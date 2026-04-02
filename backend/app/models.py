"""SQLAlchemy ORM models."""

import datetime
from sqlalchemy import (
    Column, Integer, String, Text, Float, LargeBinary,
    DateTime, Boolean, ForeignKey, JSON
)
from sqlalchemy.orm import relationship
from app.database import Base


def _utcnow() -> datetime.datetime:
    """Return current UTC time as a naive datetime (no tzinfo).

    PostgreSQL ``TIMESTAMP WITHOUT TIME ZONE`` columns (the project default)
    require naive datetimes.  asyncpg raises if you pass a tz-aware value
    into such a column, so we intentionally strip tzinfo here.
    """
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)


class QAPair(Base):
    """A question-answer pair in the knowledge base."""
    __tablename__ = "qa_pairs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    category = Column(String(255), nullable=True, index=True)
    question = Column(Text, nullable=False)
    answer = Column(Text, nullable=False)
    embedding = Column(LargeBinary, nullable=True)  # numpy array as bytes
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
    deleted_at = Column(DateTime, nullable=True, default=None)

    def __repr__(self):
        return f"<QAPair id={self.id} q='{self.question[:40]}...'>"


class ProcessingJob(Base):
    """Tracks the lifecycle of an uploaded document."""
    __tablename__ = "processing_jobs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    batch_id = Column(String(64), nullable=True, index=True)
    original_filename = Column(String(512), nullable=False)
    stored_filename = Column(String(512), nullable=False)  # UUID-based
    status = Column(String(50), default="pending", index=True)  # pending | processing | done | error
    error_message = Column(Text, nullable=True)
    output_filename = Column(String(512), nullable=True)
    total_questions = Column(Integer, default=0)
    matched_questions = Column(Integer, default=0)
    flagged_questions_count = Column(Integer, default=0)
    parser_strategy = Column(String(50), nullable=True)
    parser_profile_name = Column(String(100), nullable=True)
    parse_confidence = Column(Float, nullable=True)
    parse_stats = Column(JSON, nullable=True)
    fallback_recommended = Column(Boolean, default=False)
    fallback_reason = Column(String(100), nullable=True)
    agent_mode = Column(String(32), nullable=True)
    agent_status = Column(String(32), nullable=True)
    agent_summary = Column(Text, nullable=True)
    agent_trace = Column(JSON, nullable=True)
    agent_error = Column(Text, nullable=True)
    agent_model = Column(String(128), nullable=True)
    agent_input_tokens = Column(Integer, nullable=True)
    agent_output_tokens = Column(Integer, nullable=True)
    agent_llm_calls = Column(Integer, nullable=True)
    agent_kb_routed = Column(Integer, nullable=True)
    uploaded_at = Column(DateTime, default=_utcnow)
    completed_at = Column(DateTime, nullable=True)

    review_status = Column(String(32), default="pending")  # pending | in_review | finalized

    flagged_questions = relationship("FlaggedQuestion", back_populates="job", cascade="all, delete-orphan")
    question_results = relationship("QuestionResult", back_populates="job", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<ProcessingJob id={self.id} status={self.status}>"


class FlaggedQuestion(Base):
    """A question extracted from a document that couldn't be matched."""
    __tablename__ = "flagged_questions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    job_id = Column(Integer, ForeignKey("processing_jobs.id"), nullable=False)
    extracted_question = Column(Text, nullable=False)
    context = Column(Text, nullable=True)  # surrounding text for context
    location_info = Column(JSON, nullable=True)  # where in the doc this was
    similarity_score = Column(Float, nullable=True)  # best match score (below threshold)
    best_match_question = Column(Text, nullable=True)  # closest Q from DB
    resolved = Column(Boolean, default=False, index=True)
    resolved_answer = Column(Text, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow)

    job = relationship("ProcessingJob", back_populates="flagged_questions")

    def __repr__(self):
        return f"<FlaggedQuestion id={self.id} resolved={self.resolved}>"


class QuestionResult(Base):
    """Per-question result with confidence score and review status."""
    __tablename__ = "question_results"

    id = Column(Integer, primary_key=True, autoincrement=True)
    job_id = Column(Integer, ForeignKey("processing_jobs.id"), nullable=False)
    question_index = Column(Integer, nullable=False)
    question_text = Column(Text, nullable=False)
    answer_text = Column(Text, nullable=True)
    edited_answer_text = Column(Text, nullable=True)
    confidence_score = Column(Float, nullable=True)
    source = Column(String(50), nullable=True)  # kb_match | agent | resolved_flagged | unmatched
    kb_pair_id = Column(Integer, nullable=True)
    location_info = Column(JSON, nullable=True)
    formatting_info = Column(JSON, nullable=True)
    item_type = Column(String(50), nullable=True)
    reviewed = Column(Boolean, default=False, index=True)
    agent_reason = Column(Text, nullable=True)       # reasoning from agent fill decision
    agent_issues = Column(JSON, nullable=True)        # issues list from agent fill decision
    created_at = Column(DateTime, default=_utcnow)

    job = relationship("ProcessingJob", back_populates="question_results")

    def __repr__(self):
        return f"<QuestionResult id={self.id} job_id={self.job_id} reviewed={self.reviewed}>"


class AuditLog(Base):
    """Tracks all user and system actions for accountability."""
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=_utcnow, index=True)
    action_type = Column(String(50), nullable=False, index=True)
    # action_type values: question_edit, question_approve, bulk_approve,
    #   job_finalize, flagged_resolve, flagged_dismiss, flagged_bulk_dismiss,
    #   kb_create, kb_update, kb_delete, kb_import
    entity_type = Column(String(50), nullable=False, index=True)
    # entity_type values: question_result, processing_job, flagged_question, qa_pair
    entity_id = Column(Integer, nullable=True)
    job_id = Column(Integer, nullable=True, index=True)
    actor = Column(String(255), default="user")
    details = Column(JSON, nullable=True)
    before_value = Column(Text, nullable=True)
    after_value = Column(Text, nullable=True)

    def __repr__(self):
        return f"<AuditLog id={self.id} action={self.action_type} entity={self.entity_type}>"


class FormatFingerprint(Base):
    """Remembers questionnaire document layouts for auto-detection."""
    __tablename__ = "format_fingerprints"

    id = Column(Integer, primary_key=True, autoincrement=True)
    fingerprint_hash = Column(String(64), unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=True)
    source_filename = Column(String(512), nullable=True)
    column_count = Column(Integer, nullable=True)
    header_signature = Column(String(512), nullable=True)
    structural_metadata = Column(JSON, nullable=True)
    parser_profile = Column(String(100), nullable=False)
    hint_overrides = Column(JSON, nullable=True)
    success_count = Column(Integer, default=1)
    last_used_at = Column(DateTime, default=_utcnow)
    created_at = Column(DateTime, default=_utcnow)

    def __repr__(self):
        return f"<FormatFingerprint id={self.id} hash={self.fingerprint_hash[:12]}>"


class AnswerCorrection(Base):
    """Records user corrections made during review for learning."""
    __tablename__ = "answer_corrections"

    id = Column(Integer, primary_key=True, autoincrement=True)
    job_id = Column(Integer, ForeignKey("processing_jobs.id"), nullable=False)
    question_result_id = Column(Integer, ForeignKey("question_results.id"), nullable=False)
    question_text = Column(Text, nullable=False)
    original_answer = Column(Text, nullable=True)
    corrected_answer = Column(Text, nullable=False)
    original_source = Column(String(50), nullable=True)
    original_confidence = Column(Float, nullable=True)
    correction_type = Column(String(50), default="manual")
    auto_added_to_kb = Column(Boolean, default=False)
    kb_pair_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=_utcnow)

    job = relationship("ProcessingJob")
    question_result = relationship("QuestionResult")

    def __repr__(self):
        return f"<AnswerCorrection id={self.id} job_id={self.job_id}>"


class QuestionnaireTemplate(Base):
    """A saved set of Q&A pairs from a finalized job for reuse."""
    __tablename__ = "questionnaire_templates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    source_job_id = Column(Integer, ForeignKey("processing_jobs.id"), nullable=True)
    source_filename = Column(String(512), nullable=True)
    question_count = Column(Integer, default=0)
    times_used = Column(Integer, default=0)
    last_used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
    deleted_at = Column(DateTime, nullable=True, default=None)

    answers = relationship("TemplateAnswer", back_populates="template", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<QuestionnaireTemplate id={self.id} name='{self.name}'>"


class AgentPreset(Base):
    """A saved set of agent instructions for reuse."""
    __tablename__ = "agent_presets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    instructions = Column(Text, nullable=False)
    is_builtin = Column(Boolean, default=False)
    created_at = Column(DateTime, default=_utcnow)

    def __repr__(self):
        return f"<AgentPreset id={self.id} name='{self.name}'>"


class DuplicateReview(Base):
    """Tracks a pair of KB entries flagged as potential duplicates for review."""
    __tablename__ = "duplicate_reviews"

    id = Column(Integer, primary_key=True, autoincrement=True)
    entry_a_id = Column(Integer, ForeignKey("qa_pairs.id"), nullable=False)
    entry_b_id = Column(Integer, ForeignKey("qa_pairs.id"), nullable=False)
    similarity_score = Column(Float, nullable=False)
    classification = Column(String(32), nullable=True)  # definitely_same | probably_same | different
    reason = Column(Text, nullable=True)
    recommended_keep_id = Column(Integer, nullable=True)
    status = Column(String(32), default="pending")  # pending | reviewed | dismissed
    reviewed_action = Column(String(32), nullable=True)  # keep_left | keep_right | keep_both | merged
    source = Column(String(32), default="manual_scan")  # manual_scan | auto_flag
    created_at = Column(DateTime, default=_utcnow)
    reviewed_at = Column(DateTime, nullable=True)

    entry_a = relationship("QAPair", foreign_keys=[entry_a_id])
    entry_b = relationship("QAPair", foreign_keys=[entry_b_id])

    def __repr__(self):
        return f"<DuplicateReview id={self.id} a={self.entry_a_id} b={self.entry_b_id} status={self.status}>"


class TemplateAnswer(Base):
    """An individual Q&A pair within a questionnaire template."""
    __tablename__ = "template_answers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    template_id = Column(Integer, ForeignKey("questionnaire_templates.id"), nullable=False)
    question_text = Column(Text, nullable=False)
    answer_text = Column(Text, nullable=False)
    question_index = Column(Integer, nullable=True)
    category = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=_utcnow)

    template = relationship("QuestionnaireTemplate", back_populates="answers")

    def __repr__(self):
        return f"<TemplateAnswer id={self.id} template_id={self.template_id}>"
