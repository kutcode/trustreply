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

    # Server
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:3001", "http://localhost:3002"]

    class Config:
        env_prefix = "QF_"


settings = Settings()

# Ensure directories exist
os.makedirs(settings.upload_dir, exist_ok=True)
os.makedirs(settings.output_dir, exist_ok=True)
