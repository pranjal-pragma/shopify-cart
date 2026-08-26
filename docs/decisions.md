# Decision Log

Add new entries at the top. Record the date, decision, reason, and consequences. Do not rewrite
past decisions unless they are factually incorrect; add a superseding entry instead.

## 2026-08-26: Model customer gift choice inside an offer

**Decision:** A free-gift offer owns one to twelve ordered gift options. Auto mode uses the first;
choice mode lets a shopper select exactly one option for that offer.

**Reason:** Treating separate offers as gift choices duplicated eligibility settings and allowed a
shopper to add every eligible offer instead of making one selection.

**Consequences:** Each option has its own source and generated variant identities and dedicated
Shopify product. The Discount Function accepts all generated option IDs but discounts only one
marked line per offer. Legacy singular gift offers migrate into a `primary` option.

## 2026-08-26: Isolate free-gift inventory from catalog products

**Decision:** Each free-gift offer uses a dedicated unlisted product and variant. The selected
catalog variant is a read-only source for optional SKU, barcode, tracking, and location inventory
synchronization.

**Reason:** Free-gift checkout and OMS behavior require a real Shopify variant, but changing the
merchant's original product or inventory would affect normal storefront sales.

**Consequences:** Offers persist both source and runtime variant identities. Saving gift settings
requires product, inventory, publication, and discount scopes; removed or disabled offers archive
their generated products. Inventory synchronization currently runs when the feature configuration
is saved, not continuously in response to inventory webhooks.

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
