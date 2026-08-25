from __future__ import annotations

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
        return self


class CartAppearanceResponse(CartAppearanceConfiguration):
    updated_at: str | None = None
