"""Questionnaire template endpoints."""

from __future__ import annotations

import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import QuestionnaireTemplate, TemplateAnswer, ProcessingJob, QuestionResult
from app.schemas import TemplateAnswerUpdate
from app.services.audit import log_audit

router = APIRouter(prefix="/api/templates", tags=["templates"])


class TemplateCreateRequest(BaseModel):
    job_id: int
    name: str
    description: str | None = None


class TemplateUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None


def _serialize_template(t: QuestionnaireTemplate) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "description": t.description,
        "source_job_id": t.source_job_id,
        "source_filename": t.source_filename,
        "question_count": t.question_count,
        "times_used": t.times_used,
        "last_used_at": t.last_used_at.isoformat() if t.last_used_at else None,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }


@router.get("")
async def list_templates(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """List all questionnaire templates."""

    query = select(QuestionnaireTemplate).where(QuestionnaireTemplate.deleted_at.is_(None)).order_by(QuestionnaireTemplate.updated_at.desc())

    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    items = result.scalars().all()

    return {
        "items": [_serialize_template(t) for t in items],
        "total": total,
    }


@router.post("")
async def create_template(
    body: TemplateCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Create a template from a finalized job's question results."""

    job = await db.get(ProcessingJob, body.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Load question results
    result = await db.execute(
        select(QuestionResult)
        .where(QuestionResult.job_id == body.job_id)
        .order_by(QuestionResult.question_index.asc())
    )
    question_results = result.scalars().all()

    if not question_results:
        raise HTTPException(status_code=400, detail="Job has no question results to save as template")

    template = QuestionnaireTemplate(
        name=body.name.strip(),
        description=body.description,
        source_job_id=body.job_id,
        source_filename=job.original_filename,
        question_count=0,
    )
    db.add(template)
    await db.flush()

    answer_count = 0
    for qr in question_results:
        final_answer = qr.edited_answer_text or qr.answer_text
        if not final_answer:
            continue

        ta = TemplateAnswer(
            template_id=template.id,
            question_text=qr.question_text,
            answer_text=final_answer,
            question_index=qr.question_index,
        )
        db.add(ta)
        answer_count += 1

    template.question_count = answer_count

    await log_audit(
        db,
        action_type="template_create",
        entity_type="questionnaire_template",
        entity_id=template.id,
        job_id=body.job_id,
        details={"name": body.name, "question_count": answer_count},
    )
    await db.commit()
    await db.refresh(template)

    return _serialize_template(template)


@router.get("/{template_id}")
async def get_template(template_id: int, db: AsyncSession = Depends(get_db)):
    """Get a template with its answers."""

    template = await db.get(QuestionnaireTemplate, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    result = await db.execute(
        select(TemplateAnswer)
        .where(TemplateAnswer.template_id == template_id)
        .order_by(TemplateAnswer.question_index.asc())
    )
    answers = result.scalars().all()

    data = _serialize_template(template)
    data["answers"] = [
        {
            "id": a.id,
            "question_text": a.question_text,
            "answer_text": a.answer_text,
            "question_index": a.question_index,
            "category": a.category,
        }
        for a in answers
    ]
    return data


@router.put("/{template_id}")
async def update_template(
    template_id: int,
    body: TemplateUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update template name or description."""

    template = await db.get(QuestionnaireTemplate, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    if body.name is not None:
        template.name = body.name.strip()
    if body.description is not None:
        template.description = body.description

    await log_audit(
        db,
        action_type="template_update",
        entity_type="questionnaire_template",
        entity_id=template_id,
    )
    await db.commit()
    await db.refresh(template)
    return _serialize_template(template)


@router.delete("/{template_id}")
async def delete_template(
    template_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a template and all its answers."""

    template = await db.get(QuestionnaireTemplate, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    await log_audit(
        db,
        action_type="template_delete",
        entity_type="questionnaire_template",
        entity_id=template_id,
        details={"name": template.name},
    )
    await db.delete(template)
    await db.commit()

    return {"detail": "Deleted", "id": template_id}


@router.get("/{template_id}/answers")
async def list_template_answers(
    template_id: int,
    db: AsyncSession = Depends(get_db),
):
    """List all answers in a template."""

    template = await db.get(QuestionnaireTemplate, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    result = await db.execute(
        select(TemplateAnswer)
        .where(TemplateAnswer.template_id == template_id)
        .order_by(TemplateAnswer.question_index.asc())
    )
    answers = result.scalars().all()

    return {
        "items": [
            {
                "id": a.id,
                "question_text": a.question_text,
                "answer_text": a.answer_text,
                "question_index": a.question_index,
                "category": a.category,
            }
            for a in answers
        ],
        "total": len(answers),
    }


@router.put("/{template_id}/answers/{answer_id}")
async def update_template_answer(
    template_id: int,
    answer_id: int,
    body: TemplateAnswerUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update an individual answer within a template."""

    template = await db.get(QuestionnaireTemplate, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    answer = await db.get(TemplateAnswer, answer_id)
    if not answer or answer.template_id != template_id:
        raise HTTPException(status_code=404, detail="Answer not found in this template")

    old_text = answer.answer_text
    answer.answer_text = body.answer_text.strip()

    await log_audit(
        db,
        action_type="template_update",
        entity_type="questionnaire_template",
        entity_id=template_id,
        details={"answer_id": answer_id, "question": answer.question_text},
        before_value=old_text,
        after_value=answer.answer_text,
    )
    await db.commit()

    return {
        "id": answer.id,
        "question_text": answer.question_text,
        "answer_text": answer.answer_text,
        "question_index": answer.question_index,
        "category": answer.category,
    }
