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


def make_token(
    *,
    audience: str = "client-id",
    destination: str = "https://example-shop.myshopify.com",
    secret: str = TEST_SECRET,
    expires_delta: timedelta = timedelta(minutes=1),
) -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "aud": audience,
            "dest": destination,
            "sub": "42",
            "iat": now,
            "nbf": now - timedelta(seconds=1),
            "exp": now + expires_delta,
        },
        secret,
        algorithm="HS256",
    )


def test_decode_session_token() -> None:
    token = make_token()
    claims = decode_session_token(token=token, client_id="client-id", client_secret=TEST_SECRET)
    assert claims["shop_domain"] == "example-shop.myshopify.com"


def test_decode_session_token_rejects_non_shopify_destination() -> None:
    token = make_token(destination="https://attacker.example")
    with pytest.raises(AuthenticationError):
        decode_session_token(token=token, client_id="client-id", client_secret=TEST_SECRET)


@pytest.mark.parametrize(
    "token",
    [
        make_token(audience="wrong-client"),
        make_token(secret="wrong-secret-that-is-at-least-32-bytes"),
        make_token(expires_delta=timedelta(minutes=-1)),
    ],
)
def test_decode_session_token_rejects_invalid_claims(token: str) -> None:
    with pytest.raises(AuthenticationError):
        decode_session_token(token=token, client_id="client-id", client_secret=TEST_SECRET)


def test_token_cipher_rotates_previous_key() -> None:
    old_key = Fernet.generate_key().decode()
    new_key = Fernet.generate_key().decode()
    old_cipher = TokenCipher(old_key)
    cipher = TokenCipher(new_key, [old_key])

    plaintext, rotated = cipher.decrypt_with_rotation(old_cipher.encrypt("shpat_secret"))

    assert plaintext == "shpat_secret"
    assert rotated is not None
    assert TokenCipher(new_key).decrypt(rotated) == "shpat_secret"
