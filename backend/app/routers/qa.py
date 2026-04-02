"""Q&A knowledge base CRUD endpoints."""

from __future__ import annotations
import csv
import datetime
import io
import json
from collections import defaultdict
from itertools import combinations

import numpy as np
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, Query, Response
from sqlalchemy import select, func, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from app.database import get_db, async_session
from app.models import QAPair, DuplicateReview
from app.schemas import (
    QAPairCreate, QAPairUpdate, QAPairResponse,
    QAPairListResponse,
    DuplicateCluster, DuplicateDetectionResponse,
    MergeRequest, MergeResponse,
    BulkMergeRequest, BulkMergeResponse,
    DuplicateClassifyRequest, DuplicateClassifyResponse, ClassifiedPair,
    DuplicateReviewItem, DuplicateReviewListResponse,
    DuplicateReviewAction, DuplicateReviewActionResponse,
    BulkDuplicateReviewRequest, BulkDuplicateReviewResponse,
)
from app.utils.embeddings import (
    compute_embedding, compute_embeddings, embedding_to_bytes, bytes_to_embedding,
)
from app.services.audit import log_audit
from app.services.duplicate_classifier import classify_duplicate_pairs, get_llm_model_name
from app.services.duplicate_flag import check_and_flag_duplicates
from app.config import settings

router = APIRouter(prefix="/api/qa", tags=["qa"])

# Semantic dedup threshold is loaded from settings.semantic_dedup_threshold.
# Questions above this similarity are treated as "same question, different wording"
# and the existing entry is updated instead of creating a new one.


async def _run_duplicate_check(entry_ids: list[int]) -> None:
    """Background task to check new entries for duplicates."""
    try:
        async with async_session() as db:
            await check_and_flag_duplicates(db, entry_ids)
    except Exception:
        import logging
        logging.getLogger(__name__).exception("Background duplicate check failed for entry_ids=%s", entry_ids)


def _require_category(category: str | None) -> str:
    """Normalize and validate category values."""

    value = (category or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="Category is required")
    return value


async def _find_semantic_match(
    embedding: np.ndarray,
    db: AsyncSession,
    threshold: float = settings.semantic_dedup_threshold,
    exclude_id: int | None = None,
) -> QAPair | None:
    """Find an existing KB entry whose question is semantically equivalent.

    Returns the best match above `threshold`, or None.
    This prevents "What is your company's legal name?" and
    "Please provide the full legal name of your organization"
    from creating separate entries.
    """
    result = await db.execute(
        select(QAPair).where(QAPair.embedding.isnot(None), QAPair.deleted_at.is_(None))
    )
    qa_pairs = result.scalars().all()
    if not qa_pairs:
        return None

    stored = np.array([bytes_to_embedding(qa.embedding) for qa in qa_pairs])
    similarities = stored @ embedding  # cosine similarity (embeddings are normalized)

    best_idx = int(np.argmax(similarities))
    best_sim = float(similarities[best_idx])

    if best_sim >= threshold:
        match = qa_pairs[best_idx]
        if exclude_id is not None and match.id == exclude_id:
            return None
        return match
    return None


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
    query = select(QAPair).where(QAPair.deleted_at.is_(None))

    if search:
        escaped_search = search.replace("%", r"\%").replace("_", r"\_")
        query = query.where(
            QAPair.question.ilike(f"%{escaped_search}%", escape="\\") | QAPair.answer.ilike(f"%{escaped_search}%", escape="\\")
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
        select(QAPair.category).where(QAPair.category.isnot(None)).where(QAPair.deleted_at.is_(None)).distinct()
    )
    categories = [row[0] for row in result.all() if row[0]]
    return {"categories": sorted(categories)}


@router.get("/export")
async def export_qa_pairs(
    format: str = Query("csv", description="Export format: csv or json"),
    category: str = Query("", description="Optional category filter"),
    db: AsyncSession = Depends(get_db),
):
    """Export all Q&A pairs as CSV or JSON download."""
    query = select(QAPair).where(QAPair.deleted_at.is_(None))
    if category:
        query = query.where(QAPair.category == category)
    query = query.order_by(QAPair.category, QAPair.created_at.desc())
    result = await db.execute(query)
    items = result.scalars().all()

    if format == "json":
        data = [
            {"category": item.category or "", "question": item.question, "answer": item.answer}
            for item in items
        ]
        content = json.dumps(data, indent=2, ensure_ascii=False)
        headers = {"Content-Disposition": 'attachment; filename="knowledge_base.json"'}
        return Response(content=content, media_type="application/json; charset=utf-8", headers=headers)

    # Default: CSV
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=["category", "question", "answer"])
    writer.writeheader()
    for item in items:
        writer.writerow({"category": item.category or "", "question": item.question, "answer": item.answer})
    headers = {"Content-Disposition": 'attachment; filename="knowledge_base.csv"'}
    return Response(content=output.getvalue(), media_type="text/csv; charset=utf-8", headers=headers)


@router.post("", response_model=QAPairResponse)
async def create_qa_pair(
    data: QAPairCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Create a new Q&A pair, or update the existing one if the same question already exists.

    Duplicate detection is two-tier:
      1. Exact text match (case-insensitive) — always merges.
      2. Semantic similarity above threshold — merges into the existing entry
         and keeps the better-worded question. This prevents "What is your
         company name?" and "Please provide your company's legal name" from
         creating separate entries.
    """
    category = _require_category(data.category)
    normalized_q = data.question.strip().lower()

    # Tier 1: exact text match
    result = await db.execute(select(QAPair).where(func.lower(QAPair.question) == normalized_q).where(QAPair.deleted_at.is_(None)))
    existing = result.scalars().first()

    # Tier 2: semantic match (if no exact match found)
    embedding = compute_embedding(data.question)
    if not existing:
        existing = await _find_semantic_match(embedding, db)

    if existing:
        before_answer = existing.answer
        existing.answer = data.answer
        existing.category = category
        existing.embedding = embedding_to_bytes(embedding)
        # Keep the longer/more descriptive question wording
        if len(data.question.strip()) > len((existing.question or "").strip()):
            existing.question = data.question
        await log_audit(
            db,
            action_type="kb_update",
            entity_type="qa_pair",
            entity_id=existing.id,
            before_value=before_answer,
            after_value=data.answer,
            details={"merged_question": data.question, "semantic_dedup": True},
        )
        await db.commit()
        await db.refresh(existing)
        background_tasks.add_task(_run_duplicate_check, [existing.id])
        return existing

    qa = QAPair(
        category=category,
        question=data.question,
        answer=data.answer,
        embedding=embedding_to_bytes(embedding),
    )
    db.add(qa)
    await db.flush()  # get qa.id
    await log_audit(
        db,
        action_type="kb_create",
        entity_type="qa_pair",
        entity_id=qa.id,
        after_value=data.answer,
        details={"question": data.question, "category": category},
    )
    await db.commit()
    await db.refresh(qa)
    background_tasks.add_task(_run_duplicate_check, [qa.id])
    return qa


# ── KB Deduplication helpers ──────────────────────────────────────


def _find(parent: list[int], i: int) -> int:
    while parent[i] != i:
        parent[i] = parent[parent[i]]
        i = parent[i]
    return i


def _union(parent: list[int], rank: list[int], i: int, j: int) -> None:
    ri, rj = _find(parent, i), _find(parent, j)
    if ri == rj:
        return
    if rank[ri] < rank[rj]:
        ri, rj = rj, ri
    parent[rj] = ri
    if rank[ri] == rank[rj]:
        rank[ri] += 1


@router.get("/duplicates", response_model=DuplicateDetectionResponse)
async def detect_duplicates(
    threshold: float = Query(0.85, ge=0.0, le=1.0, description="Cosine similarity threshold"),
    category: str | None = Query(None, description="Optional category filter"),
    db: AsyncSession = Depends(get_db),
):
    """Detect near-duplicate KB entries using embedding similarity."""

    query = select(QAPair).where(QAPair.deleted_at.is_(None)).where(QAPair.embedding.isnot(None))
    if category:
        query = query.where(QAPair.category == category)

    result = await db.execute(query)
    entries = list(result.scalars().all())

    if len(entries) < 2:
        return DuplicateDetectionResponse(clusters=[], total_duplicates=0, total_entries_scanned=len(entries))

    # Build embedding matrix
    embeddings = np.array([bytes_to_embedding(e.embedding) for e in entries])

    # Cosine similarity matrix (embeddings are already normalized)
    sim_matrix = embeddings @ embeddings.T

    n = len(entries)
    parent = list(range(n))
    rank = [0] * n

    # Union entries above threshold
    for i in range(n):
        for j in range(i + 1, n):
            if sim_matrix[i, j] >= threshold:
                _union(parent, rank, i, j)

    # Collect clusters
    cluster_map: dict[int, list[int]] = defaultdict(list)
    for i in range(n):
        root = _find(parent, i)
        cluster_map[root].append(i)

    clusters: list[DuplicateCluster] = []
    total_duplicates = 0
    for indices in cluster_map.values():
        if len(indices) < 2:
            continue

        # Average pairwise similarity
        pair_sims = []
        for a in range(len(indices)):
            for b in range(a + 1, len(indices)):
                pair_sims.append(float(sim_matrix[indices[a], indices[b]]))
        avg_sim = sum(pair_sims) / len(pair_sims) if pair_sims else 0.0

        cluster_entries = [entries[i] for i in indices]
        # Recommend keeping the most recently updated entry
        canonical = max(cluster_entries, key=lambda e: e.updated_at or e.created_at)

        clusters.append(DuplicateCluster(
            canonical_id=canonical.id,
            entries=[QAPairResponse.model_validate(e) for e in cluster_entries],
            similarity=round(avg_sim, 4),
        ))
        total_duplicates += len(indices)

    # Sort by cluster size descending, cap at 100
    clusters.sort(key=lambda c: len(c.entries), reverse=True)
    clusters = clusters[:100]

    return DuplicateDetectionResponse(
        clusters=clusters,
        total_duplicates=total_duplicates,
        total_entries_scanned=len(entries),
    )


async def _execute_merge(
    db: AsyncSession, keep_id: int, delete_ids: list[int],
) -> int:
    """Execute a single merge: soft-delete entries and log audit. Returns deleted count."""

    kept = await db.get(QAPair, keep_id)
    if not kept or kept.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"Entry to keep (id={keep_id}) not found or already deleted")

    deleted_count = 0
    for did in delete_ids:
        if did == keep_id:
            raise HTTPException(status_code=400, detail=f"Cannot delete the entry being kept (id={did})")
        entry = await db.get(QAPair, did)
        if not entry or entry.deleted_at is not None:
            raise HTTPException(status_code=404, detail=f"Entry to delete (id={did}) not found or already deleted")
        entry.deleted_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
        deleted_count += 1

    await log_audit(
        db,
        action_type="kb_merge",
        entity_type="qa_pair",
        entity_id=keep_id,
        details={
            "kept_id": keep_id,
            "deleted_ids": delete_ids,
            "deleted_count": deleted_count,
        },
    )
    return deleted_count


@router.post("/merge", response_model=MergeResponse)
async def merge_duplicates(
    data: MergeRequest,
    db: AsyncSession = Depends(get_db),
):
    """Merge a cluster of duplicate KB entries by keeping one and soft-deleting the rest."""

    deleted_count = await _execute_merge(db, data.keep_id, data.delete_ids)
    await db.commit()
    return MergeResponse(kept_id=data.keep_id, deleted_count=deleted_count)


@router.post("/merge/bulk", response_model=BulkMergeResponse)
async def bulk_merge_duplicates(
    data: BulkMergeRequest,
    db: AsyncSession = Depends(get_db),
):
    """Merge multiple clusters of duplicate KB entries at once."""

    total_deleted = 0
    for merge in data.merges:
        total_deleted += await _execute_merge(db, merge.keep_id, merge.delete_ids)

    await db.commit()
    return BulkMergeResponse(merged_clusters=len(data.merges), total_deleted=total_deleted)


# ── Duplicate Review endpoints ───────────────────────────────────


@router.post("/duplicates/classify", response_model=DuplicateClassifyResponse)
async def classify_duplicates(
    data: DuplicateClassifyRequest,
    db: AsyncSession = Depends(get_db),
):
    """Run embedding-based duplicate detection, then classify pairs with LLM."""

    # Reuse the embedding-based detection logic
    query = select(QAPair).where(QAPair.deleted_at.is_(None)).where(QAPair.embedding.isnot(None))
    if data.category:
        query = query.where(QAPair.category == data.category)

    result = await db.execute(query)
    entries = list(result.scalars().all())

    if len(entries) < 2:
        return DuplicateClassifyResponse(pairs=[], total_classified=0, llm_model=get_llm_model_name())

    # Build embedding matrix and compute similarities
    embeddings_array = np.array([bytes_to_embedding(e.embedding) for e in entries])
    sim_matrix = embeddings_array @ embeddings_array.T

    n = len(entries)
    parent = list(range(n))
    rank_list = [0] * n

    for i in range(n):
        for j in range(i + 1, n):
            if sim_matrix[i, j] >= data.threshold:
                _union(parent, rank_list, i, j)

    # Collect clusters
    cluster_map: dict[int, list[int]] = defaultdict(list)
    for i in range(n):
        root = _find(parent, i)
        cluster_map[root].append(i)

    # Generate pairwise combinations from clusters
    all_pairs: list[tuple[QAPair, QAPair, float]] = []
    for indices in cluster_map.values():
        if len(indices) < 2:
            continue
        for a_idx, b_idx in combinations(indices, 2):
            entry_a = entries[a_idx]
            entry_b = entries[b_idx]
            similarity = float(sim_matrix[a_idx, b_idx])
            # Normalize order
            if entry_a.id > entry_b.id:
                entry_a, entry_b = entry_b, entry_a
            all_pairs.append((entry_a, entry_b, similarity))

    if not all_pairs:
        return DuplicateClassifyResponse(pairs=[], total_classified=0, llm_model=get_llm_model_name())

    # Check which pairs already have DuplicateReview records with classification
    new_pairs: list[tuple[QAPair, QAPair, float]] = []
    existing_review_map: dict[tuple[int, int], DuplicateReview] = {}

    for entry_a, entry_b, similarity in all_pairs:
        existing_result = await db.execute(
            select(DuplicateReview).where(
                DuplicateReview.entry_a_id == entry_a.id,
                DuplicateReview.entry_b_id == entry_b.id,
                DuplicateReview.classification.isnot(None),
            )
        )
        existing_review = existing_result.scalars().first()
        if existing_review:
            existing_review_map[(entry_a.id, entry_b.id)] = existing_review
        else:
            new_pairs.append((entry_a, entry_b, similarity))

    # Create DuplicateReview records for new pairs (without classification yet)
    review_records: dict[int, DuplicateReview] = {}  # pair_index -> review
    for idx, (entry_a, entry_b, similarity) in enumerate(new_pairs):
        # Check if unclassified record exists
        existing_result = await db.execute(
            select(DuplicateReview).where(
                DuplicateReview.entry_a_id == entry_a.id,
                DuplicateReview.entry_b_id == entry_b.id,
            )
        )
        review = existing_result.scalars().first()
        if not review:
            review = DuplicateReview(
                entry_a_id=entry_a.id,
                entry_b_id=entry_b.id,
                similarity_score=round(similarity, 4),
                source="manual_scan",
                status="pending",
            )
            db.add(review)
        review_records[idx] = review

    if review_records:
        await db.flush()  # Get IDs

    # Send unclassified pairs to LLM
    classified_pairs: list[ClassifiedPair] = []

    if new_pairs:
        classifications = await classify_duplicate_pairs(new_pairs, db)

        # Update DuplicateReview records with classification
        for item in classifications:
            pair_idx = item["pair_index"]
            review = review_records.get(pair_idx)
            if not review:
                continue

            review.classification = item["classification"]
            review.reason = item["reason"]
            review.recommended_keep_id = item.get("recommended_keep_id")

            entry_a, entry_b, similarity = new_pairs[pair_idx]
            classified_pairs.append(ClassifiedPair(
                review_id=review.id,
                entry_a=QAPairResponse.model_validate(entry_a),
                entry_b=QAPairResponse.model_validate(entry_b),
                similarity=round(similarity, 4),
                classification=item["classification"],
                reason=item["reason"],
                recommended_keep_id=item.get("recommended_keep_id"),
            ))

    # Also include already-classified pairs in response
    for (a_id, b_id), review in existing_review_map.items():
        # Load related entries explicitly to avoid MissingGreenlet in async context
        entry_a = await db.get(QAPair, a_id)
        entry_b = await db.get(QAPair, b_id)
        if not entry_a or not entry_b:
            continue
        classified_pairs.append(ClassifiedPair(
            review_id=review.id,
            entry_a=QAPairResponse.model_validate(entry_a),
            entry_b=QAPairResponse.model_validate(entry_b),
            similarity=review.similarity_score,
            classification=review.classification or "probably_same",
            reason=review.reason or "",
            recommended_keep_id=review.recommended_keep_id,
        ))

    await db.commit()

    return DuplicateClassifyResponse(
        pairs=classified_pairs,
        total_classified=len(classified_pairs),
        llm_model=get_llm_model_name(),
    )


@router.get("/duplicates/reviews", response_model=DuplicateReviewListResponse)
async def list_duplicate_reviews(
    status: str = Query("all", description="Filter: pending, reviewed, dismissed, or all"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """List duplicate review items with pagination."""

    def _active_reviews_query(extra_filter=None):
        """Build a query for reviews where both entries are not soft-deleted."""
        EntryA = aliased(QAPair)
        EntryB = aliased(QAPair)
        q = (
            select(DuplicateReview)
            .join(EntryA, EntryA.id == DuplicateReview.entry_a_id)
            .where(EntryA.deleted_at.is_(None))
            .join(EntryB, EntryB.id == DuplicateReview.entry_b_id)
            .where(EntryB.deleted_at.is_(None))
        )
        if extra_filter is not None:
            q = q.where(extra_filter)
        return q

    # Base query with optional status filter
    status_filter = DuplicateReview.status == status if status != "all" else None
    base_query = _active_reviews_query(status_filter)

    # Count
    count_query = select(func.count()).select_from(base_query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Counts for pending/reviewed (each gets its own fresh aliases)
    pending_q = select(func.count()).select_from(
        _active_reviews_query(DuplicateReview.status == "pending").subquery()
    )
    reviewed_q = select(func.count()).select_from(
        _active_reviews_query(DuplicateReview.status == "reviewed").subquery()
    )
    pending_result, reviewed_result = await db.execute(pending_q), await db.execute(reviewed_q)
    pending_count = pending_result.scalar() or 0
    reviewed_count = reviewed_result.scalar() or 0

    # Paginate with eager loading of related entries
    paginated = (
        base_query
        .options(selectinload(DuplicateReview.entry_a), selectinload(DuplicateReview.entry_b))
        .order_by(DuplicateReview.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    result = await db.execute(paginated)
    reviews = result.scalars().all()

    items = []
    for review in reviews:
        entry_a = review.entry_a
        entry_b = review.entry_b
        if not entry_a or not entry_b:
            continue
        items.append(DuplicateReviewItem(
            id=review.id,
            entry_a=QAPairResponse.model_validate(entry_a),
            entry_b=QAPairResponse.model_validate(entry_b),
            similarity_score=review.similarity_score,
            classification=review.classification,
            reason=review.reason,
            recommended_keep_id=review.recommended_keep_id,
            status=review.status,
            source=review.source,
            created_at=review.created_at,
        ))

    return DuplicateReviewListResponse(
        items=items,
        total=total,
        pending_count=pending_count,
        reviewed_count=reviewed_count,
    )


async def _execute_review_action(
    db: AsyncSession,
    review: DuplicateReview,
    action: str,
) -> DuplicateReviewActionResponse:
    """Execute a single duplicate review action. Caller must commit."""

    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    kept_id: int | None = None
    deleted_id: int | None = None

    entry_a = await db.get(QAPair, review.entry_a_id)
    entry_b = await db.get(QAPair, review.entry_b_id)

    if not entry_a or not entry_b:
        raise HTTPException(status_code=404, detail="One or both entries no longer exist")
    if entry_a.deleted_at is not None or entry_b.deleted_at is not None:
        raise HTTPException(status_code=400, detail="One or both entries have already been deleted")

    if action == "keep_left":
        # Soft-delete entry_b
        entry_b.deleted_at = now
        kept_id = entry_a.id
        deleted_id = entry_b.id
        review.status = "reviewed"
        review.reviewed_action = "keep_left"
        review.reviewed_at = now

    elif action == "keep_right":
        # Soft-delete entry_a
        entry_a.deleted_at = now
        kept_id = entry_b.id
        deleted_id = entry_a.id
        review.status = "reviewed"
        review.reviewed_action = "keep_right"
        review.reviewed_at = now

    elif action == "keep_both":
        # Mark as dismissed
        review.status = "dismissed"
        review.reviewed_action = "keep_both"
        review.reviewed_at = now

    elif action == "merge":
        # Soft-delete the non-recommended entry (or entry_b if no recommendation)
        if review.recommended_keep_id and review.recommended_keep_id == entry_a.id:
            entry_b.deleted_at = now
            kept_id = entry_a.id
            deleted_id = entry_b.id
        else:
            entry_a.deleted_at = now
            kept_id = entry_b.id
            deleted_id = entry_a.id
        review.status = "reviewed"
        review.reviewed_action = "merged"
        review.reviewed_at = now

    # Log audit
    await log_audit(
        db,
        action_type="kb_duplicate_review",
        entity_type="duplicate_review",
        entity_id=review.id,
        details={
            "action": action,
            "entry_a_id": review.entry_a_id,
            "entry_b_id": review.entry_b_id,
            "kept_id": kept_id,
            "deleted_id": deleted_id,
        },
    )

    # Dismiss any OTHER pending reviews that reference the deleted entry
    if deleted_id is not None:
        other_reviews_result = await db.execute(
            select(DuplicateReview).where(
                DuplicateReview.status == "pending",
                DuplicateReview.id != review.id,
                or_(
                    DuplicateReview.entry_a_id == deleted_id,
                    DuplicateReview.entry_b_id == deleted_id,
                ),
            )
        )
        other_reviews = other_reviews_result.scalars().all()
        for other in other_reviews:
            other.status = "dismissed"
            other.reviewed_action = "auto_dismissed"
            other.reviewed_at = now

    return DuplicateReviewActionResponse(
        id=review.id,
        status=review.status,
        action=action,
        kept_id=kept_id,
        deleted_id=deleted_id,
    )


@router.post("/duplicates/reviews/{review_id}/action", response_model=DuplicateReviewActionResponse)
async def action_duplicate_review(
    review_id: int,
    data: DuplicateReviewAction,
    db: AsyncSession = Depends(get_db),
):
    """Take action on a duplicate review."""

    review = await db.get(DuplicateReview, review_id)
    if not review:
        raise HTTPException(status_code=404, detail="Duplicate review not found")
    if review.status != "pending":
        raise HTTPException(status_code=400, detail=f"Review already {review.status}")

    response = await _execute_review_action(db, review, data.action)
    await db.commit()
    return response


@router.post("/duplicates/reviews/bulk-action", response_model=BulkDuplicateReviewResponse)
async def bulk_action_duplicate_reviews(
    data: BulkDuplicateReviewRequest,
    db: AsyncSession = Depends(get_db),
):
    """Process multiple duplicate review actions at once."""

    processed = 0
    errors: list[str] = []

    for item in data.actions:
        review = await db.get(DuplicateReview, item.review_id)
        if not review:
            errors.append(f"Review {item.review_id} not found")
            continue
        if review.status != "pending":
            errors.append(f"Review {item.review_id} already {review.status}")
            continue

        try:
            async with db.begin_nested():  # savepoint per action
                await _execute_review_action(db, review, item.action)
            processed += 1
        except HTTPException as exc:
            errors.append(f"Review {item.review_id}: {exc.detail}")
        except Exception as exc:
            errors.append(f"Review {item.review_id}: {str(exc)}")

    if processed > 0:
        await db.commit()

    return BulkDuplicateReviewResponse(processed=processed, errors=errors)


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

    before_answer = qa.answer
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

    await log_audit(
        db,
        action_type="kb_update",
        entity_type="qa_pair",
        entity_id=qa_id,
        before_value=before_answer,
        after_value=qa.answer,
    )
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

    await log_audit(
        db,
        action_type="kb_delete",
        entity_type="qa_pair",
        entity_id=qa_id,
        before_value=qa.answer,
        details={"question": qa.question, "category": qa.category},
    )
    qa.deleted_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    await db.commit()
    return {"detail": "Deleted", "id": qa_id}


@router.post("/import")
async def import_qa_pairs(
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = None,
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
        return {"imported": 0, "errors": errors, "duplicates": 0, "duplicate_questions": [], "total_rows": len(records)}

    # Load existing KB entries keyed by normalized question for upsert
    existing_result = await db.execute(select(QAPair).where(QAPair.deleted_at.is_(None)))
    existing_entries = existing_result.scalars().all()
    existing_map: dict[str, QAPair] = {}
    for qa in existing_entries:
        if qa.question:
            existing_map[qa.question.strip().lower()] = qa

    # Build embedding matrix for semantic dedup against existing KB
    existing_with_embeddings = [qa for qa in existing_entries if qa.embedding is not None]
    stored_embeddings = (
        np.array([bytes_to_embedding(qa.embedding) for qa in existing_with_embeddings])
        if existing_with_embeddings else None
    )

    new_records = []
    updated_records = []  # (question, answer, category, existing_qa)
    seen_in_import: set[str] = set()
    semantic_merges = 0

    for question, answer, category in valid_records:
        normalized_q = question.strip().lower()
        # Skip duplicates within the same import file
        if normalized_q in seen_in_import:
            continue
        seen_in_import.add(normalized_q)

        if normalized_q in existing_map:
            # Exact text match — update existing
            updated_records.append((question, answer, category, existing_map[normalized_q]))
        else:
            new_records.append((question, answer, category))

    # Batch compute embeddings for ALL unique questions (new + updated) in one call.
    # Use a dict to look up embeddings by question text later — avoids fragile index math.
    all_unique_questions = [q for q, a, c in new_records] + [q for q, a, c, _ in updated_records]
    embedding_map: dict[str, np.ndarray] = {}
    if all_unique_questions:
        all_embeddings = compute_embeddings(all_unique_questions)
        for q_text, emb in zip(all_unique_questions, all_embeddings):
            embedding_map[q_text] = emb

    # Semantic dedup: check new records against existing KB embeddings.
    # Move semantically-matched records from new → updated.
    if stored_embeddings is not None and new_records:
        truly_new: list[tuple[str, str, str]] = []
        for question, answer, category in new_records:
            emb = embedding_map[question]
            similarities = stored_embeddings @ emb
            best_idx = int(np.argmax(similarities))
            best_sim = float(similarities[best_idx])

            if best_sim >= settings.semantic_dedup_threshold:
                match = existing_with_embeddings[best_idx]
                updated_records.append((question, answer, category, match))
                semantic_merges += 1
            else:
                truly_new.append((question, answer, category))
        new_records = truly_new

    new_qa_objects: list[QAPair] = []
    for question, answer, category in new_records:
        qa = QAPair(
            category=category,
            question=question,
            answer=answer,
            embedding=embedding_to_bytes(embedding_map[question]),
        )
        db.add(qa)
        new_qa_objects.append(qa)

    for question, answer, category, existing_qa in updated_records:
        existing_qa.answer = answer
        existing_qa.category = category
        if len(question.strip()) > len((existing_qa.question or "").strip()):
            existing_qa.question = question
        existing_qa.embedding = embedding_to_bytes(embedding_map[question])

    if new_records or updated_records:
        await log_audit(
            db,
            action_type="kb_import",
            entity_type="qa_pair",
            details={
                "imported": len(new_records),
                "updated": len(updated_records),
                "semantic_merges": semantic_merges,
                "skipped": len(records) - len(valid_records),
                "filename": filename,
            },
        )
        await db.flush()  # Get IDs for new records
        new_entry_ids = [qa.id for qa in new_qa_objects if qa.id]
        # Also include updated records for duplicate checking
        updated_entry_ids = [existing_qa.id for _, _, _, existing_qa in updated_records if existing_qa.id]
        all_entry_ids = new_entry_ids + updated_entry_ids
        await db.commit()

        if all_entry_ids and background_tasks is not None:
            background_tasks.add_task(_run_duplicate_check, all_entry_ids)

    return {
        "imported": len(new_records),
        "updated": len(updated_records),
        "semantic_merges": semantic_merges,
        "skipped": len(records) - len(valid_records),
        "errors": errors,
        "total_rows": len(records),
    }
