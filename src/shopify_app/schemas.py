from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class HealthResponse(BaseModel):
    status: str


class TokenExchangeResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    access_token: str
    scope: str = ""
    expires_in: int | None = Field(default=None, ge=1)


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
