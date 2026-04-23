"""Agent runtime configuration and mode/provider normalization."""

from __future__ import annotations

from dataclasses import dataclass

from app.config import settings
from app.services.agent_constants import (
    AGENT_MODE_AGENT,
    AGENT_MODE_OFF,
    AGENT_MODES,
    MODE_ALIASES,
    PROVIDER_ALIASES,
    PROVIDER_OPENAI_COMPATIBLE,
)


@dataclass(frozen=True)
class AgentRuntimeConfig:
    """Provider and model values used for a single agent run."""

    api_base: str
    api_key: str
    model: str
    provider: str = PROVIDER_OPENAI_COMPATIBLE


def normalize_provider(provider: str | None) -> str:
    """Map UI aliases (e.g. 'claude') onto canonical runtime identifiers."""
    value = (provider or "").strip().lower()
    return PROVIDER_ALIASES.get(value, value or PROVIDER_OPENAI_COMPATIBLE)


def default_agent_runtime_config() -> AgentRuntimeConfig:
    """Build runtime config from environment-backed application settings."""
    return AgentRuntimeConfig(
        api_base=settings.agent_api_base.strip(),
        api_key=settings.agent_api_key.strip(),
        model=settings.agent_model.strip(),
        provider=normalize_provider(settings.agent_provider.strip()),
    )


def list_agent_modes() -> list[dict[str, str]]:
    """Return the UI-facing list of supported agent modes."""
    return [
        {
            "name": AGENT_MODE_OFF,
            "label": "Semantic Only",
            "description": "Use only knowledge-base semantic matching.",
        },
        {
            "name": AGENT_MODE_AGENT,
            "label": "Agent",
            "description": (
                "AI-first mode. Agent decides all answers using document context + KB "
                "and flags uncertain fields (no semantic auto-match fallback)."
            ),
        },
    ]


def normalize_agent_mode(mode: str | None) -> str:
    """Normalize a requested agent mode and validate it against AGENT_MODES."""
    normalized = (mode or settings.agent_default_mode or AGENT_MODE_OFF).strip().lower()
    normalized = MODE_ALIASES.get(normalized, normalized)
    if normalized not in AGENT_MODES:
        raise ValueError(f"Unknown agent mode '{mode}'")
    return normalized


def is_agent_available(runtime_config: AgentRuntimeConfig | None = None) -> bool:
    """Return whether agent calls are fully configured and enabled."""
    config = runtime_config or default_agent_runtime_config()
    if runtime_config is None and not settings.agent_enabled:
        return False
    return bool(
        config.api_base.strip() and config.api_key.strip() and config.model.strip()
    )
