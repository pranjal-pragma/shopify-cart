from __future__ import annotations

from datetime import datetime, timedelta
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator


def validate_hex_color(value: str) -> str:
    value = value.upper()
    if (
        len(value) != 7
        or value[0] != "#"
        or any(character not in "0123456789ABCDEF" for character in value[1:])
    ):
        raise ValueError("must be a six-digit hex color")
    return value


HexColor = Annotated[str, AfterValidator(validate_hex_color)]


def validate_css_selector(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("selector cannot be empty")
    if any(character in value for character in "{};\n\r"):
        raise ValueError("must be a single CSS selector")
    return value


CssSelector = Annotated[
    str,
    Field(min_length=1, max_length=240),
    AfterValidator(validate_css_selector),
]


class HealthResponse(BaseModel):
    status: str


class TokenExchangeResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    access_token: str
    scope: str = ""
    expires_in: int | None = Field(default=None, ge=1)
    refresh_token: str | None = None
    refresh_token_expires_in: int | None = Field(default=None, ge=1)


class ShopConnectionResponse(BaseModel):
    shop_domain: str
    scopes: list[str]
    expires_in: int | None = None


class MerchantResponse(BaseModel):
    shop_domain: str
    connected: bool
    scopes: list[str]
    onboarding_completed: bool


class ShopifyInstallationIdentity(BaseModel):
    shop_gid: str
    app_installation_gid: str


class RichTextStyle(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(max_length=500)
    bold: bool = False
    italic: bool = False
    underline: bool = False
    font_size: Literal[12, 14, 16, 18, 20] = 14


class FreeGiftCondition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    condition_type: Literal["cart_subtotal", "cart_quantity"] = "cart_quantity"
    operator: Literal["greater_than", "greater_than_or_equal", "equal_to"] = "greater_than"
    value: float = Field(default=1, ge=0, le=10_000_000)
    applicable_on: Literal["all", "products"] = "all"
    product_ids: list[str] = Field(default_factory=list, max_length=250)
    product_titles: list[str] = Field(default_factory=list, max_length=250)

    @model_validator(mode="after")
    def validate_products(self) -> FreeGiftCondition:
        if len(self.product_ids) != len(self.product_titles):
            raise ValueError("free gift product identifiers and titles must match")
        if self.applicable_on == "products" and not self.product_ids:
            raise ValueError("select at least one product for the free gift condition")
        return self


class FreeGiftVariant(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    source_variant_id: str = Field(pattern=r"^gid://shopify/ProductVariant/[0-9]+$")
    source_variant_title: str = Field(min_length=1, max_length=200)
    variant_id: str = Field(pattern=r"^gid://shopify/ProductVariant/[0-9]+$")
    variant_title: str = Field(min_length=1, max_length=200)


class FreeGiftOffer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    title: str = Field(min_length=1, max_length=40)
    starts_at: datetime
    ends_at: datetime
    source_variant_id: str = Field(pattern=r"^gid://shopify/ProductVariant/[0-9]+$")
    source_variant_title: str = Field(min_length=1, max_length=200)
    variant_id: str = Field(pattern=r"^gid://shopify/ProductVariant/[0-9]+$")
    variant_title: str = Field(min_length=1, max_length=200)
    eligibility_type: Literal["cart_subtotal", "cart_quantity"] = "cart_subtotal"
    threshold: float = Field(default=0, ge=0, le=10_000_000)
    quantity: int = Field(default=1, ge=1, le=20)
    re_add_each_time: bool = False
    gift_variants: list[FreeGiftVariant] = Field(default_factory=list, min_length=1, max_length=12)
    conditions: list[FreeGiftCondition] = Field(default_factory=list, max_length=8)

    @model_validator(mode="before")
    @classmethod
    def migrate_source_variant(cls, value: object) -> object:
        if isinstance(value, dict):
            migrated = dict(value)
            migrated.setdefault("source_variant_id", migrated.get("variant_id"))
            migrated.setdefault("source_variant_title", migrated.get("variant_title"))
            gift_variants = migrated.get("gift_variants")
            if not gift_variants and migrated.get("variant_id"):
                migrated["gift_variants"] = [
                    {
                        "id": "primary",
                        "source_variant_id": migrated.get("source_variant_id"),
                        "source_variant_title": migrated.get("source_variant_title"),
                        "variant_id": migrated.get("variant_id"),
                        "variant_title": migrated.get("variant_title"),
                    }
                ]
            elif isinstance(gift_variants, list) and gift_variants:
                primary = gift_variants[0]
                if isinstance(primary, dict):
                    if not migrated.get("source_variant_id"):
                        migrated["source_variant_id"] = primary.get("source_variant_id")
                    if not migrated.get("source_variant_title"):
                        migrated["source_variant_title"] = primary.get("source_variant_title")
                    if not migrated.get("variant_id"):
                        migrated["variant_id"] = primary.get("variant_id")
                    if not migrated.get("variant_title"):
                        migrated["variant_title"] = primary.get("variant_title")
            return migrated
        return value

    @model_validator(mode="after")
    def validate_period(self) -> FreeGiftOffer:
        if self.ends_at <= self.starts_at:
            raise ValueError("free gift end time must be after its start time")
        source_ids = [gift.source_variant_id for gift in self.gift_variants]
        if len(source_ids) != len(set(source_ids)):
            raise ValueError("free gift options must use unique source variants")
        gift_ids = [gift.id for gift in self.gift_variants]
        if len(gift_ids) != len(set(gift_ids)):
            raise ValueError("free gift option identifiers must be unique")
        if not self.conditions:
            self.conditions = [
                FreeGiftCondition(
                    id=f"{self.id[:52]}_condition",
                    condition_type=self.eligibility_type,
                    operator="greater_than_or_equal",
                    value=self.threshold,
                )
            ]
        return self


class TierReward(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    goal: float = Field(gt=0, le=10_000_000)
    reward_type: Literal["shipping", "free_gift", "discount", "custom"] = "shipping"
    reward_text: str = Field(min_length=1, max_length=16)
    before_text: str = Field(min_length=1, max_length=160)
    gift_offer_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{1,64}$")
    gift_offer_title: str = Field(default="", max_length=40)
    discount_id: str | None = Field(
        default=None,
        pattern=r"^gid://shopify/(DiscountCodeNode|DiscountAutomaticNode)/[0-9]+$",
    )
    discount_title: str = Field(default="", max_length=255)
    discount_code: str = Field(default="", max_length=255)
    discount_classes: list[Literal["ORDER", "PRODUCT", "SHIPPING"]] = Field(
        default_factory=list, max_length=3
    )


class OneTickSkuRule(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    text: RichTextStyle
    variant_id: str = Field(pattern=r"^gid://shopify/ProductVariant/[0-9]+$")
    variant_title: str = Field(min_length=1, max_length=200)
    applicable_on: Literal["all", "products", "collections"] = "all"
    trigger_ids: list[str] = Field(default_factory=list, max_length=50)
    trigger_titles: list[str] = Field(default_factory=list, max_length=50)
    trigger_product_ids: list[list[str]] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def validate_scope(self) -> OneTickSkuRule:
        lengths = {
            len(self.trigger_ids),
            len(self.trigger_titles),
            len(self.trigger_product_ids),
        }
        if len(lengths) != 1:
            raise ValueError("one-tick rule resource identifiers, titles, and products must align")
        if self.applicable_on != "all" and not self.trigger_ids:
            raise ValueError("select at least one product or collection for the one-tick rule")
        return self


class ProductSwapRule(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    enabled: bool = True
    trigger_scope: Literal["product", "collection"] = "product"
    trigger_id: str = Field(min_length=1, max_length=255)
    trigger_title: str = Field(min_length=1, max_length=200)
    use_case: Literal["size_upgrade", "alternative", "multipack"] = "size_upgrade"
    target_variant_id: str = Field(pattern=r"^gid://shopify/ProductVariant/[0-9]+$")
    target_variant_title: str = Field(min_length=1, max_length=200)
    pill_label: str = Field(min_length=1, max_length=40)
    nudge_strategy: Literal["automatic", "mrp_discount", "custom"] = "automatic"


class ProductSwapSizeGroup(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    title: str = Field(min_length=1, max_length=80)
    variant_ids: list[str] = Field(default_factory=list, min_length=2, max_length=20)
    variant_titles: list[str] = Field(default_factory=list, min_length=2, max_length=20)

    @model_validator(mode="after")
    def validate_ladder(self) -> ProductSwapSizeGroup:
        if len(self.variant_ids) != len(self.variant_titles):
            raise ValueError("size group variant IDs and titles must align")
        if len(set(self.variant_ids)) != len(self.variant_ids):
            raise ValueError("size group variants must be unique")
        return self


class BannerCondition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    type: Literal["cart_quantity", "cart_value", "product_title"] = "cart_quantity"
    operator: Literal["greater_than", "less_than", "equals", "contains", "does_not_contain"] = (
        "greater_than"
    )
    value: str = Field(default="", max_length=200)

    @model_validator(mode="after")
    def validate_operator(self) -> BannerCondition:
        text_operators = {"contains", "does_not_contain"}
        numeric_operators = {"greater_than", "less_than", "equals"}
        allowed = text_operators if self.type == "product_title" else numeric_operators
        if self.operator not in allowed:
            raise ValueError("operator is not valid for this condition type")
        return self


class AnnouncementBanner(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    title: RichTextStyle
    show_subtext: bool = False
    subtext: RichTextStyle
    conditions: list[BannerCondition] = Field(default_factory=list, max_length=8)


class CartAppearanceConfiguration(BaseModel):
    model_config = ConfigDict(extra="forbid")

    font_source: Literal["pragma-site-cart", "theme"] = "pragma-site-cart"
    theme_color: HexColor = "#F10A0A"
    announcement_enabled: bool = True
    announcement_background: HexColor = "#FFF2F2"
    announcement_text_color: HexColor = "#7A1515"
    announcement_alignment: Literal["left", "center", "right"] = "center"
    dynamic_banners: bool = True
    advanced_conditions: bool = False
    auto_change_seconds: int = Field(default=9, ge=2, le=60)
    banners: list[AnnouncementBanner] = Field(min_length=1, max_length=8)
    display_all_products: bool = False
    show_variant_names: bool = True
    show_item_properties: bool = True
    show_free_gift_first: bool = True
    empty_title: str = Field(default="Your Cart is Empty", min_length=1, max_length=80)
    empty_cta_text: str = Field(default="Continue Shopping", min_length=1, max_length=40)
    empty_cta_url: str = Field(default="/collections/all", max_length=2048)
    show_savings: bool = True
    show_mrp_discounts: bool = False
    checkout_background: HexColor = "#202124"
    checkout_text_color: HexColor = "#FFFFFF"
    checkout_text: RichTextStyle
    checkout_subtext_enabled: bool = False
    checkout_subtext: RichTextStyle
    checkout_alignment: Literal["left", "center", "right"] = "left"
    pragma_site_cart_checkout: bool = True
    show_payment_icons: bool = True
    show_estimated_total_breakup: bool = True
    footer_enabled: bool = True
    footer_text_color: HexColor = "#676A72"
    footer_text: RichTextStyle
    footer_alignment: Literal["left", "center", "right"] = "left"
    custom_script: str = Field(default="", max_length=20_000)
    add_to_cart_behavior: Literal["open_cart", "confirmation", "nothing"] = "nothing"
    confirmation_background: HexColor = "#202124"
    confirmation_text_color: HexColor = "#FFFFFF"
    use_theme_add_to_cart_handling: bool = False
    custom_cart_icon_selectors: list[CssSelector] = Field(default_factory=list, max_length=12)
    custom_cart_drawer_selectors: list[CssSelector] = Field(default_factory=list, max_length=12)
    sticky_cart_enabled: bool = False
    scarcity_timer_enabled: bool = False
    scarcity_timer_type: Literal["urgency", "sales"] = "urgency"
    scarcity_timer_days: int = Field(default=0, ge=0, le=365)
    scarcity_timer_hours: int = Field(default=0, ge=0, le=23)
    scarcity_timer_minutes: int = Field(default=10, ge=0, le=59)
    scarcity_timer_seconds: int = Field(default=0, ge=0, le=59)
    scarcity_show_days: bool = False
    scarcity_show_hours: bool = False
    scarcity_show_minutes: bool = True
    scarcity_show_seconds: bool = True
    scarcity_timer_title: RichTextStyle = Field(
        default_factory=lambda: RichTextStyle(
            text="Your cart is reserved for", bold=True, font_size=12
        )
    )
    scarcity_timer_background: HexColor = "#FFF7E8"
    scarcity_timer_text_color: HexColor = "#7B5312"
    scarcity_timer_expiry_action: Literal["restart", "remove"] = "restart"
    scarcity_timer_started_at: datetime | None = None
    scarcity_sale_starts_at: datetime | None = None
    scarcity_sale_ends_at: datetime | None = None
    allow_free_item_quantity_changes: bool = False
    block_cart_page_redirection: bool = True
    disable_checkout_for_upsell_only: bool = False
    disable_on_non_indian_store: bool = False
    terms_checkbox_enabled: bool = False
    terms_checkbox_text: str = Field(
        default="I agree to the Terms & Conditions", min_length=1, max_length=160
    )
    terms_checkbox_url: str = Field(default="/policies/terms-of-service", max_length=2048)
    product_quantity_limit_enabled: bool = False
    quantity_limit_variant_id: str | None = Field(
        default=None, pattern=r"^gid://shopify/ProductVariant/[0-9]+$"
    )
    quantity_limit_variant_title: str = Field(default="", max_length=200)
    product_quantity_limit: int = Field(default=1, ge=1, le=99)
    variant_selection_enabled: bool = True
    product_click_behavior: Literal["nothing", "redirect", "modal"] = "nothing"

    @model_validator(mode="before")
    @classmethod
    def migrate_legacy_scarcity_timer(cls, value: object) -> object:
        if not isinstance(value, dict):
            return value
        migrated = dict(value)
        if "scarcity_timer_text" in migrated:
            legacy_text = (
                str(migrated.pop("scarcity_timer_text") or "").replace("{time}", "").strip()
            )
            migrated.setdefault(
                "scarcity_timer_title",
                {
                    "text": legacy_text or "Your cart is reserved for",
                    "bold": True,
                    "font_size": 12,
                },
            )
        if (
            migrated.get("scarcity_timer_type") == "sales"
            and not migrated.get("scarcity_sale_starts_at")
            and not migrated.get("scarcity_sale_ends_at")
            and migrated.get("scarcity_timer_started_at")
        ):
            started_at = migrated["scarcity_timer_started_at"]
            if isinstance(started_at, str):
                started_at = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
            duration = timedelta(
                days=int(migrated.get("scarcity_timer_days", 0) or 0),
                hours=int(migrated.get("scarcity_timer_hours", 0) or 0),
                minutes=int(migrated.get("scarcity_timer_minutes", 0) or 0),
                seconds=int(migrated.get("scarcity_timer_seconds", 0) or 0),
            )
            migrated["scarcity_sale_starts_at"] = started_at
            migrated["scarcity_sale_ends_at"] = started_at + duration
        return migrated

    @model_validator(mode="after")
    def validate_banner_modes(self) -> CartAppearanceConfiguration:
        if self.dynamic_banners and self.advanced_conditions:
            raise ValueError("dynamic banners and advanced conditions cannot both be enabled")
        if self.advanced_conditions and any(not banner.conditions for banner in self.banners):
            raise ValueError("every advanced banner must have at least one condition")
        if self.advanced_conditions and any(
            not condition.value.strip()
            for banner in self.banners
            for condition in banner.conditions
        ):
            raise ValueError("advanced banner condition values cannot be empty")
        for url in (self.empty_cta_url, self.terms_checkbox_url):
            if not url.startswith("/") and not url.lower().startswith(("http://", "https://")):
                raise ValueError("links must be store paths or HTTP(S) URLs")
        if any(
            selector.lower() in {"*", "html", "body", ":root"}
            for selector in self.custom_cart_drawer_selectors
        ):
            raise ValueError("custom drawer selectors cannot target the document root")
        if self.product_quantity_limit_enabled and self.quantity_limit_variant_id is None:
            raise ValueError("select a product variant before enabling its quantity limit")
        if self.scarcity_timer_enabled:
            if not self.scarcity_timer_title.text.strip():
                raise ValueError("scarcity timer title cannot be empty")
            if self.scarcity_timer_type == "sales":
                if self.scarcity_sale_starts_at is None or self.scarcity_sale_ends_at is None:
                    raise ValueError("sales countdown start and end times are required")
                if self.scarcity_sale_ends_at <= self.scarcity_sale_starts_at:
                    raise ValueError("sales countdown end time must be after its start time")
            else:
                duration = (
                    self.scarcity_timer_days * 86_400
                    + self.scarcity_timer_hours * 3_600
                    + self.scarcity_timer_minutes * 60
                    + self.scarcity_timer_seconds
                )
                if duration == 0:
                    raise ValueError("scarcity timer duration must be greater than zero")
                if not any(
                    (
                        self.scarcity_show_days,
                        self.scarcity_show_hours,
                        self.scarcity_show_minutes,
                        self.scarcity_show_seconds,
                    )
                ):
                    raise ValueError("select at least one scarcity timer display unit")
        return self


class CartFeaturesConfiguration(BaseModel):
    model_config = ConfigDict(extra="forbid")

    discount_mode: Literal["checkout_offers", "hide", "discount_box"] = "discount_box"
    order_notes_enabled: bool = True
    order_notes_title: str = Field(default="Add special instructions", min_length=1, max_length=120)
    free_gifts_enabled: bool = False
    free_gifts_copy_inventory: bool = True
    free_gift_method: Literal["auto", "choice"] = "auto"
    free_gift_offers: list[FreeGiftOffer] = Field(default_factory=list, max_length=12)
    free_gift_congratulations: bool = True
    tiered_rewards_enabled: bool = False
    tiered_reward_condition: Literal["cart_subtotal", "cart_quantity", "cart_discount_price"] = (
        "cart_subtotal"
    )
    tiered_rewards: list[TierReward] = Field(default_factory=list, max_length=12)
    tiered_primary_color: HexColor = "#F10A0A"
    tiered_secondary_color: HexColor = "#E5E7EB"
    tiered_confetti_enabled: bool = True
    tiered_applicable_on: Literal["products", "collections", "all"] = "all"
    tiered_applicable_ids: list[str] = Field(default_factory=list, max_length=50)
    tiered_applicable_titles: list[str] = Field(default_factory=list, max_length=50)
    tiered_applicable_product_ids: list[list[str]] = Field(default_factory=list, max_length=50)
    tiered_exclude_discounts: bool = False
    tiered_completion_text: str = Field(
        default="All rewards unlocked", min_length=1, max_length=160
    )
    one_tick_enabled: bool = False
    one_tick_text: RichTextStyle = Field(
        default_factory=lambda: RichTextStyle(text="Add gift wrapping", font_size=14)
    )
    one_tick_variant_id: str | None = Field(
        default=None, pattern=r"^gid://shopify/ProductVariant/[0-9]+$"
    )
    one_tick_variant_title: str = Field(default="", max_length=200)
    one_tick_sku_enabled: bool = False
    one_tick_sku_rules: list[OneTickSkuRule] = Field(default_factory=list, max_length=20)
    one_tick_remove_with_parent: bool = False
    one_tick_match_parent_quantity: bool = False
    one_tick_disable_quantity_changes: bool = False
    one_tick_disable_checkout_only: bool = False
    product_swap_enabled: bool = False
    product_swap_coexistence: Literal["swap", "upsell"] = "swap"
    product_swap_automatic_upgrade: bool = True
    product_swap_rules: list[ProductSwapRule] = Field(default_factory=list, max_length=20)
    product_swap_size_groups: list[ProductSwapSizeGroup] = Field(
        default_factory=list, max_length=12
    )

    @model_validator(mode="after")
    def validate_features(self) -> CartFeaturesConfiguration:
        if self.free_gifts_enabled and not self.free_gift_offers:
            raise ValueError("add at least one free gift offer")
        if self.tiered_rewards_enabled and not self.tiered_rewards:
            raise ValueError("add at least one tiered reward")
        tier_scope_lengths = {
            len(self.tiered_applicable_ids),
            len(self.tiered_applicable_titles),
            len(self.tiered_applicable_product_ids),
        }
        if len(tier_scope_lengths) != 1:
            raise ValueError("tiered reward resource identifiers, titles, and products must align")
        if self.tiered_rewards_enabled and self.tiered_applicable_on != "all":
            if not self.tiered_applicable_ids:
                raise ValueError("select at least one tiered reward resource")
        offer_ids = {offer.id for offer in self.free_gift_offers}
        linked_offer_ids = [
            reward.gift_offer_id
            for reward in self.tiered_rewards
            if reward.reward_type == "free_gift" and reward.gift_offer_id
        ]
        if any(offer_id not in offer_ids for offer_id in linked_offer_ids):
            raise ValueError("tiered reward references an unknown free gift offer")
        if len(linked_offer_ids) != len(set(linked_offer_ids)):
            raise ValueError("a free gift offer can belong to only one reward tier")
        if linked_offer_ids and self.tiered_reward_condition == "cart_discount_price":
            raise ValueError("free gift rewards do not support cart discount price eligibility")
        for reward in self.tiered_rewards:
            if reward.reward_type == "shipping" and reward.discount_id:
                if "SHIPPING" not in reward.discount_classes:
                    raise ValueError("shipping rewards require a shipping discount")
            if reward.reward_type == "discount" and reward.discount_id:
                if not {"ORDER", "PRODUCT"}.intersection(reward.discount_classes):
                    raise ValueError("discount rewards require an order or product discount")
        if self.one_tick_enabled:
            if self.one_tick_variant_id is None:
                raise ValueError("select a one-tick upsell variant")
            if not self.one_tick_text.text.strip():
                raise ValueError("one-tick upsell text cannot be empty")
            if len(self.one_tick_text.text) > 64:
                raise ValueError("one-tick upsell text cannot exceed 64 characters")
        if self.one_tick_sku_enabled and not self.one_tick_sku_rules:
            raise ValueError("add at least one SKU-level one-tick rule")
        groups = [offer.id for offer in self.free_gift_offers]
        groups.extend(
            condition.id for offer in self.free_gift_offers for condition in offer.conditions
        )
        groups.extend(reward.id for reward in self.tiered_rewards)
        groups.extend(rule.id for rule in self.one_tick_sku_rules)
        groups.extend(rule.id for rule in self.product_swap_rules)
        groups.extend(group.id for group in self.product_swap_size_groups)
        if len(groups) != len(set(groups)):
            raise ValueError("feature item identifiers must be unique")
        grouped_variants = [
            variant_id
            for group in self.product_swap_size_groups
            for variant_id in group.variant_ids
        ]
        if len(grouped_variants) != len(set(grouped_variants)):
            raise ValueError("a product variant can belong to only one size group")
        return self


class CartFeaturesResponse(CartFeaturesConfiguration):
    updated_at: str | None = None


class ShopifyDiscountOption(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(
        pattern=r"^gid://shopify/(DiscountCodeNode|DiscountAutomaticNode)/[0-9]+$"
    )
    title: str = Field(min_length=1, max_length=255)
    code: str = Field(default="", max_length=255)
    method: Literal["code", "automatic"]
    summary: str = Field(default="", max_length=1000)
    discount_classes: list[Literal["ORDER", "PRODUCT", "SHIPPING"]]


class UpsellRecommendation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    variant_id: str = Field(pattern=r"^gid://shopify/ProductVariant/[0-9]+$")
    variant_title: str = Field(min_length=1, max_length=200)
    product_id: str = Field(pattern=r"^gid://shopify/Product/[0-9]+$")
    product_title: str = Field(min_length=1, max_length=200)
    product_handle: str = Field(default="", max_length=255)
    image_url: str = Field(default="", max_length=2048)
    price: str = Field(default="", max_length=32)


class UpsellRule(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    title: RichTextStyle = Field(
        default_factory=lambda: RichTextStyle(text="You may also like", font_size=16, bold=True)
    )
    product_count: int = Field(default=4, ge=1, le=10)
    background_color: HexColor = "#FFFFFF"
    text_color: HexColor = "#202124"
    applicable_on: Literal["all", "products", "collections"] = "all"
    trigger_ids: list[str] = Field(default_factory=list, max_length=50)
    trigger_titles: list[str] = Field(default_factory=list, max_length=50)
    trigger_product_ids: list[str] = Field(default_factory=list, max_length=250)
    recommendations: list[UpsellRecommendation] = Field(
        default_factory=list, max_length=20
    )

    @model_validator(mode="after")
    def validate_rule(self) -> UpsellRule:
        if not self.title.text.strip():
            raise ValueError("upsell rule title cannot be empty")
        if len(self.trigger_ids) != len(self.trigger_titles):
            raise ValueError("upsell trigger identifiers and titles must align")
        if self.applicable_on != "all" and not self.trigger_ids:
            raise ValueError("select at least one upsell trigger")
        if not self.recommendations:
            raise ValueError("select at least one recommended product")
        variant_ids = [item.variant_id for item in self.recommendations]
        if len(variant_ids) != len(set(variant_ids)):
            raise ValueError("recommended variants must be unique within a rule")
        return self


class CartUpsellConfiguration(BaseModel):
    model_config = ConfigDict(extra="forbid")

    upsell_enabled: bool = False
    upsell_cap_quantity: bool = True
    upsell_max_quantity: int = Field(default=1, ge=1, le=99)
    upsell_variant_behavior: Literal["variant_popup", "product_popup"] = "variant_popup"
    upsell_ai_enabled: bool = True
    upsell_ai_title: RichTextStyle = Field(
        default_factory=lambda: RichTextStyle(text="Recommended for you", font_size=16, bold=True)
    )
    upsell_ai_background_color: HexColor = "#FFFFFF"
    upsell_ai_text_color: HexColor = "#202124"
    upsell_ai_preference: Literal["related", "complementary"] = "complementary"
    upsell_ai_product_count: int = Field(default=6, ge=1, le=10)
    upsell_rule_fallback_enabled: bool = False
    upsell_rules: list[UpsellRule] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def validate_upsells(self) -> CartUpsellConfiguration:
        if not self.upsell_ai_title.text.strip():
            raise ValueError("AI upsell title cannot be empty")
        ids = [rule.id for rule in self.upsell_rules]
        if len(ids) != len(set(ids)):
            raise ValueError("upsell rule identifiers must be unique")
        if self.upsell_enabled and not self.upsell_ai_enabled and not self.upsell_rules:
            raise ValueError("enable AI recommendations or add an upsell rule")
        if self.upsell_rule_fallback_enabled and not self.upsell_rules:
            raise ValueError("add an upsell rule before enabling rule-based fallback")
        return self


class CartUpsellResponse(CartUpsellConfiguration):
    updated_at: str | None = None


class CartAppearanceResponse(CartAppearanceConfiguration):
    updated_at: str | None = None
