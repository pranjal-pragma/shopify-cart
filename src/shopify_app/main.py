from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
import structlog
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from shopify_app.api.router import api_router
from shopify_app.config import Settings, get_settings
from shopify_app.db import create_session_factory
from shopify_app.logging import configure_logging
from shopify_app.middleware import RequestContextMiddleware
from shopify_app.security import TokenCipher
from shopify_app.shopify_client import ShopifyClient

logger = structlog.get_logger()


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, json_logs=settings.env == "production")

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        session_factory = create_session_factory(settings.database_url)
        http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(settings.http_timeout_seconds),
            limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
        )
        app.state.session_factory = session_factory
        app.state.shopify_client = ShopifyClient(
            http_client=http_client,
            client_id=settings.shopify_client_id,
            client_secret=settings.shopify_client_secret.get_secret_value(),
            api_version=settings.shopify_api_version,
        )
        app.state.token_cipher = TokenCipher(settings.token_encryption_key.get_secret_value())
        logger.info("application_started", environment=settings.env)
        try:
            yield
        finally:
            await http_client.aclose()
            await session_factory.kw["bind"].dispose()
            logger.info("application_stopped")

    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        debug=settings.debug,
        docs_url="/docs" if settings.env != "production" else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.env != "production" else None,
        lifespan=lifespan,
    )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)
    app.add_middleware(RequestContextMiddleware)
    app.include_router(api_router)
    app.dependency_overrides[get_settings] = lambda: settings

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled_exception", path=request.url.path)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "internal server error"},
        )

    return app


app = create_app()
