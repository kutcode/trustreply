"""Tests for app.utils.questions – question normalization helpers."""

import pytest
from app.utils.questions import clean_display_question, normalize_question_key


class TestCleanDisplayQuestion:
    """Tests for clean_display_question()."""

    def test_removes_numeric_prefix_with_dot(self):
        assert clean_display_question("1. What is your name?") == "What is your name?"

    def test_removes_numeric_prefix_with_paren(self):
        assert clean_display_question("2) What is your policy?") == "What is your policy?"

    def test_removes_numeric_prefix_with_colon(self):
        assert clean_display_question("3: Describe your process") == "Describe your process"

    def test_removes_letter_prefix_with_dot(self):
        assert clean_display_question("a. Describe your security") == "Describe your security"

    def test_removes_letter_prefix_with_paren(self):
        assert clean_display_question("b) What frameworks do you use?") == "What frameworks do you use?"

    def test_removes_uppercase_letter_prefix(self):
        assert clean_display_question("A. List your certifications") == "List your certifications"

    def test_removes_parenthesized_number(self):
        assert clean_display_question("(1) Do you encrypt data at rest?") == "Do you encrypt data at rest?"

    def test_no_prefix_unchanged(self):
        assert clean_display_question("What is your name?") == "What is your name?"

    def test_collapses_extra_whitespace(self):
        assert clean_display_question("1.  What   is   your   name?") == "What is your name?"

    def test_strips_leading_trailing_whitespace(self):
        assert clean_display_question("  1. Question text  ") == "Question text"

    def test_empty_string(self):
        assert clean_display_question("") == ""

    def test_none_input(self):
        assert clean_display_question(None) == ""

    def test_only_whitespace(self):
        assert clean_display_question("   ") == ""

    def test_preserves_internal_numbering(self):
        """Should not strip numbers that are part of the question body."""
        result = clean_display_question("Do you comply with ISO 27001?")
        assert "27001" in result


class TestNormalizeQuestionKey:
    """Tests for normalize_question_key()."""

    def test_case_folds(self):
        assert normalize_question_key("What Is Your Name?") == "what is your name?"

    def test_strips_numbering(self):
        assert normalize_question_key("1. What is your policy?") == "what is your policy?"

    def test_strips_trailing_colon(self):
        assert normalize_question_key("Company name:") == "company name"

    def test_collapses_whitespace(self):
        assert normalize_question_key("What   is   your   name?") == "what is your name?"

    def test_same_question_different_numbering_matches(self):
        key1 = normalize_question_key("1. Describe your process")
        key2 = normalize_question_key("a) Describe your process")
        assert key1 == key2

    def test_same_question_different_case_matches(self):
        key1 = normalize_question_key("What is your name?")
        key2 = normalize_question_key("WHAT IS YOUR NAME?")
        assert key1 == key2

    def test_empty_string(self):
        assert normalize_question_key("") == ""

    def test_none_input(self):
        assert normalize_question_key(None) == ""
