from __future__ import annotations

import httpx
import pytest


async def test_liveness(client: httpx.AsyncClient) -> None:
    response = await client.get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["x-request-id"]


async def test_readiness(client: httpx.AsyncClient) -> None:
    response = await client.get("/health/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_swagger_ui_csp_allows_its_assets(client: httpx.AsyncClient) -> None:
    response = await client.get("/docs")

    assert response.status_code == 200
    csp = response.headers["content-security-policy"]
    assert "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net" in csp
    assert "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net" in csp
    assert "connect-src 'self'" in csp


async def test_api_csp_remains_restricted(client: httpx.AsyncClient) -> None:
    response = await client.get("/health/live")

    assert response.status_code == 200
    csp = response.headers["content-security-policy"]
    assert "script-src 'self' https://cdn.shopify.com" in csp
    assert "cdn.jsdelivr.net" not in csp


@pytest.mark.parametrize("path", ["/", "/appearance", "/features", "/upsell", "/checkout"])
async def test_admin_routes_serve_the_embedded_app(
    client: httpx.AsyncClient, path: str
) -> None:
    response = await client.get(path)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith(("text/html", "text/plain"))
