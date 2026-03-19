"""Semantic matcher — matches extracted questions against the Q&A knowledge base."""

from __future__ import annotations
import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import QAPair, FlaggedQuestion
from app.services.parser import ExtractedItem
from app.utils.embeddings import (
    compute_embedding,
    compute_embeddings,
    cosine_similarity,
    bytes_to_embedding,
    embedding_to_bytes,
)
from app.config import settings
from app.utils.questions import normalize_question_key


async def match_questions(
    items: list[ExtractedItem],
    job_id: int,
    db: AsyncSession,
    threshold: float | None = None,
) -> tuple[list[ExtractedItem], list[FlaggedQuestion]]:
    """Match extracted questions against the Q&A knowledge base.

    Returns:
        - matched_items: ExtractedItems with answer_text populated
        - flagged: FlaggedQuestion ORM objects (not yet committed)
    """
    if threshold is None:
        threshold = settings.similarity_threshold

    # Load all Q&A pairs from DB
    result = await db.execute(select(QAPair).where(QAPair.embedding.isnot(None)))
    qa_pairs = result.scalars().all()

    resolved_result = await db.execute(
        select(FlaggedQuestion).where(
            FlaggedQuestion.resolved.is_(True),
            FlaggedQuestion.resolved_answer.is_not(None),
            FlaggedQuestion.resolved_answer != "[Dismissed]",
        )
    )
    resolved_flags = resolved_result.scalars().all()
    resolved_answers: dict[str, tuple[str, object | None]] = {}
    for flagged_question in resolved_flags:
        normalized = normalize_question_key(flagged_question.extracted_question)
        previous = resolved_answers.get(normalized)
        previous_resolved_at = previous[1] if previous is not None else None
        if previous is None or (
            flagged_question.resolved_at is not None
            and (previous_resolved_at is None or flagged_question.resolved_at > previous_resolved_at)
        ):
            resolved_answers[normalized] = (
                flagged_question.resolved_answer or "",
                flagged_question.resolved_at,
            )

    if not qa_pairs:
        # No knowledge base entries — flag everything
        flagged = []
        for item in items:
            reused_answer = resolved_answers.get(normalize_question_key(item.question_text))
            if reused_answer:
                item.answer_text = reused_answer[0]
                item.confidence = 1.0
                item.matched_source = "resolved_flagged"
                continue
            flagged.append(FlaggedQuestion(
                job_id=job_id,
                extracted_question=item.question_text,
                context=None,
                location_info=item.location,
                similarity_score=0.0,
                best_match_question=None,
                resolved=False,
            ))
        return items, flagged

    # Build matrix of stored embeddings
    stored_embeddings = np.array([
        bytes_to_embedding(qa.embedding) for qa in qa_pairs
    ])

    # Batch compute all question embeddings at once
    question_texts = [item.question_text for item in items]
    question_embeddings = compute_embeddings(question_texts)

    matched_items = []
    flagged = []

    for i, item in enumerate(items):
        q_embedding = question_embeddings[i]

        # Compute similarities against all stored Q&A embeddings
        similarities = np.dot(stored_embeddings, q_embedding)
        best_idx = int(np.argmax(similarities))
        best_score = float(similarities[best_idx])
        best_qa = qa_pairs[best_idx]

        if best_score >= threshold:
            # Match found — populate the answer
            item.answer_text = best_qa.answer
            item.confidence = best_score
            item.matched_qa_id = best_qa.id
            item.matched_source = "kb_match"
            matched_items.append(item)
        else:
            reused_answer = resolved_answers.get(normalize_question_key(item.question_text))
            if reused_answer:
                item.answer_text = reused_answer[0]
                item.confidence = 1.0
                item.matched_source = "resolved_flagged"
                matched_items.append(item)
                continue

            # Below threshold — flag for human review
            flagged.append(FlaggedQuestion(
                job_id=job_id,
                extracted_question=item.question_text,
                context=None,
                location_info=item.location,
                similarity_score=best_score,
                best_match_question=best_qa.question,
                resolved=False,
            ))

    return items, flagged


async def ensure_embedding(qa: QAPair, db: AsyncSession) -> None:
    """Compute and store the embedding for a Q&A pair if missing."""
    if qa.embedding is None:
        embedding = compute_embedding(qa.question)
        qa.embedding = embedding_to_bytes(embedding)
        await db.commit()
