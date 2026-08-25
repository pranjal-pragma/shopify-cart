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
  font_source: 'gokwik' | 'theme';
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
  gokwik_checkout: boolean;
  show_payment_icons: boolean;
  show_estimated_total_breakup: boolean;
  footer_enabled: boolean;
  footer_text_color: string;
  footer_text: RichTextStyle;
  footer_alignment: 'left' | 'center' | 'right';
  custom_script: string;
}

export interface CartAppearanceResponse extends CartAppearanceConfiguration {
  updated_at: string | null;
}

interface ShopifyGlobal {
  idToken(): Promise<string>;
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

export async function connectMerchant(): Promise<Merchant> {
  await requireOk(await authenticatedFetch('/api/v1/shopify/token-exchange', {method: 'POST'}));
  const response = await requireOk(await authenticatedFetch('/api/v1/shopify/me'));
  return response.json() as Promise<Merchant>;
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
