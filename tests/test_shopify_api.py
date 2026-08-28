from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import httpx
import jwt
import pytest

import shopify_app.services.shopify as shopify_service
from shopify_app.config import Settings
from shopify_app.schemas import (
    CartAppearanceConfiguration,
    CartFeaturesConfiguration,
    ShopifyInstallationIdentity,
    TokenExchangeResponse,
)
from shopify_app.services.shopify import (
    GiftInventoryLevel,
    GiftVariantSnapshot,
    free_gift_automatic_discount_input,
    free_gift_product_input,
)
from shopify_app.shopify_client import ShopifyClient


def make_session_token(settings: Settings, shop_domain: str = "example-shop.myshopify.com") -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "aud": settings.shopify_client_id,
            "dest": f"https://{shop_domain}",
            "sub": "42",
            "iat": now,
            "nbf": now - timedelta(seconds=1),
            "exp": now + timedelta(minutes=1),
        },
        settings.shopify_client_secret.get_secret_value(),
        algorithm="HS256",
    )


async def test_token_exchange_then_me(
    client: httpx.AsyncClient, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def fake_exchange(
        self: ShopifyClient, *, shop_domain: str, session_token: str
    ) -> TokenExchangeResponse:
        assert shop_domain == "example-shop.myshopify.com"
        assert session_token
        return TokenExchangeResponse(
            access_token="shpat_test",
            scope="read_products",
            expires_in=3600,
            refresh_token="shprt_test",
            refresh_token_expires_in=7_776_000,
        )

    async def fake_identity(
        self: ShopifyClient, *, shop_domain: str, access_token: str
    ) -> ShopifyInstallationIdentity:
        assert shop_domain == "example-shop.myshopify.com"
        assert access_token == "shpat_test"
        return ShopifyInstallationIdentity(
            shop_gid="gid://shopify/Shop/42",
            app_installation_gid="gid://shopify/AppInstallation/84",
        )

    monkeypatch.setattr(ShopifyClient, "exchange_session_token", fake_exchange)
    monkeypatch.setattr(ShopifyClient, "get_installation_identity", fake_identity)
    headers = {"Authorization": f"Bearer {make_session_token(settings)}"}

    exchange_response = await client.post("/api/v1/shopify/token-exchange", headers=headers)
    assert exchange_response.status_code == 200
    assert exchange_response.json() == {
        "shop_domain": "example-shop.myshopify.com",
        "scopes": ["read_products"],
        "expires_in": 3600,
    }

    me_response = await client.get("/api/v1/shopify/me", headers=headers)
    assert me_response.status_code == 200
    assert me_response.json() == {
        "shop_domain": "example-shop.myshopify.com",
        "connected": True,
        "scopes": ["read_products"],
        "onboarding_completed": False,
    }


async def test_me_is_isolated_to_authenticated_shop(
    client: httpx.AsyncClient, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def fake_exchange(
        self: ShopifyClient, *, shop_domain: str, session_token: str
    ) -> TokenExchangeResponse:
        return TokenExchangeResponse(
            access_token=f"token-{shop_domain}",
            scope="read_products",
            expires_in=3600,
            refresh_token=f"refresh-{shop_domain}",
            refresh_token_expires_in=7_776_000,
        )

    async def fake_identity(
        self: ShopifyClient, *, shop_domain: str, access_token: str
    ) -> ShopifyInstallationIdentity:
        assert access_token == f"token-{shop_domain}"
        return ShopifyInstallationIdentity(
            shop_gid=f"gid://shopify/Shop/{shop_domain}",
            app_installation_gid=f"gid://shopify/AppInstallation/{shop_domain}",
        )

    monkeypatch.setattr(ShopifyClient, "exchange_session_token", fake_exchange)
    monkeypatch.setattr(ShopifyClient, "get_installation_identity", fake_identity)
    first_token = make_session_token(settings, "first.myshopify.com")
    first_headers = {"Authorization": f"Bearer {first_token}"}
    second_headers = {
        "Authorization": f"Bearer {make_session_token(settings, 'second.myshopify.com')}"
    }
    first = await client.post("/api/v1/shopify/token-exchange", headers=first_headers)
    second = await client.post("/api/v1/shopify/token-exchange", headers=second_headers)
    assert first.status_code == 200
    assert second.status_code == 200

    response = await client.get(
        "/api/v1/shopify/me?shop=first.myshopify.com", headers=second_headers
    )
    assert response.status_code == 200
    assert response.json()["shop_domain"] == "second.myshopify.com"


async def test_shopify_endpoint_requires_session_token(client: httpx.AsyncClient) -> None:
    response = await client.post("/api/v1/shopify/token-exchange")
    assert response.status_code == 401


async def test_me_requires_token_exchange(client: httpx.AsyncClient, settings: Settings) -> None:
    headers = {"Authorization": f"Bearer {make_session_token(settings)}"}
    response = await client.get("/api/v1/shopify/me", headers=headers)
    assert response.status_code == 409


async def test_public_graphql_proxy_is_not_exposed(client: httpx.AsyncClient) -> None:
    response = await client.post("/api/v1/shopify/graphql", json={"query": "query { shop { id } }"})
    assert response.status_code == 404


async def test_cart_appearance_defaults_and_persists_per_shop(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    first_headers = {"Authorization": f"Bearer {make_session_token(settings)}"}
    default_response = await client.get("/api/v1/shopify/appearance", headers=first_headers)
    assert default_response.status_code == 200
    configuration = default_response.json()
    assert configuration["theme_color"] == "#F10A0A"
    assert configuration["advanced_conditions"] is False
    assert configuration["add_to_cart_behavior"] == "nothing"
    assert configuration["confirmation_background"] == "#202124"
    assert configuration["confirmation_text_color"] == "#FFFFFF"
    assert configuration["scarcity_timer_type"] == "urgency"
    assert configuration["scarcity_timer_title"]["text"] == "Your cart is reserved for"
    assert configuration["scarcity_timer_started_at"] is None
    assert configuration["scarcity_sale_starts_at"] is None
    assert configuration["scarcity_sale_ends_at"] is None
    assert configuration["block_cart_page_redirection"] is True
    assert configuration["checkout_on_cart_enabled"] is True
    assert configuration["checkout_guest_checkout_enabled"] is False
    assert configuration["checkout_login_banner_enabled"] is True
    assert configuration["checkout_login_banner_text"] == (
        "Log in to use saved addresses and checkout faster."
    )
    assert configuration["checkout_personalisation_message"] == "Welcome back, {first_name}"
    assert configuration["checkout_address_placement"] == "top"
    assert configuration["variant_selection_enabled"] is True
    assert configuration["updated_at"] is None

    configuration.pop("updated_at")
    configuration["theme_color"] = "#146B4A"
    configuration["empty_title"] = "Nothing here yet"
    configuration["add_to_cart_behavior"] = "confirmation"
    configuration["confirmation_background"] = "#146B4A"
    configuration["confirmation_text_color"] = "#FFF9E8"
    configuration["custom_cart_icon_selectors"] = [".header-cart"]
    configuration["checkout_guest_checkout_enabled"] = True
    configuration["checkout_address_placement"] = "bottom"
    saved_response = await client.put(
        "/api/v1/shopify/appearance", headers=first_headers, json=configuration
    )
    assert saved_response.status_code == 200
    assert saved_response.json()["theme_color"] == "#146B4A"
    assert saved_response.json()["updated_at"] is not None

    reloaded = await client.get("/api/v1/shopify/appearance", headers=first_headers)
    assert reloaded.json()["empty_title"] == "Nothing here yet"
    assert reloaded.json()["add_to_cart_behavior"] == "confirmation"
    assert reloaded.json()["confirmation_background"] == "#146B4A"
    assert reloaded.json()["confirmation_text_color"] == "#FFF9E8"
    assert reloaded.json()["custom_cart_icon_selectors"] == [".header-cart"]
    assert reloaded.json()["checkout_guest_checkout_enabled"] is True
    assert reloaded.json()["checkout_address_placement"] == "bottom"

    second_headers = {
        "Authorization": f"Bearer {make_session_token(settings, 'second.myshopify.com')}"
    }
    second_shop = await client.get("/api/v1/shopify/appearance", headers=second_headers)
    assert second_shop.json()["theme_color"] == "#F10A0A"


async def test_cart_appearance_rejects_invalid_configuration(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    headers = {"Authorization": f"Bearer {make_session_token(settings)}"}
    configuration = (await client.get("/api/v1/shopify/appearance", headers=headers)).json()
    configuration.pop("updated_at")
    configuration["theme_color"] = "red"

    response = await client.put("/api/v1/shopify/appearance", headers=headers, json=configuration)
    assert response.status_code == 422


async def test_cart_appearance_rejects_conflicting_banner_modes(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    headers = {"Authorization": f"Bearer {make_session_token(settings)}"}
    configuration = (await client.get("/api/v1/shopify/appearance", headers=headers)).json()
    configuration.pop("updated_at")
    configuration["dynamic_banners"] = True
    configuration["advanced_conditions"] = True

    response = await client.put("/api/v1/shopify/appearance", headers=headers, json=configuration)
    assert response.status_code == 422


async def test_cart_appearance_publishes_sales_period_and_rejects_invalid_range(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    headers = {"Authorization": f"Bearer {make_session_token(settings)}"}
    configuration = (await client.get("/api/v1/shopify/appearance", headers=headers)).json()
    configuration.pop("updated_at")
    configuration.update(
        {
            "scarcity_timer_enabled": True,
            "scarcity_timer_type": "sales",
            "scarcity_sale_starts_at": "2026-08-25T12:30:00Z",
            "scarcity_sale_ends_at": "2026-08-26T12:30:00Z",
        }
    )

    saved = await client.put("/api/v1/shopify/appearance", headers=headers, json=configuration)
    assert saved.status_code == 200
    assert saved.json()["scarcity_sale_starts_at"] == "2026-08-25T12:30:00Z"
    assert saved.json()["scarcity_sale_ends_at"] == "2026-08-26T12:30:00Z"

    configuration["scarcity_sale_ends_at"] = configuration["scarcity_sale_starts_at"]
    invalid = await client.put("/api/v1/shopify/appearance", headers=headers, json=configuration)
    assert invalid.status_code == 422


async def test_cart_features_persist_and_survive_appearance_saves(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    headers = {"Authorization": f"Bearer {make_session_token(settings)}"}
    feature_response = await client.get("/api/v1/shopify/features", headers=headers)
    assert feature_response.status_code == 200
    features = feature_response.json()
    assert features["discount_mode"] == "discount_box"
    assert features["order_notes_enabled"] is True
    assert features["free_gift_offers"] == []
    assert features["tiered_applicable_ids"] == []

    features.pop("updated_at")
    features["discount_mode"] = "hide"
    features["order_notes_title"] = "Delivery instructions"
    features["tiered_applicable_on"] = "products"
    features["tiered_applicable_ids"] = ["gid://shopify/Product/100"]
    features["tiered_applicable_titles"] = ["Snowboard"]
    features["tiered_applicable_product_ids"] = [["gid://shopify/Product/100"]]
    saved_features = await client.put("/api/v1/shopify/features", headers=headers, json=features)
    assert saved_features.status_code == 200
    assert saved_features.json()["order_notes_title"] == "Delivery instructions"
    assert saved_features.json()["tiered_applicable_titles"] == ["Snowboard"]

    appearance = (await client.get("/api/v1/shopify/appearance", headers=headers)).json()
    appearance.pop("updated_at")
    appearance["theme_color"] = "#135E46"
    saved_appearance = await client.put(
        "/api/v1/shopify/appearance", headers=headers, json=appearance
    )
    assert saved_appearance.status_code == 200

    reloaded = await client.get("/api/v1/shopify/features", headers=headers)
    assert reloaded.status_code == 200
    assert reloaded.json()["discount_mode"] == "hide"
    assert reloaded.json()["order_notes_title"] == "Delivery instructions"
    assert reloaded.json()["tiered_applicable_product_ids"] == [
        ["gid://shopify/Product/100"]
    ]


async def test_cart_features_validate_enabled_campaigns(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    headers = {"Authorization": f"Bearer {make_session_token(settings)}"}
    features = (await client.get("/api/v1/shopify/features", headers=headers)).json()
    features.pop("updated_at")
    features["free_gifts_enabled"] = True

    invalid_gifts = await client.put("/api/v1/shopify/features", headers=headers, json=features)
    assert invalid_gifts.status_code == 422

    features["free_gifts_enabled"] = False
    features["one_tick_enabled"] = True
    invalid_one_tick = await client.put("/api/v1/shopify/features", headers=headers, json=features)
    assert invalid_one_tick.status_code == 422


async def test_cart_upsell_persists_and_validates_rules(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    headers = {"Authorization": f"Bearer {make_session_token(settings)}"}
    response = await client.get("/api/v1/shopify/upsell", headers=headers)
    assert response.status_code == 200
    upsell = response.json()
    assert upsell["upsell_enabled"] is False
    assert upsell["upsell_ai_preference"] == "complementary"
    assert upsell["upsell_max_quantity"] == 1

    upsell.pop("updated_at")
    upsell.update(
        {
            "upsell_enabled": True,
            "upsell_ai_enabled": False,
            "upsell_rules": [
                {
                    "id": "snowboard_rule",
                    "title": {"text": "Complete the set", "bold": True},
                    "product_count": 3,
                    "background_color": "#FFFFFF",
                    "text_color": "#202124",
                    "applicable_on": "products",
                    "trigger_ids": ["gid://shopify/Product/100"],
                    "trigger_titles": ["Snowboard"],
                    "trigger_product_ids": [["gid://shopify/Product/100"]],
                    "recommendations": [
                        {
                            "variant_id": "gid://shopify/ProductVariant/201",
                            "variant_title": "Black",
                            "product_id": "gid://shopify/Product/200",
                            "product_title": "Snowboard bag",
                            "product_handle": "snowboard-bag",
                            "image_url": "",
                            "price": "49.00",
                        }
                    ],
                }
            ],
        }
    )
    saved = await client.put("/api/v1/shopify/upsell", headers=headers, json=upsell)
    assert saved.status_code == 200
    assert saved.json()["upsell_rules"][0]["title"]["text"] == "Complete the set"

    reloaded = await client.get("/api/v1/shopify/upsell", headers=headers)
    assert reloaded.json()["upsell_rules"][0]["recommendations"][0]["product_handle"] == (
        "snowboard-bag"
    )

    upsell["upsell_rules"][0]["recommendations"] = []
    invalid = await client.put("/api/v1/shopify/upsell", headers=headers, json=upsell)
    assert invalid.status_code == 422


async def test_cart_upsell_requires_an_enabled_recommendation_source(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    headers = {"Authorization": f"Bearer {make_session_token(settings)}"}
    upsell = (await client.get("/api/v1/shopify/upsell", headers=headers)).json()
    upsell.pop("updated_at")
    upsell["upsell_enabled"] = True
    upsell["upsell_ai_enabled"] = False

    response = await client.put("/api/v1/shopify/upsell", headers=headers, json=upsell)
    assert response.status_code == 422


async def test_free_gift_offer_conditions_persist(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    headers = {"Authorization": f"Bearer {make_session_token(settings)}"}
    features = (await client.get("/api/v1/shopify/features", headers=headers)).json()
    features.pop("updated_at")
    now = datetime.now(UTC)
    features.update(
        {
            "free_gifts_enabled": True,
            "free_gift_method": "choice",
            "free_gift_offers": [
                {
                    "id": "gift_offer",
                    "title": "Choose a gift",
                    "starts_at": now.isoformat(),
                    "ends_at": (now + timedelta(days=7)).isoformat(),
                    "variant_id": "gid://shopify/ProductVariant/123",
                    "variant_title": "Gift / Default",
                    "eligibility_type": "cart_quantity",
                    "threshold": 2,
                    "quantity": 2,
                    "re_add_each_time": True,
                    "conditions": [
                        {
                            "id": "gift_condition",
                            "condition_type": "cart_quantity",
                            "operator": "greater_than",
                            "value": 1,
                            "applicable_on": "products",
                            "product_ids": ["gid://shopify/Product/456"],
                            "product_titles": ["Snowboard"],
                        }
                    ],
                }
            ],
        }
    )

    saved = await client.put("/api/v1/shopify/features", headers=headers, json=features)

    assert saved.status_code == 200
    offer = saved.json()["free_gift_offers"][0]
    assert offer["quantity"] == 2
    assert offer["re_add_each_time"] is True
    assert offer["gift_variants"][0]["source_variant_id"] == ("gid://shopify/ProductVariant/123")
    assert offer["conditions"][0]["product_titles"] == ["Snowboard"]


def test_legacy_free_gift_offer_migrates_to_condition() -> None:
    now = datetime.now(UTC)
    configuration = CartFeaturesConfiguration.model_validate(
        {
            "free_gifts_enabled": True,
            "free_gift_offers": [
                {
                    "id": "legacy_gift",
                    "title": "Legacy gift",
                    "starts_at": now,
                    "ends_at": now + timedelta(days=1),
                    "variant_id": "gid://shopify/ProductVariant/123",
                    "variant_title": "Gift / Default",
                    "eligibility_type": "cart_subtotal",
                    "threshold": 999,
                }
            ],
        }
    )

    condition = configuration.free_gift_offers[0].conditions[0]
    assert configuration.free_gift_offers[0].source_variant_id == (
        "gid://shopify/ProductVariant/123"
    )
    assert configuration.free_gift_offers[0].source_variant_title == "Gift / Default"
    assert configuration.free_gift_offers[0].gift_variants[0].id == "primary"
    assert condition.condition_type == "cart_subtotal"
    assert condition.operator == "greater_than_or_equal"
    assert condition.value == 999


def test_free_gift_discount_input_enforces_checkout_configuration() -> None:
    now = datetime.now(UTC)
    configuration = CartFeaturesConfiguration.model_validate(
        {
            "free_gifts_enabled": True,
            "free_gift_offers": [
                {
                    "id": "checkout_gift",
                    "title": "Checkout gift",
                    "starts_at": now,
                    "ends_at": now + timedelta(days=2),
                    "variant_id": "gid://shopify/ProductVariant/123",
                    "variant_title": "Gift / Default",
                    "quantity": 2,
                    "conditions": [
                        {
                            "id": "minimum_cart",
                            "condition_type": "cart_subtotal",
                            "operator": "greater_than_or_equal",
                            "value": 500,
                        }
                    ],
                }
            ],
        }
    )

    discount = free_gift_automatic_discount_input(configuration.free_gift_offers[0])
    function_configuration = json.loads(discount["metafields"][0]["value"])

    assert discount["functionHandle"] == "free-gift-discount"
    assert discount["discountClasses"] == ["PRODUCT"]
    assert discount["startsAt"] == now.isoformat()
    assert function_configuration["variant_id"] == "gid://shopify/ProductVariant/123"
    assert function_configuration["variant_ids"] == ["gid://shopify/ProductVariant/123"]
    assert function_configuration["quantity"] == 2
    assert function_configuration["conditions"][0]["value"] == 500


def test_free_gift_offer_supports_multiple_choice_variants() -> None:
    now = datetime.now(UTC)
    configuration = CartFeaturesConfiguration.model_validate(
        {
            "free_gifts_enabled": True,
            "free_gift_method": "choice",
            "free_gift_offers": [
                {
                    "id": "choice_gift",
                    "title": "Choose a gift",
                    "starts_at": now,
                    "ends_at": now + timedelta(days=2),
                    "gift_variants": [
                        {
                            "id": "gift_one",
                            "source_variant_id": "gid://shopify/ProductVariant/111",
                            "source_variant_title": "Gift one",
                            "variant_id": "gid://shopify/ProductVariant/911",
                            "variant_title": "Generated gift one",
                        },
                        {
                            "id": "gift_two",
                            "source_variant_id": "gid://shopify/ProductVariant/222",
                            "source_variant_title": "Gift two",
                            "variant_id": "gid://shopify/ProductVariant/922",
                            "variant_title": "Generated gift two",
                        },
                    ],
                }
            ],
        }
    )
    offer = configuration.free_gift_offers[0]
    function_configuration = json.loads(
        free_gift_automatic_discount_input(offer)["metafields"][0]["value"]
    )

    assert offer.source_variant_id == "gid://shopify/ProductVariant/111"
    assert offer.variant_id == "gid://shopify/ProductVariant/911"
    assert function_configuration["variant_ids"] == [
        "gid://shopify/ProductVariant/911",
        "gid://shopify/ProductVariant/922",
    ]


def test_free_gift_product_input_copies_inventory_to_dedicated_variant() -> None:
    now = datetime.now(UTC)
    offer = CartFeaturesConfiguration.model_validate(
        {
            "free_gifts_enabled": True,
            "free_gift_offers": [
                {
                    "id": "inventory_gift",
                    "title": "Inventory gift",
                    "starts_at": now,
                    "ends_at": now + timedelta(days=1),
                    "variant_id": "gid://shopify/ProductVariant/123",
                    "variant_title": "Source gift",
                }
            ],
        }
    ).free_gift_offers[0]
    source = GiftVariantSnapshot(
        variant_id="gid://shopify/ProductVariant/123",
        title="Source gift",
        price="749.95",
        sku="SOURCE-SKU",
        barcode="123456789",
        tracked=True,
        inventory_policy="DENY",
        taxable=True,
        inventory_item_id="gid://shopify/InventoryItem/456",
        inventory_levels=(GiftInventoryLevel(location_id="gid://shopify/Location/1", available=8),),
    )

    product = free_gift_product_input(
        offer=offer,
        gift_variant=offer.gift_variants[0],
        source=source,
        target_variant_id="gid://shopify/ProductVariant/999",
        copy_inventory=True,
    )
    variant = product["variants"][0]

    assert product["status"] == "UNLISTED"
    assert variant["id"] == "gid://shopify/ProductVariant/999"
    assert variant["sku"] == "SOURCE-SKU"
    assert variant["barcode"] == "123456789"
    assert variant["inventoryItem"]["tracked"] is True
    assert variant["inventoryQuantities"] == [
        {
            "locationId": "gid://shopify/Location/1",
            "name": "available",
            "quantity": 8,
        }
    ]


def test_free_gift_product_input_does_not_copy_inventory_when_disabled() -> None:
    now = datetime.now(UTC)
    offer = CartFeaturesConfiguration.model_validate(
        {
            "free_gifts_enabled": True,
            "free_gift_offers": [
                {
                    "id": "standalone_gift",
                    "title": "Standalone gift",
                    "starts_at": now,
                    "ends_at": now + timedelta(days=1),
                    "variant_id": "gid://shopify/ProductVariant/123",
                    "variant_title": "Source gift",
                }
            ],
        }
    ).free_gift_offers[0]
    source = GiftVariantSnapshot(
        variant_id="gid://shopify/ProductVariant/123",
        title="Source gift",
        price="100.00",
        sku="DO-NOT-COPY",
        barcode="987654321",
        tracked=True,
        inventory_policy="CONTINUE",
        taxable=False,
        inventory_item_id="gid://shopify/InventoryItem/456",
        inventory_levels=(GiftInventoryLevel(location_id="gid://shopify/Location/1", available=4),),
    )

    product = free_gift_product_input(
        offer=offer,
        gift_variant=offer.gift_variants[0],
        source=source,
        target_variant_id=None,
        copy_inventory=False,
    )
    variant = product["variants"][0]

    assert variant["sku"] == ""
    assert variant["barcode"] == ""
    assert variant["inventoryItem"]["tracked"] is False
    assert "inventoryQuantities" not in variant


async def test_free_gift_inventory_sync_uses_a_dedicated_variant(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = datetime.now(UTC)
    configuration = CartFeaturesConfiguration.model_validate(
        {
            "free_gifts_enabled": True,
            "free_gifts_copy_inventory": True,
            "free_gift_offers": [
                {
                    "id": "synced_gift",
                    "title": "Synced gift",
                    "starts_at": now,
                    "ends_at": now + timedelta(days=1),
                    "variant_id": "gid://shopify/ProductVariant/123",
                    "variant_title": "Catalog source",
                }
            ],
        }
    )

    async def fake_access_token(**_: object) -> str:
        return "access-token"

    monkeypatch.setattr(shopify_service, "get_valid_access_token", fake_access_token)

    class FakeDb:
        async def get(self, *_: object) -> object:
            return type("Session", (), {"app_installation_gid": "gid://shopify/App/1"})()

    class FakeShopifyClient:
        def __init__(self) -> None:
            self.product_input: dict[str, object] | None = None
            self.published_product_id: str | None = None

        async def graphql(self, **request: object) -> dict[str, object]:
            query = str(request["query"])
            variables = request["variables"]
            assert isinstance(variables, dict)
            if "GiftPublication" in query:
                return {
                    "data": {
                        "publications": {
                            "nodes": [
                                {
                                    "id": "gid://shopify/Publication/1",
                                    "channels": {
                                        "nodes": [
                                            {"handle": "online-store", "name": "Online Store"}
                                        ]
                                    },
                                }
                            ]
                        }
                    }
                }
            if "GiftInventorySource" in query:
                return {
                    "data": {
                        "source": {
                            "id": "gid://shopify/ProductVariant/123",
                            "displayName": "Catalog source",
                            "barcode": "SOURCE-BARCODE",
                            "price": "25.00",
                            "inventoryPolicy": "DENY",
                            "taxable": True,
                            "inventoryItem": {
                                "id": "gid://shopify/InventoryItem/123",
                                "sku": "SOURCE-SKU",
                                "tracked": True,
                                "inventoryLevels": {
                                    "nodes": [
                                        {
                                            "location": {"id": "gid://shopify/Location/1"},
                                            "quantities": [{"name": "available", "quantity": 6}],
                                        }
                                    ]
                                },
                            },
                        },
                        "target": None,
                    }
                }
            if "UpsertGiftProduct" in query:
                self.product_input = variables["input"]
                return {
                    "data": {
                        "productSet": {
                            "product": {
                                "id": "gid://shopify/Product/999",
                                "variants": {
                                    "nodes": [
                                        {
                                            "id": "gid://shopify/ProductVariant/999",
                                            "displayName": "pragma-site-cart gift - Synced gift",
                                            "barcode": "SOURCE-BARCODE",
                                            "price": "25.00",
                                            "inventoryPolicy": "DENY",
                                            "taxable": True,
                                            "inventoryItem": {
                                                "id": "gid://shopify/InventoryItem/999",
                                                "sku": "SOURCE-SKU",
                                                "tracked": True,
                                                "inventoryLevels": {"nodes": []},
                                            },
                                        }
                                    ]
                                },
                            },
                            "userErrors": [],
                        }
                    }
                }
            if "PublishGiftProduct" in query:
                self.published_product_id = str(variables["id"])
                return {"data": {"publishablePublish": {"userErrors": []}}}
            raise AssertionError(f"Unexpected GraphQL operation: {query}")

    fake_client = FakeShopifyClient()
    synchronized, bindings = await shopify_service.sync_free_gift_inventory(
        shop_domain="example-shop.myshopify.com",
        configuration=configuration,
        existing_bindings={},
        db=FakeDb(),  # type: ignore[arg-type]
        client=fake_client,  # type: ignore[arg-type]
        cipher=object(),  # type: ignore[arg-type]
    )
    offer = synchronized.free_gift_offers[0]

    assert offer.source_variant_id == "gid://shopify/ProductVariant/123"
    assert offer.variant_id == "gid://shopify/ProductVariant/999"
    assert fake_client.published_product_id == "gid://shopify/Product/999"
    assert fake_client.product_input is not None
    assert fake_client.product_input["variants"][0]["sku"] == "SOURCE-SKU"  # type: ignore[index]
    assert bindings["synced_gift"]["product_id"] == "gid://shopify/Product/999"


def test_cart_appearance_migrates_legacy_scarcity_text() -> None:
    configuration = {
        **CartAppearanceConfiguration.model_validate(
            {
                "banners": [
                    {
                        "id": "welcome",
                        "title": {"text": "Welcome"},
                        "subtext": {"text": ""},
                    }
                ],
                "checkout_text": {"text": "Checkout"},
                "checkout_subtext": {"text": ""},
                "footer_text": {"text": "Secure"},
            }
        ).model_dump(mode="json"),
        "scarcity_timer_text": "Complete checkout in {time}",
    }
    configuration.pop("scarcity_timer_title")

    migrated = CartAppearanceConfiguration.model_validate(configuration)

    assert migrated.scarcity_timer_title.text == "Complete checkout in"


def test_cart_appearance_migrates_legacy_sales_timer_period() -> None:
    configuration = CartAppearanceConfiguration.model_validate(
        {
            "banners": [
                {
                    "id": "welcome",
                    "title": {"text": "Welcome"},
                    "subtext": {"text": ""},
                }
            ],
            "checkout_text": {"text": "Checkout"},
            "checkout_subtext": {"text": ""},
            "footer_text": {"text": "Secure"},
            "scarcity_timer_enabled": True,
            "scarcity_timer_type": "sales",
            "scarcity_timer_started_at": "2026-08-25T12:30:00Z",
            "scarcity_timer_minutes": 30,
        }
    )

    migrated_start = configuration.scarcity_sale_starts_at
    migrated_end = configuration.scarcity_sale_ends_at
    assert migrated_start is not None
    assert migrated_end is not None
    assert int((migrated_end - migrated_start).total_seconds()) == 1800


async def test_cart_settings_reject_invalid_selectors_and_incomplete_quantity_limit(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    headers = {"Authorization": f"Bearer {make_session_token(settings)}"}
    configuration = (await client.get("/api/v1/shopify/appearance", headers=headers)).json()
    configuration.pop("updated_at")
    configuration["custom_cart_icon_selectors"] = [".cart { display: none; }"]

    invalid_selector = await client.put(
        "/api/v1/shopify/appearance", headers=headers, json=configuration
    )
    assert invalid_selector.status_code == 422

    configuration["custom_cart_icon_selectors"] = []
    configuration["product_quantity_limit_enabled"] = True
    configuration["quantity_limit_variant_id"] = None
    incomplete_limit = await client.put(
        "/api/v1/shopify/appearance", headers=headers, json=configuration
    )
    assert incomplete_limit.status_code == 422


async def test_cart_appearance_persists_advanced_banner_conditions(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    headers = {"Authorization": f"Bearer {make_session_token(settings)}"}
    configuration = (await client.get("/api/v1/shopify/appearance", headers=headers)).json()
    configuration.pop("updated_at")
    configuration["dynamic_banners"] = False
    configuration["advanced_conditions"] = True
    configuration["banners"][0]["conditions"] = [
        {
            "id": "minimum-cart",
            "type": "cart_quantity",
            "operator": "greater_than",
            "value": "2",
        }
    ]

    response = await client.put("/api/v1/shopify/appearance", headers=headers, json=configuration)
    assert response.status_code == 200
    assert response.json()["banners"][0]["conditions"][0]["value"] == "2"
