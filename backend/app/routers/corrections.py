"""Answer correction endpoints - learning from user edits."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import AnswerCorrection

router = APIRouter(prefix="/api/corrections", tags=["corrections"])


@router.get("")
async def list_corrections(
    job_id: int | None = Query(None, description="Filter by job ID"),
    auto_added: bool | None = Query(None, description="Filter by auto-added-to-KB status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """List answer corrections with optional filters."""

    query = select(AnswerCorrection)

    if job_id is not None:
        query = query.where(AnswerCorrection.job_id == job_id)
    if auto_added is not None:
        query = query.where(AnswerCorrection.auto_added_to_kb == auto_added)

    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    query = query.order_by(AnswerCorrection.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    items = result.scalars().all()

    return {
        "items": [
            {
                "id": c.id,
                "job_id": c.job_id,
                "question_result_id": c.question_result_id,
                "question_text": c.question_text,
                "original_answer": c.original_answer,
                "corrected_answer": c.corrected_answer,
                "original_source": c.original_source,
                "original_confidence": c.original_confidence,
                "correction_type": c.correction_type,
                "auto_added_to_kb": c.auto_added_to_kb,
                "kb_pair_id": c.kb_pair_id,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in items
        ],
        "total": total,
    }


@router.get("/stats")
async def correction_stats(
    db: AsyncSession = Depends(get_db),
):
    """Summary statistics for answer corrections."""

    total_result = await db.execute(select(func.count(AnswerCorrection.id)))
    total = total_result.scalar() or 0

    auto_added_result = await db.execute(
        select(func.count(AnswerCorrection.id)).where(AnswerCorrection.auto_added_to_kb.is_(True))
    )
    auto_added = auto_added_result.scalar() or 0

    # Corrections by source
    source_result = await db.execute(
        select(AnswerCorrection.original_source, func.count(AnswerCorrection.id))
        .group_by(AnswerCorrection.original_source)
    )
    by_source = {row[0] or "unknown": row[1] for row in source_result.all()}

    return {
        "total_corrections": total,
        "auto_added_to_kb": auto_added,
        "corrections_by_source": by_source,
    }
