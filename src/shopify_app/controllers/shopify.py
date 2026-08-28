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
    CartUpsellConfiguration,
    CartUpsellResponse,
    MerchantResponse,
    ShopConnectionResponse,
    ShopifyDiscountOption,
)
from shopify_app.security import TokenCipher
from shopify_app.services.shopify import (
    InvalidWebhookError,
    InvalidWebhookSignatureError,
    ShopifyUnavailableError,
    TokenExchangeRequiredError,
    exchange_session_token,
    get_merchant_identity,
    list_active_discounts,
    process_webhook,
    publish_cart_appearance,
    sync_free_gift_discounts,
    sync_free_gift_inventory,
    valid_gift_product_bindings,
)
from shopify_app.shopify_client import ShopifyClient

logger = structlog.get_logger()


def configuration_section(configuration: dict[str, object], fields: set[str]) -> dict[str, object]:
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
            "footer_text": {
                "text": "Secure checkout powered by pragma-site-cart",
                "font_size": 12,
            },
        }
    )


def default_cart_features() -> CartFeaturesConfiguration:
    return CartFeaturesConfiguration()


def validated_cart_features_section(configuration: dict[str, object]) -> CartFeaturesConfiguration:
    section = configuration_section(configuration, set(CartFeaturesConfiguration.model_fields))
    if section.get("tiered_applicable_on") != "all" and not section.get(
        "tiered_applicable_ids"
    ):
        section = {
            **section,
            "tiered_applicable_on": "all",
            "tiered_applicable_ids": [],
            "tiered_applicable_titles": [],
            "tiered_applicable_product_ids": [],
        }
    return CartFeaturesConfiguration.model_validate(section)


def default_cart_upsell() -> CartUpsellConfiguration:
    return CartUpsellConfiguration()


def free_gift_configuration_changed(
    previous: CartFeaturesConfiguration,
    current: CartFeaturesConfiguration,
) -> bool:
    gift_fields = (
        "free_gifts_enabled",
        "free_gifts_copy_inventory",
        "free_gift_method",
        "free_gift_offers",
    )
    return any(getattr(previous, field) != getattr(current, field) for field in gift_fields)


def align_tiered_gift_offers(
    configuration: CartFeaturesConfiguration,
) -> CartFeaturesConfiguration:
    if not configuration.tiered_rewards_enabled:
        return configuration
    condition_type = (
        configuration.tiered_reward_condition
        if configuration.tiered_reward_condition in {"cart_subtotal", "cart_quantity"}
        else "cart_subtotal"
    )
    goals = {
        reward.gift_offer_id: reward.goal
        for reward in configuration.tiered_rewards
        if reward.reward_type == "free_gift" and reward.gift_offer_id
    }
    if not goals:
        return configuration
    scoped_product_ids = []
    if configuration.tiered_applicable_on == "products":
        scoped_product_ids = configuration.tiered_applicable_ids
    elif configuration.tiered_applicable_on == "collections":
        scoped_product_ids = list(
            dict.fromkeys(
                product_id
                for product_ids in configuration.tiered_applicable_product_ids
                for product_id in product_ids
            )
        )
    scoped_product_ids = scoped_product_ids[:250]
    offers = []
    for offer in configuration.free_gift_offers:
        goal = goals.get(offer.id)
        if goal is None:
            offers.append(offer)
            continue
        condition = offer.conditions[0].model_copy(
            update={
                "condition_type": condition_type,
                "operator": "greater_than_or_equal",
                "value": goal,
                "applicable_on": "products" if scoped_product_ids else "all",
                "product_ids": scoped_product_ids,
                "product_titles": scoped_product_ids,
            }
        )
        offers.append(
            offer.model_copy(
                update={
                    "eligibility_type": condition_type,
                    "threshold": goal,
                    "conditions": [condition],
                }
            )
        )
    return configuration.model_copy(update={"free_gift_offers": offers})


async def discount_options(
    *,
    auth: tuple[str, str],
    db: AsyncSession,
    client: ShopifyClient,
    cipher: TokenCipher,
) -> list[ShopifyDiscountOption]:
    _, shop_domain = auth
    try:
        return await list_active_discounts(
            shop_domain=shop_domain, db=db, client=client, cipher=cipher
        )
    except TokenExchangeRequiredError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="token exchange required"
        ) from exc
    except ShopifyUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not load Shopify discounts",
        ) from exc


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
        **default_cart_upsell().model_dump(mode="json"),
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


async def get_cart_appearance(*, auth: tuple[str, str], db: AsyncSession) -> CartAppearanceResponse:
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


async def get_cart_features(*, auth: tuple[str, str], db: AsyncSession) -> CartFeaturesResponse:
    _, shop_domain = auth
    appearance = await db.get(CartAppearance, shop_domain)
    if appearance is None:
        return CartFeaturesResponse(**default_cart_features().model_dump())
    return CartFeaturesResponse(
        **validated_cart_features_section(appearance.configuration).model_dump(),
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
    configuration = align_tiered_gift_offers(configuration)
    existing = await db.get(CartAppearance, shop_domain)
    stored_discount_ids = (
        existing.configuration.get("_free_gift_discount_ids", {}) if existing else {}
    )
    stored_gift_bindings = valid_gift_product_bindings(
        existing.configuration.get("_free_gift_product_bindings", {}) if existing else {}
    )
    if not isinstance(stored_discount_ids, dict) or not all(
        isinstance(key, str) and isinstance(value, str)
        for key, value in stored_discount_ids.items()
    ):
        stored_discount_ids = {}
    previous_configuration = (
        validated_cart_features_section(existing.configuration)
        if existing
        else default_cart_features()
    )
    synchronized_configuration = configuration
    gift_bindings = stored_gift_bindings
    discount_ids = cast(dict[str, str], stored_discount_ids)
    if free_gift_configuration_changed(previous_configuration, configuration):
        try:
            synchronized_configuration, gift_bindings = await sync_free_gift_inventory(
                shop_domain=shop_domain,
                configuration=configuration,
                existing_bindings=stored_gift_bindings,
                db=db,
                client=client,
                cipher=cipher,
            )
            discount_ids = await sync_free_gift_discounts(
                shop_domain=shop_domain,
                configuration=synchronized_configuration,
                existing_discount_ids=cast(dict[str, str], stored_discount_ids),
                db=db,
                client=client,
                cipher=cipher,
            )
        except TokenExchangeRequiredError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="token exchange required"
            ) from exc
        except ShopifyUnavailableError as exc:
            cause = exc.__cause__ or exc
            logger.warning(
                "free_gift_synchronization_failed",
                shop_domain=shop_domain,
                error=str(cause),
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Could not synchronize Shopify free gift products and discounts",
            ) from exc

    appearance = await publish_and_store_cart_configuration(
        shop_domain=shop_domain,
        section={
            **synchronized_configuration.model_dump(mode="json"),
            "_free_gift_discount_ids": discount_ids,
            "_free_gift_product_bindings": gift_bindings,
        },
        db=db,
        client=client,
        cipher=cipher,
    )
    return CartFeaturesResponse(
        **synchronized_configuration.model_dump(), updated_at=appearance.updated_at.isoformat()
    )


async def get_cart_upsell(*, auth: tuple[str, str], db: AsyncSession) -> CartUpsellResponse:
    _, shop_domain = auth
    appearance = await db.get(CartAppearance, shop_domain)
    if appearance is None:
        return CartUpsellResponse(**default_cart_upsell().model_dump())
    section = configuration_section(
        appearance.configuration, set(CartUpsellConfiguration.model_fields)
    )
    return CartUpsellResponse(
        **CartUpsellConfiguration.model_validate(section).model_dump(),
        updated_at=appearance.updated_at.isoformat(),
    )


async def save_cart_upsell(
    *,
    auth: tuple[str, str],
    configuration: CartUpsellConfiguration,
    db: AsyncSession,
    client: ShopifyClient,
    cipher: TokenCipher,
) -> CartUpsellResponse:
    _, shop_domain = auth
    appearance = await publish_and_store_cart_configuration(
        shop_domain=shop_domain,
        section=configuration.model_dump(mode="json"),
        db=db,
        client=client,
        cipher=cipher,
    )
    return CartUpsellResponse(
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
