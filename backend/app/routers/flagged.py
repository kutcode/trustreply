"""Flagged questions endpoints."""

from __future__ import annotations
import csv
import datetime
import io
from collections import OrderedDict

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, async_session
from app.models import FlaggedQuestion, ProcessingJob, QAPair
from app.services.duplicate_flag import check_and_flag_duplicates
from app.schemas import (
    FlaggedQuestionResponse, FlaggedQuestionResolve,
    FlaggedQuestionListResponse,
    FlaggedBulkDismissRequest,
    FlaggedBulkDismissResponse,
    FlaggedSyncResponse,
)
from app.utils.embeddings import compute_embedding, embedding_to_bytes
from app.utils.questions import clean_display_question, normalize_question_key
from app.routers.qa import _require_category
from app.services.audit import log_audit

router = APIRouter(prefix="/api/flagged", tags=["flagged"])


async def _run_duplicate_check_flagged(entry_ids: list[int]) -> None:
    """Background task to check new KB entries (from flagged resolution) for duplicates."""
    try:
        async with async_session() as db:
            await check_and_flag_duplicates(db, entry_ids)
    except Exception:
        import logging
        logging.getLogger(__name__).exception("Background duplicate check failed for entry_ids=%s", entry_ids)


async def _load_duplicate_group(
    db: AsyncSession,
    question_text: str,
    *,
    resolved: bool | None = None,
) -> list[FlaggedQuestion]:
    """Fetch flagged questions that normalize to the same prompt."""

    query = select(FlaggedQuestion).where(
        FlaggedQuestion.extracted_question.isnot(None)
    )
    if resolved is not None:
        query = query.where(FlaggedQuestion.resolved == resolved)

    result = await db.execute(query)
    items = result.scalars().all()

    normalized = normalize_question_key(question_text)
    matches = [
        item for item in items
        if normalize_question_key(item.extracted_question) == normalized
    ]
    return matches


async def _load_filenames_for_job_ids(db: AsyncSession, job_ids: list[int]) -> list[str]:
    """Look up original filenames for a set of jobs."""

    if not job_ids:
        return []

    result = await db.execute(
        select(ProcessingJob.id, ProcessingJob.original_filename).where(ProcessingJob.id.in_(job_ids))
    )
    filename_map = {job_id: filename for job_id, filename in result.all()}
    return [filename_map[job_id] for job_id in job_ids if job_id in filename_map]


def _build_grouped_flagged_payload(rows: list[tuple[FlaggedQuestion, str]]) -> list[FlaggedQuestionResponse]:
    """Collapse duplicate flagged questions into grouped response items."""

    grouped: OrderedDict[str, dict] = OrderedDict()

    for fq, filename in rows:
        group_key = normalize_question_key(fq.extracted_question)
        bucket = grouped.get(group_key)

        if bucket is None:
            bucket = {
                "id": fq.id,
                "extracted_question": clean_display_question(fq.extracted_question),
                "normalized_question": group_key,
                "context": fq.context,
                "similarity_score": fq.similarity_score,
                "best_match_question": fq.best_match_question,
                "resolved": fq.resolved,
                "resolved_answer": fq.resolved_answer,
                "resolved_at": fq.resolved_at,
                "created_at": fq.created_at,
                "occurrence_count": 0,
                "job_ids": [],
                "filenames": [],
            }
            grouped[group_key] = bucket

        bucket["occurrence_count"] += 1

        if fq.job_id not in bucket["job_ids"]:
            bucket["job_ids"].append(fq.job_id)
        if filename not in bucket["filenames"]:
            bucket["filenames"].append(filename)

        bucket["resolved"] = bucket["resolved"] and fq.resolved

        if fq.created_at > bucket["created_at"]:
            bucket["id"] = fq.id
            bucket["context"] = fq.context
            bucket["similarity_score"] = fq.similarity_score
            bucket["best_match_question"] = fq.best_match_question
            bucket["resolved"] = fq.resolved
            bucket["resolved_answer"] = fq.resolved_answer
            bucket["resolved_at"] = fq.resolved_at
            bucket["created_at"] = fq.created_at
            bucket["extracted_question"] = clean_display_question(fq.extracted_question)

    return [FlaggedQuestionResponse(**payload) for payload in grouped.values()]


async def _sync_unresolved_flagged_with_knowledge_base(
    db: AsyncSession,
    *,
    job_id: int | None = None,
) -> FlaggedSyncResponse:
    """Resolve unresolved flagged questions that now exist in the knowledge base."""

    unresolved_query = select(FlaggedQuestion).where(FlaggedQuestion.resolved.is_(False))
    if job_id is not None:
        unresolved_query = unresolved_query.where(FlaggedQuestion.job_id == job_id)

    unresolved_result = await db.execute(unresolved_query.order_by(FlaggedQuestion.created_at.asc()))
    unresolved_flags = unresolved_result.scalars().all()

    qa_result = await db.execute(
        select(QAPair).where(QAPair.deleted_at.is_(None)).order_by(QAPair.updated_at.desc(), QAPair.id.desc())
    )
    qa_pairs = qa_result.scalars().all()

    qa_lookup: dict[str, QAPair] = {}
    for qa in qa_pairs:
        key = normalize_question_key(qa.question)
        if key not in qa_lookup:
            qa_lookup[key] = qa

    synced_occurrences = 0
    synced_groups: set[str] = set()
    resolved_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)

    for flagged_question in unresolved_flags:
        key = normalize_question_key(flagged_question.extracted_question)
        qa = qa_lookup.get(key)
        if qa is None:
            continue

        flagged_question.resolved = True
        flagged_question.resolved_answer = qa.answer
        flagged_question.resolved_at = resolved_at
        synced_occurrences += 1
        synced_groups.add(key)

    if synced_occurrences > 0:
        await db.commit()

    remaining_result = await db.execute(
        select(FlaggedQuestion).where(
            FlaggedQuestion.resolved.is_(False),
            *( [FlaggedQuestion.job_id == job_id] if job_id is not None else [] ),
        )
    )
    remaining_unresolved = len(remaining_result.scalars().all())

    return FlaggedSyncResponse(
        scanned_occurrences=len(unresolved_flags),
        synced_occurrences=synced_occurrences,
        synced_groups=len(synced_groups),
        remaining_unresolved=remaining_unresolved,
    )


async def _query_grouped_flagged(
    db: AsyncSession,
    *,
    resolved: bool | None = None,
    job_id: int | None = None,
) -> list[FlaggedQuestionResponse]:
    """Load grouped flagged questions with the same filters used by the list endpoint."""

    query = select(FlaggedQuestion, ProcessingJob.original_filename).join(
        ProcessingJob,
        ProcessingJob.id == FlaggedQuestion.job_id,
    )

    if resolved is not None:
        query = query.where(FlaggedQuestion.resolved == resolved)
    if job_id is not None:
        query = query.where(FlaggedQuestion.job_id == job_id)

    query = query.order_by(FlaggedQuestion.created_at.desc())

    result = await db.execute(query)
    rows = result.all()
    return _build_grouped_flagged_payload(rows)


@router.get("", response_model=FlaggedQuestionListResponse)
async def list_flagged(
    resolved: bool | None = Query(None, description="Filter: true=resolved, false=unresolved, none=all"),
    job_id: int | None = Query(None, description="Filter by job ID"),
    db: AsyncSession = Depends(get_db),
):
    """List flagged questions."""
    items = await _query_grouped_flagged(db, resolved=resolved, job_id=job_id)

    return FlaggedQuestionListResponse(items=items, total=len(items))


@router.get("/export")
async def export_flagged_csv(
    resolved: bool | None = Query(False, description="Export unresolved by default; set true or omit for other views"),
    job_id: int | None = Query(None, description="Filter by job ID"),
    db: AsyncSession = Depends(get_db),
):
    """Export grouped flagged questions as an import-ready CSV template."""

    items = await _query_grouped_flagged(db, resolved=resolved, job_id=job_id)

    output = io.StringIO()
    writer = csv.DictWriter(
        output,
        fieldnames=["category", "question", "answer"],
    )
    writer.writeheader()

    for item in items:
        answer = ""
        if item.resolved and item.resolved_answer and item.resolved_answer != "[Dismissed]":
            answer = item.resolved_answer

        writer.writerow(
            {
                "category": "",
                "question": item.extracted_question,
                "answer": answer,
            }
        )

    suffix = "all" if resolved is None else "resolved" if resolved else "unresolved"
    filename = f"flagged_questions_{suffix}.csv"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return Response(content=output.getvalue(), media_type="text/csv; charset=utf-8", headers=headers)


@router.post("/sync", response_model=FlaggedSyncResponse)
async def sync_flagged_questions(
    job_id: int | None = Query(None, description="Optionally sync only a single job's flagged questions"),
    db: AsyncSession = Depends(get_db),
):
    """Sync unresolved flagged questions against the current knowledge base."""

    return await _sync_unresolved_flagged_with_knowledge_base(db, job_id=job_id)


@router.post("/deduplicate")
async def deduplicate_flagged(
    db: AsyncSession = Depends(get_db),
):
    """Remove duplicate flagged question rows, keeping one per normalized question per job.

    The list endpoint already groups duplicates visually, but this cleans
    the actual DB rows so the same question from the same job isn't stored
    more than once.
    """

    result = await db.execute(select(FlaggedQuestion).order_by(FlaggedQuestion.created_at.asc()))
    all_flags = result.scalars().all()

    seen: dict[tuple[str, int], int] = {}  # (normalized_key, job_id) -> kept id
    to_delete: list[int] = []

    for fq in all_flags:
        key = (normalize_question_key(fq.extracted_question), fq.job_id)
        if key in seen:
            to_delete.append(fq.id)
        else:
            seen[key] = fq.id

    if to_delete:
        await db.execute(
            FlaggedQuestion.__table__.delete().where(FlaggedQuestion.id.in_(to_delete))
        )
        await db.commit()

    return {
        "total_before": len(all_flags),
        "duplicates_removed": len(to_delete),
        "total_after": len(all_flags) - len(to_delete),
    }


@router.delete("/dismissed")
async def purge_dismissed(
    db: AsyncSession = Depends(get_db),
):
    """Permanently delete all dismissed flagged question rows from the database."""
    result = await db.execute(
        select(FlaggedQuestion).where(FlaggedQuestion.resolved_answer == "[Dismissed]")
    )
    dismissed_items = result.scalars().all()

    if not dismissed_items:
        return {"purged": 0, "message": "No dismissed items to purge"}

    count = len(dismissed_items)
    for item in dismissed_items:
        await db.delete(item)

    await log_audit(
        db,
        action_type="flagged_bulk_dismiss",
        entity_type="flagged_question",
        details={"action": "purge_dismissed", "purged_count": count},
    )
    await db.commit()

    return {"purged": count, "message": f"Permanently removed {count} dismissed flagged question(s)"}


@router.get("/{flag_id}", response_model=FlaggedQuestionResponse)
async def get_flagged(flag_id: int, db: AsyncSession = Depends(get_db)):
    """Get a single flagged question."""
    fq = await db.get(FlaggedQuestion, flag_id)
    if not fq:
        raise HTTPException(status_code=404, detail="Flagged question not found")
    job = await db.get(ProcessingJob, fq.job_id)
    return FlaggedQuestionResponse(
        id=fq.id,
        extracted_question=clean_display_question(fq.extracted_question),
        normalized_question=normalize_question_key(fq.extracted_question),
        context=fq.context,
        similarity_score=fq.similarity_score,
        best_match_question=fq.best_match_question,
        resolved=fq.resolved,
        resolved_answer=fq.resolved_answer,
        resolved_at=fq.resolved_at,
        created_at=fq.created_at,
        occurrence_count=1,
        job_ids=[fq.job_id],
        filenames=[job.original_filename] if job else [],
    )


@router.post("/{flag_id}/resolve", response_model=FlaggedQuestionResponse)
async def resolve_flagged(
    flag_id: int,
    data: FlaggedQuestionResolve,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Resolve a flagged question by providing an answer.

    Optionally adds the Q&A pair to the knowledge base.
    """
    fq = await db.get(FlaggedQuestion, flag_id)
    if not fq:
        raise HTTPException(status_code=404, detail="Flagged question not found")
    duplicates = await _load_duplicate_group(db, fq.extracted_question, resolved=False)
    if not duplicates:
        raise HTTPException(status_code=400, detail="Already resolved")

    resolved_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    unique_questions = []
    seen_questions: set[str] = set()
    for duplicate in duplicates:
        duplicate.resolved = True
        duplicate.resolved_answer = data.answer
        duplicate.resolved_at = resolved_at

        if duplicate.extracted_question not in seen_questions:
            unique_questions.append(duplicate.extracted_question)
            seen_questions.add(duplicate.extracted_question)

    # Optionally add to knowledge base (upsert: update if same question exists)
    new_kb_entry_ids: list[int] = []
    newly_added_qa: list[QAPair] = []
    if data.add_to_knowledge_base:
        category = _require_category(data.category)
        existing_result = await db.execute(select(QAPair).where(QAPair.deleted_at.is_(None)))
        existing_map: dict[str, QAPair] = {}
        for qa in existing_result.scalars().all():
            if qa.question:
                existing_map[qa.question.strip().lower()] = qa

        for question in unique_questions:
            normalized_q = question.strip().lower()
            embedding = compute_embedding(question)

            if normalized_q in existing_map:
                # Update existing KB entry
                existing_qa = existing_map[normalized_q]
                existing_qa.answer = data.answer
                existing_qa.category = category
                existing_qa.question = question
                existing_qa.embedding = embedding_to_bytes(embedding)
                new_kb_entry_ids.append(existing_qa.id)
            else:
                qa = QAPair(
                    category=category,
                    question=question,
                    answer=data.answer,
                    embedding=embedding_to_bytes(embedding),
                )
                db.add(qa)
                newly_added_qa.append(qa)
                existing_map[normalized_q] = qa

    await log_audit(
        db,
        action_type="flagged_resolve",
        entity_type="flagged_question",
        entity_id=flag_id,
        job_id=fq.job_id,
        after_value=data.answer,
        details={
            "add_to_kb": data.add_to_knowledge_base,
            "occurrence_count": len(duplicates),
        },
    )
    # Flush to get IDs for newly added QAPair entries
    if data.add_to_knowledge_base and newly_added_qa:
        await db.flush()
        for qa in newly_added_qa:
            if qa.id:
                new_kb_entry_ids.append(qa.id)
    await db.commit()

    # Trigger background duplicate check for new KB entries
    if new_kb_entry_ids:
        background_tasks.add_task(_run_duplicate_check_flagged, new_kb_entry_ids)

    await db.refresh(fq)
    job_ids = sorted({duplicate.job_id for duplicate in duplicates})
    filenames = await _load_filenames_for_job_ids(db, job_ids)
    return FlaggedQuestionResponse(
        id=fq.id,
        extracted_question=clean_display_question(fq.extracted_question),
        normalized_question=normalize_question_key(fq.extracted_question),
        context=fq.context,
        similarity_score=fq.similarity_score,
        best_match_question=fq.best_match_question,
        resolved=fq.resolved,
        resolved_answer=fq.resolved_answer,
        resolved_at=fq.resolved_at,
        created_at=fq.created_at,
        occurrence_count=len(duplicates),
        job_ids=job_ids,
        filenames=filenames,
    )


@router.post("/{flag_id}/dismiss", response_model=FlaggedQuestionResponse)
async def dismiss_flagged(
    flag_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Dismiss a flagged question (mark resolved without adding to KB)."""
    fq = await db.get(FlaggedQuestion, flag_id)
    if not fq:
        raise HTTPException(status_code=404, detail="Flagged question not found")
    duplicates = await _load_duplicate_group(db, fq.extracted_question, resolved=False)
    if not duplicates:
        raise HTTPException(status_code=400, detail="Already resolved")

    dismissed_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    for duplicate in duplicates:
        duplicate.resolved = True
        duplicate.resolved_at = dismissed_at
        duplicate.resolved_answer = "[Dismissed]"

    await log_audit(
        db,
        action_type="flagged_dismiss",
        entity_type="flagged_question",
        entity_id=flag_id,
        job_id=fq.job_id,
        details={"occurrence_count": len(duplicates)},
    )
    await db.commit()
    await db.refresh(fq)
    job_ids = sorted({duplicate.job_id for duplicate in duplicates})
    filenames = await _load_filenames_for_job_ids(db, job_ids)
    return FlaggedQuestionResponse(
        id=fq.id,
        extracted_question=clean_display_question(fq.extracted_question),
        normalized_question=normalize_question_key(fq.extracted_question),
        context=fq.context,
        similarity_score=fq.similarity_score,
        best_match_question=fq.best_match_question,
        resolved=fq.resolved,
        resolved_answer=fq.resolved_answer,
        resolved_at=fq.resolved_at,
        created_at=fq.created_at,
        occurrence_count=len(duplicates),
        job_ids=job_ids,
        filenames=filenames,
    )


@router.post("/dismiss-bulk", response_model=FlaggedBulkDismissResponse)
async def dismiss_flagged_bulk(
    data: FlaggedBulkDismissRequest,
    db: AsyncSession = Depends(get_db),
):
    """Dismiss multiple grouped flagged questions in one request."""

    unique_ids = sorted(set(data.ids))
    if not unique_ids:
        raise HTTPException(status_code=400, detail="No flagged question ids provided")

    result = await db.execute(select(FlaggedQuestion).where(FlaggedQuestion.id.in_(unique_ids)))
    found_items = result.scalars().all()
    found_by_id = {item.id: item for item in found_items}
    not_found_ids = [item_id for item_id in unique_ids if item_id not in found_by_id]

    dismissed_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    dismissed_groups = 0
    dismissed_occurrences = 0
    already_resolved_groups = 0
    processed_groups: set[str] = set()

    for item_id in unique_ids:
        flagged_item = found_by_id.get(item_id)
        if flagged_item is None:
            continue

        group_key = normalize_question_key(flagged_item.extracted_question)
        if group_key in processed_groups:
            continue
        processed_groups.add(group_key)

        duplicates = await _load_duplicate_group(db, flagged_item.extracted_question, resolved=False)
        if not duplicates:
            already_resolved_groups += 1
            continue

        for duplicate in duplicates:
            duplicate.resolved = True
            duplicate.resolved_at = dismissed_at
            duplicate.resolved_answer = "[Dismissed]"

        dismissed_groups += 1
        dismissed_occurrences += len(duplicates)

    if dismissed_occurrences > 0:
        await log_audit(
            db,
            action_type="flagged_bulk_dismiss",
            entity_type="flagged_question",
            details={
                "dismissed_groups": dismissed_groups,
                "dismissed_occurrences": dismissed_occurrences,
            },
        )
        await db.commit()

    return FlaggedBulkDismissResponse(
        requested_ids=len(unique_ids),
        dismissed_groups=dismissed_groups,
        dismissed_occurrences=dismissed_occurrences,
        already_resolved_groups=already_resolved_groups,
        not_found_ids=not_found_ids,
    )
