from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Annotated, cast

import httpx
import structlog
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shopify_app.config import Settings, get_settings
from shopify_app.db import get_db
from shopify_app.models import ShopSession, WebhookDelivery
from shopify_app.schemas import MerchantResponse, ShopConnectionResponse
from shopify_app.security import (
    AuthenticationError,
    TokenCipher,
    decode_session_token,
    validate_shop_domain,
    verify_webhook_hmac,
)
from shopify_app.shopify_client import ShopifyClient, ShopifyUpstreamError

router = APIRouter(prefix="/shopify", tags=["shopify"])
bearer = HTTPBearer(auto_error=False)
logger = structlog.get_logger()


def get_shopify_client(request: Request) -> ShopifyClient:
    return cast(ShopifyClient, request.app.state.shopify_client)


def get_token_cipher(request: Request) -> TokenCipher:
    return cast(TokenCipher, request.app.state.token_cipher)


def authenticate_session_token(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> tuple[str, str]:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing bearer token")
    try:
        claims = decode_session_token(
            token=credentials.credentials,
            client_id=settings.shopify_client_id,
            client_secret=settings.shopify_client_secret.get_secret_value(),
        )
    except AuthenticationError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    return credentials.credentials, str(claims["shop_domain"])


@router.post("/token-exchange", response_model=ShopConnectionResponse)
async def token_exchange(
    auth: Annotated[tuple[str, str], Depends(authenticate_session_token)],
    db: Annotated[AsyncSession, Depends(get_db)],
    client: Annotated[ShopifyClient, Depends(get_shopify_client)],
    cipher: Annotated[TokenCipher, Depends(get_token_cipher)],
) -> ShopConnectionResponse:
    session_token, shop_domain = auth
    try:
        token = await client.exchange_session_token(
            shop_domain=shop_domain, session_token=session_token
        )
        identity = await client.get_installation_identity(
            shop_domain=shop_domain, access_token=token.access_token
        )
    except (ShopifyUpstreamError, httpx.HTTPError) as exc:
        logger.warning("shopify_token_exchange_failed", shop_domain=shop_domain)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="Shopify unavailable"
        ) from exc

    expires_at = (
        datetime.now(UTC) + timedelta(seconds=token.expires_in) if token.expires_in else None
    )
    session = await db.get(ShopSession, shop_domain)
    if session is None:
        session = ShopSession(
            shop_domain=shop_domain,
            encrypted_access_token=cipher.encrypt(token.access_token),
            scopes=token.scope,
            expires_at=expires_at,
            shop_gid=identity.shop_gid,
            app_installation_gid=identity.app_installation_gid,
        )
        db.add(session)
    else:
        if session.installation_status != "active":
            session.installed_at = datetime.now(UTC)
        session.encrypted_access_token = cipher.encrypt(token.access_token)
        session.scopes = token.scope
        session.expires_at = expires_at
        session.shop_gid = identity.shop_gid
        session.app_installation_gid = identity.app_installation_gid
        session.installation_status = "active"
        session.uninstalled_at = None
    await db.commit()
    return ShopConnectionResponse(
        shop_domain=shop_domain,
        scopes=[scope for scope in token.scope.split(",") if scope],
        expires_in=token.expires_in,
    )


@router.get("/me", response_model=MerchantResponse)
async def merchant_identity(
    auth: Annotated[tuple[str, str], Depends(authenticate_session_token)],
    db: Annotated[AsyncSession, Depends(get_db)],
    cipher: Annotated[TokenCipher, Depends(get_token_cipher)],
) -> MerchantResponse:
    _, shop_domain = auth
    session = await db.get(ShopSession, shop_domain)
    if session is None or session.installation_status != "active":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="token exchange required")
    try:
        _, rotated_token = cipher.decrypt_with_rotation(session.encrypted_access_token)
    except AuthenticationError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="token exchange required"
        ) from exc
    if rotated_token is not None:
        session.encrypted_access_token = rotated_token
        await db.commit()
    return MerchantResponse(
        shop_domain=shop_domain,
        connected=True,
        scopes=[scope for scope in session.scopes.split(",") if scope],
        onboarding_completed=session.onboarding_completed,
    )


async def read_limited_body(request: Request, limit: int) -> bytes:
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > limit:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="body too large"
        )
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > limit:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="body too large"
            )
    return bytes(body)


@router.post("/webhooks", status_code=status.HTTP_200_OK)
async def receive_webhook(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
    x_shopify_hmac_sha256: Annotated[str | None, Header()] = None,
    x_shopify_topic: Annotated[str | None, Header()] = None,
    x_shopify_shop_domain: Annotated[str | None, Header()] = None,
    x_shopify_webhook_id: Annotated[str | None, Header()] = None,
    x_shopify_api_version: Annotated[str | None, Header()] = None,
) -> Response:
    if not all(
        [x_shopify_hmac_sha256, x_shopify_topic, x_shopify_shop_domain, x_shopify_webhook_id]
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="missing Shopify headers"
        )

    hmac_header = cast(str, x_shopify_hmac_sha256)
    topic = cast(str, x_shopify_topic)
    shop_header = cast(str, x_shopify_shop_domain)
    webhook_id = cast(str, x_shopify_webhook_id)

    body = await read_limited_body(request, settings.webhook_max_body_bytes)
    if not verify_webhook_hmac(
        body=body,
        signature=hmac_header,
        client_secret=settings.shopify_client_secret.get_secret_value(),
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid webhook signature"
        )
    try:
        shop_domain = validate_shop_domain(shop_header)
        payload = json.loads(body)
        if not isinstance(payload, dict):
            raise ValueError
    except (AuthenticationError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="invalid webhook"
        ) from exc

    if await db.get(WebhookDelivery, webhook_id) is not None:
        return Response(status_code=status.HTTP_200_OK)

    delivery = WebhookDelivery(
        webhook_id=webhook_id,
        topic=topic,
        shop_domain=shop_domain,
        api_version=x_shopify_api_version,
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
        return Response(status_code=status.HTTP_200_OK)
    logger.info(
        "shopify_webhook_received",
        topic=topic,
        shop_domain=shop_domain,
        webhook_id=webhook_id,
        webhook_status=delivery.status,
    )
    return Response(status_code=status.HTTP_200_OK)
