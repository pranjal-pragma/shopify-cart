from __future__ import annotations

from typing import cast

import structlog
from fastapi import HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shopify_app.config import Settings
from shopify_app.models import CartAppearance
from shopify_app.schemas import (
    CartAppearanceConfiguration,
    CartAppearanceResponse,
    CartFeaturesConfiguration,
    CartFeaturesResponse,
    MerchantResponse,
    ShopConnectionResponse,
)
from shopify_app.security import TokenCipher
from shopify_app.services.shopify import (
    InvalidWebhookError,
    InvalidWebhookSignatureError,
    ShopifyUnavailableError,
    TokenExchangeRequiredError,
    exchange_session_token,
    get_merchant_identity,
    process_webhook,
    publish_cart_appearance,
)
from shopify_app.shopify_client import ShopifyClient

logger = structlog.get_logger()


def configuration_section(
    configuration: dict[str, object], fields: set[str]
) -> dict[str, object]:
    return {key: value for key, value in configuration.items() if key in fields}


async def exchange_token(
    *,
    auth: tuple[str, str],
    db: AsyncSession,
    client: ShopifyClient,
    cipher: TokenCipher,
) -> ShopConnectionResponse:
    session_token, shop_domain = auth
    try:
        return await exchange_session_token(
            session_token=session_token,
            shop_domain=shop_domain,
            db=db,
            client=client,
            cipher=cipher,
        )
    except ShopifyUnavailableError as exc:
        logger.warning("shopify_token_exchange_failed", shop_domain=shop_domain)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="Shopify unavailable"
        ) from exc


async def merchant_identity(
    *,
    auth: tuple[str, str],
    db: AsyncSession,
    cipher: TokenCipher,
) -> MerchantResponse:
    _, shop_domain = auth
    try:
        return await get_merchant_identity(shop_domain=shop_domain, db=db, cipher=cipher)
    except TokenExchangeRequiredError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="token exchange required"
        ) from exc


def default_cart_appearance() -> CartAppearanceConfiguration:
    return CartAppearanceConfiguration.model_validate(
        {
            "banners": [
                {
                    "id": "welcome",
                    "title": {"text": "Free shipping on orders above Rs. 999"},
                    "subtext": {"text": "Add more to unlock your reward", "font_size": 12},
                }
            ],
            "checkout_text": {"text": "Proceed to checkout", "bold": True, "font_size": 16},
            "checkout_subtext": {"text": "Safe and secure checkout", "font_size": 12},
            "footer_text": {"text": "Secure checkout powered by GoKwik", "font_size": 12},
        }
    )


def default_cart_features() -> CartFeaturesConfiguration:
    return CartFeaturesConfiguration()


async def publish_and_store_cart_configuration(
    *,
    shop_domain: str,
    section: dict[str, object],
    db: AsyncSession,
    client: ShopifyClient,
    cipher: TokenCipher,
) -> CartAppearance:
    appearance = await db.get(CartAppearance, shop_domain)
    defaults = {
        **default_cart_appearance().model_dump(mode="json"),
        **default_cart_features().model_dump(mode="json"),
    }
    combined = {**defaults, **(appearance.configuration if appearance else {}), **section}
    try:
        await publish_cart_appearance(
            shop_domain=shop_domain,
            configuration=combined,
            db=db,
            client=client,
            cipher=cipher,
        )
    except TokenExchangeRequiredError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="token exchange required"
        ) from exc
    except ShopifyUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not publish cart configuration to Shopify",
        ) from exc

    if appearance is None:
        appearance = CartAppearance(shop_domain=shop_domain, configuration=combined)
        db.add(appearance)
    else:
        appearance.configuration = combined
    await db.commit()
    await db.refresh(appearance)
    return appearance


async def get_cart_appearance(
    *, auth: tuple[str, str], db: AsyncSession
) -> CartAppearanceResponse:
    _, shop_domain = auth
    appearance = await db.scalar(
        select(CartAppearance).where(CartAppearance.shop_domain == shop_domain)
    )
    if appearance is None:
        return CartAppearanceResponse(**default_cart_appearance().model_dump())
    section = configuration_section(
        appearance.configuration, set(CartAppearanceConfiguration.model_fields)
    )
    return CartAppearanceResponse(
        **CartAppearanceConfiguration.model_validate(section).model_dump(),
        updated_at=appearance.updated_at.isoformat(),
    )


async def save_cart_appearance(
    *,
    auth: tuple[str, str],
    configuration: CartAppearanceConfiguration,
    db: AsyncSession,
    client: ShopifyClient,
    cipher: TokenCipher,
) -> CartAppearanceResponse:
    _, shop_domain = auth
    serialized = configuration.model_dump(mode="json")
    appearance = await publish_and_store_cart_configuration(
        shop_domain=shop_domain,
        section=serialized,
        db=db,
        client=client,
        cipher=cipher,
    )
    return CartAppearanceResponse(
        **configuration.model_dump(), updated_at=appearance.updated_at.isoformat()
    )


async def get_cart_features(
    *, auth: tuple[str, str], db: AsyncSession
) -> CartFeaturesResponse:
    _, shop_domain = auth
    appearance = await db.get(CartAppearance, shop_domain)
    if appearance is None:
        return CartFeaturesResponse(**default_cart_features().model_dump())
    section = configuration_section(
        appearance.configuration, set(CartFeaturesConfiguration.model_fields)
    )
    return CartFeaturesResponse(
        **CartFeaturesConfiguration.model_validate(section).model_dump(),
        updated_at=appearance.updated_at.isoformat(),
    )


async def save_cart_features(
    *,
    auth: tuple[str, str],
    configuration: CartFeaturesConfiguration,
    db: AsyncSession,
    client: ShopifyClient,
    cipher: TokenCipher,
) -> CartFeaturesResponse:
    _, shop_domain = auth
    appearance = await publish_and_store_cart_configuration(
        shop_domain=shop_domain,
        section=configuration.model_dump(mode="json"),
        db=db,
        client=client,
        cipher=cipher,
    )
    return CartFeaturesResponse(
        **configuration.model_dump(), updated_at=appearance.updated_at.isoformat()
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


async def receive_webhook(
    *,
    request: Request,
    db: AsyncSession,
    settings: Settings,
    x_shopify_hmac_sha256: str | None,
    x_shopify_topic: str | None,
    x_shopify_shop_domain: str | None,
    x_shopify_webhook_id: str | None,
    x_shopify_api_version: str | None,
) -> Response:
    if not all(
        [x_shopify_hmac_sha256, x_shopify_topic, x_shopify_shop_domain, x_shopify_webhook_id]
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="missing Shopify headers"
        )

    body = await read_limited_body(request, settings.webhook_max_body_bytes)
    try:
        result = await process_webhook(
            body=body,
            hmac_signature=cast(str, x_shopify_hmac_sha256),
            topic=cast(str, x_shopify_topic),
            shop_domain_header=cast(str, x_shopify_shop_domain),
            webhook_id=cast(str, x_shopify_webhook_id),
            api_version=x_shopify_api_version,
            client_secret=settings.shopify_client_secret.get_secret_value(),
            db=db,
        )
    except InvalidWebhookSignatureError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid webhook signature"
        ) from exc
    except InvalidWebhookError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="invalid webhook"
        ) from exc

    if not result.duplicate:
        logger.info(
            "shopify_webhook_received",
            topic=result.topic,
            shop_domain=result.shop_domain,
            webhook_id=result.webhook_id,
            webhook_status=result.status,
        )
    return Response(status_code=status.HTTP_200_OK)
