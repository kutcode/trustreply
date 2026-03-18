"""SQLAlchemy async engine and session factory."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

engine = create_async_engine(settings.database_url, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    """FastAPI dependency that yields a DB session."""
    async with async_session() as session:
        yield session


async def init_db():
    """Create all tables on startup."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        if settings.database_url.startswith("sqlite"):
            await _ensure_sqlite_job_columns(conn)


async def _ensure_sqlite_job_columns(conn) -> None:
    """Apply lightweight additive schema updates for local SQLite databases."""

    result = await conn.exec_driver_sql("PRAGMA table_info(processing_jobs)")
    existing_columns = {row[1] for row in result.fetchall()}

    required_columns = {
        "batch_id": "ALTER TABLE processing_jobs ADD COLUMN batch_id VARCHAR(64)",
        "parser_strategy": "ALTER TABLE processing_jobs ADD COLUMN parser_strategy VARCHAR(50)",
        "parser_profile_name": "ALTER TABLE processing_jobs ADD COLUMN parser_profile_name VARCHAR(100)",
        "parse_confidence": "ALTER TABLE processing_jobs ADD COLUMN parse_confidence FLOAT",
        "parse_stats": "ALTER TABLE processing_jobs ADD COLUMN parse_stats JSON",
        "fallback_recommended": "ALTER TABLE processing_jobs ADD COLUMN fallback_recommended BOOLEAN DEFAULT 0",
        "fallback_reason": "ALTER TABLE processing_jobs ADD COLUMN fallback_reason VARCHAR(100)",
        "agent_mode": "ALTER TABLE processing_jobs ADD COLUMN agent_mode VARCHAR(32)",
        "agent_status": "ALTER TABLE processing_jobs ADD COLUMN agent_status VARCHAR(32)",
        "agent_summary": "ALTER TABLE processing_jobs ADD COLUMN agent_summary TEXT",
        "agent_trace": "ALTER TABLE processing_jobs ADD COLUMN agent_trace JSON",
        "agent_error": "ALTER TABLE processing_jobs ADD COLUMN agent_error TEXT",
        "agent_model": "ALTER TABLE processing_jobs ADD COLUMN agent_model VARCHAR(128)",
    }

    for column_name, ddl in required_columns.items():
        if column_name not in existing_columns:
            await conn.exec_driver_sql(ddl)
