"""Unit tests for upload router helper functions."""

import pytest
from pathlib import Path

from app.routers.upload import (
    _output_file_spec,
    _media_type_for_path,
    _clean_optional_form_value,
    _serialize_run_format,
    _deserialize_run_format,
)
from app.services.parser import RunFormat


class TestOutputFileSpec:
    def test_docx_input(self):
        name, media = _output_file_spec("questionnaire.docx", ".docx")
        assert name.startswith("filled_")
        assert name.endswith("_questionnaire.docx")
        assert "wordprocessingml" in media

    def test_csv_input(self):
        name, media = _output_file_spec("data.csv", ".csv")
        assert name.startswith("filled_")
        assert name.endswith("_data.csv")
        assert media == "text/csv"

    def test_pdf_input_produces_docx(self):
        name, media = _output_file_spec("form.pdf", ".pdf")
        assert name.endswith("_form.docx")
        assert "wordprocessingml" in media

    def test_unique_filenames(self):
        name1, _ = _output_file_spec("test.docx", ".docx")
        name2, _ = _output_file_spec("test.docx", ".docx")
        assert name1 != name2  # UUID prefix should differ


class TestMediaTypeForPath:
    def test_docx(self):
        assert "wordprocessingml" in _media_type_for_path(Path("out.docx"))

    def test_csv(self):
        assert _media_type_for_path(Path("out.csv")) == "text/csv"

    def test_unknown_extension(self):
        assert _media_type_for_path(Path("out.xyz")) == "application/octet-stream"

    def test_uppercase_extension(self):
        assert _media_type_for_path(Path("out.DOCX")) != "application/octet-stream"


class TestCleanOptionalFormValue:
    def test_normal_string(self):
        assert _clean_optional_form_value("hello") == "hello"

    def test_none(self):
        assert _clean_optional_form_value(None) is None

    def test_empty_string(self):
        assert _clean_optional_form_value("") is None

    def test_whitespace_only(self):
        assert _clean_optional_form_value("   ") is None

    def test_strips_whitespace(self):
        assert _clean_optional_form_value("  hello  ") == "hello"


class TestSerializeDeserializeRunFormat:
    def test_none_roundtrip(self):
        assert _serialize_run_format(None) is None
        assert _deserialize_run_format(None) is None

    def test_roundtrip_preserves_fields(self):
        fmt = RunFormat()
        fmt.bold = True
        fmt.italic = False
        fmt.font_name = "Arial"
        serialized = _serialize_run_format(fmt)
        assert serialized is not None
        assert serialized["bold"] is True
        assert serialized["font_name"] == "Arial"

        deserialized = _deserialize_run_format(serialized)
        assert deserialized is not None
        assert deserialized.bold is True
        assert deserialized.font_name == "Arial"

    def test_empty_format_serializes_to_none(self):
        fmt = RunFormat()
        # All fields are None/falsy, so serialized result is None
        assert _serialize_run_format(fmt) is None

    def test_deserialize_empty_dict(self):
        assert _deserialize_run_format({}) is None
