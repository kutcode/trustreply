"""Shared test fixtures."""

import pytest
import pytest_asyncio
import csv
from pathlib import Path
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from docx import Document as DocxDocument

from app.database import Base, get_db
from app.main import app
from app.config import settings

TEST_DB_URL = "sqlite+aiosqlite://"  # in-memory


@pytest.fixture(autouse=True)
def isolate_runtime_settings():
    """Keep tests deterministic regardless of local .env overrides."""

    original = {
        "agent_enabled": settings.agent_enabled,
        "agent_provider": settings.agent_provider,
        "agent_api_base": settings.agent_api_base,
        "agent_api_key": settings.agent_api_key,
        "agent_model": settings.agent_model,
        "agent_default_mode": settings.agent_default_mode,
    }

    settings.agent_enabled = False
    settings.agent_provider = "openai"
    settings.agent_api_base = "https://api.openai.com/v1"
    settings.agent_api_key = ""
    settings.agent_model = "gpt-4.1-nano"
    settings.agent_default_mode = "agent"

    try:
        yield
    finally:
        for key, value in original.items():
            setattr(settings, key, value)


@pytest_asyncio.fixture
async def db_engine():
    """Create a fresh in-memory database engine for each test."""
    engine = create_async_engine(TEST_DB_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(db_engine):
    """Yield a DB session bound to the test engine."""
    session_factory = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session


@pytest_asyncio.fixture
async def client(db_session):
    """HTTP test client with overridden DB dependency."""
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def make_docx(tmp_path):
    """Factory fixture to create test .docx files with table-based questions."""
    def _make(questions_and_answers: list[tuple[str, str]], filename: str = "test.docx") -> Path:
        doc = DocxDocument()
        if questions_and_answers:
            table = doc.add_table(rows=len(questions_and_answers), cols=2)
            for i, (q, a) in enumerate(questions_and_answers):
                table.rows[i].cells[0].text = q
                table.rows[i].cells[1].text = a
        path = tmp_path / filename
        doc.save(str(path))
        return path
    return _make


@pytest.fixture
def make_paragraph_docx(tmp_path):
    """Factory fixture to create test .docx files with paragraph-based questions."""
    def _make(questions: list[str], filename: str = "test_para.docx") -> Path:
        doc = DocxDocument()
        for q in questions:
            doc.add_paragraph(q)
            doc.add_paragraph("")  # empty answer placeholder
        path = tmp_path / filename
        doc.save(str(path))
        return path
    return _make


@pytest.fixture
def make_csv(tmp_path):
    """Factory fixture to create questionnaire CSV files."""

    def _make(rows: list[list[str]], filename: str = "test.csv") -> Path:
        path = tmp_path / filename
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerows(rows)
        return path

    return _make
