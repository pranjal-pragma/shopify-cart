"""Store refresh metadata for expiring offline tokens.

Revision ID: 20260821_0003
Revises: 20260820_0002
Create Date: 2026-08-21
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260821_0003"
down_revision: str | None = "20260820_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "shop_sessions", sa.Column("encrypted_refresh_token", sa.LargeBinary(), nullable=True)
    )
    op.add_column(
        "shop_sessions",
        sa.Column("refresh_token_expires_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("shop_sessions", "refresh_token_expires_at")
    op.drop_column("shop_sessions", "encrypted_refresh_token")
