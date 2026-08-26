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

The Discount Function queries `_pragma_site_cart_free_gift_offer`. A mismatch between the query
and the theme property causes gifts to retain their normal checkout price.

## Free-gift product identity

Every offer has two variant identities:

- `source_variant_id` and `source_variant_title` identify the merchant-selected catalog variant.
  Backend synchronization reads this variant but never modifies it.
- `variant_id` and `variant_title` identify the dedicated `pragma-site-cart` gift variant used by
  the storefront and Discount Function.

Generated products use the deterministic handle `pragma-site-cart-gift-{offer_id}`, have product
type `pragma-site-cart gift`, are `UNLISTED`, and are published to Online Store so Shopify Ajax Cart
can add them. Hidden persisted configuration `_free_gift_product_bindings` maps offer IDs to the
generated product and variant IDs for cleanup.

When `free_gifts_copy_inventory` is enabled, saving synchronizes SKU, barcode, inventory tracking,
inventory policy, and available quantities at the source variant's active locations. When it is
disabled, the generated gift variant is untracked with blank SKU and barcode. Neither mode writes
to the source product or source inventory item. Removing an offer or disabling free gifts archives
its generated product.

## Configuration naming

- The app-provided font source value is `pragma-site-cart`; `theme` selects storefront fonts.
- The checkout configuration field is `pragma_site_cart_checkout`.
- Appearance and feature fields are validated with `extra="forbid"`; add fields to both Pydantic
  and TypeScript contracts before using them.
