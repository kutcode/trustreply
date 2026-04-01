"""Tests for heuristic parser helper functions: confidence, fallback, and table mapping."""

import pytest

from app.services.parsers.heuristic import (
    _score_parse_confidence,
    _fallback_decision,
    _normalize_text,
    _matches_any_pattern,
    _infer_table_mapping,
    QUESTION_HEADER_PATTERNS,
    ANSWER_HEADER_PATTERNS,
)
from app.services.parsers.types import ExtractedItem, ParseOptions


# ── _score_parse_confidence ──────────────────────────────────────────


class TestScoreParseConfidence:
    def _item(self, item_type="table_cell"):
        return ExtractedItem(question_text="Q?", item_type=item_type)

    def test_no_items_returns_zero(self):
        assert _score_parse_confidence({}, []) == 0.0

    def test_table_only_returns_0_9(self):
        stats = {"table_items": 5}
        items = [self._item("table_cell")]
        assert _score_parse_confidence(stats, items) == 0.9

    def test_paragraph_only_returns_0_75(self):
        stats = {"paragraph_items": 3}
        items = [self._item("paragraph")]
        assert _score_parse_confidence(stats, items) == 0.75

    def test_mixed_table_and_paragraph_returns_0_95(self):
        stats = {"table_items": 2, "paragraph_items": 1}
        items = [self._item()]
        assert _score_parse_confidence(stats, items) == 0.95

    def test_pdf_table_items_count(self):
        stats = {"pdf_table_items": 4}
        items = [self._item()]
        assert _score_parse_confidence(stats, items) == 0.9

    def test_csv_items_count(self):
        stats = {"csv_items": 3}
        items = [self._item()]
        assert _score_parse_confidence(stats, items) == 0.9

    def test_pdf_text_items_count_as_paragraph(self):
        stats = {"pdf_text_items": 2}
        items = [self._item()]
        assert _score_parse_confidence(stats, items) == 0.75

    def test_no_recognized_source_returns_0_5(self):
        stats = {"unknown_source": 1}
        items = [self._item()]
        assert _score_parse_confidence(stats, items) == 0.5


# ── _fallback_decision ───────────────────────────────────────────────


class TestFallbackDecision:
    def test_no_items_recommends_fallback(self):
        stats = {"items_total": 0}
        recommended, reason = _fallback_decision(stats, 0.0)
        assert recommended is True
        assert reason == "no_questions_found"

    def test_low_confidence_recommends_fallback(self):
        stats = {"items_total": 5}
        recommended, reason = _fallback_decision(stats, 0.75)
        assert recommended is True
        assert reason == "low_confidence_parse"

    def test_high_confidence_no_fallback(self):
        stats = {"items_total": 5, "table_items": 5}
        recommended, reason = _fallback_decision(stats, 0.9)
        assert recommended is False
        assert reason is None

    def test_table_layout_not_understood(self):
        stats = {"items_total": 3, "table_rows_scanned": 10, "table_items": 0}
        recommended, reason = _fallback_decision(stats, 0.85)
        assert recommended is True
        assert reason == "table_layout_not_understood"

    def test_few_table_rows_no_layout_fallback(self):
        """With < 3 table rows scanned and 0 table items, no layout fallback."""
        stats = {"items_total": 3, "table_rows_scanned": 2, "table_items": 0}
        recommended, reason = _fallback_decision(stats, 0.85)
        assert recommended is False

    def test_pdf_table_rows_count(self):
        stats = {"items_total": 2, "pdf_table_rows_scanned": 5, "pdf_table_items": 0}
        recommended, reason = _fallback_decision(stats, 0.9)
        assert recommended is True
        assert reason == "table_layout_not_understood"


# ── _normalize_text ──────────────────────────────────────────────────


class TestNormalizeText:
    def test_lowercases(self):
        assert _normalize_text("Hello World") == "hello world"

    def test_collapses_whitespace(self):
        assert _normalize_text("  hello   world  ") == "hello world"

    def test_empty_string(self):
        assert _normalize_text("") == ""


# ── _matches_any_pattern ─────────────────────────────────────────────


class TestMatchesAnyPattern:
    def test_matches_question_header(self):
        assert _matches_any_pattern("Question", QUESTION_HEADER_PATTERNS) is True

    def test_matches_questions_plural(self):
        assert _matches_any_pattern("Questions", QUESTION_HEADER_PATTERNS) is True

    def test_matches_answer_header(self):
        assert _matches_any_pattern("Answer", ANSWER_HEADER_PATTERNS) is True

    def test_matches_response_header(self):
        assert _matches_any_pattern("Response", ANSWER_HEADER_PATTERNS) is True

    def test_no_match(self):
        assert _matches_any_pattern("Foobar", QUESTION_HEADER_PATTERNS) is False

    def test_case_insensitive(self):
        assert _matches_any_pattern("QUESTION", QUESTION_HEADER_PATTERNS) is True

    def test_partial_match(self):
        """Pattern should match within the text."""
        assert _matches_any_pattern("Vendor Questions List", QUESTION_HEADER_PATTERNS) is True


# ── _infer_table_mapping ─────────────────────────────────────────────


class TestInferTableMapping:
    def test_auto_detect_disabled_returns_defaults(self):
        rows = [["Question", "Answer"], ["What?", ""]]
        opts = ParseOptions(auto_detect_columns=False)
        q, a, h = _infer_table_mapping(rows, opts)
        assert q == 0
        assert a == 1
        assert h == 0

    def test_empty_rows_returns_defaults(self):
        opts = ParseOptions()
        q, a, h = _infer_table_mapping([], opts)
        assert q == 0
        assert a == 1

    def test_detects_question_answer_headers(self):
        rows = [
            ["Question", "Answer"],
            ["What is your name?", ""],
        ]
        opts = ParseOptions()
        q, a, h = _infer_table_mapping(rows, opts)
        assert q == 0
        assert a == 1
        assert h >= 1  # header row detected

    def test_detects_reversed_columns(self):
        rows = [
            ["Response", "Requirement"],
            ["", "Describe your process"],
        ]
        opts = ParseOptions()
        q, a, h = _infer_table_mapping(rows, opts)
        # "Requirement" matches question pattern, "Response" matches answer
        assert q == 1
        assert a == 0

    def test_three_column_with_headers(self):
        rows = [
            ["#", "Question", "Answer"],
            ["1", "What is your policy?", ""],
        ]
        opts = ParseOptions()
        q, a, h = _infer_table_mapping(rows, opts)
        assert q == 1
        assert a == 2
        assert h >= 1

    def test_two_column_no_headers_uses_defaults(self):
        rows = [
            ["What is your name?", ""],
            ["Describe your process", ""],
        ]
        opts = ParseOptions()
        q, a, h = _infer_table_mapping(rows, opts)
        # No header detected, 2-col table -> returns defaults
        assert q == 0
        assert a == 1

    def test_wide_table_infers_from_content(self):
        """For 3+ column tables without headers, infer from question-like content."""
        rows = [
            ["1", "What is your company name?", "", "Notes"],
            ["2", "Describe your security policy", "", "Notes"],
        ]
        opts = ParseOptions()
        q, a, h = _infer_table_mapping(rows, opts)
        assert q == 1  # col with question-like text
        assert a == 2  # adjacent empty col
