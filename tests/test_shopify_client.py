from __future__ import annotations

import json

import httpx

from shopify_app.shopify_client import ShopifyClient


async def test_shopify_client_token_exchange_and_graphql() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/admin/oauth/access_token":
            form = dict(item.split("=") for item in request.content.decode().split("&"))
            assert form["client_id"] == "client-id"
            return httpx.Response(
                200,
                json={"access_token": "shpat_test", "scope": "read_products"},
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

        result = await client.graphql(
            shop_domain="example-shop.myshopify.com",
            access_token=token.access_token,
            query="query { shop { name } }",
            variables={},
        )
        assert result == {"data": {"shop": {"name": "Example"}}}
