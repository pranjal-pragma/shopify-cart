from __future__ import annotations

import base64
import hashlib
import hmac
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from cryptography.fernet import Fernet

from shopify_app.security import (
    AuthenticationError,
    TokenCipher,
    decode_session_token,
    verify_webhook_hmac,
)

TEST_SECRET = "test-secret-that-is-at-least-32-bytes"


def test_verify_webhook_hmac() -> None:
    body = b'{"id": 42}'
    signature = base64.b64encode(
        hmac.new(TEST_SECRET.encode(), body, hashlib.sha256).digest()
    ).decode()
    assert verify_webhook_hmac(body=body, signature=signature, client_secret=TEST_SECRET)
    assert not verify_webhook_hmac(body=body + b" ", signature=signature, client_secret=TEST_SECRET)
    assert not verify_webhook_hmac(body=body, signature="not-base64!", client_secret=TEST_SECRET)


def test_token_cipher_round_trip() -> None:
    cipher = TokenCipher(Fernet.generate_key().decode())
    encrypted = cipher.encrypt("shpat_secret")
    assert encrypted != b"shpat_secret"
    assert cipher.decrypt(encrypted) == "shpat_secret"


def test_decode_session_token() -> None:
    now = datetime.now(UTC)
    token = jwt.encode(
        {
            "aud": "client-id",
            "dest": "https://example-shop.myshopify.com",
            "sub": "42",
            "iat": now,
            "nbf": now - timedelta(seconds=1),
            "exp": now + timedelta(minutes=1),
        },
        TEST_SECRET,
        algorithm="HS256",
    )
    claims = decode_session_token(token=token, client_id="client-id", client_secret=TEST_SECRET)
    assert claims["shop_domain"] == "example-shop.myshopify.com"


def test_decode_session_token_rejects_non_shopify_destination() -> None:
    now = datetime.now(UTC)
    token = jwt.encode(
        {
            "aud": "client-id",
            "dest": "https://attacker.example",
            "sub": "42",
            "iat": now,
            "nbf": now - timedelta(seconds=1),
            "exp": now + timedelta(minutes=1),
        },
        TEST_SECRET,
        algorithm="HS256",
    )
    with pytest.raises(AuthenticationError):
        decode_session_token(token=token, client_id="client-id", client_secret=TEST_SECRET)
