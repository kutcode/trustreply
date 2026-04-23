from __future__ import annotations

import logging

from app.database import async_session
from app.services.duplicate_flag import check_and_flag_duplicates

logger = logging.getLogger(__name__)


async def run_duplicate_check(entry_ids: list[int]) -> None:
    try:
        async with async_session() as db:
            await check_and_flag_duplicates(db, entry_ids)
    except Exception:
        logger.exception("Background duplicate check failed for entry_ids=%s", entry_ids)
