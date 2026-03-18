"""FastAPI application entry point."""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import init_db
from app.routers import upload, qa, flagged
from app.schemas import AppSettingsUpdate
from app.services.agent import AGENT_MODES, is_agent_available, list_agent_modes
from app.services.parser import get_parser_profiles, get_parser_profile_names


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle."""
    # Startup: create database tables
    await init_db()
    yield
    # Shutdown: nothing to clean up


app = FastAPI(
    title="TrustReply",
    description="TrustReply auto-fills questionnaire documents using a Q&A knowledge base with semantic matching.",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(upload.router)
app.include_router(qa.router)
app.include_router(flagged.router)


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "version": "1.0.0"}


def _settings_response() -> dict:
    """Build the settings payload returned by GET and PUT."""
    return {
        "similarity_threshold": settings.similarity_threshold,
        "embedding_model": settings.embedding_model,
        "default_parser_profile": settings.default_parser_profile,
        "max_bulk_files": settings.max_bulk_files,
        "parser_profiles": get_parser_profiles(),
        "agent_enabled": settings.agent_enabled,
        "agent_provider": settings.agent_provider,
        "agent_api_base": settings.agent_api_base,
        "agent_available": is_agent_available(),
        "agent_model": settings.agent_model,
        "agent_default_mode": settings.agent_default_mode,
        "agent_modes": list_agent_modes(),
        "agent_timeout_seconds": settings.agent_timeout_seconds,
        "agent_max_questions_per_call": settings.agent_max_questions_per_call,
        "agent_has_key": bool(settings.agent_api_key.strip()),
    }


@app.get("/api/settings")
async def get_settings():
    """Get current application settings."""
    return _settings_response()


# ── Env-file persistence helper ─────────────────────────────────────

_ENV_FILE_PATH = Path(__file__).resolve().parent.parent / ".env"

# Map schema field names → QF_ env variable names
_FIELD_TO_ENV: dict[str, str] = {
    "agent_enabled": "QF_AGENT_ENABLED",
    "agent_provider": "QF_AGENT_PROVIDER",
    "agent_api_base": "QF_AGENT_API_BASE",
    "agent_api_key": "QF_AGENT_API_KEY",
    "agent_model": "QF_AGENT_MODEL",
    "agent_timeout_seconds": "QF_AGENT_TIMEOUT_SECONDS",
    "agent_default_mode": "QF_AGENT_DEFAULT_MODE",
    "agent_max_questions_per_call": "QF_AGENT_MAX_QUESTIONS_PER_CALL",
    "similarity_threshold": "QF_SIMILARITY_THRESHOLD",
    "default_parser_profile": "QF_DEFAULT_PARSER_PROFILE",
}


def _persist_to_env_file(updates: dict[str, str]) -> None:
    """Best-effort write changed settings to the backend .env file."""
    try:
        lines: list[str] = []
        if _ENV_FILE_PATH.exists():
            lines = _ENV_FILE_PATH.read_text(encoding="utf-8").splitlines()

        existing_keys: set[str] = set()
        new_lines: list[str] = []
        for line in lines:
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                new_lines.append(line)
                continue
            key = stripped.split("=", 1)[0].strip()
            if key in updates:
                new_lines.append(f"{key}={updates[key]}")
                existing_keys.add(key)
            else:
                new_lines.append(line)

        for key, value in updates.items():
            if key not in existing_keys:
                new_lines.append(f"{key}={value}")

        _ENV_FILE_PATH.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
    except Exception:
        pass  # Best-effort; in-memory update is the primary mechanism.


@app.put("/api/settings")
async def update_settings(body: AppSettingsUpdate):
    """Update application settings (persisted in-memory + .env file)."""
    env_updates: dict[str, str] = {}

    if body.agent_default_mode is not None:
        if body.agent_default_mode not in AGENT_MODES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid agent_default_mode '{body.agent_default_mode}'. Must be one of: {', '.join(AGENT_MODES)}",
            )

    if body.default_parser_profile is not None:
        valid_profiles = get_parser_profile_names()
        if body.default_parser_profile not in valid_profiles:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown parser profile '{body.default_parser_profile}'",
            )

    # Apply each provided field to the in-memory settings singleton.
    payload = body.model_dump(exclude_none=True)
    for field_name, value in payload.items():
        setattr(settings, field_name, value)
        env_key = _FIELD_TO_ENV.get(field_name)
        if env_key:
            env_updates[env_key] = str(value).lower() if isinstance(value, bool) else str(value)

    if env_updates:
        _persist_to_env_file(env_updates)

    return _settings_response()
