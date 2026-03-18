"""SQLAlchemy ORM models."""

import datetime
from sqlalchemy import (
    Column, Integer, String, Text, Float, LargeBinary,
    DateTime, Boolean, ForeignKey, JSON
)
from sqlalchemy.orm import relationship
from app.database import Base


class QAPair(Base):
    """A question-answer pair in the knowledge base."""
    __tablename__ = "qa_pairs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    category = Column(String(255), nullable=True, index=True)
    question = Column(Text, nullable=False)
    answer = Column(Text, nullable=False)
    embedding = Column(LargeBinary, nullable=True)  # numpy array as bytes
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

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
    uploaded_at = Column(DateTime, default=datetime.datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    flagged_questions = relationship("FlaggedQuestion", back_populates="job", cascade="all, delete-orphan")

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
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    job = relationship("ProcessingJob", back_populates="flagged_questions")

    def __repr__(self):
        return f"<FlaggedQuestion id={self.id} resolved={self.resolved}>"
