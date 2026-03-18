"""Application configuration — loads from environment variables."""

import os
from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Paths
    base_dir: Path = Path(__file__).resolve().parent.parent
    upload_dir: Path = base_dir / "uploads"
    output_dir: Path = base_dir / "outputs"

    # Database
    database_url: str = f"sqlite+aiosqlite:///{base_dir / 'questionnaire_filler.db'}"

    # Matching
    similarity_threshold: float = 0.75
    embedding_model: str = "all-MiniLM-L6-v2"
    default_parser_profile: str = "default"
    max_bulk_files: int = 50

    # Agent
    agent_enabled: bool = False
    agent_provider: str = "openai"
    agent_api_base: str = "https://api.openai.com/v1"
    agent_api_key: str = ""
    agent_model: str = "gpt-4.1-nano"
    agent_timeout_seconds: int = 45
    agent_default_mode: str = "agent"
    agent_max_questions_per_call: int = 20
    agent_max_context_chars: int = 6000

    # Server
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:3001", "http://localhost:3002"]

    class Config:
        env_prefix = "QF_"
        env_file = (
            Path(__file__).resolve().parent.parent.parent / ".env",
            Path(__file__).resolve().parent.parent / ".env",
        )
        env_file_encoding = "utf-8"


settings = Settings()

# Keep upload defaults in Agent mode unless explicitly overridden per-request.
settings.agent_default_mode = "agent"
if settings.agent_provider.strip().lower() in {"openai-compatible", "openai_compatible", "custom"}:
    settings.agent_provider = "openai"

# Ensure directories exist
os.makedirs(settings.upload_dir, exist_ok=True)
os.makedirs(settings.output_dir, exist_ok=True)
