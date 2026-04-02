"""Audit trail service — records user and system actions."""

from __future__ import annotations

import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import AuditLog
from app.config import settings


async def log_audit(
    db: AsyncSession,
    *,
    action_type: str,
    entity_type: str,
    entity_id: int | None = None,
    job_id: int | None = None,
    actor: str | None = None,
    details: dict | None = None,
    before_value: str | None = None,
    after_value: str | None = None,
) -> AuditLog:
    """
    Create an audit log entry.

    The caller is responsible for committing the transaction — this keeps
    audit writes atomic with the action they record.
    """
    entry = AuditLog(
        timestamp=datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None),
        action_type=action_type,
        entity_type=entity_type,
        entity_id=entity_id,
        job_id=job_id,
        actor=actor or settings.audit_default_actor,
        details=details,
        before_value=before_value,
        after_value=after_value,
    )
    db.add(entry)
    return entry
