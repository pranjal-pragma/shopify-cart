# Shopify FastAPI starter

A production-oriented Python backend for an embedded Shopify app. It uses FastAPI, `uv`,
PostgreSQL, Shopify managed installation/session tokens, token exchange, GraphQL Admin API,
verified and deduplicated webhooks, encrypted access tokens, structured logs, and health probes.

## Start locally

Prerequisites: Python 3.12/3.13, `uv`, Docker, and Shopify CLI.

The Docker PostgreSQL service is exposed on `localhost:5433` so it does not conflict with a native
PostgreSQL server using the default port `5432`. The example application configuration already
targets port `5433`.

```bash
cp .env.example .env
# Set APP_SHOPIFY_CLIENT_ID and APP_SHOPIFY_APP_URL, then generate the local Shopify config.
uv run python scripts/render_shopify_config.py
uv sync
docker compose up -d db
uv run alembic upgrade head
uv run uvicorn shopify_app.main:app --reload
```

In a second terminal, start the embedded React admin during development:

```bash
cd admin
cp .env.example .env
npm install
npm run dev
```

Set the Shopify app URL to the Vite/Shopify CLI development URL. In production, the Docker image
builds the admin into the FastAPI image; pass `VITE_SHOPIFY_API_KEY` as a Docker build argument.
`shopify.app.toml` is generated from `.env` and ignored by Git; commit changes to
`shopify.app.template.toml` when updating scopes, webhooks, or other shared Shopify configuration.

To run the full embedded-app preview with an existing ngrok tunnel, stop any separately running
Uvicorn process first, then let Shopify CLI manage the FastAPI process and its assigned port:

```bash
uv run python scripts/render_shopify_config.py
shopify app dev --tunnel-url=https://your-ngrok-hostname.ngrok-free.app:8000
```

## Debug the backend in VS Code

Install Microsoft's Python and Python Debugger VS Code extensions before using the checked-in
launch configurations. Debug mode intentionally runs without Uvicorn auto-reload so breakpoints
remain attached to one process.

For local debugging, start PostgreSQL and apply migrations:

```bash
docker compose up -d db
uv run alembic upgrade head
```

Open **Run and Debug** in VS Code, select **FastAPI: Debug Local**, and press F5. Set a breakpoint in
an endpoint and request `http://127.0.0.1:8000/health/live` to trigger it.

For container debugging, build and start the debug-only Compose profile:

```bash
docker compose --profile debug up --build app-debug
```

The container waits before starting Uvicorn. Select **FastAPI: Attach Docker** in VS Code and press
F5 to resume it. Ports 8000 and 5678 bind only to localhost. The standard production Docker target
does not install `debugpy` or expose its port.

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
3. The admin calls `POST /api/v1/shopify/token-exchange`. The backend validates the JWT, exchanges
   it for an offline token, stores it encrypted, and records the Shopify installation identity.
4. The admin calls `GET /api/v1/shopify/me` to load the authenticated shop and onboarding state.
   Shopify Admin API access remains behind narrow backend services; no public GraphQL proxy exists.

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
