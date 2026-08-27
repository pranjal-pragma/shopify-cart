from datetime import UTC, datetime, timedelta

from shopify_app.controllers.shopify import free_gift_configuration_changed
from shopify_app.schemas import CartFeaturesConfiguration


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
