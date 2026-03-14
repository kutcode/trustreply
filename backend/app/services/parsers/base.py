"""Shared parser interface."""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

from app.services.parsers.types import ParseOptions, ParseResult


class BaseParser(ABC):
    """Abstract interface for document parsers."""

    strategy_name = "base"

    @abstractmethod
    def parse(self, file_path: Path, options: ParseOptions | None = None) -> ParseResult:
        """Parse a file and return extracted items with parser diagnostics."""
