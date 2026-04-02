"""LLM-powered duplicate pair classifier for knowledge base deduplication."""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import QAPair
from app.services.agent import (
    AgentRuntimeConfig,
    _call_chat_json,
    _normalize_provider,
    default_agent_runtime_config,
    PROVIDER_ANTHROPIC,
)

logger = logging.getLogger(__name__)

CLASSIFY_SYSTEM_PROMPT = """You are a knowledge base deduplication assistant. You will be given pairs of Q&A entries that have been detected as potential duplicates based on embedding similarity.

For each pair, classify the relationship and recommend which entry to keep.

Respond with a JSON object containing a "pairs" array. Each element must have:
- "pair_index": (int) the index of the pair in the input
- "classification": one of "definitely_same", "probably_same", or "different"
  - "definitely_same": The questions ask the same thing, just worded differently
  - "probably_same": The questions are very similar but might have subtle differences in scope
  - "different": The questions actually ask about different things despite surface similarity
- "reason": (string) a brief 1-sentence explanation
- "recommended_keep_id": (int) the ID of the entry with the better/more complete answer"""

BATCH_SIZE = 10


def _build_user_message(pairs: list[tuple[QAPair, QAPair, float]]) -> str:
    """Build a user message describing pairs for the LLM to classify."""

    lines = ["Classify the following Q&A pairs:\n"]
    for idx, (entry_a, entry_b, similarity) in enumerate(pairs):
        lines.append(f"--- Pair {idx} (similarity: {similarity:.4f}) ---")
        lines.append(f"Entry A (ID={entry_a.id}):")
        lines.append(f"  Question: {entry_a.question}")
        lines.append(f"  Answer: {entry_a.answer[:500]}")
        lines.append(f"Entry B (ID={entry_b.id}):")
        lines.append(f"  Question: {entry_b.question}")
        lines.append(f"  Answer: {entry_b.answer[:500]}")
        lines.append("")
    return "\n".join(lines)


def _get_runtime_config() -> AgentRuntimeConfig:
    """Build runtime config from current settings."""
    return default_agent_runtime_config()


async def classify_duplicate_pairs(
    pairs: list[tuple[QAPair, QAPair, float]],
    db: AsyncSession,
) -> list[dict[str, Any]]:
    """Classify a list of (entry_a, entry_b, similarity) pairs using the LLM.

    Returns a list of dicts with keys:
      pair_index, classification, reason, recommended_keep_id
    for each successfully classified pair.
    """

    if not pairs:
        return []

    runtime_config = _get_runtime_config()
    results: list[dict[str, Any]] = []

    # Process in batches of BATCH_SIZE
    for batch_start in range(0, len(pairs), BATCH_SIZE):
        batch = pairs[batch_start:batch_start + BATCH_SIZE]

        messages = [
            {"role": "system", "content": CLASSIFY_SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_message(batch)},
        ]

        try:
            response = await _call_chat_json(messages, runtime_config, temperature=0.1)
            classified_pairs = response.get("pairs", [])

            # Map pair_index back to global index
            for item in classified_pairs:
                local_idx = item.get("pair_index", -1)
                if 0 <= local_idx < len(batch):
                    global_idx = batch_start + local_idx
                    results.append({
                        "pair_index": global_idx,
                        "classification": item.get("classification", "probably_same"),
                        "reason": item.get("reason", ""),
                        "recommended_keep_id": item.get("recommended_keep_id"),
                    })
        except Exception:
            logger.exception(
                "LLM classification failed for batch starting at index %d; "
                "marking %d pairs as unclassified",
                batch_start,
                len(batch),
            )
            # On failure, return unclassified placeholders for the batch
            for local_idx in range(len(batch)):
                global_idx = batch_start + local_idx
                results.append({
                    "pair_index": global_idx,
                    "classification": "probably_same",
                    "reason": "LLM classification failed; defaulting to probably_same",
                    "recommended_keep_id": None,
                })

    return results


def get_llm_model_name() -> str:
    """Return the model name string for the currently configured provider."""
    return settings.agent_model.strip()
