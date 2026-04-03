"""Auto-flag near-duplicate KB entries when new entries are added."""

from __future__ import annotations

import logging

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import QAPair, DuplicateReview
from app.utils.embeddings import bytes_to_embedding

logger = logging.getLogger(__name__)


async def check_and_flag_duplicates(
    db: AsyncSession,
    new_entry_ids: list[int],
    threshold: float = settings.semantic_dedup_threshold,
) -> int:
    """Check newly added KB entries against existing entries for near-duplicates.

    Creates DuplicateReview records for any pairs above threshold.
    Returns number of new duplicate pairs flagged.
    """

    if not new_entry_ids:
        return 0

    # Load new entries
    new_result = await db.execute(
        select(QAPair).where(
            QAPair.id.in_(new_entry_ids),
            QAPair.deleted_at.is_(None),
            QAPair.embedding.isnot(None),
        )
    )
    new_entries = list(new_result.scalars().all())

    if not new_entries:
        return 0

    # Load all existing non-deleted entries with embeddings (excluding the new ones)
    existing_result = await db.execute(
        select(QAPair).where(
            QAPair.deleted_at.is_(None),
            QAPair.embedding.isnot(None),
            ~QAPair.id.in_(new_entry_ids),
        )
    )
    existing_entries = list(existing_result.scalars().all())

    if not existing_entries:
        return 0

    # Build embedding arrays
    new_embeddings = np.array([bytes_to_embedding(e.embedding) for e in new_entries])
    existing_embeddings = np.array([bytes_to_embedding(e.embedding) for e in existing_entries])

    # Compute cosine similarity (embeddings are already normalized)
    sim_matrix = new_embeddings @ existing_embeddings.T  # shape: (len(new), len(existing))

    flagged_count = 0

    for i, new_entry in enumerate(new_entries):
        for j, existing_entry in enumerate(existing_entries):
            similarity = float(sim_matrix[i, j])
            if similarity < threshold:
                continue

            # Normalize pair order so entry_a_id < entry_b_id to avoid duplicates
            a_id = min(new_entry.id, existing_entry.id)
            b_id = max(new_entry.id, existing_entry.id)

            # Check if this pair already has a DuplicateReview record
            existing_review = await db.execute(
                select(DuplicateReview).where(
                    DuplicateReview.entry_a_id == a_id,
                    DuplicateReview.entry_b_id == b_id,
                )
            )
            if existing_review.scalars().first() is not None:
                continue

            # Create new review record
            review = DuplicateReview(
                entry_a_id=a_id,
                entry_b_id=b_id,
                similarity_score=round(similarity, 4),
                source="auto_flag",
                status="pending",
            )
            db.add(review)
            flagged_count += 1

    if flagged_count > 0:
        await db.commit()

    logger.info(
        "Auto-flag duplicate check: %d new entries checked against %d existing, %d pairs flagged",
        len(new_entries),
        len(existing_entries),
        flagged_count,
    )

    return flagged_count
