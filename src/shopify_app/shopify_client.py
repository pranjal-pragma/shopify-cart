from __future__ import annotations

import asyncio
from typing import Any

import httpx

from shopify_app.schemas import ShopifyInstallationIdentity, TokenExchangeResponse
from shopify_app.security import validate_shop_domain

TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange"  # noqa: S105
ID_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:id_token"  # noqa: S105
OFFLINE_TOKEN_TYPE = "urn:shopify:params:oauth:token-type:offline-access-token"  # noqa: S105


class ShopifyUpstreamError(RuntimeError):
    pass


class ShopifyClient:
    def __init__(
        self,
        *,
        http_client: httpx.AsyncClient,
        client_id: str,
        client_secret: str,
        api_version: str,
    ) -> None:
        self._http = http_client
        self._client_id = client_id
        self._client_secret = client_secret
        self._api_version = api_version

    async def _post_with_retry(self, url: str, **kwargs: Any) -> httpx.Response:
        for attempt in range(3):
            try:
                response = await self._http.post(url, **kwargs)
            except httpx.HTTPError:
                if attempt == 2:
                    raise
            else:
                if response.status_code != 429 and response.status_code < 500:
                    return response
                if attempt == 2:
                    return response
            await asyncio.sleep(0.1 * (2**attempt))
        raise AssertionError("retry loop exited unexpectedly")

    async def exchange_session_token(
        self, *, shop_domain: str, session_token: str
    ) -> TokenExchangeResponse:
        shop_domain = validate_shop_domain(shop_domain)
        response = await self._post_with_retry(
            f"https://{shop_domain}/admin/oauth/access_token",
            data={
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "grant_type": TOKEN_EXCHANGE_GRANT,
                "subject_token": session_token,
                "subject_token_type": ID_TOKEN_TYPE,
                "requested_token_type": OFFLINE_TOKEN_TYPE,
            },
        )
        if response.is_error:
            raise ShopifyUpstreamError(f"Shopify token exchange failed ({response.status_code})")
        return TokenExchangeResponse.model_validate(response.json())

    async def graphql(
        self,
        *,
        shop_domain: str,
        access_token: str,
        query: str,
        variables: dict[str, Any],
    ) -> dict[str, Any]:
        shop_domain = validate_shop_domain(shop_domain)
        response = await self._post_with_retry(
            f"https://{shop_domain}/admin/api/{self._api_version}/graphql.json",
            headers={"X-Shopify-Access-Token": access_token},
            json={"query": query, "variables": variables},
        )
        if response.is_error:
            raise ShopifyUpstreamError(f"Shopify GraphQL request failed ({response.status_code})")
        payload: dict[str, Any] = response.json()
        return payload

    async def get_installation_identity(
        self, *, shop_domain: str, access_token: str
    ) -> ShopifyInstallationIdentity:
        payload = await self.graphql(
            shop_domain=shop_domain,
            access_token=access_token,
            query="query AuthenticationBootstrap { shop { id } currentAppInstallation { id } }",
            variables={},
        )
        try:
            data = payload["data"]
            return ShopifyInstallationIdentity(
                shop_gid=data["shop"]["id"],
                app_installation_gid=data["currentAppInstallation"]["id"],
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ShopifyUpstreamError("Shopify returned invalid installation identity") from exc
