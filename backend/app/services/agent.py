"""Optional LLM agent orchestration for contextual questionnaire filling."""

from __future__ import annotations

import csv
import datetime
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
import numpy as np
import pdfplumber
from docx import Document as DocxDocument
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import QAPair
from app.services.parser import ExtractedItem
from app.utils.embeddings import bytes_to_embedding, compute_embeddings

AGENT_MODE_OFF = "off"
AGENT_MODE_AGENT = "agent"
AGENT_MODES = (AGENT_MODE_OFF, AGENT_MODE_AGENT)

# Backward-compat aliases for old modes stored in DB or sent by API clients.
_MODE_ALIASES = {"assist": AGENT_MODE_AGENT, "full": AGENT_MODE_AGENT}


@dataclass(frozen=True)
class AgentRuntimeConfig:
    """Provider/runtime values used for an individual agent run."""

    api_base: str
    api_key: str
    model: str
    provider: str = "openai-compatible"


def default_agent_runtime_config() -> AgentRuntimeConfig:
    """Build runtime config from environment-backed application settings."""

    return AgentRuntimeConfig(
        api_base=settings.agent_api_base.strip(),
        api_key=settings.agent_api_key.strip(),
        model=settings.agent_model.strip(),
        provider=settings.agent_provider.strip() or "openai-compatible",
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
            "description": "AI agent reviews all questions using document context and KB. Can override semantic matches with better context-aware answers.",
        },
    ]


def normalize_agent_mode(mode: str | None) -> str:
    """Normalize a requested agent mode and validate support."""

    normalized = (mode or settings.agent_default_mode or AGENT_MODE_OFF).strip().lower()
    normalized = _MODE_ALIASES.get(normalized, normalized)
    if normalized not in AGENT_MODES:
        raise ValueError(f"Unknown agent mode '{mode}'")
    return normalized


def is_agent_available(runtime_config: AgentRuntimeConfig | None = None) -> bool:
    """Return whether agent calls are fully configured and enabled."""

    config = runtime_config or default_agent_runtime_config()
    if runtime_config is None and not settings.agent_enabled:
        return False
    return bool(
        config.api_base.strip()
        and config.api_key.strip()
        and config.model.strip()
    )


def append_trace(
    trace: list[dict[str, Any]],
    step: str,
    status: str,
    message: str,
    data: dict[str, Any] | None = None,
) -> None:
    """Append a structured trace event for frontend rendering."""

    event: dict[str, Any] = {
        "timestamp": datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "step": step,
        "status": status,
        "message": message,
    }
    if data:
        event["data"] = data
    trace.append(event)


def _chunked(items: list[Any], size: int) -> list[list[Any]]:
    """Split a list into fixed-size chunks."""

    if size <= 0:
        size = 1
    return [items[i:i + size] for i in range(0, len(items), size)]


def _extract_json_object(text: str) -> dict[str, Any]:
    """Parse LLM content into a JSON object, handling code fences."""

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

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start >= 0 and end > start:
        parsed = json.loads(cleaned[start:end + 1])
        if isinstance(parsed, dict):
            return parsed

    raise ValueError("Agent response was not valid JSON object text")


def _content_to_text(content: Any) -> str:
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


async def _call_chat_json(
    messages: list[dict[str, str]],
    runtime_config: AgentRuntimeConfig,
    *,
    temperature: float = 0.1,
) -> dict[str, Any]:
    """Call an OpenAI-compatible chat API and parse a JSON object response."""

    endpoint = runtime_config.api_base.rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {runtime_config.api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": runtime_config.model,
        "messages": messages,
        "temperature": temperature,
    }

    timeout = httpx.Timeout(settings.agent_timeout_seconds)
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(endpoint, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()

    choices = data.get("choices") or []
    if not choices:
        raise ValueError("Agent response did not include choices")
    message = choices[0].get("message") or {}
    content = _content_to_text(message.get("content"))
    if not content.strip():
        raise ValueError("Agent response was empty")
    return _extract_json_object(content)


def _extract_document_context(file_path: Path, items: list[ExtractedItem]) -> str:
    """Build a compact context string from source documents and extracted items."""

    lines: list[str] = []
    suffix = file_path.suffix.lower()

    try:
        if suffix == ".docx":
            doc = DocxDocument(str(file_path))
            for paragraph in doc.paragraphs[:120]:
                text = paragraph.text.strip()
                if text:
                    lines.append(text)
            for table in doc.tables[:10]:
                for row in table.rows[:40]:
                    row_cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
                    if row_cells:
                        lines.append(" | ".join(row_cells))
        elif suffix == ".csv":
            with file_path.open("r", encoding="utf-8", errors="ignore", newline="") as handle:
                reader = csv.reader(handle)
                for idx, row in enumerate(reader):
                    if idx >= 120:
                        break
                    compact = [cell.strip() for cell in row if cell.strip()]
                    if compact:
                        lines.append(" | ".join(compact))
        elif suffix == ".pdf":
            with pdfplumber.open(str(file_path)) as pdf:
                for page in pdf.pages[:4]:
                    page_text = page.extract_text() or ""
                    for line in page_text.splitlines():
                        cleaned = line.strip()
                        if cleaned:
                            lines.append(cleaned)
    except Exception:
        # Fall back to extracted-question context below.
        pass

    if items:
        lines.append("Extracted question preview:")
        for item in items[:40]:
            question = (item.question_text or "").strip()
            if question:
                lines.append(f"- {question}")

    context = "\n".join(lines)
    max_chars = max(settings.agent_max_context_chars, 500)
    if len(context) > max_chars:
        context = context[:max_chars] + "\n...[truncated]"
    return context


async def _build_candidate_map(
    questions: list[str],
    db: AsyncSession,
    top_k: int = 3,
) -> dict[int, list[dict[str, Any]]]:
    """Build top-k KB candidates per question using existing embeddings."""

    if not questions:
        return {}

    result = await db.execute(select(QAPair).where(QAPair.embedding.isnot(None)))
    qa_pairs = result.scalars().all()
    if not qa_pairs:
        return {idx: [] for idx in range(len(questions))}

    stored_embeddings = np.array([bytes_to_embedding(qa.embedding) for qa in qa_pairs])
    question_embeddings = compute_embeddings(questions)

    candidate_map: dict[int, list[dict[str, Any]]] = {}
    for idx, embedding in enumerate(question_embeddings):
        similarities = np.dot(stored_embeddings, embedding)
        if similarities.size == 0:
            candidate_map[idx] = []
            continue

        top_count = min(top_k, similarities.size)
        top_indices = np.argpartition(-similarities, top_count - 1)[:top_count]
        ordered = top_indices[np.argsort(-similarities[top_indices])]

        candidates: list[dict[str, Any]] = []
        for ranked_idx in ordered:
            qa = qa_pairs[int(ranked_idx)]
            candidates.append(
                {
                    "category": qa.category,
                    "question": qa.question,
                    "answer": qa.answer,
                    "similarity": round(float(similarities[int(ranked_idx)]), 4),
                }
            )
        candidate_map[idx] = candidates

    return candidate_map


def _coerce_confidence(value: Any) -> float | None:
    """Coerce arbitrary model confidence values to [0, 1]."""

    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return None
    return max(0.0, min(1.0, confidence))


async def run_contextual_fill_agent(
    *,
    file_path: Path,
    items: list[ExtractedItem],
    db: AsyncSession,
    mode: str,
    instructions: str | None = None,
    runtime_config: AgentRuntimeConfig | None = None,
) -> dict[str, Any]:
    """Run two-stage research + fill agent over extracted questions."""

    mode = normalize_agent_mode(mode)
    runtime = runtime_config or default_agent_runtime_config()
    trace: list[dict[str, Any]] = []

    if mode == AGENT_MODE_OFF:
        append_trace(trace, "agent", "skipped", "Agent mode is disabled for this job.")
        return {
            "items": items,
            "trace": trace,
            "status": "skipped",
            "summary": "Agent mode was off.",
            "stats": {
                "questions_considered": 0,
                "answers_generated": 0,
                "flags_recommended": 0,
                "overrides": 0,
            },
            "decisions": [],
        }

    if not is_agent_available(runtime):
        append_trace(
            trace,
            "agent",
            "skipped",
            "Agent was requested but API settings are incomplete.",
        )
        return {
            "items": items,
            "trace": trace,
            "status": "skipped",
            "summary": "Agent requested but not configured (missing key/model/base URL or disabled).",
            "stats": {
                "questions_considered": 0,
                "answers_generated": 0,
                "flags_recommended": 0,
                "overrides": 0,
            },
            "decisions": [],
        }

    original_answers = [item.answer_text for item in items]
    work_items = [
        {"index": idx, "question_text": item.question_text, "current_answer": item.answer_text}
        for idx, item in enumerate(items)
    ]

    for work_idx, work_item in enumerate(work_items):
        work_item["work_idx"] = work_idx

    if not work_items:
        append_trace(trace, "agent", "skipped", "No questions needed agent work for this mode.")
        return {
            "items": items,
            "trace": trace,
            "status": "completed",
            "summary": "No unresolved questions needed agent reasoning.",
            "stats": {
                "questions_considered": 0,
                "answers_generated": 0,
                "flags_recommended": 0,
                "overrides": 0,
            },
            "decisions": [],
        }

    append_trace(
        trace,
        "agent",
        "running",
        "Starting contextual research + fill workflow.",
        {
            "mode": mode,
            "provider": runtime.provider,
            "model": runtime.model,
            "questions_considered": len(work_items),
        },
    )

    document_context = _extract_document_context(file_path, items)
    candidate_map = await _build_candidate_map(
        [work_item["question_text"] for work_item in work_items],
        db,
        top_k=3,
    )
    append_trace(
        trace,
        "research",
        "running",
        "Built knowledge-base candidate context.",
        {"question_count": len(work_items)},
    )

    max_per_call = max(settings.agent_max_questions_per_call, 1)
    ordered_decisions: list[dict[str, Any]] = []
    chunks = _chunked(work_items, max_per_call)

    for chunk_idx, chunk in enumerate(chunks, start=1):
        payload_questions = []
        for work_item in chunk:
            global_idx = work_item["index"]
            local_idx = int(work_item["work_idx"])
            payload_questions.append(
                {
                    "id": f"q_{global_idx}",
                    "question": work_item["question_text"],
                    "current_answer": work_item["current_answer"],
                    "kb_candidates": candidate_map.get(local_idx, []),
                }
            )

        append_trace(
            trace,
            "research",
            "running",
            f"Running research agent on chunk {chunk_idx}/{len(chunks)}.",
            {"chunk_size": len(payload_questions)},
        )

        research_messages = [
            {
                "role": "system",
                "content": (
                    "You are ResearchAgent for questionnaire autofill. Your job is to think like a person "
                    "sitting down to fill in a questionnaire on behalf of their company.\n\n"
                    "CRITICAL CONTEXT RULES:\n"
                    "1. The DOCUMENT CONTEXT shows the questionnaire being filled. Read headers, titles, and "
                    "surrounding text to understand WHO is being asked (e.g., which company/vendor).\n"
                    "2. The KB CANDIDATES contain answers from YOUR company's knowledge base — these are "
                    "answers about YOUR company's policies, practices, and information.\n"
                    "3. For GENERAL questions about your company (security policies, compliance, certifications, "
                    "processes), use KB candidates confidently when they match.\n"
                    "4. For CONTEXT-SPECIFIC questions (Company Name, Contact Person, Date, Project Name, "
                    "Client Reference, specific third-party names), these change per questionnaire. Flag these "
                    "for human review unless the answer is clearly derivable from the document context itself.\n"
                    "5. Do NOT invent facts. Do NOT guess contact details, dates, or entity-specific information.\n"
                    "6. When unsure, set needs_human_review=true and confidence below 0.5.\n\n"
                    "Return strict JSON: "
                    "{\"notes\":[{\"id\":\"...\",\"research_summary\":\"...\",\"proposed_answer\":\"...\","
                    "\"confidence\":0.0,\"needs_human_review\":false,\"issues\":[\"...\"]}]}"
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "mode": mode,
                        "instructions": instructions or "",
                        "document_context": document_context,
                        "questions": payload_questions,
                    },
                    ensure_ascii=False,
                ),
            },
        ]
        research_result = await _call_chat_json(research_messages, runtime, temperature=0.0)
        research_notes = research_result.get("notes", [])
        if not isinstance(research_notes, list):
            research_notes = []

        append_trace(
            trace,
            "fill",
            "running",
            f"Running fill agent on chunk {chunk_idx}/{len(chunks)}.",
            {"research_notes": len(research_notes)},
        )

        fill_messages = [
            {
                "role": "system",
                "content": (
                    "You are FillAgent for questionnaire completion. Think like a professional filling in "
                    "a vendor/compliance questionnaire on behalf of their company.\n\n"
                    "DECISION RULES:\n"
                    "1. ACTION='answer' only when confidence >= 0.7 AND the answer is factually supported "
                    "by KB candidates or clear document context.\n"
                    "2. ACTION='flag' when: confidence < 0.7, the question is context-specific (names, "
                    "dates, contacts, project references), the KB has no relevant match, or there is any "
                    "ambiguity about which entity the question refers to.\n"
                    "3. For context-specific fields (Company Name, Contact Person, Date, Address, etc.), "
                    "ALWAYS flag unless a prior answer or document header makes the answer unambiguous.\n"
                    "4. When flagging, include a clear 'reason' explaining what information is needed so "
                    "the human reviewer can fill it quickly.\n"
                    "5. Prefer KB-backed answers for general policy/compliance/security questions.\n"
                    "6. Never fabricate information. A wrong answer is worse than a flag.\n\n"
                    "Return strict JSON: "
                    "{\"decisions\":[{\"id\":\"...\",\"action\":\"answer|flag\",\"answer\":\"...\","
                    "\"confidence\":0.0,\"reason\":\"...\",\"issues\":[\"...\"]}],\"summary\":\"...\"}"
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "mode": mode,
                        "instructions": instructions or "",
                        "questions": payload_questions,
                        "research_notes": research_notes,
                    },
                    ensure_ascii=False,
                ),
            },
        ]
        fill_result = await _call_chat_json(fill_messages, runtime, temperature=0.0)
        chunk_decisions = fill_result.get("decisions", [])
        if not isinstance(chunk_decisions, list):
            chunk_decisions = []

        for decision in chunk_decisions:
            if not isinstance(decision, dict):
                continue
            decision_id = str(decision.get("id", ""))
            if not decision_id.startswith("q_"):
                continue
            try:
                item_index = int(decision_id.split("_", maxsplit=1)[1])
            except (TypeError, ValueError):
                continue
            if item_index < 0 or item_index >= len(items):
                continue

            action = str(decision.get("action", "flag")).strip().lower()
            answer = (decision.get("answer") or "").strip()
            if action not in {"answer", "flag"}:
                action = "flag"
            if action == "answer" and not answer:
                action = "flag"

            decision_payload = {
                "id": decision_id,
                "question": items[item_index].question_text,
                "action": action,
                "answer": answer if action == "answer" else None,
                "confidence": _coerce_confidence(decision.get("confidence")),
                "reason": str(decision.get("reason") or ""),
                "issues": decision.get("issues") if isinstance(decision.get("issues"), list) else [],
            }
            ordered_decisions.append(decision_payload)

            if action == "answer":
                items[item_index].answer_text = answer
            elif mode == AGENT_MODE_AGENT or not items[item_index].answer_text:
                items[item_index].answer_text = None

        append_trace(
            trace,
            "fill",
            "completed",
            f"Completed chunk {chunk_idx}/{len(chunks)}.",
            {"decisions": len(chunk_decisions)},
        )

    answers_generated = 0
    overrides = 0
    flags_recommended = 0

    for idx, item in enumerate(items):
        before = original_answers[idx]
        after = item.answer_text
        if before is None and after is not None:
            answers_generated += 1
        if before is not None and after is None:
            flags_recommended += 1
        if before is not None and after is not None and before.strip() != after.strip():
            overrides += 1

    summary = (
        f"Agent processed {len(work_items)} questions, generated {answers_generated} answer(s), "
        f"recommended {flags_recommended} additional flag(s), and adjusted {overrides} existing answer(s)."
    )
    append_trace(
        trace,
        "agent",
        "completed",
        summary,
    )

    return {
        "items": items,
        "trace": trace,
        "status": "completed",
        "summary": summary,
        "stats": {
            "questions_considered": len(work_items),
            "answers_generated": answers_generated,
            "flags_recommended": flags_recommended,
            "overrides": overrides,
        },
        "decisions": ordered_decisions[:100],
    }


async def run_troubleshoot_agent(
    *,
    file_path: Path,
    profile_results: list[dict[str, Any]],
    recommended_profile: str | None,
    instructions: str | None = None,
    runtime_config: AgentRuntimeConfig | None = None,
) -> dict[str, Any]:
    """Run an optional troubleshooting-focused agent analysis."""

    runtime = runtime_config or default_agent_runtime_config()
    trace: list[dict[str, Any]] = []
    if not is_agent_available(runtime):
        append_trace(
            trace,
            "agent",
            "skipped",
            "Troubleshooting agent skipped because API settings are incomplete.",
        )
        return {
            "status": "skipped",
            "summary": "Agent diagnostics unavailable because the API key/model/base URL are not configured.",
            "trace": trace,
            "root_causes": [],
            "next_steps": [],
            "recommended_profile": recommended_profile,
        }

    context = _extract_document_context(file_path, [])
    append_trace(
        trace,
        "agent",
        "running",
        "Running agent troubleshooting analysis.",
        {"provider": runtime.provider, "model": runtime.model},
    )

    payload = {
        "instructions": instructions or "",
        "recommended_profile_from_rules": recommended_profile,
        "profiles": profile_results,
        "document_context": context,
    }
    messages = [
        {
            "role": "system",
            "content": (
                "You are TroubleshootAgent for questionnaire parsing diagnostics. "
                "Analyze parser-profile outcomes and explain likely root causes. "
                "Return strict JSON object: "
                "{\"summary\":\"...\",\"root_causes\":[\"...\"],\"next_steps\":[\"...\"],"
                "\"recommended_profile\":\"profile_or_null\"}"
            ),
        },
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]

    result = await _call_chat_json(messages, runtime, temperature=0.0)
    summary = str(result.get("summary") or "").strip()
    root_causes = result.get("root_causes")
    next_steps = result.get("next_steps")
    recommended = result.get("recommended_profile")

    if not isinstance(root_causes, list):
        root_causes = []
    if not isinstance(next_steps, list):
        next_steps = []
    if recommended is not None:
        recommended = str(recommended).strip() or None

    if not summary:
        summary = "Agent analysis completed."

    append_trace(trace, "agent", "completed", summary)
    return {
        "status": "completed",
        "summary": summary,
        "trace": trace,
        "root_causes": [str(item) for item in root_causes[:8]],
        "next_steps": [str(item) for item in next_steps[:8]],
        "recommended_profile": recommended or recommended_profile,
    }
