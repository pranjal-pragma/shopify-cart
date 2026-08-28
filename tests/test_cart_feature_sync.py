from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from shopify_app.controllers.shopify import (
    align_tiered_gift_offers,
    free_gift_configuration_changed,
    validated_cart_features_section,
    validated_cart_upsell_section,
)
from shopify_app.schemas import CartFeaturesConfiguration, CartUpsellConfiguration
from shopify_app.services.shopify import (
    GiftVariantSnapshot,
    archive_gift_product,
    enriched_upsell_configuration,
    free_gift_product_input,
    list_active_discounts,
    publish_gift_product,
    shopify_user_errors_indicate_missing,
    sync_free_gift_inventory,
    validated_shopify_result,
)
from shopify_app.shopify_client import ShopifyUpstreamError


def test_regular_feature_changes_do_not_trigger_free_gift_sync() -> None:
    previous = CartFeaturesConfiguration()
    current = previous.model_copy(update={"order_notes_title": "Delivery instructions"})

    assert free_gift_configuration_changed(previous, current) is False


def test_legacy_tier_scope_without_resources_migrates_to_all_products() -> None:
    configuration = validated_cart_features_section(
        {"tiered_applicable_on": "collections"}
    )

    assert configuration.tiered_applicable_on == "all"
    assert configuration.tiered_applicable_ids == []


def test_upsell_recommendations_are_enriched_with_product_metadata() -> None:
    configuration = CartUpsellConfiguration.model_validate(
        {
            "upsell_enabled": True,
            "upsell_ai_enabled": False,
            "upsell_rules": [
                {
                    "id": "wax",
                    "recommendations": [
                        {
                            "variant_id": "gid://shopify/ProductVariant/202",
                            "variant_title": "Wax - Old title",
                            "product_id": "gid://shopify/Product/101",
                            "product_title": "Product",
                        }
                    ],
                }
            ],
        }
    )
    enriched = enriched_upsell_configuration(
        configuration,
        [
            {
                "id": "gid://shopify/ProductVariant/202",
                "displayName": "Ski Wax - Special",
                "price": "49.95",
                "image": {"url": "https://cdn.example.com/wax.png"},
                "product": {
                    "id": "gid://shopify/Product/101",
                    "title": "Ski Wax",
                    "handle": "ski-wax",
                    "featuredImage": {"url": "https://cdn.example.com/product.png"},
                },
            }
        ],
    )
    recommendation = enriched.upsell_rules[0].recommendations[0]
    assert recommendation.product_title == "Ski Wax"
    assert recommendation.product_handle == "ski-wax"
    assert recommendation.variant_title == "Ski Wax - Special"
    assert recommendation.image_url == "https://cdn.example.com/wax.png"
    assert recommendation.price == "49.95"


def test_legacy_sku_upsell_without_rules_migrates_to_disabled() -> None:
    configuration = validated_cart_features_section({"one_tick_sku_enabled": True})

    assert configuration.one_tick_sku_enabled is False
    assert configuration.one_tick_sku_rules == []


def test_legacy_product_upsell_snapshots_migrate_per_trigger() -> None:
    configuration = validated_cart_upsell_section(
        {
            "upsell_rules": [
                {
                    "id": "snowboards",
                    "title": {"text": "Complete the set"},
                    "applicable_on": "products",
                    "trigger_ids": [
                        "gid://shopify/Product/101",
                        "gid://shopify/Product/202",
                    ],
                    "trigger_titles": ["Small board", "Large board"],
                    "trigger_product_ids": [],
                    "recommendations": [
                        {
                            "variant_id": "gid://shopify/ProductVariant/303",
                            "variant_title": "Default",
                            "product_id": "gid://shopify/Product/303",
                            "product_title": "Board bag",
                        }
                    ],
                }
            ]
        }
    )

    assert configuration.upsell_rules[0].trigger_product_ids == [
        ["gid://shopify/Product/101"],
        ["gid://shopify/Product/202"],
    ]


def test_legacy_product_swap_rule_migrates_its_product_snapshot() -> None:
    configuration = validated_cart_features_section(
        {
            "product_swap_rules": [
                {
                    "id": "larger_board",
                    "trigger_id": "gid://shopify/Product/101",
                    "trigger_title": "Small board",
                    "target_variant_id": "gid://shopify/ProductVariant/202",
                    "target_variant_title": "Large board / Default",
                    "pill_label": "Choose a larger size",
                }
            ]
        }
    )

    assert configuration.product_swap_rules[0].trigger_product_ids == [
        "gid://shopify/Product/101"
    ]


def test_product_swap_size_group_accepts_an_ordered_product_ladder() -> None:
    configuration = CartFeaturesConfiguration.model_validate(
        {
            "product_swap_size_groups": [
                {
                    "id": "board_sizes",
                    "title": "Board sizes",
                    "product_ids": [
                        "gid://shopify/Product/101",
                        "gid://shopify/Product/202",
                    ],
                    "product_titles": ["Small board", "Large board"],
                    "product_handles": ["small-board", "large-board"],
                    "variant_ids": [
                        "gid://shopify/ProductVariant/1001",
                        "gid://shopify/ProductVariant/2002",
                    ],
                    "variant_titles": ["Default", "Default"],
                }
            ]
        }
    )

    assert configuration.product_swap_size_groups[0].product_handles == [
        "small-board",
        "large-board",
    ]


def test_product_cannot_belong_to_multiple_swap_size_groups() -> None:
    group = {
        "title": "Board sizes",
        "product_ids": [
            "gid://shopify/Product/101",
            "gid://shopify/Product/202",
        ],
        "product_titles": ["Small board", "Large board"],
        "product_handles": ["small-board", "large-board"],
        "variant_ids": [
            "gid://shopify/ProductVariant/1001",
            "gid://shopify/ProductVariant/2002",
        ],
        "variant_titles": ["Default", "Default"],
    }

    with pytest.raises(ValidationError, match="only one size group"):
        CartFeaturesConfiguration.model_validate(
            {
                "product_swap_size_groups": [
                    {**group, "id": "board_sizes"},
                    {**group, "id": "duplicate_board_sizes"},
                ]
            }
        )


def test_sku_upsell_rule_accepts_targeted_product_snapshots() -> None:
    configuration = CartFeaturesConfiguration.model_validate(
        {
            "one_tick_sku_enabled": True,
            "one_tick_sku_rules": [
                {
                    "id": "wax_add_on",
                    "text": {"text": "Add ski wax"},
                    "variant_id": "gid://shopify/ProductVariant/123",
                    "variant_title": "Ski wax / Default",
                    "applicable_on": "products",
                    "trigger_ids": ["gid://shopify/Product/456"],
                    "trigger_titles": ["Snowboard"],
                    "trigger_product_ids": [["gid://shopify/Product/456"]],
                }
            ],
        }
    )

    assert configuration.one_tick_sku_rules[0].trigger_product_ids == [
        ["gid://shopify/Product/456"]
    ]


def test_targeted_sku_upsell_requires_a_selected_resource() -> None:
    with pytest.raises(ValidationError, match="select at least one product or collection"):
        CartFeaturesConfiguration.model_validate(
            {
                "one_tick_sku_enabled": True,
                "one_tick_sku_rules": [
                    {
                        "id": "wax_add_on",
                        "text": {"text": "Add ski wax"},
                        "variant_id": "gid://shopify/ProductVariant/123",
                        "variant_title": "Ski wax / Default",
                        "applicable_on": "products",
                    }
                ],
            }
        )


def test_free_gift_changes_trigger_shopify_sync() -> None:
    previous = CartFeaturesConfiguration()
    starts_at = datetime.now(UTC)
    current = CartFeaturesConfiguration.model_validate(
        {
            **previous.model_dump(mode="json"),
            "free_gifts_enabled": True,
            "free_gift_offers": [
                {
                    "id": "gift_offer",
                    "title": "Choose a gift",
                    "starts_at": starts_at.isoformat(),
                    "ends_at": (starts_at + timedelta(days=7)).isoformat(),
                    "variant_id": "gid://shopify/ProductVariant/123",
                    "variant_title": "Gift / Default",
                }
            ],
        }
    )

    assert free_gift_configuration_changed(previous, current) is True


def test_tiered_gift_reward_aligns_the_linked_offer_condition() -> None:
    starts_at = datetime.now(UTC)
    configuration = CartFeaturesConfiguration.model_validate(
        {
            "free_gifts_enabled": True,
            "free_gift_offers": [
                {
                    "id": "gift_offer",
                    "title": "Choose a gift",
                    "starts_at": starts_at.isoformat(),
                    "ends_at": (starts_at + timedelta(days=7)).isoformat(),
                    "variant_id": "gid://shopify/ProductVariant/123",
                    "variant_title": "Gift / Default",
                }
            ],
            "tiered_rewards_enabled": True,
            "tiered_reward_condition": "cart_quantity",
            "tiered_applicable_on": "products",
            "tiered_applicable_ids": ["gid://shopify/Product/456"],
            "tiered_applicable_titles": ["Snowboard"],
            "tiered_applicable_product_ids": [["gid://shopify/Product/456"]],
            "tiered_rewards": [
                {
                    "id": "gift_reward",
                    "goal": 4,
                    "reward_type": "free_gift",
                    "reward_text": "Free gift",
                    "before_text": "Add more to unlock a gift",
                    "gift_offer_id": "gift_offer",
                    "gift_offer_title": "Choose a gift",
                }
            ],
        }
    )

    aligned = align_tiered_gift_offers(configuration)
    offer = aligned.free_gift_offers[0]

    assert offer.threshold == 4
    assert offer.eligibility_type == "cart_quantity"
    assert offer.conditions[0].condition_type == "cart_quantity"
    assert offer.conditions[0].operator == "greater_than_or_equal"
    assert offer.conditions[0].value == 4
    assert offer.conditions[0].applicable_on == "products"
    assert offer.conditions[0].product_ids == ["gid://shopify/Product/456"]


async def test_active_discounts_are_mapped_for_reward_selection(monkeypatch) -> None:
    async def access_token(**kwargs: object) -> str:
        return "token"

    class FakeShopifyClient:
        async def graphql(self, **kwargs: object) -> dict[str, object]:
            assert "discountNodes" in str(kwargs["query"])
            return {
                "data": {
                    "discountNodes": {
                        "nodes": [
                            {
                                "id": "gid://shopify/DiscountCodeNode/1",
                                "discount": {
                                    "title": "Free delivery",
                                    "summary": "Free standard delivery",
                                    "status": "ACTIVE",
                                    "discountClasses": ["SHIPPING"],
                                    "codes": {"nodes": [{"code": "SHIPFREE"}]},
                                },
                            },
                            {
                                "id": "gid://shopify/DiscountAutomaticNode/2",
                                "discount": {
                                    "title": "Automatic delivery",
                                    "summary": "Automatic free shipping",
                                    "status": "ACTIVE",
                                    "discountClasses": ["SHIPPING"],
                                },
                            },
                            {
                                "id": "gid://shopify/DiscountCodeNode/3",
                                "discount": {
                                    "title": "Expired",
                                    "status": "EXPIRED",
                                    "discountClasses": ["ORDER"],
                                    "codes": {"nodes": [{"code": "OLD"}]},
                                },
                            },
                        ]
                    }
                }
            }

    monkeypatch.setattr("shopify_app.services.shopify.get_valid_access_token", access_token)
    options = await list_active_discounts(
        shop_domain="example-shop.myshopify.com",
        db=object(),  # type: ignore[arg-type]
        client=FakeShopifyClient(),  # type: ignore[arg-type]
        cipher=object(),  # type: ignore[arg-type]
    )

    assert [option.code for option in options] == ["SHIPFREE", ""]
    assert [option.method for option in options] == ["code", "automatic"]
    assert all(option.discount_classes == ["SHIPPING"] for option in options)


def test_shopify_graphql_errors_keep_the_upstream_message() -> None:
    try:
        validated_shopify_result(
            {"errors": [{"message": "Cannot query field 'code'"}]},
            "publishablePublish",
            "Shopify could not publish the gift product",
        )
    except ShopifyUpstreamError as exc:
        assert "Cannot query field 'code'" in str(exc)
    else:  # pragma: no cover - assertion guard
        raise AssertionError("Expected ShopifyUpstreamError")


async def test_gift_publication_requests_supported_user_error_fields() -> None:
    class FakeShopifyClient:
        async def graphql(self, **kwargs: object) -> dict[str, object]:
            query = str(kwargs["query"])
            assert "userErrors { field message }" in query
            assert "userErrors { field message code }" not in query
            return {"data": {"publishablePublish": {"userErrors": []}}}

    await publish_gift_product(
        shop_domain="example-shop.myshopify.com",
        access_token="token",
        product_id="gid://shopify/Product/1",
        publication_id="gid://shopify/Publication/1",
        client=FakeShopifyClient(),  # type: ignore[arg-type]
    )


async def test_gift_archive_requests_supported_user_error_fields() -> None:
    class FakeShopifyClient:
        async def graphql(self, **kwargs: object) -> dict[str, object]:
            query = str(kwargs["query"])
            assert "userErrors { field message }" in query
            assert "userErrors { field message code }" not in query
            return {
                "data": {
                    "productUpdate": {
                        "product": {"id": "gid://shopify/Product/1"},
                        "userErrors": [],
                    }
                }
            }

    await archive_gift_product(
        shop_domain="example-shop.myshopify.com",
        access_token="token",
        product_id="gid://shopify/Product/1",
        client=FakeShopifyClient(),  # type: ignore[arg-type]
    )


def test_missing_shopify_resource_is_safe_for_cleanup_retry() -> None:
    payload = {
        "data": {
            "discountAutomaticDelete": {
                "deletedAutomaticDiscountId": None,
                "userErrors": [{"field": ["id"], "message": "Automatic discount does not exist."}],
            }
        }
    }

    assert shopify_user_errors_indicate_missing(payload, "discountAutomaticDelete") is True
    assert shopify_user_errors_indicate_missing(payload, "productUpdate") is False


async def test_disabling_free_gifts_preserves_offer_configuration() -> None:
    starts_at = datetime.now(UTC)
    configuration = CartFeaturesConfiguration.model_validate(
        {
            "free_gifts_enabled": False,
            "free_gift_offers": [
                {
                    "id": "gift_offer",
                    "title": "Choose a gift",
                    "starts_at": starts_at.isoformat(),
                    "ends_at": (starts_at + timedelta(days=7)).isoformat(),
                    "variant_id": "gid://shopify/ProductVariant/123",
                    "variant_title": "Gift / Default",
                    "re_add_each_time": False,
                }
            ],
        }
    )

    class FakeDb:
        async def get(self, model: object, key: str) -> None:
            return None

    synchronized, bindings = await sync_free_gift_inventory(
        shop_domain="example-shop.myshopify.com",
        configuration=configuration,
        existing_bindings={},
        db=FakeDb(),  # type: ignore[arg-type]
        client=object(),  # type: ignore[arg-type]
        cipher=object(),  # type: ignore[arg-type]
    )

    assert synchronized.free_gift_offers == configuration.free_gift_offers
    assert synchronized.free_gift_offers[0].re_add_each_time is False
    assert bindings == {}


def test_generated_gift_uses_source_product_identity_and_image() -> None:
    starts_at = datetime.now(UTC)
    offer = CartFeaturesConfiguration.model_validate(
        {
            "free_gifts_enabled": True,
            "free_gift_offers": [
                {
                    "id": "gift_offer",
                    "title": "Choose a gift",
                    "starts_at": starts_at.isoformat(),
                    "ends_at": (starts_at + timedelta(days=7)).isoformat(),
                    "variant_id": "gid://shopify/ProductVariant/123",
                    "variant_title": "Selling Plans Ski Wax / Sample",
                }
            ],
        }
    ).free_gift_offers[0]
    gift_variant = offer.gift_variants[0]
    source = GiftVariantSnapshot(
        variant_id=gift_variant.source_variant_id,
        title="Sample",
        price="10.00",
        sku="WAX-SAMPLE",
        barcode="",
        tracked=False,
        inventory_policy="DENY",
        taxable=True,
        inventory_item_id="gid://shopify/InventoryItem/1",
        inventory_levels=(),
        product_title="Selling Plans Ski Wax",
        image_url="https://cdn.shopify.com/s/files/ski-wax.jpg",
        image_alt="Yellow ski wax",
    )

    product = free_gift_product_input(
        offer=offer,
        gift_variant=gift_variant,
        source=source,
        target_variant_id=None,
        copy_inventory=False,
    )

    assert product["title"] == "Selling Plans Ski Wax"
    assert product["productType"] == "pragma-site-cart gift"
    assert product["productOptions"][0]["values"] == [{"name": "Sample"}]
    assert product["files"] == [
        {
            "originalSource": source.image_url,
            "alt": source.image_alt,
            "contentType": "IMAGE",
        }
    ]
    assert product["variants"][0]["file"] == product["files"][0]
