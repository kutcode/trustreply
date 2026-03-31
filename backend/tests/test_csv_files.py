"""Tests for app.utils.csv_files – CSV format detection and I/O."""

import pytest
from pathlib import Path
from app.utils.csv_files import CsvFormat, detect_csv_format, read_csv_rows, write_csv_rows


class TestDetectCsvFormat:
    """Tests for detect_csv_format()."""

    def test_comma_delimited(self):
        text = "Question,Answer\nWhat is X?,Yes\n"
        fmt = detect_csv_format(text)
        assert fmt.delimiter == ","

    def test_semicolon_delimited(self):
        text = "Question;Answer\nWhat is X?;Yes\n"
        fmt = detect_csv_format(text)
        assert fmt.delimiter == ";"

    def test_tab_delimited(self):
        text = "Question\tAnswer\nWhat is X?\tYes\n"
        fmt = detect_csv_format(text)
        assert fmt.delimiter == "\t"

    def test_empty_string_returns_defaults(self):
        fmt = detect_csv_format("")
        assert fmt.delimiter == ","
        assert fmt.quotechar == '"'

    def test_whitespace_only_returns_defaults(self):
        fmt = detect_csv_format("   \n  \n")
        assert fmt.delimiter == ","

    def test_quoted_fields(self):
        text = '"Question","Answer"\n"What, is X?","Yes, it is"\n'
        fmt = detect_csv_format(text)
        assert fmt.delimiter == ","
        assert fmt.quotechar == '"'

    def test_unparseable_returns_defaults(self):
        text = "just a plain line with no delimiters"
        fmt = detect_csv_format(text)
        # Should return defaults without raising
        assert fmt.delimiter == ","


class TestReadWriteCsvRoundTrip:
    """Tests for read_csv_rows() and write_csv_rows()."""

    def test_roundtrip_comma(self, tmp_path: Path):
        original_rows = [
            ["Question", "Answer"],
            ["What is X?", "It is Y"],
            ["Describe Z", "Z is a thing"],
        ]
        path = tmp_path / "test.csv"
        fmt = CsvFormat(delimiter=",")
        write_csv_rows(path, original_rows, fmt)

        rows, detected_fmt = read_csv_rows(path)
        assert detected_fmt.delimiter == ","
        assert rows == original_rows

    def test_roundtrip_semicolon(self, tmp_path: Path):
        original_rows = [
            ["Question", "Answer"],
            ["What is X?", "It is Y"],
        ]
        path = tmp_path / "test.csv"
        fmt = CsvFormat(delimiter=";")
        write_csv_rows(path, original_rows, fmt)

        rows, detected_fmt = read_csv_rows(path)
        assert detected_fmt.delimiter == ";"
        assert rows == original_rows

    def test_roundtrip_tab(self, tmp_path: Path):
        original_rows = [
            ["Question", "Answer"],
            ["What is X?", "It is Y"],
        ]
        path = tmp_path / "test.csv"
        fmt = CsvFormat(delimiter="\t")
        write_csv_rows(path, original_rows, fmt)

        rows, detected_fmt = read_csv_rows(path)
        assert detected_fmt.delimiter == "\t"
        assert rows == original_rows

    def test_handles_bom(self, tmp_path: Path):
        """read_csv_rows uses utf-8-sig encoding, so BOM should be stripped."""
        path = tmp_path / "bom.csv"
        path.write_bytes(b"\xef\xbb\xbfQuestion,Answer\nWhat?,Yes\n")

        rows, fmt = read_csv_rows(path)
        assert rows[0][0] == "Question"  # no BOM character

    def test_strips_cell_whitespace(self, tmp_path: Path):
        """read_csv_rows strips whitespace from each cell."""
        path = tmp_path / "spaces.csv"
        path.write_text("  Question  , Answer \n  What? , Yes \n", encoding="utf-8")

        rows, _ = read_csv_rows(path)
        assert rows[0] == ["Question", "Answer"]
        assert rows[1] == ["What?", "Yes"]

    def test_special_characters(self, tmp_path: Path):
        """Fields with commas and quotes survive the round-trip."""
        original_rows = [
            ["Question", "Answer"],
            ["What is \"X\"?", "It's a, thing"],
        ]
        path = tmp_path / "special.csv"
        fmt = CsvFormat(delimiter=",")
        write_csv_rows(path, original_rows, fmt)

        rows, _ = read_csv_rows(path)
        assert rows[1][0] == 'What is "X"?'
        assert rows[1][1] == "It's a, thing"

    def test_write_returns_path(self, tmp_path: Path):
        path = tmp_path / "out.csv"
        result = write_csv_rows(path, [["a", "b"]], CsvFormat())
        assert result == path
        assert path.exists()
