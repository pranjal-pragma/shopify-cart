from __future__ import annotations

import base64
import hashlib
import hmac
from uuid import uuid4

import httpx

TEST_SECRET = "test-secret-that-is-at-least-32-bytes"


def webhook_headers(body: bytes, *, secret: str = TEST_SECRET) -> dict[str, str]:
    signature = base64.b64encode(hmac.new(secret.encode(), body, hashlib.sha256).digest()).decode()
    return {
        "X-Shopify-Hmac-Sha256": signature,
        "X-Shopify-Topic": "app/uninstalled",
        "X-Shopify-Shop-Domain": "example-shop.myshopify.com",
        "X-Shopify-Webhook-Id": str(uuid4()),
        "X-Shopify-Api-Version": "2026-07",
        "Content-Type": "application/json",
    }


async def test_webhook_accepts_valid_hmac(client: httpx.AsyncClient) -> None:
    body = b'{"id": 42}'
    response = await client.post(
        "/api/v1/shopify/webhooks", content=body, headers=webhook_headers(body)
    )
    assert response.status_code == 200


async def test_webhook_rejects_invalid_hmac(client: httpx.AsyncClient) -> None:
    body = b'{"id": 42}'
    headers = webhook_headers(body)
    headers["X-Shopify-Hmac-Sha256"] = base64.b64encode(b"wrong").decode()
    response = await client.post("/api/v1/shopify/webhooks", content=body, headers=headers)
    assert response.status_code == 401
