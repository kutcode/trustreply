"""Q&A knowledge base CRUD endpoints."""

from __future__ import annotations
import csv
import io
import json

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import QAPair
from app.schemas import (
    QAPairCreate, QAPairUpdate, QAPairResponse,
    QAPairListResponse,
)
from app.utils.embeddings import compute_embedding, compute_embeddings, embedding_to_bytes

router = APIRouter(prefix="/api/qa", tags=["qa"])


def _require_category(category: str | None) -> str:
    """Normalize and validate category values."""

    value = (category or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="Category is required")
    return value


def _normalize_import_record(record: dict) -> dict[str, str]:
    """Normalize import record keys for case/BOM-insensitive lookup."""

    normalized: dict[str, str] = {}
    for key, value in record.items():
        normalized_key = str(key or "").strip().lower().lstrip("\ufeff")
        normalized[normalized_key] = value
    return normalized


def _clean_import_value(value: object | None) -> str:
    """Convert import values to normalized strings."""

    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


@router.get("", response_model=QAPairListResponse)
async def list_qa_pairs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str = Query("", description="Search question/answer text"),
    category: str = Query("", description="Filter by category"),
    db: AsyncSession = Depends(get_db),
):
    """List Q&A pairs with pagination and search."""
    query = select(QAPair)

    if search:
        query = query.where(
            QAPair.question.ilike(f"%{search}%") | QAPair.answer.ilike(f"%{search}%")
        )
    if category:
        query = query.where(QAPair.category == category)

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Paginate
    query = query.order_by(QAPair.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)

    result = await db.execute(query)
    items = result.scalars().all()

    return QAPairListResponse(items=items, total=total, page=page, page_size=page_size)


@router.get("/categories")
async def list_categories(db: AsyncSession = Depends(get_db)):
    """List all unique categories."""
    result = await db.execute(
        select(QAPair.category).where(QAPair.category.isnot(None)).distinct()
    )
    categories = [row[0] for row in result.all() if row[0]]
    return {"categories": sorted(categories)}


@router.post("", response_model=QAPairResponse)
async def create_qa_pair(
    data: QAPairCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new Q&A pair."""
    # Compute embedding
    embedding = compute_embedding(data.question)
    category = _require_category(data.category)

    qa = QAPair(
        category=category,
        question=data.question,
        answer=data.answer,
        embedding=embedding_to_bytes(embedding),
    )
    db.add(qa)
    await db.commit()
    await db.refresh(qa)
    return qa


@router.put("/{qa_id}", response_model=QAPairResponse)
async def update_qa_pair(
    qa_id: int,
    data: QAPairUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update an existing Q&A pair."""
    qa = await db.get(QAPair, qa_id)
    if not qa:
        raise HTTPException(status_code=404, detail="Q&A pair not found")

    if data.category is not None:
        qa.category = _require_category(data.category)
    if data.answer is not None:
        qa.answer = data.answer
    if data.question is not None:
        qa.question = data.question
        # Recompute embedding when question changes
        embedding = compute_embedding(data.question)
        qa.embedding = embedding_to_bytes(embedding)

    qa.category = _require_category(qa.category)

    await db.commit()
    await db.refresh(qa)
    return qa


@router.delete("/{qa_id}")
async def delete_qa_pair(
    qa_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a Q&A pair."""
    qa = await db.get(QAPair, qa_id)
    if not qa:
        raise HTTPException(status_code=404, detail="Q&A pair not found")

    await db.delete(qa)
    await db.commit()
    return {"detail": "Deleted", "id": qa_id}


@router.post("/import")
async def import_qa_pairs(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Bulk import Q&A pairs from CSV or JSON.

    CSV format: category,question,answer (with header row)
    JSON format: [{"category": "...", "question": "...", "answer": "..."}]
    """
    content = await file.read()
    text = content.decode("utf-8-sig")
    filename = file.filename or "import.csv"

    records: list[dict[str, object]] = []
    errors: list[str] = []

    if filename.endswith(".json"):
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON format")
        if not isinstance(parsed, list):
            raise HTTPException(status_code=400, detail="JSON import must be an array of records")
        for i, record in enumerate(parsed):
            if not isinstance(record, dict):
                errors.append(f"Row {i + 1}: invalid record format (expected object)")
                continue
            records.append(_normalize_import_record(record))
    else:
        # Treat as CSV
        reader = csv.DictReader(io.StringIO(text))
        for row in reader:
            records.append(_normalize_import_record(row))

    if not records:
        raise HTTPException(status_code=400, detail="No records found in file")

    valid_records = []
    for i, record in enumerate(records):
        question = _clean_import_value(record.get("question"))
        answer = _clean_import_value(record.get("answer"))
        category = _clean_import_value(record.get("category"))

        if not category or not question or not answer:
            errors.append(f"Row {i + 1}: missing category, question, or answer")
            continue

        valid_records.append((question, answer, category))

    if not valid_records:
        return {"imported": 0, "errors": errors, "total_rows": len(records)}

    # Batch compute all embeddings at once (3-5x faster than one-by-one)
    questions = [q for q, a, c in valid_records]
    embeddings = compute_embeddings(questions)

    for (question, answer, category), emb in zip(valid_records, embeddings):
        qa = QAPair(
            category=category,
            question=question,
            answer=answer,
            embedding=embedding_to_bytes(emb),
        )
        db.add(qa)

    await db.commit()

    return {
        "imported": len(valid_records),
        "skipped": len(records) - len(valid_records),
        "errors": errors,
        "total_rows": len(records),
    }
