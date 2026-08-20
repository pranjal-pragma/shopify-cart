# Shopify FastAPI starter

A production-oriented Python backend for an embedded Shopify app. It uses FastAPI, `uv`,
PostgreSQL, Shopify managed installation/session tokens, token exchange, GraphQL Admin API,
verified and deduplicated webhooks, encrypted access tokens, structured logs, and health probes.

## Start locally

Prerequisites: Python 3.12/3.13, `uv`, Docker, and Shopify CLI.

```bash
cp .env.example .env
uv sync
docker compose up -d db
uv run alembic upgrade head
uv run uvicorn shopify_app.main:app --reload
```

Generate `APP_TOKEN_ENCRYPTION_KEY` before exchanging a token:

```bash
uv run python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Then update `.env` and `shopify.app.toml` from the Shopify Dev Dashboard, and deploy the app
configuration with `shopify app deploy`. The OpenAPI UI is at `http://localhost:8000/docs` in
development only.

## Embedded app flow

1. Configure scopes in `shopify.app.toml`; Shopify managed installation handles consent.
2. The App Bridge frontend sends its short-lived session token as `Authorization: Bearer <JWT>`.
3. Call `POST /api/v1/shopify/token-exchange` once per shop (and again when an expiring token
   needs renewal). The backend validates the JWT and stores the offline token encrypted.
4. Call `POST /api/v1/shopify/graphql` with a session token and a GraphQL document. In a real app,
   prefer narrow, domain-specific backend endpoints rather than exposing a broad proxy to clients.

Shopify's REST Admin API is legacy; this starter intentionally uses GraphQL.

## Webhooks and privacy

All configured topics use `POST /api/v1/shopify/webhooks`. The handler verifies the raw-body HMAC,
validates the shop domain, deduplicates by `X-Shopify-Webhook-Id`, and records delivery metadata.
Uninstall and shop-redaction events delete stored shop credentials. Because the starter has no
customer domain tables, customer data-request/redaction events are acknowledged and scrubbed.
When adding customer data, extend those branches to export or delete it within Shopify's required
time window. Non-compliance topics remain in `received` state: connect a durable worker/queue before
subscribing to them; never run important webhook work only in FastAPI `BackgroundTasks`.

## Production checklist

- Set `APP_ENV=production`, explicit `APP_ALLOWED_HOSTS`, strong secrets, and an HTTPS app URL.
- Store secrets in your platform's secret manager. Plan Fernet key rotation before launch.
- Run `uv run alembic upgrade head` as a release step, not independently in every web replica.
- Run at least two replicas behind a load balancer. Scale replicas first in Kubernetes/serverless;
  for a single VM, add Uvicorn `--workers N`.
- Use a managed PostgreSQL service with backups, TLS, pooling, and least-privilege credentials.
- Add rate limits/WAF rules at the edge and tracing/error reporting appropriate to your platform.
- Add app-specific authorization and GraphQL allow-listing before exposing frontend features.
- Review the Shopify API version every quarter and test webhook reconciliation/retries.

## Quality commands

```bash
uv run ruff format .
uv run ruff check .
uv run mypy
uv run pytest --cov=shopify_app
uv lock --check
```

