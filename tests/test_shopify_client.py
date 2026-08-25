from __future__ import annotations

import json
from urllib.parse import parse_qsl

import httpx

from shopify_app.shopify_client import ShopifyClient


async def test_shopify_client_token_exchange_and_graphql() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/admin/oauth/access_token":
            form = dict(parse_qsl(request.content.decode()))
            assert form["client_id"] == "client-id"
            assert form["expiring"] == "1"
            return httpx.Response(
                200,
                json={
                    "access_token": "shpat_test",
                    "scope": "read_products",
                    "expires_in": 3600,
                    "refresh_token": "shprt_test",
                    "refresh_token_expires_in": 7_776_000,
                },
            )
        assert request.url.path == "/admin/api/2026-07/graphql.json"
        assert request.headers["X-Shopify-Access-Token"] == "shpat_test"
        assert json.loads(request.content) == {"query": "query { shop { name } }", "variables": {}}
        return httpx.Response(200, json={"data": {"shop": {"name": "Example"}}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        client = ShopifyClient(
            http_client=http_client,
            client_id="client-id",
            client_secret="client-secret",
            api_version="2026-07",
        )
        token = await client.exchange_session_token(
            shop_domain="example-shop.myshopify.com", session_token="session-jwt"
        )
        assert token.access_token == "shpat_test"
        assert token.refresh_token == "shprt_test"

        result = await client.graphql(
            shop_domain="example-shop.myshopify.com",
            access_token=token.access_token,
            query="query { shop { name } }",
            variables={},
        )
        assert result == {"data": {"shop": {"name": "Example"}}}


async def test_token_exchange_retries_transient_shopify_failures() -> None:
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            return httpx.Response(503)
        return httpx.Response(
            200,
            json={
                "access_token": "shpat_recovered",
                "scope": "read_products",
                "expires_in": 3600,
                "refresh_token": "shprt_recovered",
                "refresh_token_expires_in": 7_776_000,
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        client = ShopifyClient(
            http_client=http_client,
            client_id="client-id",
            client_secret="client-secret",
            api_version="2026-07",
        )
        token = await client.exchange_session_token(
            shop_domain="example-shop.myshopify.com", session_token="session-jwt"
        )

    assert attempts == 3
    assert token.access_token == "shpat_recovered"


async def test_shopify_client_refreshes_offline_access_token() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/admin/oauth/access_token"
        form = dict(parse_qsl(request.content.decode()))
        assert form == {
            "client_id": "client-id",
            "client_secret": "client-secret",
            "grant_type": "refresh_token",
            "refresh_token": "shprt_old",
        }
        return httpx.Response(
            200,
            json={
                "access_token": "shpat_new",
                "scope": "read_products",
                "expires_in": 3600,
                "refresh_token": "shprt_new",
                "refresh_token_expires_in": 7_776_000,
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        client = ShopifyClient(
            http_client=http_client,
            client_id="client-id",
            client_secret="client-secret",
            api_version="2026-07",
        )
        token = await client.refresh_offline_access_token(
            shop_domain="example-shop.myshopify.com", refresh_token="shprt_old"
        )

    assert token.access_token == "shpat_new"
    assert token.refresh_token == "shprt_new"
