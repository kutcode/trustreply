"""Agent preset endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import AgentPreset
from app.schemas import AgentPresetCreate, AgentPresetResponse, AgentPresetListResponse

router = APIRouter(prefix="/api/presets", tags=["presets"])


@router.get("", response_model=AgentPresetListResponse)
async def list_presets(db: AsyncSession = Depends(get_db)):
    """List all agent presets (built-in + custom)."""
    count_result = await db.execute(select(func.count()).select_from(AgentPreset))
    total = count_result.scalar() or 0

    result = await db.execute(
        select(AgentPreset).order_by(AgentPreset.is_builtin.desc(), AgentPreset.created_at.asc())
    )
    items = result.scalars().all()

    return AgentPresetListResponse(items=items, total=total)


@router.post("", response_model=AgentPresetResponse)
async def create_preset(body: AgentPresetCreate, db: AsyncSession = Depends(get_db)):
    """Create a custom agent preset."""
    preset = AgentPreset(
        name=body.name.strip(),
        instructions=body.instructions.strip(),
        is_builtin=False,
    )
    db.add(preset)
    await db.commit()
    await db.refresh(preset)
    return preset


@router.delete("/{preset_id}")
async def delete_preset(preset_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a custom agent preset (built-in presets cannot be deleted)."""
    preset = await db.get(AgentPreset, preset_id)
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")
    if preset.is_builtin:
        raise HTTPException(status_code=400, detail="Cannot delete a built-in preset")

    await db.delete(preset)
    await db.commit()
    return {"detail": "Deleted", "id": preset_id}
