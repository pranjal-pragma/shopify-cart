from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import jwt
import pytest

from shopify_app.config import Settings
from shopify_app.schemas import TokenExchangeResponse
from shopify_app.shopify_client import ShopifyClient


def make_session_token(settings: Settings) -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "aud": settings.shopify_client_id,
            "dest": "https://example-shop.myshopify.com",
            "sub": "42",
            "iat": now,
            "nbf": now - timedelta(seconds=1),
            "exp": now + timedelta(minutes=1),
        },
        settings.shopify_client_secret.get_secret_value(),
        algorithm="HS256",
    )


async def test_token_exchange_then_graphql(
    client: httpx.AsyncClient, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def fake_exchange(
        self: ShopifyClient, *, shop_domain: str, session_token: str
    ) -> TokenExchangeResponse:
        assert shop_domain == "example-shop.myshopify.com"
        assert session_token
        return TokenExchangeResponse(access_token="shpat_test", scope="read_products")

    async def fake_graphql(
        self: ShopifyClient,
        *,
        shop_domain: str,
        access_token: str,
        query: str,
        variables: dict[str, Any],
    ) -> dict[str, Any]:
        assert shop_domain == "example-shop.myshopify.com"
        assert access_token == "shpat_test"
        assert query == "query Shop { shop { name } }"
        assert variables == {}
        return {"data": {"shop": {"name": "Example"}}}

    monkeypatch.setattr(ShopifyClient, "exchange_session_token", fake_exchange)
    monkeypatch.setattr(ShopifyClient, "graphql", fake_graphql)
    headers = {"Authorization": f"Bearer {make_session_token(settings)}"}

    exchange_response = await client.post("/api/v1/shopify/token-exchange", headers=headers)
    assert exchange_response.status_code == 200
    assert exchange_response.json() == {
        "shop_domain": "example-shop.myshopify.com",
        "scopes": ["read_products"],
        "expires_in": None,
    }

    graphql_response = await client.post(
        "/api/v1/shopify/graphql",
        headers=headers,
        json={"query": "query Shop { shop { name } }"},
    )
    assert graphql_response.status_code == 200
    assert graphql_response.json() == {"data": {"shop": {"name": "Example"}}}


async def test_shopify_endpoint_requires_session_token(client: httpx.AsyncClient) -> None:
    response = await client.post("/api/v1/shopify/token-exchange")
    assert response.status_code == 401
