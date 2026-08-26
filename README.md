# pragma-site-cart

An embedded Shopify side-cart application with a FastAPI backend, React admin, theme app
extension, and Shopify Discount Function.

## Project memory bank

Read [`docs/README.md`](docs/README.md) before changing the project. Developers and coding agents
must update the relevant memory-bank files whenever implementation changes make them inaccurate.

## Run the project locally

### Prerequisites

Install the following before continuing:

- Python 3.12 or 3.13
- [`uv`](https://docs.astral.sh/uv/)
- Docker with Docker Compose
- Node.js 22 and npm
- [Shopify CLI](https://shopify.dev/docs/api/shopify-cli)
- A Shopify app and a development store

The local PostgreSQL container is exposed on `localhost:5433`, avoiding a conflict with a native
PostgreSQL instance on the default port `5432`.

### 1. Install dependencies

From the repository root:

```bash
uv sync
npm --prefix admin ci
```

### 2. Configure environment variables

Create the backend and admin environment files:

```bash
cp .env.example .env
cp admin/.env.example admin/.env
```

Generate an encryption key:

```bash
uv run python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Copy the generated value into `APP_TOKEN_ENCRYPTION_KEY` in `.env`, then configure these values:

```dotenv
APP_SHOPIFY_APP_NAME=pragma-site-cart
APP_SHOPIFY_APP_URL=https://your-tunnel-hostname.example
APP_SHOPIFY_CLIENT_ID=your-dev-dashboard-client-id
APP_SHOPIFY_CLIENT_SECRET=your-dev-dashboard-client-secret
APP_TOKEN_ENCRYPTION_KEY=your-generated-fernet-key
```

Set the same client ID in `admin/.env`:

```dotenv
VITE_SHOPIFY_API_KEY=your-dev-dashboard-client-id
```

`APP_SHOPIFY_APP_URL` must be an absolute HTTPS URL. When using a custom ngrok tunnel, use its
public hostname here. Shopify CLI can update the development URL automatically when it manages the
tunnel.

### 3. Start PostgreSQL and apply migrations

```bash
docker compose up -d db
docker compose ps
uv run alembic upgrade head
```

The database is ready when `docker compose ps` reports the `db` service as healthy.

### 4. Generate the Shopify configuration

```bash
uv run python scripts/render_shopify_config.py
```

This creates `shopify.app.toml` from `.env` and `shopify.app.template.toml`. The generated file is
ignored by Git. Change scopes, webhook subscriptions, or shared Shopify settings in
`shopify.app.template.toml`, then rerun the command.

### 5. Build the admin frontend

```bash
npm --prefix admin run build
```

FastAPI serves the resulting `admin/dist` files at `/`. Rebuild the admin after frontend changes
when using the Shopify CLI workflow below.

### 6. Run the embedded app with Shopify CLI (recommended)

Let Shopify CLI start FastAPI using the command in `shopify.web.toml`:

```bash
shopify app dev --store=your-development-store.myshopify.com
```

Follow the URL printed by Shopify CLI to install or open the app in Shopify Admin. Do not start a
second Uvicorn process for this workflow; Shopify CLI supplies the port and manages the backend
process.

To use an existing ngrok tunnel instead of Shopify CLI's tunnel, start ngrok first and run:

```bash
shopify app dev \
  --store=your-development-store.myshopify.com \
  --tunnel-url=https://your-ngrok-hostname.ngrok-free.app:8000
```

The port after the tunnel hostname is the local app port Shopify CLI should forward to.

### Backend-only development

To run FastAPI without Shopify CLI:

```bash
docker compose up -d db
uv run alembic upgrade head
uv run uvicorn shopify_app.main:app --host 127.0.0.1 --port 8000 --reload
```

Useful local endpoints:

- API documentation: `http://127.0.0.1:8000/docs`
- Liveness probe: `http://127.0.0.1:8000/health/live`
- Readiness probe: `http://127.0.0.1:8000/health/ready`

Shopify authentication and App Bridge session tokens require the embedded Shopify Admin preview.

For Vite hot reload, keep the backend running and start the admin separately in another terminal:

```bash
npm --prefix admin run dev
```

Vite runs on `http://127.0.0.1:5173` and proxies `/api` requests to FastAPI on port `8000`.

### Daily startup

After the first-time setup, the usual startup sequence is:

```bash
docker compose up -d db
uv run alembic upgrade head
uv run python scripts/render_shopify_config.py
npm --prefix admin run build
shopify app dev --store=your-development-store.myshopify.com
```

Stop the database when finished:

```bash
docker compose down
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
