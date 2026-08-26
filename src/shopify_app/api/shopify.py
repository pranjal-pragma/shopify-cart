from __future__ import annotations

from typing import Annotated, cast

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from shopify_app.config import Settings, get_settings
from shopify_app.controllers import shopify as shopify_controller
from shopify_app.db import get_db
from shopify_app.schemas import (
    CartAppearanceConfiguration,
    CartAppearanceResponse,
    CartFeaturesConfiguration,
    CartFeaturesResponse,
    MerchantResponse,
    ShopConnectionResponse,
)
from shopify_app.security import (
    AuthenticationError,
    TokenCipher,
    decode_session_token,
)
from shopify_app.shopify_client import ShopifyClient

router = APIRouter(prefix="/shopify", tags=["shopify"])
bearer = HTTPBearer(auto_error=False)


def get_shopify_client(request: Request) -> ShopifyClient:
    return cast(ShopifyClient, request.app.state.shopify_client)


def get_token_cipher(request: Request) -> TokenCipher:
    return cast(TokenCipher, request.app.state.token_cipher)


def authenticate_session_token(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> tuple[str, str]:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing bearer token")
    try:
        claims = decode_session_token(
            token=credentials.credentials,
            client_id=settings.shopify_client_id,
            client_secret=settings.shopify_client_secret.get_secret_value(),
        )
    except AuthenticationError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    return credentials.credentials, str(claims["shop_domain"])


@router.post("/token-exchange", response_model=ShopConnectionResponse)
async def token_exchange(
    auth: Annotated[tuple[str, str], Depends(authenticate_session_token)],
    db: Annotated[AsyncSession, Depends(get_db)],
    client: Annotated[ShopifyClient, Depends(get_shopify_client)],
    cipher: Annotated[TokenCipher, Depends(get_token_cipher)],
) -> ShopConnectionResponse:
    return await shopify_controller.exchange_token(
        auth=auth,
        db=db,
        client=client,
        cipher=cipher,
    )


@router.get("/me", response_model=MerchantResponse)
async def merchant_identity(
    auth: Annotated[tuple[str, str], Depends(authenticate_session_token)],
    db: Annotated[AsyncSession, Depends(get_db)],
    cipher: Annotated[TokenCipher, Depends(get_token_cipher)],
) -> MerchantResponse:
    return await shopify_controller.merchant_identity(auth=auth, db=db, cipher=cipher)


@router.get("/appearance", response_model=CartAppearanceResponse)
async def cart_appearance(
    auth: Annotated[tuple[str, str], Depends(authenticate_session_token)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CartAppearanceResponse:
    return await shopify_controller.get_cart_appearance(auth=auth, db=db)


@router.put("/appearance", response_model=CartAppearanceResponse)
async def update_cart_appearance(
    configuration: CartAppearanceConfiguration,
    auth: Annotated[tuple[str, str], Depends(authenticate_session_token)],
    db: Annotated[AsyncSession, Depends(get_db)],
    client: Annotated[ShopifyClient, Depends(get_shopify_client)],
    cipher: Annotated[TokenCipher, Depends(get_token_cipher)],
) -> CartAppearanceResponse:
    return await shopify_controller.save_cart_appearance(
        auth=auth, configuration=configuration, db=db, client=client, cipher=cipher
    )


@router.get("/features", response_model=CartFeaturesResponse)
async def cart_features(
    auth: Annotated[tuple[str, str], Depends(authenticate_session_token)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CartFeaturesResponse:
    return await shopify_controller.get_cart_features(auth=auth, db=db)


@router.put("/features", response_model=CartFeaturesResponse)
async def update_cart_features(
    configuration: CartFeaturesConfiguration,
    auth: Annotated[tuple[str, str], Depends(authenticate_session_token)],
    db: Annotated[AsyncSession, Depends(get_db)],
    client: Annotated[ShopifyClient, Depends(get_shopify_client)],
    cipher: Annotated[TokenCipher, Depends(get_token_cipher)],
) -> CartFeaturesResponse:
    return await shopify_controller.save_cart_features(
        auth=auth, configuration=configuration, db=db, client=client, cipher=cipher
    )


@router.post("/webhooks", status_code=status.HTTP_200_OK)
async def receive_webhook(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
    x_shopify_hmac_sha256: Annotated[str | None, Header()] = None,
    x_shopify_topic: Annotated[str | None, Header()] = None,
    x_shopify_shop_domain: Annotated[str | None, Header()] = None,
    x_shopify_webhook_id: Annotated[str | None, Header()] = None,
    x_shopify_api_version: Annotated[str | None, Header()] = None,
) -> Response:
    return await shopify_controller.receive_webhook(
        request=request,
        db=db,
        settings=settings,
        x_shopify_hmac_sha256=x_shopify_hmac_sha256,
        x_shopify_topic=x_shopify_topic,
        x_shopify_shop_domain=x_shopify_shop_domain,
        x_shopify_webhook_id=x_shopify_webhook_id,
        x_shopify_api_version=x_shopify_api_version,
    )
