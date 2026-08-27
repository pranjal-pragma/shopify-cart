# Cart Contracts

These names connect the admin configuration, backend schema, theme extension, custom scripts,
and Shopify Discount Function. Change them together.

## Product identity

- Product and extension display name: `pragma-site-cart`
- Theme extension directory: `extensions/pragma-site-cart`
- Theme extension handle: `pragma-site-cart`
- Theme source package: `pragma-site-cart-theme-extension`

## Storefront assets

- `pragma-site-cart.js`: drawer rendering and public browser API.
- `pragma-site-cart-extras.js`: announcements, totals, savings, and custom scripts.
- `pragma-site-cart-settings.js`: cart interception, sticky cart, limits, and product behavior.
- `pragma-site-cart-scarcity.js`: urgency and sales countdown timers.
- `pragma-site-cart-features.js`: notes, rewards, add-ons, discounts, and swaps.
- `pragma-site-cart-gifts.js`: gift eligibility and cart mutations.
- `pragma-site-cart-upsell.js`: AI and rule-based recommendation rendering and cart mutations.
- `pragma-site-cart.css`: all storefront drawer styling.

## Browser API and events

The public API is available as `window.pragmaSiteCart` after initialization. It exposes the root,
frozen configuration, `open`, `close`, `refresh`, `sync`, `getCart`, and `on` helpers.

Lifecycle events:

- `pragma-site-cart:cart:ready`
- `pragma-site-cart:cart:rendered`
- `pragma-site-cart:cart:opened`
- `pragma-site-cart:cart:closed`
- `pragma-site-cart:custom-script:ready`
- `pragma-site-cart:custom-script:error`
- `PragmaSiteCartAtcButtonClicked`

Custom scripts receive `pragmaSiteCart` and `configuration` arguments.

The Cart Features coupon form applies codes through the locale-aware Shopify Ajax Cart
`cart/update.js` endpoint using its `discount` field. Applied codes are derived from cart-level and
line-level discount applications, totals are refreshed through `pragmaSiteCart.sync()`, and posting
an empty discount string removes all entered coupon codes. Checkout remains a normal `/checkout`
navigation because Shopify owns discount validation and calculation.

## Tiered rewards

Tiered reward rows are presentation and eligibility rules; Shopify remains the source of truth for
the monetary fulfillment:

- `free_gift` links to one configured free-gift offer. On save, the backend aligns that offer's
  eligibility condition with the tier goal. The generated gift variant and Discount Function make
  the selected gift genuinely free at checkout.
- `discount` links to an active Shopify code or automatic discount with an `ORDER` or `PRODUCT`
  discount class.
- `free_shipping` links to an active Shopify code or automatic discount with the `SHIPPING` class.
- `custom` is display-only and does not mutate the Shopify cart.

Discount choices come from `GET /api/v1/shopify/discounts`, which reads active code and automatic
discounts from Shopify Admin GraphQL. The storefront reconciles unlocked code discounts through
Shopify's Ajax Cart API; Shopify applies automatic discounts itself. Configure the Shopify discount's
own eligibility and minimums to agree with the tier because Shopify performs final checkout validation.

Each milestone uses a Lucide icon matching its reward type. Newly unlocked rewards trigger a
drawer-wide confetti overlay once per page session; the overlay is decorative and ignores pointer
events.

Embedded admin sidebar links use pathname routes (`/appearance`, `/features`, `/upsell`, and
`/checkout`) because Shopify App Bridge navigation does not use URL fragments for destination
matching. FastAPI serves the admin SPA index at each route.

When `block_cart_page_redirection` is enabled, the settings bundle owns recognized storefront cart
triggers. It intercepts clicks during window capture, prevents navigation, stops theme click
handlers, opens `pragma-site-cart`, and hides common native cart drawers and notifications. Built-in
detection covers `/cart` links, Dawn cart-icon markers, common `data-*` cart triggers,
`button[name="cart"]`, and controls whose `aria-controls` value references a cart. Merchants can
extend trigger and drawer detection with `custom_cart_icon_selectors` and
`custom_cart_drawer_selectors`.

When the terms checkbox is enabled but unchecked, the drawer removes the checkout link's `href` and
blocks pointer and keyboard activation during event capture. Once the shopper accepts the terms, the
original checkout URL is restored. This prevents theme-level click handlers and normal anchor
navigation from bypassing the configured requirement.

## DOM and CSS namespace

- Root marker: `data-pragma-site-cart-root`
- Internal data attributes: `data-psc-*`
- Storefront CSS classes and custom properties: `psc-*` and `--psc-*`
- JavaScript dataset properties corresponding to `data-psc-*`: `dataset.psc*`

## Cart line markers

Private Shopify line-item properties use the `_pragma_site_cart_*` namespace:

- `_pragma_site_cart_free_gift`
- `_pragma_site_cart_free_gift_offer`
- `_pragma_site_cart_one_tick`
- `_pragma_site_cart_upsell`
- `_pragma_site_cart_swap`

The upsell API is isolated at `/api/v1/shopify/upsell`. Shopify's Product Recommendations Ajax
endpoint supplies AI results. Rule-based recommendations store the selected product variant,
product identity, handle, image, and price so the theme can render and add the line. Product rules
match cart product GIDs directly. Collection rules use the product IDs returned with the Shopify
resource-picker selection; keep those snapshots current when collection membership changes.

`upsell_variant_behavior=variant_popup` opens option selection when a recommendation has multiple
available variants. `product_popup` always opens a details dialog. Added lines carry
`_pragma_site_cart_upsell=true`, and `upsell_cap_quantity` limits quantities added through the
recommendation UI without changing the catalog or inventory.

The Discount Function queries `_pragma_site_cart_free_gift_offer`. A mismatch between the query
and the theme property causes gifts to retain their normal checkout price.

## Free-gift product identity

Every entry in `gift_variants` has two variant identities:

- `source_variant_id` and `source_variant_title` identify the merchant-selected catalog variant.
  Backend synchronization reads this variant but never modifies it.
- `variant_id` and `variant_title` identify its dedicated `pragma-site-cart` gift variant used by
  the storefront and Discount Function. The singular fields on the offer mirror the first option
  for backward compatibility.

The primary generated product uses `pragma-site-cart-gift-{offer_id}`; additional options use
`pragma-site-cart-gift-{offer_id}-{gift_option_id}`. Products have type `pragma-site-cart gift`, are
`UNLISTED`, and are published to Online Store so Shopify Ajax Cart can add them. Hidden persisted
configuration `_free_gift_product_bindings` maps offer-option keys to generated IDs for cleanup.
The generated product copies the source product's customer-facing title, variant title, and image;
the technical gift identity remains only in its handle, product type, tags, and private cart-line
properties. Re-saving a gift configuration repairs these display fields on existing generated
products.

`free_gift_method=auto` adds the first configured option. `free_gift_method=choice` renders all
options but permits only one selected gift line per offer. The Discount Function receives every
allowed generated variant ID and discounts at most one matching marked line.

The choice-mode gift selector is inserted inside `.psc-cart-content` immediately before
`[data-psc-items]`, so it scrolls with and always precedes the product lines. Its option rows use
the `.psc-cart-gift-option` namespace and expose their selected state through `aria-pressed` and
the `is-selected` class.

When `free_gifts_copy_inventory` is enabled, saving synchronizes SKU, barcode, inventory tracking,
inventory policy, and available quantities at the source variant's active locations. When it is
disabled, the generated gift variant is untracked with blank SKU and barcode. Neither mode writes
to the source product or source inventory item. Removing an offer or disabling free gifts archives
its generated product. Disabling Free Gifts preserves the offer configuration so a merchant can
re-enable it later without rebuilding the campaign.
Gift-product archive mutations request only the portable `field` and `message` user-error fields;
`ProductUpdatePayload.userErrors` does not expose `code` in the configured Shopify API version.
Product archiving and automatic-discount deletion are idempotent cleanup operations: Shopify
`does not exist` and `not found` responses are treated as already cleaned, allowing a disable save
to recover after a partially completed request.

Free-gift product and Discount Function synchronization runs only when `free_gifts_enabled`,
`free_gifts_copy_inventory`, `free_gift_method`, or `free_gift_offers` changes. Saves to unrelated
Cart Features fields preserve the stored gift bindings and discount IDs and publish only the shared
cart configuration. This prevents a stale gift campaign from blocking notes, rewards, add-ons, or
other feature saves.

## Configuration naming

- The app-provided font source value is `pragma-site-cart`; `theme` selects storefront fonts.
- The checkout configuration field is `pragma_site_cart_checkout`.
- Appearance and feature fields are validated with `extra="forbid"`; add fields to both Pydantic
  and TypeScript contracts before using them.
