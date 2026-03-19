"""Shared parser datatypes."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class RunFormat:
    """Captures run-level formatting so we can replicate it when writing answers."""

    font_name: str | None = None
    font_size: Any | None = None  # docx Pt object
    bold: bool | None = None
    italic: bool | None = None
    underline: bool | None = None
    color_rgb: Any | None = None  # RGBColor or None


@dataclass
class ExtractedItem:
    """A single question/field extracted from a document."""

    question_text: str
    item_type: str  # "table_cell" | "paragraph" | "pdf_text" | "pdf_table" | "csv_row"
    location: dict = field(default_factory=dict)
    formatting: RunFormat | None = None
    answer_text: str | None = None  # populated after matching
    source_block_id: str | None = None
    confidence: float | None = None
    matched_qa_id: int | None = None
    matched_source: str | None = None  # kb_match | resolved_flagged | agent
    parser_strategy: str | None = None
    raw_text: str | None = None


@dataclass
class ParseOptions:
    """Configures how the heuristic parser interprets document structure."""

    question_column_index: int = 0
    answer_column_index: int = 1
    header_rows: int = 0
    min_question_length: int = 10
    allow_additional_columns: bool = True
    auto_detect_columns: bool = True
    scan_paragraphs: bool = True
    detect_row_blocks: bool = True
    profile_name: str = "default"


@dataclass
class ParseResult:
    """Structured parser output with diagnostics for future fallback logic."""

    items: list[ExtractedItem]
    confidence: float
    stats: dict[str, Any] = field(default_factory=dict)
    profile_name: str = "default"
    parser_strategy: str = "heuristic"
    fallback_recommended: bool = False
    fallback_reason: str | None = None
