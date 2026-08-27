# Development

## Prerequisites

- Python 3.12 or 3.13 with `uv`
- Node.js and npm
- PostgreSQL
- Shopify CLI and access to the configured development store

Use `.env.example` and `admin/.env.example` as templates. Never commit real credentials.

The free-gift product and inventory synchronization requires these Shopify scopes:

`read_products,write_products,read_inventory,write_inventory,read_publications,write_publications,read_discounts,write_discounts`

After adding or changing scopes, regenerate `shopify.app.toml`, restart `shopify app dev`, and
approve the updated permissions for the development store.

## Install and prepare

```bash
uv sync --dev
npm install
npm --prefix admin install
npm --prefix theme-src install
docker compose up -d db
uv run alembic upgrade head
uv run python scripts/render_shopify_config.py
```

## Run with Shopify

The recommended command starts Shopify CLI, the FastAPI web process, the admin frontend build,
and extension watchers:

```bash
npm run dev
```

Shopify CLI selects available local ports and prints the current preview URLs. Do not assume a
fixed backend port during Shopify development.

For backend-only work:

```bash
uv run python scripts/run_shopify_dev.py
```

## Build commands

```bash
npm --prefix admin run build
npm --prefix theme-src run build
npm --prefix extensions/free-gift-discount run build
```

The theme build must be run after every `theme-src` change because the generated extension
assets are committed.

## Quality checks

```bash
uv run ruff check src tests
uv run mypy src
uv run pytest
npm --prefix admin run build
npm --prefix theme-src run build
npm --prefix extensions/free-gift-discount test -- --run
```

When a Shopify development session is active, also confirm that theme check, function build, and
preview update finish successfully in the CLI output.

## Useful URLs and endpoints

- Admin API prefix: `/api/v1/shopify`
- Health probes: `/health/live` and `/health/ready`
- Main admin routes: `/`, `#appearance`, and `#features`

The embedded app should be opened from Shopify Admin so App Bridge has the required host and
session context. The local `?preview=1` mode is for isolated admin UI development only.
