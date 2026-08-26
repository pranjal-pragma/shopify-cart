# Project Memory Bank

This directory is the shared memory bank for developers and coding agents working on
pragma-site-cart. Read it before making changes that affect application behavior,
architecture, integrations, configuration, or developer workflow.

## Required maintenance

Every agent must update the relevant files in this directory whenever a change makes the
documented information incomplete or inaccurate. Documentation updates are part of the
implementation, not an optional follow-up.

Do not copy secrets, access tokens, store credentials, or `.env` values into this directory.

## Contents

- [agent-guide.md](agent-guide.md): required workflow and documentation rules for agents.
- [architecture.md](architecture.md): system boundaries, data flow, and repository map.
- [cart-contracts.md](cart-contracts.md): storefront APIs, selectors, events, and cart markers.
- [development.md](development.md): local startup, builds, tests, and verification.
- [decisions.md](decisions.md): durable technical decisions and their consequences.

## Quick orientation

- Backend: FastAPI, Pydantic, SQLAlchemy, PostgreSQL, and Shopify Admin GraphQL.
- Admin UI: React, TypeScript, Vite, Shopify App Bridge, and Polaris web components.
- Storefront: Shopify theme app extension in `extensions/pragma-site-cart`.
- Checkout enforcement: Shopify Discount Function in `extensions/free-gift-discount`.
- Canonical storefront source: `theme-src`; generated bundles are written into the theme
  extension's `assets` directory.

