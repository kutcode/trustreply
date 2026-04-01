"""Tests for database initialization and schema migration."""

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.database import Base, _ensure_sqlite_job_columns


@pytest_asyncio.fixture
async def raw_engine():
    """Create an in-memory SQLite engine with schema created."""
    engine = create_async_engine("sqlite+aiosqlite://", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


async def _get_columns(conn, table: str) -> set[str]:
    """Get column names for a table."""
    result = await conn.exec_driver_sql(f"PRAGMA table_info({table})")
    return {row[1] for row in result.fetchall()}


# ── _ensure_sqlite_job_columns ───────────────────────────────────────


async def test_migration_is_idempotent(raw_engine):
    """Calling _ensure_sqlite_job_columns twice should not raise."""
    async with raw_engine.begin() as conn:
        await _ensure_sqlite_job_columns(conn)
        # Second call should be a no-op
        await _ensure_sqlite_job_columns(conn)

    # Verify columns exist
    async with raw_engine.begin() as conn:
        columns = await _get_columns(conn, "processing_jobs")
        assert "batch_id" in columns
        assert "agent_mode" in columns
        assert "review_status" in columns


async def test_migration_adds_all_required_columns(raw_engine):
    """All 14 migration columns should exist after migration."""
    async with raw_engine.begin() as conn:
        await _ensure_sqlite_job_columns(conn)
        columns = await _get_columns(conn, "processing_jobs")

    expected = {
        "batch_id", "parser_strategy", "parser_profile_name",
        "parse_confidence", "parse_stats", "fallback_recommended",
        "fallback_reason", "agent_mode", "agent_status", "agent_summary",
        "agent_trace", "agent_error", "agent_model", "review_status",
    }
    assert expected.issubset(columns)


async def test_migration_on_fresh_schema_is_noop(raw_engine):
    """Fresh schema from create_all already has all columns, migration should be safe."""
    async with raw_engine.begin() as conn:
        columns_before = await _get_columns(conn, "processing_jobs")
        await _ensure_sqlite_job_columns(conn)
        columns_after = await _get_columns(conn, "processing_jobs")

    assert columns_before == columns_after


async def test_migration_adds_missing_column():
    """If a column is missing, migration should add it."""
    engine = create_async_engine("sqlite+aiosqlite://", echo=False)

    async with engine.begin() as conn:
        # Create a minimal processing_jobs table missing some columns
        await conn.exec_driver_sql("""
            CREATE TABLE processing_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                original_filename VARCHAR(512) NOT NULL,
                stored_filename VARCHAR(512) NOT NULL,
                status VARCHAR(50) DEFAULT 'pending'
            )
        """)

        columns_before = await _get_columns(conn, "processing_jobs")
        assert "batch_id" not in columns_before
        assert "agent_mode" not in columns_before

        await _ensure_sqlite_job_columns(conn)

        columns_after = await _get_columns(conn, "processing_jobs")
        assert "batch_id" in columns_after
        assert "agent_mode" in columns_after
        assert "review_status" in columns_after

    await engine.dispose()
