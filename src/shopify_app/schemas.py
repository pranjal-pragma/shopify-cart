from __future__ import annotations

from datetime import datetime, timedelta
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator


def validate_hex_color(value: str) -> str:
    value = value.upper()
    if len(value) != 7 or value[0] != "#" or any(
        character not in "0123456789ABCDEF" for character in value[1:]
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


class BannerCondition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    type: Literal["cart_quantity", "cart_value", "product_title"] = "cart_quantity"
    operator: Literal[
        "greater_than", "less_than", "equals", "contains", "does_not_contain"
    ] = "greater_than"
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

    font_source: Literal["gokwik", "theme"] = "gokwik"
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
    gokwik_checkout: bool = True
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
            legacy_text = str(migrated.pop("scarcity_timer_text") or "").replace(
                "{time}", ""
            ).strip()
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


class CartAppearanceResponse(CartAppearanceConfiguration):
    updated_at: str | None = None
