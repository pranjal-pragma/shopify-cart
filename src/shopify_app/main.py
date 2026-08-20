from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import structlog
from fastapi import FastAPI, Request, status
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from shopify_app.api.router import api_router
from shopify_app.config import Settings, get_settings
from shopify_app.db import create_session_factory
from shopify_app.logging import configure_logging
from shopify_app.middleware import RequestContextMiddleware
from shopify_app.security import TokenCipher
from shopify_app.shopify_client import ShopifyClient

logger = structlog.get_logger()
ADMIN_DIST = Path(__file__).resolve().parents[2] / "admin" / "dist"
README_PATH = Path(__file__).resolve().parents[2] / "README.md"


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
        app.state.token_cipher = TokenCipher(
            settings.token_encryption_key.get_secret_value(),
            [key.get_secret_value() for key in settings.token_encryption_previous_keys],
        )
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
    app.mount(
        "/assets",
        StaticFiles(directory=ADMIN_DIST / "assets", check_dir=False),
        name="admin-assets",
    )

    @app.middleware("http")
    async def embedded_app_security_headers(request: Request, call_next):  # type: ignore[no-untyped-def]
        response = await call_next(request)
        if settings.env != "production" and request.url.path.startswith("/docs"):
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; "
                "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
                "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
                "img-src 'self' data: https:; "
                "connect-src 'self'; "
                "frame-ancestors 'self'"
            )
        else:
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; "
                "script-src 'self' https://cdn.shopify.com; "
                "style-src 'self' 'unsafe-inline'; "
                "img-src 'self' data: https:; "
                "connect-src 'self' https://*.myshopify.com https://admin.shopify.com; "
                "frame-ancestors https://admin.shopify.com https://*.myshopify.com"
            )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response

    @app.get("/", include_in_schema=False)
    async def admin_index() -> FileResponse:
        index = ADMIN_DIST / "index.html"
        if not index.is_file():
            return FileResponse(  # pragma: no cover - exercised only in packaged deployments
                README_PATH, media_type="text/plain"
            )
        return FileResponse(index)

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled_exception", path=request.url.path)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "internal server error"},
        )

    return app


app = create_app()
