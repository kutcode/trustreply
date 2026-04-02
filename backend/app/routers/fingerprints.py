"""Format fingerprint management endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import FormatFingerprint
from app.services.audit import log_audit

router = APIRouter(prefix="/api/fingerprints", tags=["fingerprints"])


@router.get("")
async def list_fingerprints(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """List all learned format fingerprints."""

    query = select(FormatFingerprint).order_by(FormatFingerprint.last_used_at.desc())

    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    items = result.scalars().all()

    return {
        "items": [
            {
                "id": fp.id,
                "fingerprint_hash": fp.fingerprint_hash,
                "name": fp.name,
                "source_filename": fp.source_filename,
                "column_count": fp.column_count,
                "header_signature": fp.header_signature,
                "parser_profile": fp.parser_profile,
                "hint_overrides": fp.hint_overrides,
                "success_count": fp.success_count,
                "last_used_at": fp.last_used_at.isoformat() if fp.last_used_at else None,
                "created_at": fp.created_at.isoformat() if fp.created_at else None,
            }
            for fp in items
        ],
        "total": total,
    }


@router.put("/{fingerprint_id}")
async def update_fingerprint(
    fingerprint_id: int,
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    """Update a fingerprint's name or parser profile."""

    fp = await db.get(FormatFingerprint, fingerprint_id)
    if not fp:
        raise HTTPException(status_code=404, detail="Fingerprint not found")

    if "name" in body:
        fp.name = body["name"]
    if "parser_profile" in body:
        fp.parser_profile = body["parser_profile"]
    if "hint_overrides" in body:
        fp.hint_overrides = body["hint_overrides"]

    await log_audit(
        db,
        action_type="fingerprint_update",
        entity_type="format_fingerprint",
        entity_id=fingerprint_id,
        details={"updated_fields": list(body.keys())},
    )
    await db.commit()
    await db.refresh(fp)

    return {
        "id": fp.id,
        "fingerprint_hash": fp.fingerprint_hash,
        "name": fp.name,
        "parser_profile": fp.parser_profile,
        "hint_overrides": fp.hint_overrides,
        "success_count": fp.success_count,
    }


@router.delete("/{fingerprint_id}")
async def delete_fingerprint(
    fingerprint_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a learned fingerprint."""

    fp = await db.get(FormatFingerprint, fingerprint_id)
    if not fp:
        raise HTTPException(status_code=404, detail="Fingerprint not found")

    await log_audit(
        db,
        action_type="fingerprint_delete",
        entity_type="format_fingerprint",
        entity_id=fingerprint_id,
        details={"name": fp.name, "parser_profile": fp.parser_profile},
    )
    await db.delete(fp)
    await db.commit()

    return {"detail": "Deleted", "id": fingerprint_id}
