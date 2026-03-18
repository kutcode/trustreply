"""Public parser facade.

This module keeps the original import surface stable while the parser
implementation moves behind strategy classes.
"""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path

from app.services.parsers.heuristic import DEFAULT_MIN_QUESTION_LENGTH, HeuristicParser, _is_question
from app.services.parsers.types import ExtractedItem, ParseOptions, ParseResult, RunFormat

MIN_QUESTION_LENGTH = DEFAULT_MIN_QUESTION_LENGTH

PARSER_PROFILES: dict[str, dict[str, object]] = {
    "default": {
        "label": "Default",
        "description": "Balanced parser for common questionnaire tables and paragraph prompts, with light column auto-detection.",
        "options": ParseOptions(profile_name="default"),
    },
    "strict_two_column": {
        "label": "Strict Two Column",
        "description": "Use only two-column table rows and ignore wider table layouts.",
        "options": ParseOptions(
            allow_additional_columns=False,
            auto_detect_columns=False,
            detect_row_blocks=False,
            profile_name="strict_two_column",
        ),
    },
    "three_column_table": {
        "label": "Three Column Table",
        "description": "Treat column 2 as the question and column 3 as the answer, with one header row.",
        "options": ParseOptions(
            question_column_index=1,
            answer_column_index=2,
            header_rows=1,
            auto_detect_columns=False,
            profile_name="three_column_table",
        ),
    },
    "row_block_questionnaire": {
        "label": "Row Block",
        "description": "Prefer merged question rows with answers in the following blank row.",
        "options": ParseOptions(
            detect_row_blocks=True,
            profile_name="row_block_questionnaire",
        ),
    },
}


def get_parser_profile_names() -> list[str]:
    """Return the supported parser profile identifiers."""

    return list(PARSER_PROFILES.keys())


def get_parser_profiles() -> list[dict[str, str]]:
    """Return user-facing parser profile metadata."""

    profiles = []
    for name, data in PARSER_PROFILES.items():
        profiles.append(
            {
                "name": name,
                "label": str(data["label"]),
                "description": str(data["description"]),
            }
        )
    return profiles


def get_parse_options(profile_name: str | None = None) -> ParseOptions:
    """Resolve parser profile settings to concrete parse options."""

    profile_name = profile_name or "default"
    profile = PARSER_PROFILES.get(profile_name)
    if profile is None:
        raise ValueError(f"Unknown parser profile: {profile_name}")

    options = deepcopy(profile["options"])
    options.profile_name = profile_name
    return options


def parse_docx_result(file_path: Path, options: ParseOptions | None = None) -> ParseResult:
    """Parse a DOCX file and return extracted items with parser diagnostics."""

    return HeuristicParser().parse_docx(file_path, options)


def parse_pdf_result(file_path: Path, options: ParseOptions | None = None) -> ParseResult:
    """Parse a PDF file and return extracted items with parser diagnostics."""

    return HeuristicParser().parse_pdf(file_path, options)


def parse_csv_result(file_path: Path, options: ParseOptions | None = None) -> ParseResult:
    """Parse a CSV file and return extracted items with parser diagnostics."""

    return HeuristicParser().parse_csv(file_path, options)


def parse_document_result(file_path: Path, options: ParseOptions | None = None) -> ParseResult:
    """Parse any supported document and return a structured parse result."""

    return HeuristicParser().parse(file_path, options)


def parse_docx(file_path: Path, options: ParseOptions | None = None) -> list[ExtractedItem]:
    """Backward-compatible DOCX parser that returns extracted items only."""

    return parse_docx_result(file_path, options).items


def parse_pdf(file_path: Path, options: ParseOptions | None = None) -> list[ExtractedItem]:
    """Backward-compatible PDF parser that returns extracted items only."""

    return parse_pdf_result(file_path, options).items


def parse_csv(file_path: Path, options: ParseOptions | None = None) -> list[ExtractedItem]:
    """Backward-compatible CSV parser that returns extracted items only."""

    return parse_csv_result(file_path, options).items


def parse_document(file_path: Path, options: ParseOptions | None = None) -> list[ExtractedItem]:
    """Backward-compatible entry point that returns extracted items only."""

    return parse_document_result(file_path, options).items
