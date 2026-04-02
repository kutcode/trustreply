"""FastAPI application entry point."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings, update_setting
from app.middleware.auth import APIKeyMiddleware
from app.database import init_db
from app.routers import upload, qa, flagged, audit, fingerprints, corrections, templates, presets
from app.schemas import AgentModelsRequest, AgentModelsResponse, AppSettingsUpdate, TestConnectionResponse
from app.services.agent import (
    AGENT_MODE_AGENT,
    AGENT_MODES,
    PROVIDER_ANTHROPIC,
    PROVIDER_OPENAI,
    is_agent_available,
    list_agent_modes,
)
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

# API key auth (must be added before CORS so it runs after CORS in the middleware stack)
app.add_middleware(APIKeyMiddleware)

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
app.include_router(audit.router)
app.include_router(fingerprints.router)
app.include_router(corrections.router)
app.include_router(templates.router)
app.include_router(presets.router)


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
        "parser_hint_overrides": settings.parser_hint_overrides,
        "max_bulk_files": settings.max_bulk_files,
        "parser_profiles": get_parser_profiles(),
        "agent_enabled": settings.agent_enabled,
        "agent_provider": settings.agent_provider,
        "agent_api_base": settings.agent_api_base,
        "agent_available": is_agent_available(),
        "agent_model": settings.agent_model,
        "agent_default_mode": AGENT_MODE_AGENT,
        "agent_modes": list_agent_modes(),
        "agent_timeout_seconds": settings.agent_timeout_seconds,
        "agent_max_questions_per_call": settings.agent_max_questions_per_call,
        "agent_has_key": bool(settings.agent_api_key.strip()),
        "agent_openai_has_key": bool(settings.agent_openai_api_key.strip()),
        "agent_openai_model": settings.agent_openai_model,
        "agent_anthropic_has_key": bool(settings.agent_anthropic_api_key.strip()),
        "agent_anthropic_model": settings.agent_anthropic_model,
    }


@app.get("/api/settings")
async def get_settings():
    """Get current application settings."""
    return _settings_response()


def _normalize_provider(provider: str | None) -> str:
    """Normalize supported provider aliases for settings/model discovery."""

    normalized = (provider or "").strip().lower()
    if normalized in {"claude"}:
        return PROVIDER_ANTHROPIC
    if normalized in {"openai-compatible", "openai_compatible", "custom"}:
        return PROVIDER_OPENAI
    return normalized or PROVIDER_OPENAI


def _openai_chat_candidate(model_id: str) -> bool:
    """Return whether a model id is likely usable with our chat-agent flow."""

    model = model_id.strip().lower()
    if not model:
        return False
    blocked_prefixes = (
        "text-embedding",
        "text-moderation",
        "omni-moderation",
        "whisper",
        "tts-",
        "dall-e",
        "gpt-image",
        "gpt-realtime",
        "gpt-audio",
    )
    if model.startswith("ft:"):
        return False
    if any(model.startswith(prefix) for prefix in blocked_prefixes):
        return False
    return model.startswith(("gpt", "o1", "o3", "o4", "chatgpt"))


def _dedupe_model_options(options: list[dict[str, str]]) -> list[dict[str, str]]:
    """Keep first-seen model ids and drop duplicates."""

    seen: set[str] = set()
    deduped: list[dict[str, str]] = []
    for option in options:
        model_id = option.get("id", "").strip()
        if not model_id or model_id in seen:
            continue
        seen.add(model_id)
        deduped.append({"id": model_id, "label": option.get("label", model_id)})
    return deduped


async def _fetch_openai_models(api_base: str, api_key: str) -> list[dict[str, str]]:
    """Fetch model ids from an OpenAI-compatible /models endpoint."""

    endpoint = api_base.rstrip("/") + "/models"
    headers = {"Authorization": f"Bearer {api_key}"}

    timeout = httpx.Timeout(settings.agent_timeout_seconds)
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.get(endpoint, headers=headers)
    if response.status_code >= 400:
        detail = response.text[:300] if response.text else f"HTTP {response.status_code}"
        raise HTTPException(status_code=400, detail=f"Failed to fetch OpenAI models: {detail}")

    data = response.json()
    raw_models = data.get("data")
    if not isinstance(raw_models, list):
        raise HTTPException(status_code=400, detail="OpenAI model response did not contain a data list.")

    with_timestamps: list[tuple[int, dict[str, str]]] = []
    fallback_options: list[dict[str, str]] = []
    for item in raw_models:
        if not isinstance(item, dict):
            continue
        model_id = str(item.get("id") or "").strip()
        if not model_id:
            continue
        option = {"id": model_id, "label": model_id}
        fallback_options.append(option)
        if _openai_chat_candidate(model_id):
            created = int(item.get("created") or 0)
            with_timestamps.append((created, option))

    if with_timestamps:
        with_timestamps.sort(key=lambda entry: (entry[0], entry[1]["id"]), reverse=True)
        return _dedupe_model_options([option for _, option in with_timestamps])
    return _dedupe_model_options(fallback_options)


async def _fetch_anthropic_models(api_base: str, api_key: str) -> list[dict[str, str]]:
    """Fetch model ids from Anthropic /v1/models."""

    endpoint = api_base.rstrip("/") + "/models"
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
    }

    timeout = httpx.Timeout(settings.agent_timeout_seconds)
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.get(endpoint, headers=headers)
    if response.status_code >= 400:
        detail = response.text[:300] if response.text else f"HTTP {response.status_code}"
        raise HTTPException(status_code=400, detail=f"Failed to fetch Claude models: {detail}")

    data = response.json()
    raw_models = data.get("data")
    if not isinstance(raw_models, list):
        raise HTTPException(status_code=400, detail="Claude model response did not contain a data list.")

    options: list[dict[str, str]] = []
    for item in raw_models:
        if not isinstance(item, dict):
            continue
        model_id = str(item.get("id") or "").strip()
        if not model_id:
            continue
        display = str(item.get("display_name") or "").strip()
        label = f"{display} ({model_id})" if display else model_id
        options.append({"id": model_id, "label": label})
    return _dedupe_model_options(options)


def _resolve_provider_credentials(provider: str, body_api_base: str | None, body_api_key: str | None) -> tuple[str, str]:
    """Resolve API base URL and key for a provider, using per-provider fallbacks."""

    # Per-provider defaults
    if provider == PROVIDER_ANTHROPIC:
        default_base = "https://api.anthropic.com/v1"
        default_key = settings.agent_anthropic_api_key or settings.agent_api_key or ""
    else:  # openai
        default_base = "https://api.openai.com/v1"
        default_key = settings.agent_openai_api_key or settings.agent_api_key or ""

    api_base = (body_api_base or default_base).strip()
    api_key = (body_api_key or default_key).strip()
    return api_base, api_key


@app.post("/api/settings/models", response_model=AgentModelsResponse)
async def list_agent_models(body: AgentModelsRequest):
    """Fetch provider model options for a UI dropdown."""

    provider = _normalize_provider(body.provider or settings.agent_provider)
    if provider not in {PROVIDER_OPENAI, PROVIDER_ANTHROPIC}:
        raise HTTPException(status_code=400, detail="Unsupported provider. Allowed values: openai, anthropic.")

    api_base, api_key = _resolve_provider_credentials(provider, body.api_base, body.api_key)
    if not api_base:
        raise HTTPException(status_code=400, detail="API base URL is required to load models.")
    if not api_key:
        raise HTTPException(status_code=400, detail="API key is required to load models.")

    try:
        if provider == PROVIDER_ANTHROPIC:
            models = await _fetch_anthropic_models(api_base, api_key)
        else:
            models = await _fetch_openai_models(api_base, api_key)
    except (httpx.HTTPError, httpx.TimeoutException) as exc:
        raise HTTPException(status_code=400, detail=f"Failed to fetch provider models: {exc}") from exc

    if not models:
        raise HTTPException(status_code=400, detail="No models were returned by the provider.")

    return AgentModelsResponse(provider=provider, models=models)


@app.post("/api/settings/test-connection", response_model=TestConnectionResponse)
async def test_agent_connection(body: AgentModelsRequest):
    """Test that the configured provider credentials are valid."""

    provider = _normalize_provider(body.provider or settings.agent_provider)
    if provider not in {PROVIDER_OPENAI, PROVIDER_ANTHROPIC}:
        raise HTTPException(status_code=400, detail="Unsupported provider. Allowed values: openai, anthropic.")

    api_base, api_key = _resolve_provider_credentials(provider, body.api_base, body.api_key)
    if not api_base:
        raise HTTPException(status_code=400, detail="API base URL is required.")
    if not api_key:
        raise HTTPException(status_code=400, detail="API key is required.")

    try:
        if provider == PROVIDER_ANTHROPIC:
            models = await _fetch_anthropic_models(api_base, api_key)
        else:
            models = await _fetch_openai_models(api_base, api_key)
    except (httpx.HTTPError, httpx.TimeoutException) as exc:
        raise HTTPException(status_code=400, detail=f"Connection failed: {exc}") from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Connection failed: {exc}") from exc

    label = "Anthropic" if provider == PROVIDER_ANTHROPIC else "OpenAI"
    return TestConnectionResponse(
        ok=True,
        provider=provider,
        message=f"Connected to {label} successfully. {len(models)} model(s) available.",
    )


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
    "agent_openai_api_key": "QF_AGENT_OPENAI_API_KEY",
    "agent_openai_model": "QF_AGENT_OPENAI_MODEL",
    "agent_anthropic_api_key": "QF_AGENT_ANTHROPIC_API_KEY",
    "agent_anthropic_model": "QF_AGENT_ANTHROPIC_MODEL",
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
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Failed to persist settings to .env: {e}")


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
        if body.agent_default_mode != AGENT_MODE_AGENT:
            raise HTTPException(
                status_code=400,
                detail="Default agent mode is locked to 'agent'.",
            )

    if body.default_parser_profile is not None:
        valid_profiles = get_parser_profile_names()
        if body.default_parser_profile not in valid_profiles:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown parser profile '{body.default_parser_profile}'",
            )

    if body.agent_provider is not None:
        provider = _normalize_provider(body.agent_provider)
        body.agent_provider = provider
        if provider not in {PROVIDER_OPENAI, PROVIDER_ANTHROPIC}:
            raise HTTPException(
                status_code=400,
                detail="Unsupported agent_provider. Allowed values: openai, anthropic.",
            )

    # Apply each provided field to the in-memory settings singleton.
    payload = body.model_dump(exclude_none=True)
    for field_name, value in payload.items():
        update_setting(field_name, value)
        env_key = _FIELD_TO_ENV.get(field_name)
        if env_key:
            env_updates[env_key] = str(value).lower() if isinstance(value, bool) else str(value)

    if env_updates:
        _persist_to_env_file(env_updates)

    # Keep default mode pinned to agent for all future uploads unless caller overrides per-request.
    update_setting("agent_default_mode", AGENT_MODE_AGENT)
    _persist_to_env_file({"QF_AGENT_DEFAULT_MODE": AGENT_MODE_AGENT})

    return _settings_response()
