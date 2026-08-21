from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shopify_app.models import ShopSession, WebhookDelivery
from shopify_app.schemas import MerchantResponse, ShopConnectionResponse
from shopify_app.security import (
    AuthenticationError,
    TokenCipher,
    validate_shop_domain,
    verify_webhook_hmac,
)
from shopify_app.shopify_client import ShopifyClient, ShopifyUpstreamError

TOKEN_REFRESH_MARGIN = timedelta(minutes=5)


class ShopifyServiceError(Exception):
    """Base error for Shopify service failures."""


class ShopifyUnavailableError(ShopifyServiceError):
    """Raised when Shopify cannot complete the requested operation."""


class TokenExchangeRequiredError(ShopifyServiceError):
    """Raised when a shop has no usable active access token."""


class InvalidWebhookSignatureError(ShopifyServiceError):
    """Raised when a webhook HMAC does not match the request body."""


class InvalidWebhookError(ShopifyServiceError):
    """Raised when a webhook payload or shop domain is invalid."""


@dataclass(frozen=True)
class WebhookResult:
    topic: str
    shop_domain: str
    webhook_id: str
    status: str
    duplicate: bool = False


def split_scopes(scopes: str) -> list[str]:
    return [scope for scope in scopes.split(",") if scope]


def token_expires_at(expires_in: int | None) -> datetime | None:
    return datetime.now(UTC) + timedelta(seconds=expires_in) if expires_in else None


def normalize_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def should_refresh_token(expires_at: datetime | None) -> bool:
    if expires_at is None:
        return False
    return normalize_datetime(expires_at) <= datetime.now(UTC) + TOKEN_REFRESH_MARGIN


def token_has_expired(expires_at: datetime | None) -> bool:
    if expires_at is None:
        return False
    return normalize_datetime(expires_at) <= datetime.now(UTC)


def update_session_tokens(
    *,
    session: ShopSession,
    token_access_token: str,
    token_scope: str,
    token_expires_in: int | None,
    refresh_token: str | None,
    refresh_token_expires_in: int | None,
    cipher: TokenCipher,
) -> None:
    session.encrypted_access_token = cipher.encrypt(token_access_token)
    session.scopes = token_scope
    session.expires_at = token_expires_at(token_expires_in)
    if refresh_token is not None:
        session.encrypted_refresh_token = cipher.encrypt(refresh_token)
    if refresh_token_expires_in is not None:
        session.refresh_token_expires_at = token_expires_at(refresh_token_expires_in)


async def exchange_session_token(
    *,
    session_token: str,
    shop_domain: str,
    db: AsyncSession,
    client: ShopifyClient,
    cipher: TokenCipher,
) -> ShopConnectionResponse:
    try:
        token = await client.exchange_session_token(
            shop_domain=shop_domain, session_token=session_token
        )
        identity = await client.get_installation_identity(
            shop_domain=shop_domain, access_token=token.access_token
        )
    except (ShopifyUpstreamError, httpx.HTTPError) as exc:
        raise ShopifyUnavailableError from exc

    session = await db.get(ShopSession, shop_domain)
    if session is None:
        session = ShopSession(
            shop_domain=shop_domain,
            encrypted_access_token=b"",
            scopes="",
            shop_gid=identity.shop_gid,
            app_installation_gid=identity.app_installation_gid,
        )
        update_session_tokens(
            session=session,
            token_access_token=token.access_token,
            token_scope=token.scope,
            token_expires_in=token.expires_in,
            refresh_token=token.refresh_token,
            refresh_token_expires_in=token.refresh_token_expires_in,
            cipher=cipher,
        )
        db.add(session)
    else:
        if session.installation_status != "active":
            session.installed_at = datetime.now(UTC)
        update_session_tokens(
            session=session,
            token_access_token=token.access_token,
            token_scope=token.scope,
            token_expires_in=token.expires_in,
            refresh_token=token.refresh_token,
            refresh_token_expires_in=token.refresh_token_expires_in,
            cipher=cipher,
        )
        session.shop_gid = identity.shop_gid
        session.app_installation_gid = identity.app_installation_gid
        session.installation_status = "active"
        session.uninstalled_at = None

    await db.commit()
    return ShopConnectionResponse(
        shop_domain=shop_domain,
        scopes=split_scopes(token.scope),
        expires_in=token.expires_in,
    )


async def get_valid_access_token(
    *,
    shop_domain: str,
    db: AsyncSession,
    client: ShopifyClient,
    cipher: TokenCipher,
) -> str:
    session = await db.get(ShopSession, shop_domain)
    if session is None or session.installation_status != "active":
        raise TokenExchangeRequiredError

    try:
        access_token, rotated_access_token = cipher.decrypt_with_rotation(
            session.encrypted_access_token
        )
    except AuthenticationError as exc:
        raise TokenExchangeRequiredError from exc

    if rotated_access_token is not None:
        session.encrypted_access_token = rotated_access_token
        await db.commit()

    if not should_refresh_token(session.expires_at):
        return access_token

    if session.encrypted_refresh_token is None:
        raise TokenExchangeRequiredError

    if token_has_expired(session.refresh_token_expires_at):
        raise TokenExchangeRequiredError

    try:
        refresh_token, rotated_refresh_token = cipher.decrypt_with_rotation(
            session.encrypted_refresh_token
        )
        token = await client.refresh_offline_access_token(
            shop_domain=shop_domain, refresh_token=refresh_token
        )
    except AuthenticationError as exc:
        raise TokenExchangeRequiredError from exc
    except (ShopifyUpstreamError, httpx.HTTPError) as exc:
        raise ShopifyUnavailableError from exc

    if rotated_refresh_token is not None:
        session.encrypted_refresh_token = rotated_refresh_token

    update_session_tokens(
        session=session,
        token_access_token=token.access_token,
        token_scope=token.scope,
        token_expires_in=token.expires_in,
        refresh_token=token.refresh_token,
        refresh_token_expires_in=token.refresh_token_expires_in,
        cipher=cipher,
    )
    await db.commit()
    return token.access_token


async def get_merchant_identity(
    *,
    shop_domain: str,
    db: AsyncSession,
    cipher: TokenCipher,
) -> MerchantResponse:
    session = await db.get(ShopSession, shop_domain)
    if session is None or session.installation_status != "active":
        raise TokenExchangeRequiredError

    try:
        _, rotated_token = cipher.decrypt_with_rotation(session.encrypted_access_token)
    except AuthenticationError as exc:
        raise TokenExchangeRequiredError from exc

    if rotated_token is not None:
        session.encrypted_access_token = rotated_token
        await db.commit()

    return MerchantResponse(
        shop_domain=shop_domain,
        connected=True,
        scopes=split_scopes(session.scopes),
        onboarding_completed=session.onboarding_completed,
    )


async def process_webhook(
    *,
    body: bytes,
    hmac_signature: str,
    topic: str,
    shop_domain_header: str,
    webhook_id: str,
    api_version: str | None,
    client_secret: str,
    db: AsyncSession,
) -> WebhookResult:
    if not verify_webhook_hmac(
        body=body,
        signature=hmac_signature,
        client_secret=client_secret,
    ):
        raise InvalidWebhookSignatureError

    try:
        shop_domain = validate_shop_domain(shop_domain_header)
        payload: Any = json.loads(body)
        if not isinstance(payload, dict):
            raise ValueError
    except (AuthenticationError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise InvalidWebhookError from exc

    if await db.get(WebhookDelivery, webhook_id) is not None:
        return WebhookResult(
            topic=topic,
            shop_domain=shop_domain,
            webhook_id=webhook_id,
            status="duplicate",
            duplicate=True,
        )

    delivery = WebhookDelivery(
        webhook_id=webhook_id,
        topic=topic,
        shop_domain=shop_domain,
        api_version=api_version,
        payload=payload,
    )
    db.add(delivery)

    # This starter owns no customer data. Extend these branches when adding domain tables.
    if topic in {"customers/redact", "customers/data_request"}:
        delivery.payload = {}
        delivery.status = "processed"
        delivery.processed_at = datetime.now(UTC)
    elif topic == "app/uninstalled":
        session = await db.get(ShopSession, shop_domain)
        if session is not None:
            session.encrypted_access_token = b""
            session.encrypted_refresh_token = None
            session.expires_at = None
            session.refresh_token_expires_at = None
            session.installation_status = "uninstalled"
            session.uninstalled_at = datetime.now(UTC)
        delivery.payload = {}
        delivery.status = "processed"
        delivery.processed_at = datetime.now(UTC)
    elif topic == "shop/redact":
        session = await db.get(ShopSession, shop_domain)
        if session is not None:
            await db.delete(session)
        delivery.payload = {}
        delivery.status = "processed"
        delivery.processed_at = datetime.now(UTC)

    try:
        await db.commit()
    except IntegrityError:
        # Concurrent Shopify retries can pass the initial lookup together.
        await db.rollback()
        return WebhookResult(
            topic=topic,
            shop_domain=shop_domain,
            webhook_id=webhook_id,
            status="duplicate",
            duplicate=True,
        )

    return WebhookResult(
        topic=topic,
        shop_domain=shop_domain,
        webhook_id=webhook_id,
        status=delivery.status,
    )
