"""SQLAlchemy async engine and session factory."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

_is_postgres = settings.database_url.startswith("postgresql")

# Configure engine based on database type
if _is_postgres:
    engine = create_async_engine(
        settings.database_url,
        echo=False,
        pool_size=5,
        max_overflow=10,
        pool_pre_ping=True,
        pool_recycle=280,       # Recycle before Supabase pooler's 300s idle timeout
        pool_timeout=20,        # Wait up to 20s for a connection from the pool
        connect_args={
            "server_settings": {"application_name": "trustreply"},
            "command_timeout": 30,
        },
    )
else:
    engine = create_async_engine(settings.database_url, echo=False)

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    """FastAPI dependency that yields a DB session."""
    async with async_session() as session:
        yield session


async def init_db():
    """Create tables on startup. For Postgres, only creates missing tables."""
    if _is_postgres:
        async with engine.begin() as conn:
            await conn.execute(text("SELECT 1"))
            await _ensure_postgres_duplicate_reviews(conn)
        return

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _ensure_sqlite_job_columns(conn)
        await _ensure_sqlite_question_result_columns(conn)
        await _ensure_sqlite_duplicate_reviews(conn)


async def _ensure_postgres_duplicate_reviews(conn) -> None:
    """Create the duplicate_reviews table in Postgres if it doesn't exist.

    Also migrates columns from TIMESTAMPTZ to TIMESTAMP if needed, to match
    the SQLAlchemy model which uses naive (UTC) datetimes.
    """
    await conn.execute(text("""
        CREATE TABLE IF NOT EXISTS duplicate_reviews (
            id SERIAL PRIMARY KEY,
            entry_a_id INTEGER NOT NULL REFERENCES qa_pairs(id) ON DELETE CASCADE,
            entry_b_id INTEGER NOT NULL REFERENCES qa_pairs(id) ON DELETE CASCADE,
            similarity_score DOUBLE PRECISION NOT NULL,
            classification VARCHAR(32),
            reason TEXT,
            recommended_keep_id INTEGER,
            status VARCHAR(32) DEFAULT 'pending',
            reviewed_action VARCHAR(32),
            source VARCHAR(32) DEFAULT 'manual_scan',
            created_at TIMESTAMP DEFAULT NOW(),
            reviewed_at TIMESTAMP
        )
    """))
    # Note: If columns were created as TIMESTAMPTZ (old DDL), asyncpg will
    # auto-convert to naive datetimes on read.  No ALTER needed.
    await conn.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_duplicate_reviews_status ON duplicate_reviews(status)"
    ))
    await conn.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_duplicate_reviews_entry_a ON duplicate_reviews(entry_a_id)"
    ))
    await conn.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_duplicate_reviews_entry_b ON duplicate_reviews(entry_b_id)"
    ))


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
        "review_status": "ALTER TABLE processing_jobs ADD COLUMN review_status VARCHAR(32) DEFAULT 'pending'",
        "agent_input_tokens": "ALTER TABLE processing_jobs ADD COLUMN agent_input_tokens INTEGER",
        "agent_output_tokens": "ALTER TABLE processing_jobs ADD COLUMN agent_output_tokens INTEGER",
        "agent_llm_calls": "ALTER TABLE processing_jobs ADD COLUMN agent_llm_calls INTEGER",
        "agent_kb_routed": "ALTER TABLE processing_jobs ADD COLUMN agent_kb_routed INTEGER",
    }

    for column_name, ddl in required_columns.items():
        if column_name not in existing_columns:
            await conn.exec_driver_sql(ddl)


async def _ensure_sqlite_question_result_columns(conn) -> None:
    """Add new columns to question_results table for agent reasoning."""

    result = await conn.exec_driver_sql("PRAGMA table_info(question_results)")
    existing_columns = {row[1] for row in result.fetchall()}

    required_columns = {
        "agent_reason": "ALTER TABLE question_results ADD COLUMN agent_reason TEXT",
        "agent_issues": "ALTER TABLE question_results ADD COLUMN agent_issues JSON",
    }

    for column_name, ddl in required_columns.items():
        if column_name not in existing_columns:
            await conn.exec_driver_sql(ddl)


async def _ensure_sqlite_duplicate_reviews(conn) -> None:
    """Create the duplicate_reviews table if it doesn't exist (SQLite only)."""

    await conn.exec_driver_sql("""
        CREATE TABLE IF NOT EXISTS duplicate_reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_a_id INTEGER NOT NULL REFERENCES qa_pairs(id),
            entry_b_id INTEGER NOT NULL REFERENCES qa_pairs(id),
            similarity_score REAL NOT NULL,
            classification VARCHAR(32),
            reason TEXT,
            recommended_keep_id INTEGER,
            status VARCHAR(32) DEFAULT 'pending',
            reviewed_action VARCHAR(32),
            source VARCHAR(32) DEFAULT 'manual_scan',
            created_at TIMESTAMP,
            reviewed_at TIMESTAMP
        )
    """)
