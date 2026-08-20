from __future__ import annotations

from typing import Any

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


class GraphQLRequest(BaseModel):
    query: str = Field(min_length=1, max_length=100_000)
    variables: dict[str, Any] = Field(default_factory=dict)
