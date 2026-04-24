"""Add duplicate_reviews table plus contradicts and assigned_to columns.

Covers schema drift added after the initial migration:
  - duplicate_reviews (new table for LLM-classified duplicate pair review)
  - duplicate_reviews.contradicts (F2 contradiction detection)
  - flagged_questions.assigned_to (F3 SME routing)
  - question_results.assigned_to (F3 SME routing)

Revision ID: 003_duplicate_reviews_and_assignments
Revises: 002_initial_postgres
Create Date: 2026-04-23
"""
from alembic import op
import sqlalchemy as sa

revision = "003_duplicate_reviews_and_assignments"
down_revision = "002_initial_postgres"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "duplicate_reviews",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("entry_a_id", sa.Integer, sa.ForeignKey("qa_pairs.id"), nullable=False),
        sa.Column("entry_b_id", sa.Integer, sa.ForeignKey("qa_pairs.id"), nullable=False),
        sa.Column("similarity_score", sa.Float, nullable=False),
        sa.Column("classification", sa.String(32), nullable=True),
        sa.Column("contradicts", sa.Boolean, nullable=True),
        sa.Column("reason", sa.Text, nullable=True),
        sa.Column("recommended_keep_id", sa.Integer, nullable=True),
        sa.Column("status", sa.String(32), server_default="pending"),
        sa.Column("reviewed_action", sa.String(32), nullable=True),
        sa.Column("source", sa.String(32), server_default="manual_scan"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("reviewed_at", sa.DateTime, nullable=True),
    )

    op.add_column(
        "flagged_questions",
        sa.Column("assigned_to", sa.String(255), nullable=True),
    )
    op.add_column(
        "question_results",
        sa.Column("assigned_to", sa.String(255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("question_results", "assigned_to")
    op.drop_column("flagged_questions", "assigned_to")
    op.drop_table("duplicate_reviews")
