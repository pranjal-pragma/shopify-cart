from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from uuid import uuid4

import httpx
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shopify_app.models import ShopSession, WebhookDelivery
from shopify_app.schemas import (
    CartFeaturesConfiguration,
    FreeGiftOffer,
    FreeGiftVariant,
    MerchantResponse,
    ShopConnectionResponse,
    ShopifyDiscountOption,
)
from shopify_app.security import (
    AuthenticationError,
    TokenCipher,
    validate_shop_domain,
    verify_webhook_hmac,
)
from shopify_app.shopify_client import ShopifyClient, ShopifyUpstreamError

TOKEN_REFRESH_MARGIN = timedelta(minutes=5)
APPEARANCE_METAFIELD_NAMESPACE = "cart"
APPEARANCE_METAFIELD_KEY = "appearance"
FREE_GIFT_FUNCTION_HANDLE = "free-gift-discount"
FREE_GIFT_METAFIELD_NAMESPACE = "$app"
FREE_GIFT_METAFIELD_KEY = "function-configuration"
FREE_GIFT_PRODUCT_HANDLE_PREFIX = "pragma-site-cart-gift"


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


@dataclass(frozen=True)
class GiftInventoryLevel:
    location_id: str
    available: int


@dataclass(frozen=True)
class GiftVariantSnapshot:
    variant_id: str
    title: str
    price: str
    sku: str
    barcode: str
    tracked: bool
    inventory_policy: str
    taxable: bool
    inventory_item_id: str
    inventory_levels: tuple[GiftInventoryLevel, ...]
    product_title: str = ""
    image_url: str = ""
    image_alt: str = ""


@dataclass(frozen=True)
class GiftProductState:
    product_id: str
    variant: GiftVariantSnapshot


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


async def publish_cart_appearance(
    *,
    shop_domain: str,
    configuration: dict[str, Any],
    db: AsyncSession,
    client: ShopifyClient,
    cipher: TokenCipher,
) -> None:
    session = await db.get(ShopSession, shop_domain)
    if session is None or session.app_installation_gid is None:
        return

    access_token = await get_valid_access_token(
        shop_domain=shop_domain, db=db, client=client, cipher=cipher
    )
    try:
        payload = await client.graphql(
            shop_domain=shop_domain,
            access_token=access_token,
            query="""
                mutation PublishCartAppearance($metafields: [MetafieldsSetInput!]!) {
                  metafieldsSet(metafields: $metafields) {
                    metafields { id namespace key }
                    userErrors { field message code }
                  }
                }
            """,
            variables={
                "metafields": [
                    {
                        "ownerId": session.app_installation_gid,
                        "namespace": APPEARANCE_METAFIELD_NAMESPACE,
                        "key": APPEARANCE_METAFIELD_KEY,
                        "type": "json",
                        "value": json.dumps(configuration, separators=(",", ":")),
                    }
                ]
            },
        )
        result = payload["data"]["metafieldsSet"]
        if payload.get("errors") or result["userErrors"]:
            raise ShopifyUpstreamError("Shopify rejected the cart appearance metafield")
    except (KeyError, TypeError, ShopifyUpstreamError, httpx.HTTPError) as exc:
        raise ShopifyUnavailableError from exc


async def list_active_code_discounts(
    *,
    shop_domain: str,
    db: AsyncSession,
    client: ShopifyClient,
    cipher: TokenCipher,
) -> list[ShopifyDiscountOption]:
    access_token = await get_valid_access_token(
        shop_domain=shop_domain, db=db, client=client, cipher=cipher
    )
    try:
        payload = await client.graphql(
            shop_domain=shop_domain,
            access_token=access_token,
            query="""
                query ActiveCartRewardDiscounts {
                  codeDiscountNodes(first: 100, query: "status:active") {
                    nodes {
                      id
                      codeDiscount {
                        __typename
                        ... on DiscountCodeBasic {
                          title summary status discountClasses
                          codes(first: 1) { nodes { code } }
                        }
                        ... on DiscountCodeBxgy {
                          title summary status discountClasses
                          codes(first: 1) { nodes { code } }
                        }
                        ... on DiscountCodeFreeShipping {
                          title summary status discountClasses
                          codes(first: 1) { nodes { code } }
                        }
                        ... on DiscountCodeApp {
                          title status discountClasses
                          codes(first: 1) { nodes { code } }
                        }
                      }
                    }
                  }
                }
            """,
            variables={},
        )
        nodes = payload["data"]["codeDiscountNodes"]["nodes"]
        options: list[ShopifyDiscountOption] = []
        for node in nodes:
            discount = node.get("codeDiscount") or {}
            codes = (discount.get("codes") or {}).get("nodes") or []
            if discount.get("status") != "ACTIVE" or not codes:
                continue
            options.append(
                ShopifyDiscountOption(
                    id=node["id"],
                    title=discount["title"],
                    code=codes[0]["code"],
                    summary=discount.get("summary") or "",
                    discount_classes=discount.get("discountClasses") or [],
                )
            )
        return options
    except (KeyError, TypeError, ValueError, ShopifyUpstreamError) as exc:
        raise ShopifyUnavailableError("Shopify could not load active discounts") from exc


def free_gift_function_configuration(offer: FreeGiftOffer) -> dict[str, Any]:
    return {
        "id": offer.id,
        "variant_id": offer.variant_id,
        "variant_ids": [gift.variant_id for gift in offer.gift_variants],
        "quantity": offer.quantity,
        "conditions": [
            {
                "condition_type": condition.condition_type,
                "operator": condition.operator,
                "value": condition.value,
                "applicable_on": condition.applicable_on,
                "product_ids": condition.product_ids,
            }
            for condition in offer.conditions
        ],
    }


def free_gift_binding_key(offer_id: str, gift_id: str) -> str:
    return offer_id if gift_id == "primary" else f"{offer_id}:{gift_id}"


def free_gift_product_handle(offer_id: str, gift_id: str = "primary") -> str:
    suffix = offer_id if gift_id == "primary" else f"{offer_id}-{gift_id}"
    return f"{FREE_GIFT_PRODUCT_HANDLE_PREFIX}-{suffix.lower()}"


def parse_inventory_levels(inventory_item: dict[str, Any]) -> tuple[GiftInventoryLevel, ...]:
    levels: list[GiftInventoryLevel] = []
    for level in inventory_item.get("inventoryLevels", {}).get("nodes", []):
        quantities = level.get("quantities", [])
        available = next(
            (
                quantity.get("quantity", 0)
                for quantity in quantities
                if quantity.get("name") == "available"
            ),
            0,
        )
        levels.append(
            GiftInventoryLevel(location_id=level["location"]["id"], available=int(available))
        )
    return tuple(levels)


def parse_gift_variant(variant: dict[str, Any]) -> GiftVariantSnapshot:
    inventory_item = variant["inventoryItem"]
    product = variant.get("product") or {}
    variant_image = variant.get("image") or {}
    featured_media = product.get("featuredMedia") or {}
    featured_image = featured_media.get("image") or {}
    product_title = str(product.get("title") or "")
    return GiftVariantSnapshot(
        variant_id=variant["id"],
        title=str(variant.get("title") or variant["displayName"]),
        price=str(variant["price"]),
        sku=inventory_item.get("sku") or "",
        barcode=variant.get("barcode") or "",
        tracked=bool(inventory_item.get("tracked")),
        inventory_policy=variant.get("inventoryPolicy") or "DENY",
        taxable=bool(variant.get("taxable", True)),
        inventory_item_id=inventory_item["id"],
        inventory_levels=parse_inventory_levels(inventory_item),
        product_title=product_title,
        image_url=str(variant_image.get("url") or featured_image.get("url") or ""),
        image_alt=str(
            variant_image.get("altText") or featured_media.get("alt") or product_title or ""
        ),
    )


def free_gift_product_input(
    *,
    offer: FreeGiftOffer,
    gift_variant: FreeGiftVariant,
    source: GiftVariantSnapshot,
    target_variant_id: str | None,
    copy_inventory: bool,
) -> dict[str, Any]:
    variant_title = source.title or "Default Title"
    variant: dict[str, Any] = {
        "optionValues": [{"optionName": "Title", "name": variant_title}],
        "price": source.price,
        "sku": source.sku if copy_inventory else "",
        "barcode": source.barcode if copy_inventory else "",
        "inventoryItem": {
            "tracked": source.tracked if copy_inventory else False,
        },
        "inventoryPolicy": source.inventory_policy,
        "taxable": source.taxable,
    }
    if target_variant_id:
        variant["id"] = target_variant_id
    if copy_inventory and source.tracked:
        variant["inventoryQuantities"] = [
            {
                "locationId": level.location_id,
                "name": "available",
                "quantity": level.available,
            }
            for level in source.inventory_levels
        ]
    image: dict[str, Any] | None = None
    if source.image_url:
        image = {
            "originalSource": source.image_url,
            "alt": source.image_alt or source.product_title or variant_title,
            "contentType": "IMAGE",
        }
        variant["file"] = image

    product: dict[str, Any] = {
        "title": source.product_title or gift_variant.source_variant_title,
        "handle": free_gift_product_handle(offer.id, gift_variant.id),
        "status": "UNLISTED",
        "productType": "pragma-site-cart gift",
        "tags": ["pragma-site-cart", "free-gift"],
        "productOptions": [{"name": "Title", "position": 1, "values": [{"name": variant_title}]}],
        "variants": [variant],
    }
    if image:
        product["files"] = [image]
    return product


def validated_shopify_result(
    payload: dict[str, Any], field: str, error_message: str
) -> dict[str, Any]:
    top_level_errors = payload.get("errors")
    if top_level_errors:
        details = "; ".join(
            str(error.get("message", error)) if isinstance(error, dict) else str(error)
            for error in top_level_errors
        )
        raise ShopifyUpstreamError(f"{error_message}: {details}")
    try:
        result = payload["data"][field]
        if result["userErrors"]:
            errors = result["userErrors"]
            details = "; ".join(
                str(error.get("message", error)) if isinstance(error, dict) else str(error)
                for error in errors
            )
            raise ShopifyUpstreamError(f"{error_message}: {details}")
        return cast(dict[str, Any], result)
    except (KeyError, TypeError) as exc:
        raise ShopifyUpstreamError(error_message) from exc


def shopify_user_errors_indicate_missing(payload: dict[str, Any], field: str) -> bool:
    try:
        errors = payload["data"][field]["userErrors"]
    except (KeyError, TypeError):
        return False
    if not errors:
        return False
    missing_phrases = ("does not exist", "not found")
    return all(
        isinstance(error, dict)
        and any(phrase in str(error.get("message", "")).lower() for phrase in missing_phrases)
        for error in errors
    )


async def fetch_gift_product_state(
    *,
    shop_domain: str,
    access_token: str,
    source_variant_id: str,
    handle: str,
    client: ShopifyClient,
) -> tuple[GiftVariantSnapshot, GiftProductState | None]:
    payload = await client.graphql(
        shop_domain=shop_domain,
        access_token=access_token,
        query="""
            query GiftInventorySource($sourceVariantId: ID!, $handle: String!) {
              source: productVariant(id: $sourceVariantId) {
                id
                title
                displayName
                barcode
                price
                inventoryPolicy
                taxable
                image { url altText }
                product {
                  title
                  featuredMedia {
                    alt
                    ... on MediaImage { image { url } }
                  }
                }
                inventoryItem {
                  id
                  sku
                  tracked
                  inventoryLevels(first: 250) {
                    nodes {
                      location { id }
                      quantities(names: ["available"]) { name quantity }
                    }
                  }
                }
              }
              target: productByIdentifier(identifier: {handle: $handle}) {
                id
                variants(first: 1) {
                  nodes {
                    id
                    displayName
                    barcode
                    price
                    inventoryPolicy
                    taxable
                    inventoryItem {
                      id
                      sku
                      tracked
                      inventoryLevels(first: 250) {
                        nodes {
                          location { id }
                          quantities(names: ["available"]) { name quantity }
                        }
                      }
                    }
                  }
                }
              }
            }
        """,
        variables={"sourceVariantId": source_variant_id, "handle": handle},
    )
    try:
        if payload.get("errors"):
            raise ShopifyUpstreamError("Shopify rejected the gift inventory query")
        source_node = payload["data"]["source"]
        if source_node is None:
            raise ShopifyUpstreamError("The selected gift source variant no longer exists")
        source = parse_gift_variant(source_node)
        target_node = payload["data"].get("target")
        if target_node is None:
            return source, None
        target_variants = target_node["variants"]["nodes"]
        if not target_variants:
            return source, None
        return source, GiftProductState(
            product_id=target_node["id"],
            variant=parse_gift_variant(target_variants[0]),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise ShopifyUpstreamError("Shopify returned invalid gift inventory data") from exc


async def activate_missing_gift_inventory_levels(
    *,
    shop_domain: str,
    access_token: str,
    source: GiftVariantSnapshot,
    target: GiftVariantSnapshot,
    client: ShopifyClient,
) -> None:
    target_locations = {level.location_id for level in target.inventory_levels}
    for level in source.inventory_levels:
        if level.location_id in target_locations:
            continue
        payload = await client.graphql(
            shop_domain=shop_domain,
            access_token=access_token,
            query="""
                mutation ActivateGiftInventory(
                  $inventoryItemId: ID!,
                  $locationId: ID!,
                  $available: Int,
                  $idempotencyKey: String!
                ) {
                  inventoryActivate(
                    inventoryItemId: $inventoryItemId,
                    locationId: $locationId,
                    available: $available
                  ) @idempotent(key: $idempotencyKey) {
                    inventoryLevel { id }
                    userErrors { field message code }
                  }
                }
            """,
            variables={
                "inventoryItemId": target.inventory_item_id,
                "locationId": level.location_id,
                "available": level.available,
                "idempotencyKey": str(uuid4()),
            },
        )
        validated_shopify_result(
            payload, "inventoryActivate", "Shopify could not activate gift inventory"
        )


async def upsert_gift_product(
    *,
    shop_domain: str,
    access_token: str,
    offer: FreeGiftOffer,
    gift_variant: FreeGiftVariant,
    source: GiftVariantSnapshot,
    target: GiftProductState | None,
    copy_inventory: bool,
    client: ShopifyClient,
) -> GiftProductState:
    if copy_inventory and source.tracked and target is not None:
        await activate_missing_gift_inventory_levels(
            shop_domain=shop_domain,
            access_token=access_token,
            source=source,
            target=target.variant,
            client=client,
        )
    payload = await client.graphql(
        shop_domain=shop_domain,
        access_token=access_token,
        query="""
            mutation UpsertGiftProduct(
              $identifier: ProductSetIdentifiers!,
              $input: ProductSetInput!
            ) {
              productSet(identifier: $identifier, input: $input, synchronous: true) {
                product {
                  id
                  variants(first: 1) {
                    nodes {
                      id
                      displayName
                      barcode
                      price
                      inventoryPolicy
                      taxable
                      inventoryItem {
                        id
                        sku
                        tracked
                        inventoryLevels(first: 250) {
                          nodes {
                            location { id }
                            quantities(names: ["available"]) { name quantity }
                          }
                        }
                      }
                    }
                  }
                }
                userErrors { field message code }
              }
            }
        """,
        variables={
            "identifier": {"handle": free_gift_product_handle(offer.id, gift_variant.id)},
            "input": free_gift_product_input(
                offer=offer,
                gift_variant=gift_variant,
                source=source,
                target_variant_id=target.variant.variant_id if target else None,
                copy_inventory=copy_inventory,
            ),
        },
    )
    result = validated_shopify_result(
        payload, "productSet", "Shopify could not synchronize the gift product"
    )
    try:
        product = result["product"]
        return GiftProductState(
            product_id=product["id"],
            variant=parse_gift_variant(product["variants"]["nodes"][0]),
        )
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise ShopifyUpstreamError("Shopify returned an invalid gift product") from exc


async def online_store_publication_id(
    *, shop_domain: str, access_token: str, client: ShopifyClient
) -> str:
    payload = await client.graphql(
        shop_domain=shop_domain,
        access_token=access_token,
        query="""
            query GiftPublication {
              publications(first: 50) {
                nodes {
                  id
                  channels(first: 10) { nodes { handle name } }
                }
              }
            }
        """,
        variables={},
    )
    try:
        if payload.get("errors"):
            raise ShopifyUpstreamError("Shopify rejected the publication query")
        publications = payload["data"]["publications"]["nodes"]
        publication = next(
            item
            for item in publications
            if any(
                channel["name"].strip().lower() == "online store"
                or channel["handle"].strip().lower() in {"online-store", "online_store"}
                for channel in item["channels"]["nodes"]
            )
        )
        return cast(str, publication["id"])
    except (KeyError, StopIteration, TypeError) as exc:
        raise ShopifyUpstreamError("Shopify Online Store publication is unavailable") from exc


async def publish_gift_product(
    *,
    shop_domain: str,
    access_token: str,
    product_id: str,
    publication_id: str,
    client: ShopifyClient,
) -> None:
    payload = await client.graphql(
        shop_domain=shop_domain,
        access_token=access_token,
        query="""
            mutation PublishGiftProduct($id: ID!, $publicationId: ID!) {
              publishablePublish(
                id: $id,
                input: [{publicationId: $publicationId}]
              ) {
                userErrors { field message }
              }
            }
        """,
        variables={"id": product_id, "publicationId": publication_id},
    )
    validated_shopify_result(
        payload, "publishablePublish", "Shopify could not publish the gift product"
    )


async def archive_gift_product(
    *,
    shop_domain: str,
    access_token: str,
    product_id: str,
    client: ShopifyClient,
) -> None:
    payload = await client.graphql(
        shop_domain=shop_domain,
        access_token=access_token,
        query="""
            mutation ArchiveGiftProduct($product: ProductUpdateInput!) {
              productUpdate(product: $product) {
                product { id }
                userErrors { field message }
              }
            }
        """,
        variables={"product": {"id": product_id, "status": "ARCHIVED"}},
    )
    if not shopify_user_errors_indicate_missing(payload, "productUpdate"):
        validated_shopify_result(
            payload, "productUpdate", "Shopify could not archive the gift product"
        )


def valid_gift_product_bindings(value: object) -> dict[str, dict[str, str]]:
    if not isinstance(value, dict):
        return {}
    bindings: dict[str, dict[str, str]] = {}
    for offer_id, binding in value.items():
        if not isinstance(offer_id, str) or not isinstance(binding, dict):
            continue
        product_id = binding.get("product_id")
        variant_id = binding.get("variant_id")
        source_variant_id = binding.get("source_variant_id")
        if not isinstance(product_id, str) or not isinstance(variant_id, str):
            continue
        if not isinstance(source_variant_id, str):
            continue
        bindings[offer_id] = {
            "product_id": product_id,
            "variant_id": variant_id,
            "source_variant_id": source_variant_id,
        }
    return bindings


async def sync_free_gift_inventory(
    *,
    shop_domain: str,
    configuration: CartFeaturesConfiguration,
    existing_bindings: dict[str, dict[str, str]],
    db: AsyncSession,
    client: ShopifyClient,
    cipher: TokenCipher,
) -> tuple[CartFeaturesConfiguration, dict[str, dict[str, str]]]:
    session = await db.get(ShopSession, shop_domain)
    if session is None or session.app_installation_gid is None:
        return configuration, existing_bindings

    access_token = await get_valid_access_token(
        shop_domain=shop_domain, db=db, client=client, cipher=cipher
    )
    desired_offers = configuration.free_gift_offers if configuration.free_gifts_enabled else []
    desired_binding_keys = {
        free_gift_binding_key(offer.id, gift.id)
        for offer in desired_offers
        for gift in offer.gift_variants
    }
    synchronized_offers: list[FreeGiftOffer] = []
    synchronized_bindings: dict[str, dict[str, str]] = {}

    try:
        for binding_key, binding in existing_bindings.items():
            if binding_key not in desired_binding_keys:
                await archive_gift_product(
                    shop_domain=shop_domain,
                    access_token=access_token,
                    product_id=binding["product_id"],
                    client=client,
                )

        publication_id = (
            await online_store_publication_id(
                shop_domain=shop_domain, access_token=access_token, client=client
            )
            if desired_offers
            else None
        )
        for offer in desired_offers:
            synchronized_gifts: list[FreeGiftVariant] = []
            for gift_option in offer.gift_variants:
                binding_key = free_gift_binding_key(offer.id, gift_option.id)
                source, target = await fetch_gift_product_state(
                    shop_domain=shop_domain,
                    access_token=access_token,
                    source_variant_id=gift_option.source_variant_id,
                    handle=free_gift_product_handle(offer.id, gift_option.id),
                    client=client,
                )
                gift = await upsert_gift_product(
                    shop_domain=shop_domain,
                    access_token=access_token,
                    offer=offer,
                    gift_variant=gift_option,
                    source=source,
                    target=target,
                    copy_inventory=configuration.free_gifts_copy_inventory,
                    client=client,
                )
                await publish_gift_product(
                    shop_domain=shop_domain,
                    access_token=access_token,
                    product_id=gift.product_id,
                    publication_id=cast(str, publication_id),
                    client=client,
                )
                synchronized_gift = gift_option.model_copy(
                    update={
                        "variant_id": gift.variant.variant_id,
                        "variant_title": gift.variant.title,
                    }
                )
                synchronized_gifts.append(synchronized_gift)
                synchronized_bindings[binding_key] = {
                    "product_id": gift.product_id,
                    "variant_id": gift.variant.variant_id,
                    "source_variant_id": gift_option.source_variant_id,
                }
            primary = synchronized_gifts[0]
            synchronized_offers.append(
                offer.model_copy(
                    update={
                        "source_variant_id": primary.source_variant_id,
                        "source_variant_title": primary.source_variant_title,
                        "variant_id": primary.variant_id,
                        "variant_title": primary.variant_title,
                        "gift_variants": synchronized_gifts,
                    }
                )
            )
    except (KeyError, TypeError, ShopifyUpstreamError, httpx.HTTPError) as exc:
        raise ShopifyUnavailableError from exc

    offers = (
        synchronized_offers if configuration.free_gifts_enabled else configuration.free_gift_offers
    )
    return configuration.model_copy(update={"free_gift_offers": offers}), synchronized_bindings


def free_gift_automatic_discount_input(offer: FreeGiftOffer) -> dict[str, Any]:
    return {
        "title": f"pragma-site-cart gift: {offer.title}",
        "functionHandle": FREE_GIFT_FUNCTION_HANDLE,
        "discountClasses": ["PRODUCT"],
        "startsAt": offer.starts_at.isoformat(),
        "endsAt": offer.ends_at.isoformat(),
        "combinesWith": {
            "orderDiscounts": True,
            "productDiscounts": False,
            "shippingDiscounts": True,
        },
        "metafields": [
            {
                "namespace": FREE_GIFT_METAFIELD_NAMESPACE,
                "key": FREE_GIFT_METAFIELD_KEY,
                "type": "json",
                "value": json.dumps(free_gift_function_configuration(offer), separators=(",", ":")),
            }
        ],
    }


def validated_discount_result(payload: dict[str, Any], field: str) -> dict[str, Any]:
    top_level_errors = payload.get("errors")
    if top_level_errors:
        details = "; ".join(
            str(error.get("message", error)) if isinstance(error, dict) else str(error)
            for error in top_level_errors
        )
        raise ShopifyUpstreamError(f"Shopify rejected the free gift discount: {details}")
    try:
        result = payload["data"][field]
        if result["userErrors"]:
            errors = result["userErrors"]
            details = "; ".join(
                str(error.get("message", error)) if isinstance(error, dict) else str(error)
                for error in errors
            )
            raise ShopifyUpstreamError(f"Shopify rejected the free gift discount: {details}")
        return cast(dict[str, Any], result)
    except (KeyError, TypeError) as exc:
        raise ShopifyUpstreamError("Shopify returned an invalid discount response") from exc


async def sync_free_gift_discounts(
    *,
    shop_domain: str,
    configuration: CartFeaturesConfiguration,
    existing_discount_ids: dict[str, str],
    db: AsyncSession,
    client: ShopifyClient,
    cipher: TokenCipher,
) -> dict[str, str]:
    session = await db.get(ShopSession, shop_domain)
    if session is None or session.app_installation_gid is None:
        return existing_discount_ids

    access_token = await get_valid_access_token(
        shop_domain=shop_domain, db=db, client=client, cipher=cipher
    )
    desired_offers = (
        {offer.id: offer for offer in configuration.free_gift_offers}
        if configuration.free_gifts_enabled
        else {}
    )
    synced_ids: dict[str, str] = {}

    try:
        for offer_id, discount_id in existing_discount_ids.items():
            if offer_id in desired_offers:
                continue
            payload = await client.graphql(
                shop_domain=shop_domain,
                access_token=access_token,
                query="""
                    mutation DeleteFreeGiftDiscount($id: ID!) {
                      discountAutomaticDelete(id: $id) {
                        deletedAutomaticDiscountId
                        userErrors { field message code }
                      }
                    }
                """,
                variables={"id": discount_id},
            )
            if not shopify_user_errors_indicate_missing(payload, "discountAutomaticDelete"):
                validated_discount_result(payload, "discountAutomaticDelete")

        for offer_id, offer in desired_offers.items():
            automatic_discount = free_gift_automatic_discount_input(offer)
            existing_id = existing_discount_ids.get(offer_id)
            if existing_id:
                payload = await client.graphql(
                    shop_domain=shop_domain,
                    access_token=access_token,
                    query="""
                        mutation UpdateFreeGiftDiscount(
                          $id: ID!,
                          $automaticAppDiscount: DiscountAutomaticAppInput!
                        ) {
                          discountAutomaticAppUpdate(
                            id: $id,
                            automaticAppDiscount: $automaticAppDiscount
                          ) {
                            automaticAppDiscount { discountId }
                            userErrors { field message code }
                          }
                        }
                    """,
                    variables={
                        "id": existing_id,
                        "automaticAppDiscount": automatic_discount,
                    },
                )
                result = validated_discount_result(payload, "discountAutomaticAppUpdate")
            else:
                payload = await client.graphql(
                    shop_domain=shop_domain,
                    access_token=access_token,
                    query="""
                        mutation CreateFreeGiftDiscount(
                          $automaticAppDiscount: DiscountAutomaticAppInput!
                        ) {
                          discountAutomaticAppCreate(
                            automaticAppDiscount: $automaticAppDiscount
                          ) {
                            automaticAppDiscount { discountId }
                            userErrors { field message code }
                          }
                        }
                    """,
                    variables={"automaticAppDiscount": automatic_discount},
                )
                result = validated_discount_result(payload, "discountAutomaticAppCreate")
            synced_ids[offer_id] = result["automaticAppDiscount"]["discountId"]
    except (KeyError, TypeError, ShopifyUpstreamError, httpx.HTTPError) as exc:
        raise ShopifyUnavailableError from exc

    return synced_ids


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
