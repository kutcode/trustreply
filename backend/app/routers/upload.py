"""Upload & processing job endpoints."""

from __future__ import annotations
import asyncio
import datetime
import logging
import uuid
import zipfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, BackgroundTasks, Form, Query
from sqlalchemy import select, func as sa_func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, async_session, init_db
from app.config import settings
from app.models import ProcessingJob, FlaggedQuestion, QuestionResult
from app.schemas import (
    JobBatchResponse, JobResponse, JobListResponse, TroubleshootResponse,
    QuestionResultResponse, QuestionResultListResponse, QuestionResultUpdate,
    FinalizeJobResponse,
)
from app.services.parser import (
    ExtractedItem,
    RunFormat,
    get_parse_options,
    get_parser_profile_names,
    get_parser_profiles,
    parse_document_result,
)
from app.services.matcher import match_questions
from app.services.generator import generate_filled_csv, generate_filled_docx, generate_docx_from_pdf_items
from app.services.agent import (
    AGENT_MODE_OFF,
    AgentRuntimeConfig,
    append_trace,
    is_agent_available,
    normalize_agent_mode,
    run_contextual_fill_agent,
    run_troubleshoot_agent,
)
from app.services.audit import log_audit
from app.services.fingerprint import find_matching_fingerprint, save_fingerprint
from app.utils.questions import normalize_question_key

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["upload"])


def _serialize_run_format(fmt: RunFormat | None) -> dict | None:
    """Convert a RunFormat dataclass to a JSON-serializable dict."""
    if fmt is None:
        return None
    result: dict = {}
    if fmt.font_name:
        result["font_name"] = fmt.font_name
    if fmt.font_size:
        result["font_size"] = str(fmt.font_size)
    if fmt.bold is not None:
        result["bold"] = fmt.bold
    if fmt.italic is not None:
        result["italic"] = fmt.italic
    if fmt.underline is not None:
        result["underline"] = fmt.underline
    if fmt.color_rgb:
        result["color_rgb"] = str(fmt.color_rgb)
    return result or None


def _deserialize_run_format(data: dict | None) -> RunFormat | None:
    """Reconstruct a RunFormat from serialized JSON."""
    if not data:
        return None
    fmt = RunFormat()
    fmt.font_name = data.get("font_name")
    fmt.bold = data.get("bold")
    fmt.italic = data.get("italic")
    fmt.underline = data.get("underline")
    # font_size and color_rgb are stored as strings; generator handles None gracefully
    return fmt

ALLOWED_EXTENSIONS = {".docx", ".pdf", ".csv"}


def _clean_optional_form_value(value: str | None) -> str | None:
    """Normalize optional form values and collapse blanks to None."""

    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _build_runtime_agent_config(
    *,
    agent_provider: str | None = None,
    agent_api_base: str | None = None,
    agent_api_key: str | None = None,
    agent_model: str | None = None,
) -> AgentRuntimeConfig | None:
    """Build an optional per-request agent configuration override.

    When the frontend sends only a provider (e.g. ``anthropic``), the key,
    base URL, and model are resolved from the per-provider settings stored
    in the backend.  This avoids sending API keys from the browser.
    """

    provider = _clean_optional_form_value(agent_provider)
    api_base = _clean_optional_form_value(agent_api_base)
    api_key = _clean_optional_form_value(agent_api_key)
    model = _clean_optional_form_value(agent_model)

    has_override = any(value is not None for value in (provider, api_base, api_key, model))
    if not has_override:
        return None

    # Auto-fill missing fields from per-provider settings
    norm = (provider or "").strip().lower()
    if norm == "anthropic":
        api_base = api_base or "https://api.anthropic.com/v1"
        api_key = api_key or settings.agent_anthropic_api_key or settings.agent_api_key or ""
        model = model or settings.agent_anthropic_model or "claude-sonnet-4-6"
    elif norm in ("openai", "openai-compatible"):
        api_base = api_base or "https://api.openai.com/v1"
        api_key = api_key or settings.agent_openai_api_key or settings.agent_api_key or ""
        model = model or settings.agent_openai_model or "gpt-4.1-nano"
    else:
        # Unknown provider — fall back to legacy settings
        api_base = api_base or settings.agent_api_base or ""
        api_key = api_key or settings.agent_api_key or ""
        model = model or settings.agent_model or ""

    api_key = api_key.strip()
    api_base = api_base.strip()
    model = model.strip()

    missing = []
    if not api_base:
        missing.append("agent_api_base")
    if not api_key:
        missing.append("agent_api_key")
    if not model:
        missing.append("agent_model")
    if missing:
        missing_fields = ", ".join(missing)
        raise HTTPException(
            status_code=400,
            detail=(
                f"Custom agent configuration is incomplete. Missing: {missing_fields}. "
                "Provide all three fields when overriding provider settings."
            ),
        )

    return AgentRuntimeConfig(
        api_base=api_base,
        api_key=api_key,
        model=model,
        provider=provider or "openai-compatible",
    )


def _output_file_spec(original_filename: str, source_suffix: str) -> tuple[str, str]:
    """Return the final downloadable filename and media type for a processed job."""

    stem = Path(original_filename).stem
    if source_suffix == ".pdf":
        return (
            f"filled_{uuid.uuid4().hex[:8]}_{stem}.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
    if source_suffix == ".csv":
        return (f"filled_{uuid.uuid4().hex[:8]}_{stem}.csv", "text/csv")
    return (
        f"filled_{uuid.uuid4().hex[:8]}_{stem}.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


def _media_type_for_path(path: Path) -> str:
    """Map output suffixes to download media types."""

    suffix = path.suffix.lower()
    if suffix == ".csv":
        return "text/csv"
    if suffix == ".docx":
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    return "application/octet-stream"


def _validate_upload_file(file: UploadFile) -> str:
    """Validate a user-supplied upload and return its normalized suffix."""

    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    suffix = Path(file.filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{suffix}' for '{file.filename}'. Supported: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    return suffix


async def _create_processing_job(
    file: UploadFile,
    suffix: str,
    parser_profile: str | None,
    agent_mode: str,
    agent_model: str | None,
    db: AsyncSession,
    batch_id: str | None = None,
) -> ProcessingJob:
    """Persist an upload to disk and create its processing job."""

    stored_name = f"{uuid.uuid4().hex}{suffix}"
    dest = settings.upload_dir / stored_name

    # Validate file size using streaming read to avoid loading arbitrarily large files
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    content = await file.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"File '{file.filename}' exceeds the maximum upload size of {settings.max_upload_size_mb} MB.",
        )

    dest.write_bytes(content)

    job = ProcessingJob(
        batch_id=batch_id,
        original_filename=file.filename or stored_name,
        stored_filename=stored_name,
        status="pending",
        parser_profile_name=parser_profile or settings.default_parser_profile,
        agent_mode=agent_mode,
        agent_status="pending" if agent_mode != AGENT_MODE_OFF else "disabled",
        agent_model=agent_model if agent_mode != AGENT_MODE_OFF else None,
        agent_trace=[],
    )
    db.add(job)
    return job


def _build_batch_response(batch_id: str, jobs: list[ProcessingJob]) -> JobBatchResponse:
    """Serialize a grouped upload result."""

    return JobBatchResponse(batch_id=batch_id, items=jobs, total=len(jobs))


def _append_job_trace(
    job: ProcessingJob,
    *,
    step: str,
    status: str,
    message: str,
    data: dict[str, Any] | None = None,
) -> None:
    """Append a structured trace event to the job."""

    trace = list(job.agent_trace or [])
    append_trace(trace, step=step, status=status, message=message, data=data)
    job.agent_trace = trace


def _rebuild_flagged_questions(
    items,
    job_id: int,
    prior_flagged_by_key: dict[str, FlaggedQuestion],
) -> list[FlaggedQuestion]:
    """Recreate flagged rows after optional agent adjustments."""

    refreshed: list[FlaggedQuestion] = []
    for item in items:
        if item.answer_text is not None:
            continue

        normalized = normalize_question_key(item.question_text)
        prior = prior_flagged_by_key.get(normalized)
        refreshed.append(
            FlaggedQuestion(
                job_id=job_id,
                extracted_question=item.question_text,
                context=prior.context if prior else None,
                location_info=item.location,
                similarity_score=prior.similarity_score if prior else None,
                best_match_question=prior.best_match_question if prior else None,
                resolved=False,
            )
        )
    return refreshed


def _troubleshoot_sort_key(profile_result: dict[str, object]) -> tuple[bool, bool, int, float, bool]:
    """Rank parser profiles by practical usefulness for a given document."""

    question_count = int(profile_result.get("question_count", 0))
    confidence = float(profile_result.get("confidence", 0.0))
    fallback_recommended = bool(profile_result.get("fallback_recommended", False))
    profile_name = str(profile_result.get("profile_name", ""))

    return (
        question_count > 0,
        not fallback_recommended,
        question_count,
        confidence,
        profile_name == settings.default_parser_profile,
    )


def _build_troubleshoot_summary(
    file_type: str,
    profiles: list[dict[str, object]],
) -> tuple[str | None, str | None, str, list[str]]:
    """Choose the best parser profile and explain the recommendation."""

    successful_profiles = [profile for profile in profiles if not profile.get("error_message")]
    if not successful_profiles:
        return (
            None,
            None,
            "Every parser profile failed while reading this document.",
            [
                "Try exporting the questionnaire again as DOCX or a text-selectable PDF.",
                "If this document consistently fails, it is a good candidate for a dedicated parser rule or fallback parser.",
            ],
        )

    best_profile = max(successful_profiles, key=_troubleshoot_sort_key)
    if int(best_profile.get("question_count", 0)) == 0:
        hints = [
            "No parser profile found any questions in this document.",
            "This usually means the layout is unsupported, the text is scanned/non-selectable, or the questions are embedded in an unusual structure.",
        ]
        if file_type == "pdf":
            hints.append("If this is a scanned PDF, OCR may be required before parsing.")
        hints.append("If this layout is expected in production, add a dedicated parser profile or fallback parser for it.")
        return None, None, "No parser profile was able to extract questions from this file.", hints

    recommended_profile = str(best_profile["profile_name"])
    recommended_label = str(best_profile["profile_label"])
    recommended_count = int(best_profile["question_count"])
    default_profile = next(
        (profile for profile in profiles if profile.get("profile_name") == settings.default_parser_profile),
        None,
    )

    if default_profile and default_profile["profile_name"] != recommended_profile:
        default_count = int(default_profile.get("question_count", 0))
        if default_count == 0:
            reason = (
                f"The default parser found no questions, but {recommended_label} found {recommended_count}."
            )
        else:
            reason = (
                f"{recommended_label} found {recommended_count} questions, which is more complete than the default parser's {default_count}."
            )
    else:
        reason = f"{recommended_label} is the best fit for this document and found {recommended_count} questions."

    hints = []
    if recommended_profile != settings.default_parser_profile:
        hints.append(f"Retry the upload with the '{recommended_profile}' parser profile.")
    else:
        hints.append("The default parser looks suitable for this document.")

    if bool(best_profile.get("fallback_recommended")):
        hints.append("The parse is still marked as weak, so review the extracted question preview before relying on the result.")

    return recommended_profile, recommended_label, reason, hints


async def _process_batch_concurrent(
    job_ids: list[int],
    agent_instructions: str | None = None,
    runtime_agent_config: AgentRuntimeConfig | None = None,
) -> None:
    """Process multiple batch jobs concurrently using a semaphore to limit parallelism."""

    # Ensure DB schema is ready once before the batch starts
    await init_db()

    max_concurrent = settings.agent_max_concurrent_jobs

    semaphore = asyncio.Semaphore(max_concurrent)

    async def _run_with_limit(job_id: int) -> None:
        async with semaphore:
            await _process_document(job_id, agent_instructions, runtime_agent_config)

    await asyncio.gather(
        *[_run_with_limit(job_id) for job_id in job_ids],
        return_exceptions=True,
    )


async def _process_document(
    job_id: int,
    agent_instructions: str | None = None,
    runtime_agent_config: AgentRuntimeConfig | None = None,
    template_id: int | None = None,
) -> None:
    """Background task: parse → match/fill strategy → generate output."""

    async with async_session() as db:
        try:
            job = await db.get(ProcessingJob, job_id)
            if not job:
                return

            job.status = "processing"
            job.error_message = None
            job.agent_error = None
            try:
                job.agent_mode = normalize_agent_mode(job.agent_mode)
            except ValueError:
                job.agent_mode = AGENT_MODE_OFF

            if job.agent_mode == AGENT_MODE_OFF:
                job.agent_status = "disabled"
                job.agent_summary = "Agent mode disabled."
                job.agent_trace = []
            elif not is_agent_available(runtime_agent_config):
                job.agent_status = "skipped"
                job.agent_summary = (
                    "Agent requested but API settings are incomplete. "
                    "No semantic fallback was used; unanswered questions will be flagged for review."
                )
                job.agent_trace = []
                _append_job_trace(
                    job,
                    step="agent",
                    status="skipped",
                    message="Agent requested but unavailable due missing configuration; semantic matcher skipped.",
                )
            else:
                job.agent_status = "pending"
                if runtime_agent_config:
                    job.agent_model = runtime_agent_config.model
                else:
                    job.agent_model = settings.agent_model
                job.agent_summary = "Agent queued."
                job.agent_trace = []
                _append_job_trace(
                    job,
                    step="agent",
                    status="pending",
                    message=f"Agent mode '{job.agent_mode}' queued for execution.",
                    data={
                        "model": job.agent_model,
                        "provider": runtime_agent_config.provider if runtime_agent_config else settings.agent_provider,
                    },
                )
            await db.commit()

            source_path = settings.upload_dir / job.stored_filename
            suffix = source_path.suffix.lower()

            # ── Format fingerprint auto-detection ─────────────────────
            effective_profile = job.parser_profile_name or settings.default_parser_profile
            effective_hints = settings.parser_hint_overrides or None
            fingerprint_match = await find_matching_fingerprint(source_path, db)
            if fingerprint_match and effective_profile == settings.default_parser_profile:
                effective_profile = fingerprint_match.parser_profile
                if fingerprint_match.hint_overrides:
                    effective_hints = fingerprint_match.hint_overrides
                fingerprint_match.last_used_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
                _append_job_trace(
                    job,
                    step="fingerprint",
                    status="matched",
                    message=f"Auto-detected format: profile '{effective_profile}' from learned fingerprint.",
                    data={
                        "fingerprint_id": fingerprint_match.id,
                        "fingerprint_name": fingerprint_match.name,
                        "success_count": fingerprint_match.success_count,
                    },
                )

            parse_result = parse_document_result(
                source_path,
                options=get_parse_options(
                    effective_profile,
                    hint_overrides=effective_hints,
                ),
            )
            items = parse_result.items
            job.total_questions = len(items)
            job.parser_strategy = parse_result.parser_strategy
            job.parser_profile_name = parse_result.profile_name
            job.parse_confidence = parse_result.confidence
            job.parse_stats = parse_result.stats
            job.fallback_recommended = parse_result.fallback_recommended
            job.fallback_reason = parse_result.fallback_reason
            _append_job_trace(
                job,
                step="parser",
                status="completed",
                message=f"Extracted {len(items)} question(s) with parser profile '{parse_result.profile_name}'.",
                data={"confidence": parse_result.confidence},
            )
            await db.commit()  # Commit fingerprint + parser results together

            # ── Template pre-fill ─────────────────────────────────────
            if template_id is not None:
                from app.models import QuestionnaireTemplate, TemplateAnswer
                template = await db.get(QuestionnaireTemplate, template_id)
                if template:
                    result = await db.execute(
                        select(TemplateAnswer).where(TemplateAnswer.template_id == template_id)
                    )
                    template_answers = result.scalars().all()
                    template_lookup: dict[str, str] = {}
                    for ta in template_answers:
                        key = normalize_question_key(ta.question_text)
                        template_lookup[key] = ta.answer_text

                    prefilled = 0
                    for item in items:
                        if item.answer_text is not None:
                            continue
                        key = normalize_question_key(item.question_text)
                        if key in template_lookup:
                            item.answer_text = template_lookup[key]
                            item.matched_source = "template"
                            item.confidence = 0.95
                            prefilled += 1

                    template.times_used = (template.times_used or 0) + 1
                    template.last_used_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
                    _append_job_trace(
                        job,
                        step="template",
                        status="completed",
                        message=f"Pre-filled {prefilled} answer(s) from template '{template.name}'.",
                        data={"template_id": template_id, "prefilled": prefilled},
                    )
                    await db.commit()

            if not items:
                job.status = "done"
                job.matched_questions = 0
                job.flagged_questions_count = 0
                job.completed_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
                if suffix in {".docx", ".csv"}:
                    output_name = f"filled_{job.stored_filename}"
                    import shutil

                    shutil.copy2(str(source_path), str(settings.output_dir / output_name))
                    job.output_filename = output_name
                if job.agent_mode != AGENT_MODE_OFF and job.agent_status in {"pending", "running"}:
                    job.agent_status = "completed"
                    job.agent_summary = "No questions were extracted, so agent reasoning did not run."
                await db.commit()
                return

            agent_result: dict[str, Any] | None = None
            prior_flagged_by_key: dict[str, FlaggedQuestion] = {}
            if job.agent_mode == AGENT_MODE_OFF:
                items, flagged = await match_questions(items, job_id, db)
                for flagged_item in flagged:
                    key = normalize_question_key(flagged_item.extracted_question)
                    current = prior_flagged_by_key.get(key)
                    current_score = (current.similarity_score or -1.0) if current is not None else -1.0
                    candidate_score = flagged_item.similarity_score or -1.0
                    if current is None or candidate_score > current_score:
                        prior_flagged_by_key[key] = flagged_item

                _append_job_trace(
                    job,
                    step="matcher",
                    status="completed",
                    message="Semantic matching completed.",
                    data={
                        "matched": sum(1 for item in items if item.answer_text is not None),
                        "flagged": len(flagged),
                    },
                )
            else:
                _append_job_trace(
                    job,
                    step="matcher",
                    status="skipped",
                    message="Semantic matcher skipped in Agent mode (AI-first flow).",
                )
            # Defer commit — will happen before agent run or at final save

            if job.agent_mode != AGENT_MODE_OFF and is_agent_available(runtime_agent_config):
                try:
                    job.agent_status = "running"
                    _append_job_trace(
                        job,
                        step="agent",
                        status="running",
                        message="Running research + fill agents.",
                    )
                    await db.commit()

                    agent_result = await run_contextual_fill_agent(
                        file_path=source_path,
                        items=items,
                        db=db,
                        mode=job.agent_mode,
                        instructions=agent_instructions,
                        runtime_config=runtime_agent_config,
                    )
                    items = agent_result.get("items", items)

                    existing_trace = list(job.agent_trace or [])
                    for event in agent_result.get("trace", []):
                        if isinstance(event, dict):
                            existing_trace.append(event)
                    job.agent_trace = existing_trace
                    job.agent_status = str(agent_result.get("status") or "completed")
                    job.agent_summary = str(agent_result.get("summary") or "Agent run completed.")
                    job.agent_error = None
                    # Store token usage stats
                    agent_stats = agent_result.get("stats", {})
                    job.agent_input_tokens = agent_stats.get("input_tokens")
                    job.agent_output_tokens = agent_stats.get("output_tokens")
                    job.agent_llm_calls = agent_stats.get("llm_calls")
                    job.agent_kb_routed = agent_stats.get("kb_routed")
                    await db.commit()
                except Exception as agent_exc:
                    job.agent_status = "error"
                    job.agent_error = str(agent_exc)
                    if not job.agent_summary:
                        job.agent_summary = "Agent run failed. Unanswered questions were left flagged for review."
                    _append_job_trace(
                        job,
                        step="agent",
                        status="error",
                        message="Agent run failed; no semantic fallback applied in Agent mode.",
                        data={"error": str(agent_exc)},
                    )
                    await db.commit()

            flagged = _rebuild_flagged_questions(items, job_id, prior_flagged_by_key)
            for flagged_item in flagged:
                db.add(flagged_item)

            job.matched_questions = sum(1 for item in items if item.answer_text is not None)
            job.flagged_questions_count = len(flagged)

            # Build lookup for agent reasoning data (reason + issues per question)
            agent_decisions_lookup: dict[str, dict] = {}
            if agent_result is not None:
                for dec in agent_result.get("decisions", []):
                    if isinstance(dec, dict) and "id" in dec:
                        agent_decisions_lookup[dec["id"]] = dec

            # Store per-question results for confidence visibility & review queue
            for idx, item in enumerate(items):
                source = "unmatched"
                if item.answer_text is not None:
                    if item.matched_source:
                        source = item.matched_source
                    elif job.agent_mode != AGENT_MODE_OFF:
                        source = "agent"
                    else:
                        source = "kb_match"

                # Attach agent reasoning if available
                decision = agent_decisions_lookup.get(f"q_{idx}", {})
                qr = QuestionResult(
                    job_id=job_id,
                    question_index=idx,
                    question_text=item.question_text,
                    answer_text=item.answer_text,
                    confidence_score=item.confidence,
                    source=source,
                    kb_pair_id=item.matched_qa_id,
                    location_info=item.location,
                    formatting_info=_serialize_run_format(item.formatting),
                    item_type=item.item_type,
                    reviewed=False,
                    agent_reason=decision.get("reason"),
                    agent_issues=decision.get("issues"),
                )
                db.add(qr)

            job.review_status = "pending"
            await db.commit()

            output_name, _ = _output_file_spec(job.original_filename, suffix)
            output_path = settings.output_dir / output_name

            if suffix == ".docx":
                generate_filled_docx(source_path, output_path, items)
            elif suffix == ".pdf":
                generate_docx_from_pdf_items(output_path, items)
            elif suffix == ".csv":
                generate_filled_csv(source_path, output_path, items)

            job.output_filename = output_name
            job.status = "done"
            job.completed_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)

            # ── Save format fingerprint ───────────────────────────────
            if len(items) > 0:
                try:
                    await save_fingerprint(
                        file_path=source_path,
                        parser_profile=job.parser_profile_name or settings.default_parser_profile,
                        hint_overrides=settings.parser_hint_overrides or None,
                        original_filename=job.original_filename,
                        db=db,
                    )
                except Exception as e:
                    logger.warning("Failed to save format fingerprint: %s", e)

            await db.commit()

        except Exception as e:
            job = await db.get(ProcessingJob, job_id)
            if job:
                job.status = "error"
                job.error_message = str(e)
                _append_job_trace(
                    job,
                    step="job",
                    status="error",
                    message="Processing pipeline failed.",
                    data={"error": str(e)},
                )
                await db.commit()
            raise


@router.post("/upload", response_model=JobResponse)
async def upload_document(
    file: UploadFile = File(...),
    parser_profile: str | None = Form(None),
    template_id: str | None = Form(None),
    agent_mode: str | None = Form(None),
    agent_instructions: str | None = Form(None),
    agent_provider: str | None = Form(None),
    agent_api_base: str | None = Form(None),
    agent_api_key: str | None = Form(None),
    agent_model: str | None = Form(None),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: AsyncSession = Depends(get_db),
):
    """Upload a questionnaire document for processing."""
    suffix = _validate_upload_file(file)
    if parser_profile and parser_profile not in get_parser_profile_names():
        raise HTTPException(
            status_code=400,
            detail=f"Unknown parser profile '{parser_profile}'",
        )

    # Validate template_id if provided
    template_id_parsed = None
    if template_id is not None:
        template_id_str = str(template_id).strip()
        if template_id_str and template_id_str != 'null':
            try:
                template_id_parsed = int(template_id_str)
            except (ValueError, TypeError):
                raise HTTPException(status_code=400, detail=f"Invalid template_id '{template_id}'")

    try:
        normalized_agent_mode = normalize_agent_mode(agent_mode)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Unknown agent mode '{agent_mode}'")

    runtime_agent_config = _build_runtime_agent_config(
        agent_provider=agent_provider,
        agent_api_base=agent_api_base,
        agent_api_key=agent_api_key,
        agent_model=agent_model,
    )

    job = await _create_processing_job(
        file,
        suffix,
        parser_profile,
        normalized_agent_mode,
        runtime_agent_config.model if runtime_agent_config else settings.agent_model,
        db,
    )
    await db.commit()
    await db.refresh(job)

    background_tasks.add_task(
        _process_document,
        job.id,
        _clean_optional_form_value(agent_instructions),
        runtime_agent_config,
        template_id_parsed,
    )

    return job


@router.post("/upload/bulk", response_model=JobBatchResponse)
async def bulk_upload_documents(
    files: list[UploadFile] = File(...),
    parser_profile: str | None = Form(None),
    agent_mode: str | None = Form(None),
    agent_instructions: str | None = Form(None),
    agent_provider: str | None = Form(None),
    agent_api_base: str | None = Form(None),
    agent_api_key: str | None = Form(None),
    agent_model: str | None = Form(None),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: AsyncSession = Depends(get_db),
):
    """Upload multiple questionnaire documents as a grouped batch."""
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")
    if len(files) > settings.max_bulk_files:
        raise HTTPException(
            status_code=400,
            detail=f"Too many files. Bulk upload currently supports up to {settings.max_bulk_files} files at once.",
        )
    if parser_profile and parser_profile not in get_parser_profile_names():
        raise HTTPException(
            status_code=400,
            detail=f"Unknown parser profile '{parser_profile}'",
        )

    try:
        normalized_agent_mode = normalize_agent_mode(agent_mode)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Unknown agent mode '{agent_mode}'")

    runtime_agent_config = _build_runtime_agent_config(
        agent_provider=agent_provider,
        agent_api_base=agent_api_base,
        agent_api_key=agent_api_key,
        agent_model=agent_model,
    )
    cleaned_instructions = _clean_optional_form_value(agent_instructions)

    validated_files = [(file, _validate_upload_file(file)) for file in files]
    batch_id = uuid.uuid4().hex[:12]

    jobs: list[ProcessingJob] = []
    for file, suffix in validated_files:
        job = await _create_processing_job(
            file,
            suffix,
            parser_profile,
            normalized_agent_mode,
            runtime_agent_config.model if runtime_agent_config else settings.agent_model,
            db,
            batch_id=batch_id,
        )
        jobs.append(job)

    await db.commit()
    for job in jobs:
        await db.refresh(job)

    # Process batch jobs concurrently instead of sequentially
    background_tasks.add_task(
        _process_batch_concurrent,
        [job.id for job in jobs],
        cleaned_instructions,
        runtime_agent_config,
    )

    return _build_batch_response(batch_id, jobs)


@router.post("/troubleshoot", response_model=TroubleshootResponse)
async def troubleshoot_document(
    file: UploadFile = File(...),
    analyze_with_agent: bool = Form(False),
    agent_instructions: str | None = Form(None),
    agent_provider: str | None = Form(None),
    agent_api_base: str | None = Form(None),
    agent_api_key: str | None = Form(None),
    agent_model: str | None = Form(None),
):
    """Analyze a document across parser profiles without creating a processing job."""

    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    suffix = Path(file.filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{suffix}'. Supported: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    temp_name = f"troubleshoot_{uuid.uuid4().hex}{suffix}"
    temp_path = settings.upload_dir / temp_name
    content = await file.read()
    temp_path.write_bytes(content)

    try:
        profiles = []
        for profile in get_parser_profiles():
            profile_name = profile["name"]
            profile_label = profile["label"]
            try:
                parse_result = parse_document_result(temp_path, options=get_parse_options(profile_name))
                profiles.append(
                    {
                        "profile_name": profile_name,
                        "profile_label": profile_label,
                        "question_count": len(parse_result.items),
                        "confidence": parse_result.confidence,
                        "fallback_recommended": parse_result.fallback_recommended,
                        "fallback_reason": parse_result.fallback_reason,
                        "stats": parse_result.stats,
                        "sample_questions": [item.question_text for item in parse_result.items[:6]],
                        "error_message": None,
                    }
                )
            except Exception as exc:
                profiles.append(
                    {
                        "profile_name": profile_name,
                        "profile_label": profile_label,
                        "question_count": 0,
                        "confidence": 0.0,
                        "fallback_recommended": True,
                        "fallback_reason": "parser_error",
                        "stats": {},
                        "sample_questions": [],
                        "error_message": str(exc),
                    }
                )

        recommended_profile, recommended_label, recommendation_reason, hints = _build_troubleshoot_summary(
            suffix.lstrip("."),
            profiles,
        )

        agent_analysis = None
        if analyze_with_agent:
            runtime_agent_config = _build_runtime_agent_config(
                agent_provider=agent_provider,
                agent_api_base=agent_api_base,
                agent_api_key=agent_api_key,
                agent_model=agent_model,
            )
            try:
                agent_analysis = await run_troubleshoot_agent(
                    file_path=temp_path,
                    profile_results=profiles,
                    recommended_profile=recommended_profile,
                    instructions=_clean_optional_form_value(agent_instructions),
                    runtime_config=runtime_agent_config,
                )
            except Exception as agent_exc:
                agent_analysis = {
                    "status": "error",
                    "summary": f"Agent troubleshooting failed: {agent_exc}",
                    "trace": [],
                    "root_causes": [],
                    "next_steps": [],
                    "recommended_profile": recommended_profile,
                    "fix_plan": {
                        "type": "agent_error",
                        "title": "AI troubleshooting failed for this run",
                        "rationale": str(agent_exc),
                        "action": "manual_follow_up",
                        "can_auto_apply": False,
                        "parser_profile": recommended_profile,
                        "parser_profile_label": None,
                        "parser_hints": {},
                        "steps": [
                            "Verify API credentials/model in Settings.",
                            "Retry Troubleshooting with AI diagnostics.",
                        ],
                    },
                }

        # Auto-apply the fix when the agent says it can be applied
        if agent_analysis:
            fix_plan = agent_analysis.get("fix_plan") or {}
            if fix_plan.get("can_auto_apply") and fix_plan.get("parser_profile"):
                profile_to_apply = fix_plan["parser_profile"]
                if profile_to_apply in get_parser_profile_names():
                    settings.default_parser_profile = profile_to_apply
                    agent_hints = fix_plan.get("parser_hints")
                    if isinstance(agent_hints, dict) and agent_hints:
                        settings.parser_hint_overrides = agent_hints
                    else:
                        settings.parser_hint_overrides = {}
                    fix_plan["auto_applied"] = True

        return TroubleshootResponse(
            filename=file.filename,
            file_type=suffix.lstrip("."),
            recommended_profile=recommended_profile,
            recommended_profile_label=recommended_label,
            recommendation_reason=recommendation_reason,
            hints=hints,
            profiles=profiles,
            agent_analysis=agent_analysis,
        )
    finally:
        if temp_path.exists():
            temp_path.unlink()


@router.get("/jobs", response_model=JobListResponse)
async def list_jobs(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """List all processing jobs with pagination."""
    # Get total count
    count_result = await db.execute(select(sa_func.count()).select_from(ProcessingJob))
    total = count_result.scalar() or 0

    # Paginate
    result = await db.execute(
        select(ProcessingJob)
        .order_by(ProcessingJob.uploaded_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    jobs = result.scalars().all()
    return JobListResponse(items=jobs, total=total)


@router.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(job_id: int, db: AsyncSession = Depends(get_db)):
    """Get status of a processing job."""
    job = await db.get(ProcessingJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/jobs/batch/{batch_id}", response_model=JobBatchResponse)
async def get_job_batch(batch_id: str, db: AsyncSession = Depends(get_db)):
    """Fetch the jobs that belong to a single upload batch."""

    result = await db.execute(
        select(ProcessingJob)
        .where(ProcessingJob.batch_id == batch_id)
        .order_by(ProcessingJob.id.asc())
    )
    jobs = result.scalars().all()
    if not jobs:
        raise HTTPException(status_code=404, detail="Batch not found")
    return _build_batch_response(batch_id, jobs)


@router.get("/jobs/batch/{batch_id}/download")
async def download_batch_results(batch_id: str, db: AsyncSession = Depends(get_db)):
    """Download all completed outputs for a batch as a ZIP archive."""
    from fastapi.responses import FileResponse

    result = await db.execute(
        select(ProcessingJob)
        .where(ProcessingJob.batch_id == batch_id)
        .order_by(ProcessingJob.id.asc())
    )
    jobs = result.scalars().all()
    if not jobs:
        raise HTTPException(status_code=404, detail="Batch not found")

    completed_jobs = []
    for job in jobs:
        if job.status != "done" or not job.output_filename:
            continue
        output_path = settings.output_dir / job.output_filename
        if output_path.exists():
            completed_jobs.append((job, output_path))

    if not completed_jobs:
        raise HTTPException(
            status_code=400,
            detail="No completed output files are available for this batch yet",
        )

    zip_path = settings.output_dir / f"batch_{batch_id}_results.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for index, (job, output_path) in enumerate(completed_jobs, start=1):
            download_name = f"filled_{Path(job.original_filename).stem}{output_path.suffix}"

            # Keep names unique in the archive if users upload duplicate filenames.
            if any(info.filename == download_name for info in archive.infolist()):
                download_name = f"{Path(download_name).stem}_{index}{output_path.suffix}"

            archive.write(output_path, arcname=download_name)

    return FileResponse(
        path=str(zip_path),
        filename=f"batch_{batch_id}_results.zip",
        media_type="application/zip",
    )


@router.get("/jobs/{job_id}/download")
async def download_result(job_id: int, db: AsyncSession = Depends(get_db)):
    """Download the filled document."""
    from fastapi.responses import FileResponse

    job = await db.get(ProcessingJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != "done":
        raise HTTPException(status_code=400, detail=f"Job is not complete (status: {job.status})")
    if not job.output_filename:
        raise HTTPException(status_code=404, detail="No output file available")

    output_path = settings.output_dir / job.output_filename
    if not output_path.exists():
        raise HTTPException(status_code=404, detail="Output file not found on disk")

    download_name = f"filled_{Path(job.original_filename).stem}{output_path.suffix}"

    return FileResponse(
        path=str(output_path),
        filename=download_name,
        media_type=_media_type_for_path(output_path),
    )


# ── Review Queue Endpoints ────────────────────────────────────────────


@router.get("/jobs/{job_id}/questions", response_model=QuestionResultListResponse)
async def list_question_results(job_id: int, db: AsyncSession = Depends(get_db)):
    """List all per-question results for a completed job."""
    job = await db.get(ProcessingJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    result = await db.execute(
        select(QuestionResult)
        .where(QuestionResult.job_id == job_id)
        .order_by(QuestionResult.question_index.asc())
    )
    items = result.scalars().all()
    reviewed_count = sum(1 for q in items if q.reviewed)
    return QuestionResultListResponse(
        items=items,
        total=len(items),
        reviewed_count=reviewed_count,
        unreviewed_count=len(items) - reviewed_count,
    )


@router.put("/jobs/{job_id}/questions/{question_id}", response_model=QuestionResultResponse)
async def update_question_result(
    job_id: int,
    question_id: int,
    body: QuestionResultUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Edit an answer before finalizing."""
    qr = await db.get(QuestionResult, question_id)
    if not qr or qr.job_id != job_id:
        raise HTTPException(status_code=404, detail="Question result not found")

    before = qr.edited_answer_text or qr.answer_text
    qr.edited_answer_text = body.answer_text
    qr.reviewed = True

    job = await db.get(ProcessingJob, job_id)
    if job and job.review_status != "in_review":
        job.review_status = "in_review"

    await log_audit(
        db,
        action_type="question_edit",
        entity_type="question_result",
        entity_id=question_id,
        job_id=job_id,
        before_value=before,
        after_value=body.answer_text,
    )
    await db.commit()
    await db.refresh(qr)
    return qr


@router.post("/jobs/{job_id}/questions/{question_id}/approve", response_model=QuestionResultResponse)
async def approve_question_result(
    job_id: int,
    question_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Approve an answer without editing."""
    qr = await db.get(QuestionResult, question_id)
    if not qr or qr.job_id != job_id:
        raise HTTPException(status_code=404, detail="Question result not found")

    qr.reviewed = True
    await log_audit(
        db,
        action_type="question_approve",
        entity_type="question_result",
        entity_id=question_id,
        job_id=job_id,
    )
    await db.commit()
    await db.refresh(qr)
    return qr


@router.post("/jobs/{job_id}/questions/approve-all")
async def approve_all_question_results(job_id: int, db: AsyncSession = Depends(get_db)):
    """Bulk-approve all unreviewed questions for a job."""
    job = await db.get(ProcessingJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    result = await db.execute(
        select(QuestionResult).where(
            QuestionResult.job_id == job_id,
            QuestionResult.reviewed.is_(False),
        )
    )
    items = result.scalars().all()
    for qr in items:
        qr.reviewed = True
    await log_audit(
        db,
        action_type="bulk_approve",
        entity_type="processing_job",
        entity_id=job_id,
        job_id=job_id,
        details={"count": len(items)},
    )
    await db.commit()
    return {"approved": len(items)}


@router.post("/jobs/{job_id}/finalize", response_model=FinalizeJobResponse)
async def finalize_job(job_id: int, db: AsyncSession = Depends(get_db)):
    """Regenerate the output document incorporating any edited answers."""
    job = await db.get(ProcessingJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != "done":
        raise HTTPException(status_code=400, detail="Job is not complete")

    result = await db.execute(
        select(QuestionResult)
        .where(QuestionResult.job_id == job_id)
        .order_by(QuestionResult.question_index.asc())
    )
    question_results = result.scalars().all()

    if not question_results:
        raise HTTPException(status_code=400, detail="No question results to finalize")

    rebuilt_items: list[ExtractedItem] = []
    total_edited = 0
    corrections_captured = 0

    from app.models import AnswerCorrection, QAPair
    from app.utils.embeddings import compute_embedding, embedding_to_bytes

    for qr in question_results:
        final_answer = qr.edited_answer_text if qr.edited_answer_text else qr.answer_text
        if qr.edited_answer_text and qr.edited_answer_text != (qr.answer_text or ""):
            total_edited += 1

            # Capture correction
            correction = AnswerCorrection(
                job_id=job_id,
                question_result_id=qr.id,
                question_text=qr.question_text,
                original_answer=qr.answer_text,
                corrected_answer=qr.edited_answer_text,
                original_source=qr.source,
                original_confidence=qr.confidence_score,
                correction_type="manual",
            )

            # Auto-add to KB if enabled
            if settings.feedback_auto_add_to_kb:
                conf = qr.confidence_score or 0.0
                if conf >= settings.feedback_min_confidence:
                    normalized_q = qr.question_text.strip().lower()
                    existing_result = await db.execute(
                        select(QAPair).where(sa_func.lower(QAPair.question) == normalized_q).where(QAPair.deleted_at.is_(None))
                    )
                    existing_qa = existing_result.scalars().first()
                    embedding = compute_embedding(qr.question_text)

                    if existing_qa:
                        existing_qa.answer = qr.edited_answer_text
                        existing_qa.embedding = embedding_to_bytes(embedding)
                        correction.kb_pair_id = existing_qa.id
                    else:
                        new_qa = QAPair(
                            category="Auto-Learned",
                            question=qr.question_text,
                            answer=qr.edited_answer_text,
                            embedding=embedding_to_bytes(embedding),
                        )
                        db.add(new_qa)
                        await db.flush()
                        correction.kb_pair_id = new_qa.id

                    correction.auto_added_to_kb = True
                    await log_audit(
                        db,
                        action_type="correction_auto_kb",
                        entity_type="answer_correction",
                        job_id=job_id,
                        details={"question": qr.question_text[:100]},
                    )

            db.add(correction)
            corrections_captured += 1
        elif qr.edited_answer_text:
            total_edited += 1

        rebuilt_items.append(ExtractedItem(
            question_text=qr.question_text,
            item_type=qr.item_type or "paragraph",
            location=qr.location_info or {},
            formatting=_deserialize_run_format(qr.formatting_info),
            answer_text=final_answer,
        ))

    source_path = settings.upload_dir / job.stored_filename
    suffix = source_path.suffix.lower()
    output_name, _ = _output_file_spec(job.original_filename, suffix)
    output_path = settings.output_dir / output_name

    if suffix == ".docx":
        generate_filled_docx(source_path, output_path, rebuilt_items)
    elif suffix == ".pdf":
        generate_docx_from_pdf_items(output_path, rebuilt_items)
    elif suffix == ".csv":
        generate_filled_csv(source_path, output_path, rebuilt_items)

    job.output_filename = output_name
    job.review_status = "finalized"
    await log_audit(
        db,
        action_type="job_finalize",
        entity_type="processing_job",
        entity_id=job_id,
        job_id=job_id,
        details={
            "total_edited": total_edited,
            "corrections_captured": corrections_captured,
            "output_filename": output_name,
        },
    )
    await db.commit()

    return FinalizeJobResponse(
        job_id=job.id,
        review_status="finalized",
        output_filename=output_name,
        total_edited=total_edited,
        corrections_captured=corrections_captured,
    )
