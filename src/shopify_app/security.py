from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import re
from typing import Any
from urllib.parse import urlparse

import jwt
from cryptography.fernet import Fernet, InvalidToken

SHOP_DOMAIN_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]*\.myshopify\.com$")


class AuthenticationError(ValueError):
    pass


def validate_shop_domain(shop_domain: str) -> str:
    normalized = shop_domain.strip().lower().rstrip(".")
    if not SHOP_DOMAIN_PATTERN.fullmatch(normalized):
        raise AuthenticationError("invalid Shopify shop domain")
    return normalized


def verify_webhook_hmac(*, body: bytes, signature: str, client_secret: str) -> bool:
    try:
        supplied = base64.b64decode(signature, validate=True)
    except (ValueError, binascii.Error):
        return False
    calculated = hmac.new(client_secret.encode(), body, hashlib.sha256).digest()
    return hmac.compare_digest(calculated, supplied)


def decode_session_token(*, token: str, client_id: str, client_secret: str) -> dict[str, Any]:
    try:
        claims: dict[str, Any] = jwt.decode(
            token,
            client_secret,
            algorithms=["HS256"],
            audience=client_id,
            options={"require": ["aud", "dest", "exp", "iat", "nbf", "sub"]},
        )
    except jwt.PyJWTError as exc:
        raise AuthenticationError("invalid Shopify session token") from exc

    destination = urlparse(str(claims["dest"]))
    if destination.scheme != "https" or not destination.hostname:
        raise AuthenticationError("invalid session token destination")
    claims["shop_domain"] = validate_shop_domain(destination.hostname)
    return claims


class TokenCipher:
    def __init__(self, key: str, previous_keys: list[str] | None = None) -> None:
        try:
            self._fernet = Fernet(key.encode())
            self._previous_fernets = [Fernet(item.encode()) for item in previous_keys or []]
        except (ValueError, TypeError) as exc:
            raise ValueError("token encryption keys must be valid Fernet keys") from exc

    def encrypt(self, value: str) -> bytes:
        return self._fernet.encrypt(value.encode())

    def decrypt(self, value: bytes) -> str:
        plaintext, _ = self.decrypt_with_rotation(value)
        return plaintext

    def decrypt_with_rotation(self, value: bytes) -> tuple[str, bytes | None]:
        try:
            return self._fernet.decrypt(value).decode(), None
        except InvalidToken:
            pass

        for previous in self._previous_fernets:
            try:
                plaintext = previous.decrypt(value).decode()
                return plaintext, self.encrypt(plaintext)
            except InvalidToken:
                continue
        raise AuthenticationError("stored token could not be decrypted")
