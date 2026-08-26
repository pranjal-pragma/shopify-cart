# Architecture

## Runtime components

### Embedded admin

`admin/` contains the React and TypeScript merchant interface. It authenticates through Shopify
App Bridge, exchanges a session token with the backend, and reads or writes cart configuration
through `/api/v1/shopify/*` endpoints.

Primary screens:

- `admin/src/App.tsx`: connection state, home page, navigation, and theme activation link.
- `admin/src/CartAppearancePage.tsx`: appearance and behavioral settings.
- `admin/src/CartFeaturesPage.tsx`: cart features, gifts, rewards, and related configuration.
- `admin/src/api.ts`: frontend API contracts and authenticated requests.

### FastAPI backend

`src/shopify_app/` owns authentication, persistence, validation, and Shopify API calls.

- `main.py`: application startup and middleware registration.
- `api/`: HTTP route definitions.
- `controllers/shopify.py`: orchestration and default configuration.
- `services/shopify.py`: Shopify Admin GraphQL and metafield publishing.
- `schemas.py`: API and persisted configuration contracts.
- `models.py`: SQLAlchemy models for shops, webhooks, and cart configuration.
- `security.py`: token encryption, session validation, and webhook verification.

Cart appearance and feature settings share the `cart_appearances.configuration` JSON record.
Controllers merge only fields owned by the section being saved, which prevents one admin page
from overwriting the other section.

### Theme app extension

`extensions/pragma-site-cart/` is the Shopify theme app extension. Its app embed reads the
published `app.metafields.cart.appearance` JSON and renders the storefront side cart.

`theme-src/` contains readable JavaScript sources. `npm run build` bundles them into tracked,
minified files under `extensions/pragma-site-cart/assets/`. The Liquid block and CSS live in the
extension itself.

### Discount Function

`extensions/free-gift-discount/` contains a Shopify Product Discount Function. It validates the
configured gift offer and applies a real 100% discount to eligible marked gift lines at checkout.
Its cart-line attribute query must match the marker written by the theme extension.

## Main data flow

1. Shopify Admin loads the embedded React app.
2. App Bridge supplies a session token; the backend exchanges or validates it.
3. A merchant saves appearance or feature settings.
4. FastAPI validates and stores the merged configuration in PostgreSQL.
5. For every option in an enabled free-gift offer, the Shopify service upserts a dedicated
   unlisted gift product. Merchant-selected source variants remain read-only; generated variants
   can mirror their SKU, barcode, tracking mode, and per-location available inventory.
6. The generated gift product is published to Online Store, and the synchronized variant ID is
   written into the runtime configuration and automatic discount.
7. The Shopify service publishes the merged configuration to the app-owned cart metafield.
8. The app embed reads that metafield and applies the settings to Shopify Ajax Cart APIs.
9. For eligible free gifts, auto mode adds the first option and choice mode lets the shopper add
   exactly one option per offer. The Discount Function enforces the zero price for one allowed
   generated gift line at checkout.

## Storage and external systems

- PostgreSQL stores encrypted shop sessions, webhook deliveries, and cart configuration.
- Shopify Admin GraphQL handles app installation data, metafields, products, inventory,
  publications, and discounts.
- Shopify Ajax Cart endpoints provide live storefront cart state and mutations.
- Shopify CLI tunnels the local embedded app and bundles extensions during development.
