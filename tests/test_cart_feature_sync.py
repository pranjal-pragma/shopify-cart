from datetime import UTC, datetime, timedelta

from shopify_app.controllers.shopify import free_gift_configuration_changed
from shopify_app.schemas import CartFeaturesConfiguration
from shopify_app.services.shopify import (
    GiftVariantSnapshot,
    free_gift_product_input,
    publish_gift_product,
    sync_free_gift_inventory,
    validated_shopify_result,
)
from shopify_app.shopify_client import ShopifyUpstreamError


def test_regular_feature_changes_do_not_trigger_free_gift_sync() -> None:
    previous = CartFeaturesConfiguration()
    current = previous.model_copy(update={"order_notes_title": "Delivery instructions"})

    assert free_gift_configuration_changed(previous, current) is False


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
