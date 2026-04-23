"""Constants shared across the agent package."""

from __future__ import annotations

import asyncio

AGENT_MODE_OFF = "off"
AGENT_MODE_AGENT = "agent"
AGENT_MODES = (AGENT_MODE_OFF, AGENT_MODE_AGENT)

# Runtime provider identifiers.
PROVIDER_OPENAI_COMPATIBLE = "openai-compatible"
PROVIDER_OPENAI = "openai"
PROVIDER_ANTHROPIC = "anthropic"

# Backward-compat aliases for old modes stored in DB or sent by API clients.
MODE_ALIASES = {"assist": AGENT_MODE_AGENT, "full": AGENT_MODE_AGENT}
PROVIDER_ALIASES = {
    "openai-compatible": PROVIDER_OPENAI_COMPATIBLE,
    "openai_compatible": PROVIDER_OPENAI_COMPATIBLE,
    "openai": PROVIDER_OPENAI,
    "anthropic": PROVIDER_ANTHROPIC,
    "claude": PROVIDER_ANTHROPIC,
}

AGENT_API_MAX_RETRIES = 5
AGENT_API_BASE_BACKOFF_SECONDS = 1.0
AGENT_API_MAX_BACKOFF_SECONDS = 30.0
AGENT_API_MAX_PARALLEL_CALLS = 8

# Global semaphore throttles concurrent provider calls across workers.
AGENT_API_CALL_SEMAPHORE = asyncio.Semaphore(AGENT_API_MAX_PARALLEL_CALLS)
