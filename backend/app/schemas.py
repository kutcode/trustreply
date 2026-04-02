"""Pydantic schemas for request/response validation."""

from __future__ import annotations
import datetime
from pydantic import BaseModel, ConfigDict, Field


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
    agent_input_tokens: int | None = None
    agent_output_tokens: int | None = None
    agent_llm_calls: int | None = None
    agent_kb_routed: int | None = None
    review_status: str | None = None
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


# ── Question Results (Review Queue) ──────────────────────────────────

class QuestionResultResponse(BaseModel):
    id: int
    job_id: int
    question_index: int
    question_text: str
    answer_text: str | None
    edited_answer_text: str | None
    confidence_score: float | None
    source: str | None
    kb_pair_id: int | None
    location_info: dict | None
    item_type: str | None
    reviewed: bool
    agent_reason: str | None = None
    agent_issues: list[str] | None = None
    created_at: datetime.datetime

    class Config:
        from_attributes = True


class QuestionResultListResponse(BaseModel):
    items: list[QuestionResultResponse]
    total: int
    reviewed_count: int
    unreviewed_count: int


class QuestionResultUpdate(BaseModel):
    answer_text: str = Field(..., min_length=1)


class FinalizeJobResponse(BaseModel):
    job_id: int
    review_status: str
    output_filename: str
    total_edited: int
    corrections_captured: int = 0


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
    parser_hint_overrides: dict | None = None
    agent_openai_api_key: str | None = None
    agent_openai_model: str | None = None
    agent_anthropic_api_key: str | None = None
    agent_anthropic_model: str | None = None


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


# ── Audit Trail ────────────────────────────────────────────────────

class AuditLogResponse(BaseModel):
    id: int
    timestamp: datetime.datetime
    action_type: str
    entity_type: str
    entity_id: int | None
    job_id: int | None
    actor: str
    details: dict | None
    before_value: str | None
    after_value: str | None

    class Config:
        from_attributes = True


class AuditLogListResponse(BaseModel):
    items: list[AuditLogResponse]
    total: int


# ── Agent Presets ─────────────────────────────────────────────────

class AgentPresetCreate(BaseModel):
    name: str
    instructions: str


class AgentPresetResponse(BaseModel):
    id: int
    name: str
    instructions: str
    is_builtin: bool
    created_at: datetime.datetime
    model_config = ConfigDict(from_attributes=True)


class AgentPresetListResponse(BaseModel):
    items: list[AgentPresetResponse]
    total: int


# ── Template Answers ──────────────────────────────────────────────

class TemplateAnswerUpdate(BaseModel):
    answer_text: str


# ── KB Deduplication ──────────────────────────────────────────────

class DuplicateCluster(BaseModel):
    """A group of KB entries that are semantically near-duplicate."""
    canonical_id: int  # The entry we recommend keeping (highest ID = most recently updated)
    entries: list[QAPairResponse]
    similarity: float  # Average pairwise similarity within the cluster


class DuplicateDetectionResponse(BaseModel):
    clusters: list[DuplicateCluster]
    total_duplicates: int  # Total entries that are part of a cluster
    total_entries_scanned: int


class MergeRequest(BaseModel):
    keep_id: int  # The entry to keep
    delete_ids: list[int] = Field(..., min_length=1)  # Entries to soft-delete


class MergeResponse(BaseModel):
    kept_id: int
    deleted_count: int


class BulkMergeRequest(BaseModel):
    """Merge multiple clusters at once. Each item specifies which entry to keep and which to delete."""
    merges: list[MergeRequest] = Field(..., min_length=1, max_length=100)


class BulkMergeResponse(BaseModel):
    merged_clusters: int
    total_deleted: int


# ── KB Duplicate Review (LLM-classified) ─────────────────────────

class DuplicateClassifyRequest(BaseModel):
    threshold: float = Field(0.85, ge=0.0, le=1.0)
    category: str | None = None


class ClassifiedPair(BaseModel):
    review_id: int
    entry_a: QAPairResponse
    entry_b: QAPairResponse
    similarity: float
    classification: str
    reason: str
    recommended_keep_id: int | None


class DuplicateClassifyResponse(BaseModel):
    pairs: list[ClassifiedPair]
    total_classified: int
    llm_model: str


class DuplicateReviewItem(BaseModel):
    id: int
    entry_a: QAPairResponse
    entry_b: QAPairResponse
    similarity_score: float
    classification: str | None = None
    reason: str | None = None
    recommended_keep_id: int | None = None
    status: str
    source: str
    created_at: datetime.datetime

    class Config:
        from_attributes = True


class DuplicateReviewListResponse(BaseModel):
    items: list[DuplicateReviewItem]
    total: int
    pending_count: int
    reviewed_count: int


class DuplicateReviewAction(BaseModel):
    action: str = Field(..., pattern="^(keep_left|keep_right|keep_both|merge)$")


class DuplicateReviewActionResponse(BaseModel):
    id: int
    status: str
    action: str
    kept_id: int | None = None
    deleted_id: int | None = None


class BulkDuplicateReviewAction(BaseModel):
    review_id: int
    action: str = Field(..., pattern="^(keep_left|keep_right|keep_both|merge)$")


class BulkDuplicateReviewRequest(BaseModel):
    actions: list[BulkDuplicateReviewAction] = Field(..., min_length=1, max_length=200)


class BulkDuplicateReviewResponse(BaseModel):
    processed: int
    errors: list[str] = Field(default_factory=list)
