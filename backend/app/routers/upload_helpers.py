"""Pure helpers for the upload router.

Extracted so the upload router itself can focus on request handling and
orchestration. Each function here is deterministic and has no database
access or async behavior.
"""

from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile

from app.config import settings
from app.services.parser import RunFormat

ALLOWED_EXTENSIONS = {".docx", ".pdf", ".csv", ".xlsx", ".xls"}


# --- RunFormat serialization -----------------------------------------------


def serialize_run_format(fmt: RunFormat | None) -> dict | None:
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


def deserialize_run_format(data: dict | None) -> RunFormat | None:
    """Reconstruct a RunFormat from its serialized JSON form."""
    if not data:
        return None
    fmt = RunFormat()
    fmt.font_name = data.get("font_name")
    fmt.bold = data.get("bold")
    fmt.italic = data.get("italic")
    fmt.underline = data.get("underline")
    # font_size and color_rgb are stored as strings; generator tolerates None.
    return fmt


# --- Form input normalization ----------------------------------------------


def clean_optional_form_value(value: str | None) -> str | None:
    """Trim an optional form value and collapse blank strings to None."""
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


# --- File naming & media types ---------------------------------------------


def output_file_spec(original_filename: str, source_suffix: str) -> tuple[str, str]:
    """Return the downloadable filename and media type for a processed job."""
    stem = Path(original_filename).stem
    token = uuid.uuid4().hex[:8]

    if source_suffix == ".pdf":
        return (
            f"filled_{token}_{stem}.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
    if source_suffix == ".csv":
        return (f"filled_{token}_{stem}.csv", "text/csv")
    if source_suffix in (".xlsx", ".xls"):
        return (
            f"filled_{token}_{stem}.xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    return (
        f"filled_{token}_{stem}.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


def media_type_for_path(path: Path) -> str:
    """Map an output path's suffix to its download media type."""
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return "text/csv"
    if suffix == ".docx":
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    if suffix == ".xlsx":
        return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    return "application/octet-stream"


# --- Upload validation -----------------------------------------------------


def validate_upload_file(file: UploadFile) -> str:
    """Validate a user-supplied upload and return its normalized suffix."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    suffix = Path(file.filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported file type '{suffix}' for '{file.filename}'. "
                f"Supported: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
            ),
        )
    return suffix


# --- Troubleshoot ranking --------------------------------------------------


def troubleshoot_sort_key(profile_result: dict) -> tuple[bool, bool, int, float, bool]:
    """Rank parser profiles by practical usefulness for a given document.

    Order: profiles that extracted any questions > profiles not flagged
    for fallback > question count > parser confidence > default-profile
    tiebreaker.
    """
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


def build_troubleshoot_summary(
    file_type: str,
    profiles: list[dict],
) -> tuple[str | None, str | None, str, list[str]]:
    """Choose the best parser profile for a document and explain why.

    Returns ``(profile_name, profile_label, reason, hints)`` where the
    first two elements are ``None`` when no profile is usable.
    """
    successful_profiles = [p for p in profiles if not p.get("error_message")]
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

    best_profile = max(successful_profiles, key=troubleshoot_sort_key)
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
        (p for p in profiles if p.get("profile_name") == settings.default_parser_profile),
        None,
    )

    if default_profile and default_profile["profile_name"] != recommended_profile:
        default_count = int(default_profile.get("question_count", 0))
        if default_count == 0:
            reason = f"The default parser found no questions, but {recommended_label} found {recommended_count}."
        else:
            reason = (
                f"{recommended_label} found {recommended_count} questions, "
                f"which is more complete than the default parser's {default_count}."
            )
    else:
        reason = f"{recommended_label} is the best fit for this document and found {recommended_count} questions."

    hints: list[str] = []
    if recommended_profile != settings.default_parser_profile:
        hints.append(f"Retry the upload with the '{recommended_profile}' parser profile.")
    else:
        hints.append("The default parser looks suitable for this document.")
    if bool(best_profile.get("fallback_recommended")):
        hints.append("The parse is still marked as weak; review the extracted question preview before relying on the result.")

    return recommended_profile, recommended_label, reason, hints
