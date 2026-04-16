"""Tests for the semantic matcher module."""

import datetime

import pytest_asyncio
from app.models import FlaggedQuestion, QAPair
from app.services.parser import ExtractedItem
from app.services.matcher import match_questions
from app.utils.embeddings import compute_embedding, embedding_to_bytes


@pytest_asyncio.fixture
async def seeded_db(db_session):
    """DB session with pre-loaded Q&A pairs."""
    pairs = [
        ("What is your company name?", "Acme Corporation", "General"),
        ("Describe your security policy.", "We follow ISO 27001 standards.", "Security"),
        ("What is your data retention period?", "We retain data for 7 years.", "Compliance"),
    ]
    for q, a, cat in pairs:
        emb = compute_embedding(q)
        qa = QAPair(
            category=cat,
            question=q,
            answer=a,
            embedding=embedding_to_bytes(emb),
        )
        db_session.add(qa)
    await db_session.commit()
    return db_session


async def test_exact_match(seeded_db):
    items = [ExtractedItem(
        question_text="What is your company name?",
        item_type="table_cell",
        location={"table_idx": 0, "row_idx": 0},
    )]
    matched_items, flagged = await match_questions(items, job_id=1, db=seeded_db)
    assert items[0].answer_text == "Acme Corporation"
    assert len(flagged) == 0


async def test_semantic_match(seeded_db):
    items = [ExtractedItem(
        question_text="Please provide the name of your organization",
        item_type="table_cell",
        location={"table_idx": 0, "row_idx": 0},
    )]
    # Use a lower threshold since paraphrased questions may not hit 0.75
    matched_items, flagged = await match_questions(
        items, job_id=1, db=seeded_db, threshold=0.5
    )
    assert items[0].answer_text is not None
    assert len(flagged) == 0


async def test_below_threshold_flagged(seeded_db):
    items = [ExtractedItem(
        question_text="What color is the sky on Mars at sunset?",
        item_type="table_cell",
        location={"table_idx": 0, "row_idx": 0},
    )]
    matched_items, flagged = await match_questions(items, job_id=1, db=seeded_db)
    assert items[0].answer_text is None
    assert len(flagged) == 1
    assert flagged[0].similarity_score is not None
    assert flagged[0].best_match_question is not None


async def test_empty_knowledge_base(db_session):
    items = [ExtractedItem(
        question_text="What is your company name?",
        item_type="table_cell",
        location={"table_idx": 0, "row_idx": 0},
    )]
    matched_items, flagged = await match_questions(items, job_id=1, db=db_session)
    assert len(flagged) == 1
    assert flagged[0].similarity_score == 0.0
    assert flagged[0].best_match_question is None


async def test_multiple_items_mixed(seeded_db):
    items = [
        ExtractedItem(
            question_text="What is your company name?",
            item_type="table_cell",
            location={"table_idx": 0, "row_idx": 0},
        ),
        ExtractedItem(
            question_text="What is the airspeed velocity of an unladen swallow?",
            item_type="table_cell",
            location={"table_idx": 0, "row_idx": 1},
        ),
    ]
    matched_items, flagged = await match_questions(items, job_id=1, db=seeded_db)
    assert items[0].answer_text is not None  # should match
    assert items[1].answer_text is None  # should be flagged
    assert len(flagged) == 1


async def test_reuses_resolved_flagged_answer(seeded_db):
    seeded_db.add(FlaggedQuestion(
        job_id=99,
        extracted_question="1. Describe your disaster recovery plan.",
        resolved=True,
        resolved_answer="We maintain a documented recovery plan.",
        resolved_at=datetime.datetime.now(datetime.timezone.utc),
    ))
    await seeded_db.commit()

    items = [ExtractedItem(
        question_text="Describe your disaster recovery plan.",
        item_type="table_cell",
        location={"table_idx": 0, "row_idx": 0},
    )]

    matched_items, flagged = await match_questions(items, job_id=1, db=seeded_db)
    assert items[0].answer_text == "We maintain a documented recovery plan."
    assert len(flagged) == 0
