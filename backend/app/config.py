"""Application configuration - loads from environment variables."""

import json
import os
import threading
from pathlib import Path
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="QF_",
        env_file=Path(__file__).resolve().parent.parent.parent / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @field_validator("allowed_email_domains", "cors_origins", mode="before")
    @classmethod
    def _parse_list_field(cls, v):
        """Accept empty strings, JSON arrays, or comma-separated values."""
        if isinstance(v, list):
            return v
        if not isinstance(v, str) or not v.strip():
            return []
        v = v.strip()
        if v.startswith("["):
            try:
                return json.loads(v)
            except json.JSONDecodeError:
                return []
        return [item.strip() for item in v.split(",") if item.strip()]

    @field_validator("category_sme_map", mode="before")
    @classmethod
    def _parse_dict_field(cls, v):
        """Accept empty strings, JSON objects, or pass through dicts."""
        if isinstance(v, dict):
            return v
        if not isinstance(v, str) or not v.strip():
            return {}
        try:
            return json.loads(v)
        except json.JSONDecodeError:
            return {}
    # Paths
    base_dir: Path = Path(__file__).resolve().parent.parent
    upload_dir: Path = base_dir / "uploads"
    output_dir: Path = base_dir / "outputs"

    # Database
    database_url: str = f"sqlite+aiosqlite:///{base_dir / 'questionnaire_filler.db'}"

    # Supabase (required for team deployment)
    supabase_url: str = ""          # e.g. https://xxxxx.supabase.co
    supabase_anon_key: str = ""     # public anon key
    supabase_service_key: str = ""  # service role key (for admin ops)
    supabase_jwt_secret: str = ""   # JWT secret for token verification

    # Matching
    similarity_threshold: float = 0.75
    semantic_dedup_threshold: float = 0.92  # Auto-merge KB entries above this similarity on create/import
    embedding_model: str = "all-MiniLM-L6-v2"
    default_parser_profile: str = "default"
    parser_hint_overrides: dict = {}
    max_bulk_files: int = 50

    # Agent
    agent_enabled: bool = False
    agent_provider: str = "openai"
    agent_api_base: str = "https://api.openai.com/v1"
    agent_api_key: str = ""
    agent_model: str = "gpt-4.1-nano"
    agent_timeout_seconds: int = 90
    agent_default_mode: str = "agent"
    agent_max_questions_per_call: int = 40
    agent_max_context_chars: int = 6000
    agent_verification_enabled: bool = True
    agent_verification_max_questions: int = 40
    agent_single_stage: bool = True  # Merge research+fill into one call (saves ~50% tokens)
    agent_kb_similarity_cutoff: float = 0.35  # Discard KB candidates below this similarity
    agent_max_prior_answers: int = 30  # Cap prior answers passed between chunks
    agent_skip_verify_threshold: float = 0.78  # Skip verification if avg confidence above this
    agent_kb_direct_threshold: float = 0.78  # Skip LLM when top KB candidate similarity >= this
    agent_structured_output: bool = True  # Use response_format for OpenAI providers
    agent_max_concurrent_jobs: int = 5  # Max jobs processed concurrently in a batch

    # Secondary provider keys (allows storing both OpenAI and Claude simultaneously)
    agent_openai_api_key: str = ""
    agent_openai_model: str = "gpt-4.1-nano"
    agent_anthropic_api_key: str = ""
    agent_anthropic_model: str = "claude-sonnet-4-6"

    # Feedback loop
    feedback_auto_add_to_kb: bool = True       # Auto-add user corrections to KB on finalize
    feedback_min_confidence: float = 0.0        # Only auto-add if original confidence was above this

    # SME Routing
    sme_routing_enabled: bool = False
    category_sme_map: dict = {}  # {"Security": "alice@example.com", "Privacy": "bob@example.com"}

    # Authentication
    api_key: str = ""
    allowed_email_domains: list[str] = []  # e.g. ["acme.com", "acme.co.uk"]

    # Upload limits
    max_upload_size_mb: int = 50

    # Audit
    audit_default_actor: str = "user"

    # Server
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:3001", "http://localhost:3002"]

settings = Settings()

# Keep upload defaults in Agent mode unless explicitly overridden per-request.
settings.agent_default_mode = "agent"
if settings.agent_provider.strip().lower() in {"openai-compatible", "openai_compatible", "custom"}:
    settings.agent_provider = "openai"

# Ensure directories exist
os.makedirs(settings.upload_dir, exist_ok=True)
os.makedirs(settings.output_dir, exist_ok=True)

# Thread-safe helpers for runtime settings mutation
_settings_lock = threading.Lock()


def get_setting(name: str):
    """Read a setting value with thread safety."""
    with _settings_lock:
        return getattr(settings, name)


def update_setting(name: str, value):
    """Write a setting value with thread safety."""
    with _settings_lock:
        setattr(settings, name, value)
