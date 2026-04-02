"""Initial Postgres schema — creates all tables matching models.py.

Revision ID: 002_initial_postgres
Revises:
Create Date: 2026-03-31
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "002_initial_postgres"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- qa_pairs ---
    op.create_table(
        "qa_pairs",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("category", sa.String(255), nullable=True, index=True),
        sa.Column("question", sa.Text, nullable=False),
        sa.Column("answer", sa.Text, nullable=False),
        sa.Column("embedding", sa.LargeBinary, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("deleted_at", sa.DateTime, nullable=True),
    )

    # --- processing_jobs ---
    op.create_table(
        "processing_jobs",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("batch_id", sa.String(64), nullable=True, index=True),
        sa.Column("original_filename", sa.String(512), nullable=False),
        sa.Column("stored_filename", sa.String(512), nullable=False),
        sa.Column("status", sa.String(50), server_default="pending", index=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("output_filename", sa.String(512), nullable=True),
        sa.Column("total_questions", sa.Integer, server_default="0"),
        sa.Column("matched_questions", sa.Integer, server_default="0"),
        sa.Column("flagged_questions_count", sa.Integer, server_default="0"),
        sa.Column("parser_strategy", sa.String(50), nullable=True),
        sa.Column("parser_profile_name", sa.String(100), nullable=True),
        sa.Column("parse_confidence", sa.Float, nullable=True),
        sa.Column("parse_stats", sa.JSON, nullable=True),
        sa.Column("fallback_recommended", sa.Boolean, server_default=sa.text("false")),
        sa.Column("fallback_reason", sa.String(100), nullable=True),
        sa.Column("agent_mode", sa.String(32), nullable=True),
        sa.Column("agent_status", sa.String(32), nullable=True),
        sa.Column("agent_summary", sa.Text, nullable=True),
        sa.Column("agent_trace", sa.JSON, nullable=True),
        sa.Column("agent_error", sa.Text, nullable=True),
        sa.Column("agent_model", sa.String(128), nullable=True),
        sa.Column("agent_input_tokens", sa.Integer, nullable=True),
        sa.Column("agent_output_tokens", sa.Integer, nullable=True),
        sa.Column("agent_llm_calls", sa.Integer, nullable=True),
        sa.Column("agent_kb_routed", sa.Integer, nullable=True),
        sa.Column("uploaded_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime, nullable=True),
        sa.Column("review_status", sa.String(32), server_default="pending"),
    )

    # --- flagged_questions ---
    op.create_table(
        "flagged_questions",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("job_id", sa.Integer, sa.ForeignKey("processing_jobs.id"), nullable=False),
        sa.Column("extracted_question", sa.Text, nullable=False),
        sa.Column("context", sa.Text, nullable=True),
        sa.Column("location_info", sa.JSON, nullable=True),
        sa.Column("similarity_score", sa.Float, nullable=True),
        sa.Column("best_match_question", sa.Text, nullable=True),
        sa.Column("resolved", sa.Boolean, server_default=sa.text("false"), index=True),
        sa.Column("resolved_answer", sa.Text, nullable=True),
        sa.Column("resolved_at", sa.DateTime, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )

    # --- question_results ---
    op.create_table(
        "question_results",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("job_id", sa.Integer, sa.ForeignKey("processing_jobs.id"), nullable=False),
        sa.Column("question_index", sa.Integer, nullable=False),
        sa.Column("question_text", sa.Text, nullable=False),
        sa.Column("answer_text", sa.Text, nullable=True),
        sa.Column("edited_answer_text", sa.Text, nullable=True),
        sa.Column("confidence_score", sa.Float, nullable=True),
        sa.Column("source", sa.String(50), nullable=True),
        sa.Column("kb_pair_id", sa.Integer, nullable=True),
        sa.Column("location_info", sa.JSON, nullable=True),
        sa.Column("formatting_info", sa.JSON, nullable=True),
        sa.Column("item_type", sa.String(50), nullable=True),
        sa.Column("reviewed", sa.Boolean, server_default=sa.text("false"), index=True),
        sa.Column("agent_reason", sa.Text, nullable=True),
        sa.Column("agent_issues", sa.JSON, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )

    # --- audit_logs ---
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("timestamp", sa.DateTime, server_default=sa.func.now(), index=True),
        sa.Column("action_type", sa.String(50), nullable=False, index=True),
        sa.Column("entity_type", sa.String(50), nullable=False, index=True),
        sa.Column("entity_id", sa.Integer, nullable=True),
        sa.Column("job_id", sa.Integer, nullable=True, index=True),
        sa.Column("actor", sa.String(255), server_default="user"),
        sa.Column("details", sa.JSON, nullable=True),
        sa.Column("before_value", sa.Text, nullable=True),
        sa.Column("after_value", sa.Text, nullable=True),
    )

    # --- format_fingerprints ---
    op.create_table(
        "format_fingerprints",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("fingerprint_hash", sa.String(64), unique=True, nullable=False, index=True),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("source_filename", sa.String(512), nullable=True),
        sa.Column("column_count", sa.Integer, nullable=True),
        sa.Column("header_signature", sa.String(512), nullable=True),
        sa.Column("structural_metadata", sa.JSON, nullable=True),
        sa.Column("parser_profile", sa.String(100), nullable=False),
        sa.Column("hint_overrides", sa.JSON, nullable=True),
        sa.Column("success_count", sa.Integer, server_default="1"),
        sa.Column("last_used_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )

    # --- answer_corrections ---
    op.create_table(
        "answer_corrections",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("job_id", sa.Integer, sa.ForeignKey("processing_jobs.id"), nullable=False),
        sa.Column("question_result_id", sa.Integer, sa.ForeignKey("question_results.id"), nullable=False),
        sa.Column("question_text", sa.Text, nullable=False),
        sa.Column("original_answer", sa.Text, nullable=True),
        sa.Column("corrected_answer", sa.Text, nullable=False),
        sa.Column("original_source", sa.String(50), nullable=True),
        sa.Column("original_confidence", sa.Float, nullable=True),
        sa.Column("correction_type", sa.String(50), server_default="manual"),
        sa.Column("auto_added_to_kb", sa.Boolean, server_default=sa.text("false")),
        sa.Column("kb_pair_id", sa.Integer, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )

    # --- questionnaire_templates ---
    op.create_table(
        "questionnaire_templates",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("source_job_id", sa.Integer, sa.ForeignKey("processing_jobs.id"), nullable=True),
        sa.Column("source_filename", sa.String(512), nullable=True),
        sa.Column("question_count", sa.Integer, server_default="0"),
        sa.Column("times_used", sa.Integer, server_default="0"),
        sa.Column("last_used_at", sa.DateTime, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("deleted_at", sa.DateTime, nullable=True),
    )

    # --- agent_presets ---
    op.create_table(
        "agent_presets",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("instructions", sa.Text, nullable=False),
        sa.Column("is_builtin", sa.Boolean, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )

    # --- template_answers ---
    op.create_table(
        "template_answers",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("template_id", sa.Integer, sa.ForeignKey("questionnaire_templates.id"), nullable=False),
        sa.Column("question_text", sa.Text, nullable=False),
        sa.Column("answer_text", sa.Text, nullable=False),
        sa.Column("question_index", sa.Integer, nullable=True),
        sa.Column("category", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("template_answers")
    op.drop_table("agent_presets")
    op.drop_table("questionnaire_templates")
    op.drop_table("answer_corrections")
    op.drop_table("format_fingerprints")
    op.drop_table("audit_logs")
    op.drop_table("question_results")
    op.drop_table("flagged_questions")
    op.drop_table("processing_jobs")
    op.drop_table("qa_pairs")
