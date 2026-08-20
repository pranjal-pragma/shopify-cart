from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, LargeBinary, String, func
from sqlalchemy.orm import Mapped, mapped_column

from shopify_app.db import Base, TimestampMixin


class ShopSession(TimestampMixin, Base):
    __tablename__ = "shop_sessions"

    shop_domain: Mapped[str] = mapped_column(String(255), primary_key=True)
    encrypted_access_token: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    scopes: Mapped[str] = mapped_column(String(2048), default="", nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WebhookDelivery(Base):
    __tablename__ = "webhook_deliveries"

    webhook_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    topic: Mapped[str] = mapped_column(String(255), nullable=False)
    shop_domain: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    api_version: Mapped[str | None] = mapped_column(String(16))
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="received", index=True, nullable=False)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
