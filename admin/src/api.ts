export interface Merchant {
  shop_domain: string;
  connected: boolean;
  scopes: string[];
  onboarding_completed: boolean;
}

export interface RichTextStyle {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  font_size: 12 | 14 | 16 | 18 | 20;
}

export interface AnnouncementBanner {
  id: string;
  title: RichTextStyle;
  show_subtext: boolean;
  subtext: RichTextStyle;
  conditions: BannerCondition[];
}

export type BannerConditionType = 'cart_quantity' | 'cart_value' | 'product_title';
export type BannerConditionOperator = 'greater_than' | 'less_than' | 'equals' | 'contains' | 'does_not_contain';

export interface BannerCondition {
  id: string;
  type: BannerConditionType;
  operator: BannerConditionOperator;
  value: string;
}

export interface CartAppearanceConfiguration {
  font_source: 'pragma-site-cart' | 'theme';
  theme_color: string;
  announcement_enabled: boolean;
  announcement_background: string;
  announcement_text_color: string;
  announcement_alignment: 'left' | 'center' | 'right';
  dynamic_banners: boolean;
  advanced_conditions: boolean;
  auto_change_seconds: number;
  banners: AnnouncementBanner[];
  display_all_products: boolean;
  show_variant_names: boolean;
  show_item_properties: boolean;
  show_free_gift_first: boolean;
  empty_title: string;
  empty_cta_text: string;
  empty_cta_url: string;
  show_savings: boolean;
  show_mrp_discounts: boolean;
  checkout_background: string;
  checkout_text_color: string;
  checkout_text: RichTextStyle;
  checkout_subtext_enabled: boolean;
  checkout_subtext: RichTextStyle;
  checkout_alignment: 'left' | 'center' | 'right';
  pragma_site_cart_checkout: boolean;
  show_payment_icons: boolean;
  show_estimated_total_breakup: boolean;
  footer_enabled: boolean;
  footer_text_color: string;
  footer_text: RichTextStyle;
  footer_alignment: 'left' | 'center' | 'right';
  custom_script: string;
  add_to_cart_behavior: 'open_cart' | 'confirmation' | 'nothing';
  confirmation_background: string;
  confirmation_text_color: string;
  use_theme_add_to_cart_handling: boolean;
  custom_cart_icon_selectors: string[];
  custom_cart_drawer_selectors: string[];
  sticky_cart_enabled: boolean;
  scarcity_timer_enabled: boolean;
  scarcity_timer_type: 'urgency' | 'sales';
  scarcity_timer_days: number;
  scarcity_timer_hours: number;
  scarcity_timer_minutes: number;
  scarcity_timer_seconds: number;
  scarcity_show_days: boolean;
  scarcity_show_hours: boolean;
  scarcity_show_minutes: boolean;
  scarcity_show_seconds: boolean;
  scarcity_timer_title: RichTextStyle;
  scarcity_timer_background: string;
  scarcity_timer_text_color: string;
  scarcity_timer_expiry_action: 'restart' | 'remove';
  scarcity_timer_started_at: string | null;
  scarcity_sale_starts_at: string | null;
  scarcity_sale_ends_at: string | null;
  allow_free_item_quantity_changes: boolean;
  block_cart_page_redirection: boolean;
  disable_checkout_for_upsell_only: boolean;
  disable_on_non_indian_store: boolean;
  terms_checkbox_enabled: boolean;
  terms_checkbox_text: string;
  terms_checkbox_url: string;
  product_quantity_limit_enabled: boolean;
  quantity_limit_variant_id: string | null;
  quantity_limit_variant_title: string;
  product_quantity_limit: number;
  variant_selection_enabled: boolean;
  product_click_behavior: 'nothing' | 'redirect' | 'modal';
}

export interface CartAppearanceResponse extends CartAppearanceConfiguration {
  updated_at: string | null;
}

export interface FreeGiftCondition {
  id: string;
  condition_type: 'cart_subtotal' | 'cart_quantity';
  operator: 'greater_than' | 'greater_than_or_equal' | 'equal_to';
  value: number;
  applicable_on: 'all' | 'products';
  product_ids: string[];
  product_titles: string[];
}

export interface FreeGiftVariant {
  id: string;
  source_variant_id: string;
  source_variant_title: string;
  variant_id: string;
  variant_title: string;
}

export interface FreeGiftOffer {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  source_variant_id: string;
  source_variant_title: string;
  variant_id: string;
  variant_title: string;
  eligibility_type: 'cart_subtotal' | 'cart_quantity';
  threshold: number;
  quantity: number;
  re_add_each_time: boolean;
  gift_variants: FreeGiftVariant[];
  conditions: FreeGiftCondition[];
}

export interface TierReward {
  id: string;
  goal: number;
  reward_type: 'shipping' | 'free_gift' | 'discount' | 'custom';
  reward_text: string;
  before_text: string;
  gift_offer_id: string | null;
  gift_offer_title: string;
  discount_id: string | null;
  discount_title: string;
  discount_code: string;
  discount_classes: Array<'ORDER' | 'PRODUCT' | 'SHIPPING'>;
}

export interface ShopifyDiscountOption {
  id: string;
  title: string;
  code: string;
  method: 'code' | 'automatic';
  summary: string;
  discount_classes: Array<'ORDER' | 'PRODUCT' | 'SHIPPING'>;
}

export interface ProductSwapRule {
  id: string;
  enabled: boolean;
  trigger_scope: 'product' | 'collection';
  trigger_id: string;
  trigger_title: string;
  use_case: 'size_upgrade' | 'alternative' | 'multipack';
  target_variant_id: string;
  target_variant_title: string;
  pill_label: string;
  nudge_strategy: 'automatic' | 'mrp_discount' | 'custom';
}

export interface ProductSwapSizeGroup {
  id: string;
  title: string;
  variant_ids: string[];
  variant_titles: string[];
}

export interface CartFeaturesConfiguration {
  discount_mode: 'checkout_offers' | 'hide' | 'discount_box';
  order_notes_enabled: boolean;
  order_notes_title: string;
  free_gifts_enabled: boolean;
  free_gifts_copy_inventory: boolean;
  free_gift_method: 'auto' | 'choice';
  free_gift_offers: FreeGiftOffer[];
  free_gift_congratulations: boolean;
  tiered_rewards_enabled: boolean;
  tiered_reward_condition: 'cart_subtotal' | 'cart_quantity' | 'cart_discount_price';
  tiered_rewards: TierReward[];
  tiered_primary_color: string;
  tiered_secondary_color: string;
  tiered_confetti_enabled: boolean;
  tiered_applicable_on: 'products' | 'collections' | 'all';
  tiered_applicable_ids: string[];
  tiered_applicable_titles: string[];
  tiered_applicable_product_ids: string[][];
  tiered_exclude_discounts: boolean;
  tiered_completion_text: string;
  one_tick_enabled: boolean;
  one_tick_text: RichTextStyle;
  one_tick_variant_id: string | null;
  one_tick_variant_title: string;
  one_tick_sku_enabled: boolean;
  one_tick_disable_quantity_changes: boolean;
  one_tick_disable_checkout_only: boolean;
  product_swap_enabled: boolean;
  product_swap_coexistence: 'swap' | 'upsell';
  product_swap_automatic_upgrade: boolean;
  product_swap_rules: ProductSwapRule[];
  product_swap_size_groups: ProductSwapSizeGroup[];
}

export interface CartFeaturesResponse extends CartFeaturesConfiguration {
  updated_at: string | null;
}

export interface UpsellRecommendation {
  variant_id: string;
  variant_title: string;
  product_id: string;
  product_title: string;
  product_handle: string;
  image_url: string;
  price: string;
}

export interface UpsellRule {
  id: string;
  title: RichTextStyle;
  product_count: number;
  background_color: string;
  text_color: string;
  applicable_on: 'all' | 'products' | 'collections';
  trigger_ids: string[];
  trigger_titles: string[];
  trigger_product_ids: string[];
  recommendations: UpsellRecommendation[];
}

export interface CartUpsellConfiguration {
  upsell_enabled: boolean;
  upsell_cap_quantity: boolean;
  upsell_max_quantity: number;
  upsell_variant_behavior: 'variant_popup' | 'product_popup';
  upsell_ai_enabled: boolean;
  upsell_ai_title: RichTextStyle;
  upsell_ai_background_color: string;
  upsell_ai_text_color: string;
  upsell_ai_preference: 'related' | 'complementary';
  upsell_ai_product_count: number;
  upsell_rule_fallback_enabled: boolean;
  upsell_rules: UpsellRule[];
}

export interface CartUpsellResponse extends CartUpsellConfiguration {
  updated_at: string | null;
}

export interface ShopifyResource {
  id: string;
  title?: string;
  displayName?: string;
  handle?: string;
  price?: string;
  image?: {originalSrc?: string; url?: string};
  images?: Array<{originalSrc?: string; url?: string}>;
  product?: ShopifyResource;
  products?: ShopifyResource[];
  variants?: ShopifyResource[];
}

interface ShopifyGlobal {
  idToken(): Promise<string>;
  resourcePicker(options: {
    type: 'variant' | 'product' | 'collection';
    action?: 'add' | 'select';
    multiple?: boolean | number;
    selectionIds?: {id: string}[];
  }): Promise<ShopifyResource[] | undefined>;
}

declare global {
  interface Window {
    shopify?: ShopifyGlobal;
  }
}

async function authenticatedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!window.shopify) {
    throw new Error('Open this app from Shopify Admin to authenticate.');
  }
  const token = await window.shopify.idToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(path, {...init, headers});
}

async function requireOk(response: Response): Promise<Response> {
  if (response.ok) return response;
  const body = (await response.json().catch(() => null)) as {detail?: string} | null;
  throw new Error(body?.detail ?? `Request failed (${response.status})`);
}

const merchantCacheKey = 'pragma-site-cart:merchant';

function cachedMerchant(): Merchant | null {
  try {
    const value = window.sessionStorage.getItem(merchantCacheKey);
    if (!value) return null;
    const merchant = JSON.parse(value) as Merchant;
    if (!merchant.shop_domain || merchant.connected !== true) return null;
    return merchant;
  } catch {
    window.sessionStorage.removeItem(merchantCacheKey);
    return null;
  }
}

export async function connectMerchant(): Promise<Merchant> {
  const cached = cachedMerchant();
  if (cached) return cached;
  await requireOk(await authenticatedFetch('/api/v1/shopify/token-exchange', {method: 'POST'}));
  const response = await requireOk(await authenticatedFetch('/api/v1/shopify/me'));
  const merchant = await response.json() as Merchant;
  window.sessionStorage.setItem(merchantCacheKey, JSON.stringify(merchant));
  return merchant;
}

export async function getCartAppearance(): Promise<CartAppearanceResponse> {
  const response = await requireOk(await authenticatedFetch('/api/v1/shopify/appearance'));
  return response.json() as Promise<CartAppearanceResponse>;
}

export async function saveCartAppearance(
  configuration: CartAppearanceConfiguration,
): Promise<CartAppearanceResponse> {
  const response = await requireOk(
    await authenticatedFetch('/api/v1/shopify/appearance', {
      method: 'PUT',
      body: JSON.stringify(configuration),
    }),
  );
  return response.json() as Promise<CartAppearanceResponse>;
}

export async function getCartFeatures(): Promise<CartFeaturesResponse> {
  const response = await requireOk(await authenticatedFetch('/api/v1/shopify/features'));
  return response.json() as Promise<CartFeaturesResponse>;
}

export async function saveCartFeatures(
  configuration: CartFeaturesConfiguration,
): Promise<CartFeaturesResponse> {
  const response = await requireOk(
    await authenticatedFetch('/api/v1/shopify/features', {
      method: 'PUT',
      body: JSON.stringify(configuration),
    }),
  );
  return response.json() as Promise<CartFeaturesResponse>;
}

export async function getShopifyDiscounts(): Promise<ShopifyDiscountOption[]> {
  const response = await requireOk(await authenticatedFetch('/api/v1/shopify/discounts'));
  return response.json() as Promise<ShopifyDiscountOption[]>;
}

export async function getCartUpsell(): Promise<CartUpsellResponse> {
  const response = await requireOk(await authenticatedFetch('/api/v1/shopify/upsell'));
  return response.json() as Promise<CartUpsellResponse>;
}

export async function saveCartUpsell(configuration: CartUpsellConfiguration): Promise<CartUpsellResponse> {
  const response = await requireOk(await authenticatedFetch('/api/v1/shopify/upsell', {
    method: 'PUT',
    body: JSON.stringify(configuration),
  }));
  return response.json() as Promise<CartUpsellResponse>;
}
