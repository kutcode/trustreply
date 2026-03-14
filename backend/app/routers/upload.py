"""Upload & processing job endpoints."""

from __future__ import annotations
import asyncio
import datetime
import uuid
import zipfile
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, BackgroundTasks, Form
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, async_session, init_db
from app.config import settings
from app.models import ProcessingJob, FlaggedQuestion
from app.schemas import JobBatchResponse, JobResponse, JobListResponse, TroubleshootResponse
from app.services.parser import (
    get_parse_options,
    get_parser_profile_names,
    get_parser_profiles,
    parse_document_result,
)
from app.services.matcher import match_questions
from app.services.generator import generate_filled_docx, generate_docx_from_pdf_items

router = APIRouter(prefix="/api", tags=["upload"])

ALLOWED_EXTENSIONS = {".docx", ".pdf"}


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
    db: AsyncSession,
    batch_id: str | None = None,
) -> ProcessingJob:
    """Persist an upload to disk and create its processing job."""

    stored_name = f"{uuid.uuid4().hex}{suffix}"
    dest = settings.upload_dir / stored_name

    content = await file.read()
    dest.write_bytes(content)

    job = ProcessingJob(
        batch_id=batch_id,
        original_filename=file.filename or stored_name,
        stored_filename=stored_name,
        status="pending",
        parser_profile_name=parser_profile or settings.default_parser_profile,
    )
    db.add(job)
    return job


def _build_batch_response(batch_id: str, jobs: list[ProcessingJob]) -> JobBatchResponse:
    """Serialize a grouped upload result."""

    return JobBatchResponse(batch_id=batch_id, items=jobs, total=len(jobs))


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


async def _process_document(job_id: int) -> None:
    """Background task: parse → match → generate filled document."""
    await init_db()
    async with async_session() as db:
        try:
            # Load the job
            job = await db.get(ProcessingJob, job_id)
            if not job:
                return

            job.status = "processing"
            await db.commit()

            source_path = settings.upload_dir / job.stored_filename
            suffix = source_path.suffix.lower()

            # 1. Parse the document
            parse_result = parse_document_result(
                source_path,
                options=get_parse_options(job.parser_profile_name or settings.default_parser_profile),
            )
            items = parse_result.items
            job.total_questions = len(items)
            job.parser_strategy = parse_result.parser_strategy
            job.parser_profile_name = parse_result.profile_name
            job.parse_confidence = parse_result.confidence
            job.parse_stats = parse_result.stats
            job.fallback_recommended = parse_result.fallback_recommended
            job.fallback_reason = parse_result.fallback_reason

            if not items:
                job.status = "done"
                job.matched_questions = 0
                job.flagged_questions_count = 0
                job.completed_at = datetime.datetime.utcnow()
                # Still generate an output (copy of original for docx)
                if suffix == ".docx":
                    output_name = f"filled_{job.stored_filename}"
                    import shutil
                    shutil.copy2(str(source_path), str(settings.output_dir / output_name))
                    job.output_filename = output_name
                await db.commit()
                return

            # 2. Match questions against knowledge base
            items, flagged = await match_questions(items, job_id, db)

            # 3. Save flagged questions
            for fq in flagged:
                db.add(fq)

            matched_count = sum(1 for item in items if item.answer_text is not None)
            job.matched_questions = matched_count
            job.flagged_questions_count = len(flagged)

            # 4. Generate filled document
            output_name = f"filled_{uuid.uuid4().hex[:8]}_{Path(job.original_filename).stem}.docx"
            output_path = settings.output_dir / output_name

            if suffix == ".docx":
                generate_filled_docx(source_path, output_path, items)
            elif suffix == ".pdf":
                generate_docx_from_pdf_items(output_path, items)

            job.output_filename = output_name
            job.status = "done"
            job.completed_at = datetime.datetime.utcnow()
            await db.commit()

        except Exception as e:
            job = await db.get(ProcessingJob, job_id)
            if job:
                job.status = "error"
                job.error_message = str(e)
                await db.commit()
            raise


@router.post("/upload", response_model=JobResponse)
async def upload_document(
    file: UploadFile = File(...),
    parser_profile: str | None = Form(None),
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

    job = await _create_processing_job(file, suffix, parser_profile, db)
    await db.commit()
    await db.refresh(job)

    # Start background processing
    background_tasks.add_task(_process_document, job.id)

    return job


@router.post("/upload/bulk", response_model=JobBatchResponse)
async def bulk_upload_documents(
    files: list[UploadFile] = File(...),
    parser_profile: str | None = Form(None),
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

    validated_files = [(file, _validate_upload_file(file)) for file in files]
    batch_id = uuid.uuid4().hex[:12]

    jobs: list[ProcessingJob] = []
    for file, suffix in validated_files:
        job = await _create_processing_job(file, suffix, parser_profile, db, batch_id=batch_id)
        jobs.append(job)

    await db.commit()
    for job in jobs:
        await db.refresh(job)
        background_tasks.add_task(_process_document, job.id)

    return _build_batch_response(batch_id, jobs)


@router.post("/troubleshoot", response_model=TroubleshootResponse)
async def troubleshoot_document(file: UploadFile = File(...)):
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

        return TroubleshootResponse(
            filename=file.filename,
            file_type=suffix.lstrip("."),
            recommended_profile=recommended_profile,
            recommended_profile_label=recommended_label,
            recommendation_reason=recommendation_reason,
            hints=hints,
            profiles=profiles,
        )
    finally:
        if temp_path.exists():
            temp_path.unlink()


@router.get("/jobs", response_model=JobListResponse)
async def list_jobs(
    db: AsyncSession = Depends(get_db),
):
    """List all processing jobs."""
    result = await db.execute(
        select(ProcessingJob).order_by(ProcessingJob.uploaded_at.desc())
    )
    jobs = result.scalars().all()
    total = len(jobs)
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
            download_name = f"filled_{Path(job.original_filename).name}"
            if not download_name.endswith(".docx"):
                download_name = f"{Path(download_name).stem}.docx"

            # Keep names unique in the archive if users upload duplicate filenames.
            if any(info.filename == download_name for info in archive.infolist()):
                download_name = f"{Path(download_name).stem}_{index}.docx"

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

    download_name = f"filled_{job.original_filename}"
    if not download_name.endswith(".docx"):
        download_name = Path(download_name).stem + ".docx"

    return FileResponse(
        path=str(output_path),
        filename=download_name,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
