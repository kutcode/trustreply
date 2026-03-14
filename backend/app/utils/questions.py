"""Shared helpers for normalizing question text and review placeholders."""

from __future__ import annotations

import re


REVIEW_REQUIRED_PLACEHOLDER = "[REVIEW REQUIRED] No matching answer found in the knowledge base."

_LEADING_NUMBERING_RE = re.compile(r"^\s*(?:\(?\d+\)?[.)-:]?|[A-Za-z][.)-:]?)\s+")
_WHITESPACE_RE = re.compile(r"\s+")


def clean_display_question(text: str) -> str:
    """Remove common numbering prefixes while keeping the prompt readable."""

    cleaned = _LEADING_NUMBERING_RE.sub("", (text or "").strip())
    cleaned = _WHITESPACE_RE.sub(" ", cleaned).strip()
    return cleaned or (text or "").strip()


def normalize_question_key(text: str) -> str:
    """Collapse common prompt variants so duplicate flagged questions group together."""

    cleaned = clean_display_question(text).rstrip(":").strip()
    cleaned = _WHITESPACE_RE.sub(" ", cleaned)
    return cleaned.casefold()
