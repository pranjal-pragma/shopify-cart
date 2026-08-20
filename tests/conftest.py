from __future__ import annotations

from collections.abc import AsyncIterator

import httpx
import pytest
from cryptography.fernet import Fernet
from httpx import ASGITransport

from shopify_app.config import Settings
from shopify_app.db import Base
from shopify_app.main import create_app

TEST_SECRET = "test-secret-that-is-at-least-32-bytes"


@pytest.fixture
def settings() -> Settings:
    return Settings(
        env="test",
        allowed_hosts=["testserver"],
        database_url="sqlite+aiosqlite:///:memory:",
        shopify_client_id="test-client-id",
        shopify_client_secret=TEST_SECRET,
        token_encryption_key=Fernet.generate_key().decode(),
    )


@pytest.fixture
async def client(settings: Settings) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        engine = app.state.session_factory.kw["bind"]
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with httpx.AsyncClient(
            transport=ASGITransport(app=app), base_url="http://testserver"
        ) as test_client:
            yield test_client
