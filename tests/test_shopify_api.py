from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx
import jwt
import pytest

from shopify_app.config import Settings
from shopify_app.schemas import ShopifyInstallationIdentity, TokenExchangeResponse
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


async def test_me_requires_token_exchange(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    headers = {"Authorization": f"Bearer {make_session_token(settings)}"}
    response = await client.get("/api/v1/shopify/me", headers=headers)
    assert response.status_code == 409


async def test_public_graphql_proxy_is_not_exposed(client: httpx.AsyncClient) -> None:
    response = await client.post("/api/v1/shopify/graphql", json={"query": "query { shop { id } }"})
    assert response.status_code == 404
