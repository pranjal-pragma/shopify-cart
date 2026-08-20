"""Add Shopify installation authentication state.

Revision ID: 20260820_0002
Revises: 20260819_0001
Create Date: 2026-08-20
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260820_0002"
down_revision: str | None = "20260819_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("shop_sessions", sa.Column("shop_gid", sa.String(length=255), nullable=True))
    op.add_column(
        "shop_sessions", sa.Column("app_installation_gid", sa.String(length=255), nullable=True)
    )
    op.add_column(
        "shop_sessions",
        sa.Column(
            "installation_status",
            sa.String(length=32),
            server_default="active",
            nullable=False,
        ),
    )
    op.add_column(
        "shop_sessions",
        sa.Column("onboarding_completed", sa.Boolean(), server_default="false", nullable=False),
    )
    op.add_column(
        "shop_sessions",
        sa.Column(
            "installed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.add_column(
        "shop_sessions", sa.Column("uninstalled_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("shop_sessions", "uninstalled_at")
    op.drop_column("shop_sessions", "installed_at")
    op.drop_column("shop_sessions", "onboarding_completed")
    op.drop_column("shop_sessions", "installation_status")
    op.drop_column("shop_sessions", "app_installation_gid")
    op.drop_column("shop_sessions", "shop_gid")
