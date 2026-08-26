# Decision Log

Add new entries at the top. Record the date, decision, reason, and consequences. Do not rewrite
past decisions unless they are factually incorrect; add a superseding entry instead.

## 2026-08-26: Use one product namespace everywhere

**Decision:** The complete application uses `pragma-site-cart` as its product, extension, asset,
event, configuration, and storefront namespace. Internal DOM/CSS shorthand is `psc`.

**Reason:** A single identity avoids leaking former or unrelated branding through developer APIs,
theme source, generated assets, and Shopify configuration.

**Consequences:** Browser APIs, custom events, line-item properties, selectors, saved field names,
and extension activation handles are intentionally breaking contracts. New code must use the
contracts in [cart-contracts.md](cart-contracts.md).

## 2026-08-26: Enforce free gifts with a Discount Function

**Decision:** The theme extension manages gift eligibility and cart-line insertion, while a Shopify
Product Discount Function applies the real 100% checkout discount.

**Reason:** Displaying a `FREE` label or changing drawer totals cannot alter Shopify checkout
pricing.

**Consequences:** Gift cart markers, Function input queries, offer configuration, and discount
deployment must remain synchronized.

## 2026-08-26: Keep readable theme source separate from bundled assets

**Decision:** Storefront JavaScript is edited in `theme-src` and bundled into the theme extension.

**Reason:** This keeps implementation reviewable while delivering small minified assets to
Shopify.

**Consequences:** Every storefront JavaScript change requires `npm --prefix theme-src run build`,
and both source and generated assets belong in the same commit.
