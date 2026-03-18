"""Pydantic schemas for request/response validation."""

from __future__ import annotations
import datetime
from pydantic import BaseModel, Field


# ── Q&A Pair ──────────────────────────────────────────────────────────

class QAPairCreate(BaseModel):
    category: str = Field(..., min_length=1)
    question: str = Field(..., min_length=1)
    answer: str = Field(..., min_length=1)


class QAPairUpdate(BaseModel):
    category: str | None = None
    question: str | None = None
    answer: str | None = None


class QAPairResponse(BaseModel):
    id: int
    category: str | None
    question: str
    answer: str
    created_at: datetime.datetime
    updated_at: datetime.datetime

    class Config:
        from_attributes = True


class QAPairListResponse(BaseModel):
    items: list[QAPairResponse]
    total: int
    page: int
    page_size: int


# ── Processing Job ───────────────────────────────────────────────────

class JobResponse(BaseModel):
    id: int
    batch_id: str | None
    original_filename: str
    status: str
    error_message: str | None
    total_questions: int
    matched_questions: int
    flagged_questions_count: int
    parser_strategy: str | None
    parser_profile_name: str | None
    parse_confidence: float | None
    parse_stats: dict | None
    fallback_recommended: bool
    fallback_reason: str | None
    agent_mode: str | None
    agent_status: str | None
    agent_summary: str | None
    agent_trace: list[dict] | None
    agent_error: str | None
    agent_model: str | None
    uploaded_at: datetime.datetime
    completed_at: datetime.datetime | None

    class Config:
        from_attributes = True


class JobListResponse(BaseModel):
    items: list[JobResponse]
    total: int


class JobBatchResponse(BaseModel):
    batch_id: str
    items: list[JobResponse]
    total: int


# ── Flagged Question ────────────────────────────────────────────────

class FlaggedQuestionResponse(BaseModel):
    id: int
    extracted_question: str
    normalized_question: str
    context: str | None
    similarity_score: float | None
    best_match_question: str | None
    resolved: bool
    resolved_answer: str | None
    resolved_at: datetime.datetime | None
    created_at: datetime.datetime
    occurrence_count: int = 1
    job_ids: list[int] = Field(default_factory=list)
    filenames: list[str] = Field(default_factory=list)

class FlaggedQuestionResolve(BaseModel):
    answer: str = Field(..., min_length=1)
    add_to_knowledge_base: bool = True
    category: str | None = None


class FlaggedBulkDismissRequest(BaseModel):
    ids: list[int] = Field(..., min_length=1, max_length=1000)


class FlaggedBulkDismissResponse(BaseModel):
    requested_ids: int
    dismissed_groups: int
    dismissed_occurrences: int
    already_resolved_groups: int
    not_found_ids: list[int] = Field(default_factory=list)


class FlaggedQuestionListResponse(BaseModel):
    items: list[FlaggedQuestionResponse]
    total: int


class FlaggedSyncResponse(BaseModel):
    scanned_occurrences: int
    synced_occurrences: int
    synced_groups: int
    remaining_unresolved: int


# ── Settings ─────────────────────────────────────────────────────────

class AppSettingsResponse(BaseModel):
    similarity_threshold: float
    embedding_model: str
    default_parser_profile: str
    max_bulk_files: int
    parser_profiles: list[dict]
    agent_enabled: bool
    agent_provider: str
    agent_api_base: str
    agent_available: bool
    agent_model: str
    agent_default_mode: str
    agent_modes: list[dict]


class AppSettingsUpdate(BaseModel):
    agent_enabled: bool | None = None
    agent_provider: str | None = None
    agent_api_base: str | None = None
    agent_api_key: str | None = None
    agent_model: str | None = None
    agent_timeout_seconds: int | None = Field(None, ge=1, le=300)
    agent_default_mode: str | None = None
    agent_max_questions_per_call: int | None = Field(None, ge=1, le=100)
    similarity_threshold: float | None = Field(None, ge=0.0, le=1.0)
    default_parser_profile: str | None = None


class AgentModelsRequest(BaseModel):
    provider: str | None = None
    api_base: str | None = None
    api_key: str | None = None


class AgentModelOption(BaseModel):
    id: str
    label: str


class AgentModelsResponse(BaseModel):
    provider: str
    models: list[AgentModelOption]


class TestConnectionResponse(BaseModel):
    ok: bool
    provider: str
    message: str


# ── Troubleshooting ────────────────────────────────────────────────

class TroubleshootProfileResult(BaseModel):
    profile_name: str
    profile_label: str
    question_count: int
    confidence: float
    fallback_recommended: bool
    fallback_reason: str | None
    stats: dict
    sample_questions: list[str]
    error_message: str | None = None


class TroubleshootResponse(BaseModel):
    filename: str
    file_type: str
    recommended_profile: str | None
    recommended_profile_label: str | None
    recommendation_reason: str
    hints: list[str]
    profiles: list[TroubleshootProfileResult]
    agent_analysis: dict | None = None
