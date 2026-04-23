"""Pure helpers for chunking, token estimation, and parsing LLM responses."""

from __future__ import annotations

import datetime
import json
import re
from typing import Any

import httpx


def chunked(items: list[Any], size: int) -> list[list[Any]]:
    """Split a list into fixed-size chunks."""
    if size <= 0:
        size = 1
    return [items[i:i + size] for i in range(0, len(items), size)]


def estimate_tokens(text: str) -> int:
    """Rough token count estimate (~1 token per 4 chars for English text)."""
    return max(1, len(text) // 4)


def extract_json_object(text: str) -> dict[str, Any]:
    """Parse LLM content into a JSON object, tolerating code fences and prefixes."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    # Fall back to finding the outermost brace pair in case the model wrapped
    # the JSON in conversational text.
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start >= 0 and end > start:
        try:
            parsed = json.loads(cleaned[start:end + 1])
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"Agent response contained braces but was not valid JSON: {exc}"
            ) from exc

    raise ValueError("Agent response was not valid JSON object text")


def content_to_text(content: Any) -> str:
    """Normalize chat message content payloads to plain text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str) and text.strip():
                    parts.append(text.strip())
        return "\n".join(parts)
    return str(content)


def response_json_or_none(response: httpx.Response) -> dict[str, Any] | None:
    """Best-effort parse of an HTTP response JSON body."""
    try:
        data = response.json()
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def response_error_detail(response: httpx.Response) -> str:
    """Extract a human-friendly error message from provider responses."""
    payload = response_json_or_none(response)
    if payload:
        error = payload.get("error")
        if isinstance(error, dict):
            message = str(error.get("message") or "").strip()
            code = str(error.get("code") or error.get("type") or "").strip()
            if message and code:
                return f"{message} ({code})"
            if message:
                return message
            if code:
                return code
        if isinstance(error, str) and error.strip():
            return error.strip()
        message = payload.get("message")
        if isinstance(message, str) and message.strip():
            return message.strip()

    text = (response.text or "").strip()
    if text:
        return text[:300]
    return f"HTTP {response.status_code}"


def append_trace(
    trace: list[dict[str, Any]],
    step: str,
    status: str,
    message: str,
    data: dict[str, Any] | None = None,
) -> None:
    """Append a structured trace event for the frontend activity log."""
    event: dict[str, Any] = {
        "timestamp": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat(),
        "step": step,
        "status": status,
        "message": message,
    }
    if data:
        event["data"] = data
    trace.append(event)
