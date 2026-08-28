import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Gift,
  Italic,
  Minus,
  PackageSearch,
  Plus,
  RotateCcw,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  Underline,
  X,
} from 'lucide-react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {
  getCartAppearance,
  saveCartAppearance,
  type AnnouncementBanner,
  type BannerCondition,
  type BannerConditionOperator,
  type BannerConditionType,
  type CartAppearanceConfiguration,
  type RichTextStyle,
} from './api';

type Alignment = 'left' | 'center' | 'right';

const defaultRichText = (text: string, fontSize: RichTextStyle['font_size'] = 14): RichTextStyle => ({
  text,
  bold: false,
  italic: false,
  underline: false,
  font_size: fontSize,
});

const newCondition = (): BannerCondition => ({
  id: crypto.randomUUID().replaceAll('-', '').slice(0, 16),
  type: 'cart_quantity',
  operator: 'greater_than',
  value: '',
});

const toDateTimeLocal = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

const fromDateTimeLocal = (value: string) => value ? new Date(value).toISOString() : null;

const newSalePeriod = () => {
  const startsAt = new Date();
  startsAt.setSeconds(0, 0);
  const endsAt = new Date(startsAt.getTime() + 24 * 60 * 60 * 1000);
  return {startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString()};
};

export const defaultAppearance: CartAppearanceConfiguration = {
  font_source: 'pragma-site-cart',
  theme_color: '#F10A0A',
  announcement_enabled: true,
  announcement_background: '#FFF2F2',
  announcement_text_color: '#7A1515',
  announcement_alignment: 'center',
  dynamic_banners: true,
  advanced_conditions: false,
  auto_change_seconds: 9,
  banners: [
    {
      id: 'welcome',
      title: defaultRichText('Free shipping on orders above Rs. 999'),
      show_subtext: false,
      subtext: defaultRichText('Add more to unlock your reward', 12),
      conditions: [],
    },
  ],
  display_all_products: false,
  show_variant_names: true,
  show_item_properties: true,
  show_free_gift_first: true,
  empty_title: 'Your Cart is Empty',
  empty_cta_text: 'Continue Shopping',
  empty_cta_url: '/collections/all',
  show_savings: true,
  show_mrp_discounts: false,
  checkout_background: '#202124',
  checkout_text_color: '#FFFFFF',
  checkout_text: {...defaultRichText('Proceed to checkout', 16), bold: true},
  checkout_subtext_enabled: false,
  checkout_subtext: defaultRichText('Safe and secure checkout', 12),
  checkout_alignment: 'left',
  pragma_site_cart_checkout: true,
  show_payment_icons: true,
  show_estimated_total_breakup: true,
  footer_enabled: true,
  footer_text_color: '#676A72',
  footer_text: defaultRichText('Secure checkout powered by pragma-site-cart', 12),
  footer_alignment: 'left',
  custom_script: '',
  add_to_cart_behavior: 'nothing',
  confirmation_background: '#202124',
  confirmation_text_color: '#FFFFFF',
  use_theme_add_to_cart_handling: false,
  custom_cart_icon_selectors: [],
  custom_cart_drawer_selectors: [],
  sticky_cart_enabled: false,
  scarcity_timer_enabled: false,
  scarcity_timer_type: 'urgency',
  scarcity_timer_days: 0,
  scarcity_timer_hours: 0,
  scarcity_timer_minutes: 10,
  scarcity_timer_seconds: 0,
  scarcity_show_days: false,
  scarcity_show_hours: false,
  scarcity_show_minutes: true,
  scarcity_show_seconds: true,
  scarcity_timer_title: {...defaultRichText('Your cart is reserved for', 12), bold: true},
  scarcity_timer_background: '#FFF7E8',
  scarcity_timer_text_color: '#7B5312',
  scarcity_timer_expiry_action: 'restart',
  scarcity_timer_started_at: null,
  scarcity_sale_starts_at: null,
  scarcity_sale_ends_at: null,
  allow_free_item_quantity_changes: false,
  block_cart_page_redirection: true,
  disable_checkout_for_upsell_only: false,
  disable_on_non_indian_store: false,
  terms_checkbox_enabled: false,
  terms_checkbox_text: 'I agree to the Terms & Conditions',
  terms_checkbox_url: '/policies/terms-of-service',
  checkout_on_cart_enabled: true,
  checkout_guest_checkout_enabled: false,
  checkout_login_banner_enabled: true,
  checkout_login_banner_text: 'Log in to use saved addresses and checkout faster.',
  checkout_personalisation_message: 'Welcome back, {first_name}',
  checkout_address_placement: 'top',
  product_quantity_limit_enabled: false,
  quantity_limit_variant_id: null,
  quantity_limit_variant_title: '',
  product_quantity_limit: 1,
  variant_selection_enabled: true,
  product_click_behavior: 'nothing',
};

function cloneConfiguration(configuration: CartAppearanceConfiguration) {
  return structuredClone(configuration);
}

function Toggle({
  checked,
  disabled = false,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  description?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`setting-toggle${disabled ? ' setting-toggle--disabled' : ''}`}>
      <span className="setting-toggle__copy">
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="toggle-track" aria-hidden="true"><span /></span>
    </label>
  );
}

function ColorField({label, value, onChange}: {label: string; value: string; onChange: (value: string) => void}) {
  return (
    <label className="field color-field">
      <span>{label}</span>
      <span className="color-input-wrap">
        <input
          className="color-swatch"
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
        />
        <input
          value={value}
          maxLength={7}
          pattern="#[0-9A-Fa-f]{6}"
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          aria-label={`${label} hex value`}
        />
      </span>
    </label>
  );
}

function AlignmentPicker({value, onChange}: {value: Alignment; onChange: (value: Alignment) => void}) {
  const items = [
    {value: 'left' as const, label: 'Left', icon: AlignLeft},
    {value: 'center' as const, label: 'Center', icon: AlignCenter},
    {value: 'right' as const, label: 'Right', icon: AlignRight},
  ];
  return (
    <div className="field">
      <span>Text alignment</span>
      <div className="segmented" role="radiogroup" aria-label="Text alignment">
        {items.map(({value: option, label, icon: Icon}) => (
          <button
            className={value === option ? 'is-active' : ''}
            type="button"
            role="radio"
            aria-checked={value === option}
            aria-label={label}
            title={label}
            key={option}
            onClick={() => onChange(option)}
          >
            <Icon size={17} aria-hidden />
          </button>
        ))}
      </div>
    </div>
  );
}

function RichTextField({label, value, onChange}: {label: string; value: RichTextStyle; onChange: (value: RichTextStyle) => void}) {
  const set = <K extends keyof RichTextStyle>(key: K, next: RichTextStyle[K]) => onChange({...value, [key]: next});
  return (
    <div className="field rich-field">
      <span>{label}</span>
      <div className="rich-toolbar" aria-label={`${label} formatting`}>
        <button className={value.bold ? 'is-active' : ''} type="button" onClick={() => set('bold', !value.bold)} aria-label="Bold" title="Bold"><Bold size={15} /></button>
        <button className={value.italic ? 'is-active' : ''} type="button" onClick={() => set('italic', !value.italic)} aria-label="Italic" title="Italic"><Italic size={15} /></button>
        <button className={value.underline ? 'is-active' : ''} type="button" onClick={() => set('underline', !value.underline)} aria-label="Underline" title="Underline"><Underline size={15} /></button>
        <select value={value.font_size} onChange={(event) => set('font_size', Number(event.target.value) as RichTextStyle['font_size'])} aria-label="Font size">
          {[12, 14, 16, 18, 20].map((size) => <option value={size} key={size}>{size}px</option>)}
        </select>
      </div>
      <input value={value.text} maxLength={500} onChange={(event) => set('text', event.target.value)} />
    </div>
  );
}

function Field({label, value, onChange, placeholder, type = 'text'}: {label: string; value: string | number; onChange: (value: string) => void; placeholder?: string; type?: 'text' | 'number' | 'url' | 'datetime-local'}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SelectorList({label, description, selectors, onChange}: {label: string; description: string; selectors: string[]; onChange: (selectors: string[]) => void}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const selector = draft.trim();
    if (!selector) return;
    try {
      document.createDocumentFragment().querySelector(selector);
    } catch {
      setError('Enter a valid CSS selector.');
      return;
    }
    if (selectors.includes(selector)) {
      setError('This selector is already in the list.');
      return;
    }
    onChange([...selectors, selector]);
    setDraft('');
    setError(null);
  };

  return (
    <div className="selector-list">
      <div className="selector-list__heading"><strong>{label}</strong><small>{description}</small></div>
      {selectors.length > 0 && <ul>{selectors.map((selector) => <li key={selector}><code>{selector}</code><button className="icon-button icon-button--danger" type="button" onClick={() => onChange(selectors.filter((item) => item !== selector))} aria-label={`Remove ${selector}`} title="Remove selector"><Trash2 size={15} /></button></li>)}</ul>}
      <div className="selector-list__add">
        <label className="field"><span>New selector</span><input value={draft} placeholder=".header__icon--cart" maxLength={240} onChange={(event) => { setDraft(event.target.value); setError(null); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} /></label>
        <button className="button button--secondary" type="button" onClick={add} disabled={!draft.trim() || selectors.length >= 12}><Plus size={16} />Add</button>
      </div>
      {error && <small className="field-error" role="alert">{error}</small>}
    </div>
  );
}

type ConfigurationUpdate = <K extends keyof CartAppearanceConfiguration>(key: K, value: CartAppearanceConfiguration[K]) => void;

function CartSettingsEditor({configuration, update, previewMode}: {configuration: CartAppearanceConfiguration; update: ConfigurationUpdate; previewMode: boolean}) {
  const durationUnits = [
    {label: 'Day', valueKey: 'scarcity_timer_days', showKey: 'scarcity_show_days', max: 365},
    {label: 'Hour', valueKey: 'scarcity_timer_hours', showKey: 'scarcity_show_hours', max: 23},
    {label: 'Minute', valueKey: 'scarcity_timer_minutes', showKey: 'scarcity_show_minutes', max: 59},
    {label: 'Second', valueKey: 'scarcity_timer_seconds', showKey: 'scarcity_show_seconds', max: 59},
  ] as const;
  const selectTimerType = (type: CartAppearanceConfiguration['scarcity_timer_type']) => {
    update('scarcity_timer_type', type);
    if (type === 'sales' && (!configuration.scarcity_sale_starts_at || !configuration.scarcity_sale_ends_at)) {
      const period = newSalePeriod();
      update('scarcity_sale_starts_at', period.startsAt);
      update('scarcity_sale_ends_at', period.endsAt);
    }
  };
  const pickVariant = async () => {
    if (!window.shopify?.resourcePicker) return;
    const selected = await window.shopify.resourcePicker({
      type: 'variant',
      action: 'select',
      multiple: false,
      selectionIds: configuration.quantity_limit_variant_id ? [{id: configuration.quantity_limit_variant_id}] : undefined,
    });
    const variant = selected?.[0];
    if (!variant) return;
    update('quantity_limit_variant_id', variant.id);
    update('quantity_limit_variant_title', variant.displayName || variant.title || variant.id);
  };

  return <>
    <EditorSection title="Add-to-cart behavior" description="Choose what shoppers see immediately after an item is added.">
      <div className="choice-list" role="radiogroup" aria-label="Add-to-cart behavior">
        {[{value: 'open_cart', label: 'Open side cart', description: 'Open the drawer and refresh its contents.'}, {value: 'confirmation', label: 'Show confirmation message', description: 'Keep the shopper on the page and show a compact confirmation.'}, {value: 'nothing', label: 'Do nothing', description: 'Add the product without opening a cart drawer or confirmation.'}].map((option) => <label key={option.value}><input type="radio" name="add-to-cart-behavior" checked={configuration.add_to_cart_behavior === option.value} onChange={() => update('add_to_cart_behavior', option.value as CartAppearanceConfiguration['add_to_cart_behavior'])} /><span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}
      </div>
      {configuration.add_to_cart_behavior === 'confirmation' && <div className="nested-settings confirmation-settings">
        <div className="field-grid"><ColorField label="Popup background" value={configuration.confirmation_background} onChange={(value) => update('confirmation_background', value)} /><ColorField label="Popup text" value={configuration.confirmation_text_color} onChange={(value) => update('confirmation_text_color', value)} /></div>
        <div className="confirmation-sample" style={{backgroundColor: configuration.confirmation_background, color: configuration.confirmation_text_color}}>Item added to your cart</div>
      </div>}
      <Toggle checked={configuration.use_theme_add_to_cart_handling} label="Use your own add-to-cart handling" description="Stop pragma-site-cart from watching add-to-cart requests so your theme or custom script owns the response." onChange={(value) => update('use_theme_add_to_cart_handling', value)} />
    </EditorSection>

    <EditorSection title="Custom selectors" description="Add selectors only when your theme elements are not detected automatically.">
      <SelectorList label="Custom cart icon selectors" description="Open pragma-site-cart when these theme elements are selected." selectors={configuration.custom_cart_icon_selectors} onChange={(value) => update('custom_cart_icon_selectors', value)} />
      <SelectorList label="Custom cart drawer selectors" description="Hide matching native cart drawers while pragma-site-cart is active." selectors={configuration.custom_cart_drawer_selectors} onChange={(value) => update('custom_cart_drawer_selectors', value)} />
    </EditorSection>

    <EditorSection title="Sticky cart">
      <Toggle checked={configuration.sticky_cart_enabled} label="Sticky cart" description="Show cart quantity and price at the bottom of mobile screens, except product pages." onChange={(value) => update('sticky_cart_enabled', value)} />
    </EditorSection>

    <EditorSection title="Scarcity timer banner" description="Create urgency with a cart reservation or store-wide sale countdown.">
      <Toggle checked={configuration.scarcity_timer_enabled} label="Enable" onChange={(value) => update('scarcity_timer_enabled', value)} />
      {configuration.scarcity_timer_enabled && <div className="nested-settings scarcity-settings">
        <div className="field"><span>Timer type</span><div className="choice-list choice-list--two" role="radiogroup" aria-label="Scarcity timer type">{[{value: 'urgency', label: 'Urgency timer', description: 'Starts for each shopper when their cart contains products.'}, {value: 'sales', label: 'Sales countdown timer', description: 'Counts down to the end of a fixed sale period.'}].map((option) => <label key={option.value}><input type="radio" name="scarcity-timer-type" checked={configuration.scarcity_timer_type === option.value} onChange={() => selectTimerType(option.value as CartAppearanceConfiguration['scarcity_timer_type'])} /><span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}</div></div>
        {configuration.scarcity_timer_type === 'urgency' ? <div className="field"><span>Timer duration</span><div className="scarcity-duration-grid">{durationUnits.map((unit) => <label className="scarcity-duration-unit" key={unit.valueKey}><span><input type="checkbox" checked={configuration[unit.showKey]} onChange={(event) => update(unit.showKey, event.target.checked)} />{unit.label}</span><input type="number" min="0" max={unit.max} disabled={!configuration[unit.showKey]} value={configuration[unit.valueKey]} onChange={(event) => update(unit.valueKey, Math.min(unit.max, Math.max(0, Number(event.target.value))))} /></label>)}</div></div> : <div className="field"><span>Sale period</span><div className="field-grid"><Field label="Start date & time" type="datetime-local" value={toDateTimeLocal(configuration.scarcity_sale_starts_at)} onChange={(value) => update('scarcity_sale_starts_at', fromDateTimeLocal(value))} /><Field label="End date & time" type="datetime-local" value={toDateTimeLocal(configuration.scarcity_sale_ends_at)} onChange={(value) => update('scarcity_sale_ends_at', fromDateTimeLocal(value))} /></div></div>}
        <RichTextField label="Title to display" value={configuration.scarcity_timer_title} onChange={(value) => update('scarcity_timer_title', value)} />
        <div className="field-grid"><ColorField label="Background color" value={configuration.scarcity_timer_background} onChange={(value) => update('scarcity_timer_background', value)} /><ColorField label="Text color" value={configuration.scarcity_timer_text_color} onChange={(value) => update('scarcity_timer_text_color', value)} /></div>
        {configuration.scarcity_timer_type === 'urgency' && <div className="field"><span>Action after timer expires</span><div className="choice-list choice-list--two" role="radiogroup" aria-label="Action after timer expires">{[{value: 'restart', label: 'Restart timer', description: 'Begin the same countdown again.'}, {value: 'remove', label: 'Remove timer', description: 'Hide the banner when it reaches zero.'}].map((option) => <label key={option.value}><input type="radio" name="scarcity-expiry-action" checked={configuration.scarcity_timer_expiry_action === option.value} onChange={() => update('scarcity_timer_expiry_action', option.value as CartAppearanceConfiguration['scarcity_timer_expiry_action'])} /><span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}</div></div>}
      </div>}
    </EditorSection>

    <EditorSection title="Cart integrity and routing">
      <Toggle checked={configuration.allow_free_item_quantity_changes} label="Allow quantity changes on free items" onChange={(value) => update('allow_free_item_quantity_changes', value)} />
      <Toggle checked={configuration.block_cart_page_redirection} label="Block cart page redirection" description="Open the side cart when shoppers navigate to Shopify's cart page." onChange={(value) => update('block_cart_page_redirection', value)} />
      <Toggle checked={configuration.disable_checkout_for_upsell_only} label="Disable checkout for only upsell items" description="Require at least one regular cart item before checkout." onChange={(value) => update('disable_checkout_for_upsell_only', value)} />
      <Toggle checked={configuration.disable_on_non_indian_store} label="Disable on non-Indian store" description="Keep the theme's own cart active outside the India storefront." onChange={(value) => update('disable_on_non_indian_store', value)} />
    </EditorSection>

    <EditorSection title="Consent and purchase limits">
      <Toggle checked={configuration.terms_checkbox_enabled} label="Terms & Conditions checkbox" description="Require consent before the checkout button is available." onChange={(value) => update('terms_checkbox_enabled', value)} />
      {configuration.terms_checkbox_enabled && <div className="nested-settings"><Field label="Checkbox text" value={configuration.terms_checkbox_text} onChange={(value) => update('terms_checkbox_text', value)} /><Field label="Terms link" type="url" value={configuration.terms_checkbox_url} placeholder="/policies/terms-of-service" onChange={(value) => update('terms_checkbox_url', value)} /></div>}
      <Toggle checked={configuration.product_quantity_limit_enabled} label="Set quantity limit for single product purchases" description="Cap one selected product variant at a fixed quantity." onChange={(value) => update('product_quantity_limit_enabled', value)} />
      {configuration.product_quantity_limit_enabled && <div className="nested-settings quantity-limit-settings"><div className="field"><span>Product variant</span>{configuration.quantity_limit_variant_id ? <div className="selected-resource"><span><strong>{configuration.quantity_limit_variant_title || 'Selected variant'}</strong><small>{configuration.quantity_limit_variant_id}</small></span><button className="icon-button" type="button" onClick={() => { update('quantity_limit_variant_id', null); update('quantity_limit_variant_title', ''); }} aria-label="Clear selected variant" title="Clear selection"><X size={16} /></button></div> : <button className="button button--secondary resource-picker-button" type="button" onClick={pickVariant} disabled={previewMode || !window.shopify?.resourcePicker}><PackageSearch size={17} />Select product variant</button>}</div><Field label="Maximum quantity" type="number" value={configuration.product_quantity_limit} onChange={(value) => update('product_quantity_limit', Math.min(99, Math.max(1, Number(value))))} /></div>}
    </EditorSection>

    <EditorSection title="Variant selection dropdown" description="Allow shoppers to select product variants directly from the side cart.">
      <Toggle checked={configuration.variant_selection_enabled} label="Enable" onChange={(value) => update('variant_selection_enabled', value)} />
    </EditorSection>

    <EditorSection title="Product click behavior" description="Choose what happens when a shopper selects a product in the cart.">
      <div className="choice-list choice-list--compact" role="radiogroup" aria-label="Product click behavior">{[{value: 'nothing', label: 'Do nothing'}, {value: 'redirect', label: 'Redirect to product page'}, {value: 'modal', label: 'Open product in a modal'}].map((option) => <label key={option.value}><input type="radio" name="product-click-behavior" checked={configuration.product_click_behavior === option.value} onChange={() => update('product_click_behavior', option.value as CartAppearanceConfiguration['product_click_behavior'])} /><span><strong>{option.label}</strong></span></label>)}</div>
    </EditorSection>
  </>;
}

function PreviewText({value}: {value: RichTextStyle}) {
  return (
    <span style={{fontSize: value.font_size, fontWeight: value.bold ? 700 : 400, fontStyle: value.italic ? 'italic' : 'normal', textDecoration: value.underline ? 'underline' : 'none'}}>
      {value.text}
    </span>
  );
}

function conditionMatches(condition: BannerCondition, itemCount: number, total: number, products: string[]) {
  const numericValue = Number(condition.value);
  if (condition.type === 'product_title') {
    const value = condition.value.trim().toLowerCase();
    const contains = products.some((product) => product.toLowerCase().includes(value));
    if (!value) return false;
    return condition.operator === 'does_not_contain' ? !contains : contains;
  }
  if (!Number.isFinite(numericValue)) return false;
  const actual = condition.type === 'cart_quantity' ? itemCount : total;
  if (condition.operator === 'less_than') return actual < numericValue;
  if (condition.operator === 'equals') return actual === numericValue;
  return actual > numericValue;
}

function formatScarcityDuration(configuration: CartAppearanceConfiguration) {
  if (configuration.scarcity_timer_type === 'sales') {
    const startsAt = Date.parse(configuration.scarcity_sale_starts_at || '');
    const endsAt = Date.parse(configuration.scarcity_sale_ends_at || '');
    const remaining = Math.max(0, endsAt - Math.max(Date.now(), startsAt || Date.now()));
    const totalSeconds = Math.ceil(remaining / 1000);
    const days = Math.floor(totalSeconds / 86_400);
    const hours = Math.floor((totalSeconds % 86_400) / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const seconds = totalSeconds % 60;
    return [
      days > 0 && `${String(days).padStart(2, '0')}d`,
      (days > 0 || hours > 0) && `${String(hours).padStart(2, '0')}h`,
      `${String(minutes).padStart(2, '0')}m`,
      `${String(seconds).padStart(2, '0')}s`,
    ].filter(Boolean).join(' ');
  }
  const parts = [
    configuration.scarcity_show_days && `${String(configuration.scarcity_timer_days).padStart(2, '0')}d`,
    configuration.scarcity_show_hours && `${String(configuration.scarcity_timer_hours).padStart(2, '0')}h`,
    configuration.scarcity_show_minutes && `${String(configuration.scarcity_timer_minutes).padStart(2, '0')}m`,
    configuration.scarcity_show_seconds && `${String(configuration.scarcity_timer_seconds).padStart(2, '0')}s`,
  ].filter(Boolean);
  return parts.join(' ');
}

function CartPreview({configuration, empty}: {configuration: CartAppearanceConfiguration; empty: boolean}) {
  const previewRef = useRef<HTMLElement>(null);
  const [removedItems, setRemovedItems] = useState<string[]>([]);
  const [bannerState, setBannerState] = useState({current: 0, previous: null as number | null, tick: 0});
  const fontFamily = configuration.font_source === 'theme' ? 'Georgia, serif' : 'Inter, sans-serif';
  const toteVisible = !removedItems.includes('tote');
  const capVisible = !removedItems.includes('cap');
  const itemCount = Number(toteVisible) + Number(capVisible);
  const effectiveEmpty = empty || itemCount === 0;
  const total = (toteVisible ? 1249 : 0) + (capVisible ? 699 : 0);
  const products = [toteVisible && 'Everyday tote', capVisible && 'Classic cap'].filter(Boolean) as string[];
  const eligibleBanners = configuration.advanced_conditions
    ? configuration.banners.filter((banner) => !banner.conditions.length || banner.conditions.every((condition) => conditionMatches(condition, itemCount, total, products)))
    : configuration.banners;
  const visibleBanners = eligibleBanners.length ? eligibleBanners : configuration.banners.slice(0, 1);
  const accentTint = /^#[0-9A-F]{6}$/i.test(configuration.theme_color)
    ? `${configuration.theme_color}14`
    : '#E8F5ED';

  useEffect(() => {
    if (empty) setRemovedItems([]);
  }, [empty]);

  useEffect(() => {
    previewRef.current?.setAttribute('inert', '');
  }, []);

  useEffect(() => {
    setBannerState({current: 0, previous: null, tick: 0});
    if (!configuration.dynamic_banners || visibleBanners.length < 2) return;
    const timer = window.setInterval(() => {
      setBannerState((state) => ({
        current: (state.current + 1) % visibleBanners.length,
        previous: state.current,
        tick: state.tick + 1,
      }));
    }, configuration.auto_change_seconds * 1000);
    return () => window.clearInterval(timer);
  }, [configuration.dynamic_banners, configuration.auto_change_seconds, visibleBanners.length]);

  useEffect(() => {
    if (bannerState.previous === null) return;
    const timer = window.setTimeout(() => {
      setBannerState((state) => ({...state, previous: null}));
    }, 420);
    return () => window.clearTimeout(timer);
  }, [bannerState.previous, bannerState.tick]);

  const activeIndex = Math.min(bannerState.current, visibleBanners.length - 1);
  const banner = visibleBanners[activeIndex];
  const previousBanner = bannerState.previous === null ? null : visibleBanners[Math.min(bannerState.previous, visibleBanners.length - 1)];

  const bannerContent = (item: AnnouncementBanner) => <>
    <PreviewText value={item.title} />
    {item.show_subtext && <small><PreviewText value={item.subtext} /></small>}
  </>;

  const removeItem = (item: string) => setRemovedItems((current) => [...current, item]);

  return (
    <aside ref={previewRef} className="cart-preview" style={{fontFamily}} aria-label="Cart preview">
      {configuration.announcement_enabled && banner && (
        <div className="preview-banner" style={{backgroundColor: configuration.announcement_background, color: configuration.announcement_text_color, textAlign: configuration.announcement_alignment}}>
          <div className="preview-banner__viewport" aria-live="polite">
            {previousBanner && configuration.dynamic_banners && <div key={`out-${bannerState.tick}`} className="preview-banner__message preview-banner__message--leaving">{bannerContent(previousBanner)}</div>}
            <div key={`in-${bannerState.tick}-${banner.id}`} className={`preview-banner__message${bannerState.tick ? ' preview-banner__message--entering' : ''}`}>{bannerContent(banner)}</div>
          </div>
          {configuration.dynamic_banners && visibleBanners.length > 1 && <span className="banner-dots" aria-hidden="true">{visibleBanners.map((item, index) => <i className={index === activeIndex ? 'is-active' : ''} key={item.id} />)}</span>}
        </div>
      )}
      <div className="preview-header">
        <div><strong>Your cart</strong><span>{itemCount} {itemCount === 1 ? 'item' : 'items'}</span></div>
        <button type="button" aria-label="Close cart preview"><X size={19} /></button>
      </div>
      {configuration.scarcity_timer_enabled && !effectiveEmpty && <div className="preview-scarcity" style={{backgroundColor: configuration.scarcity_timer_background, color: configuration.scarcity_timer_text_color}}><PreviewText value={configuration.scarcity_timer_title} /><strong>{formatScarcityDuration(configuration)}</strong></div>}

      {effectiveEmpty ? (
        <div className="preview-empty">
          <ShoppingBag size={35} strokeWidth={1.5} aria-hidden />
          <strong>{configuration.empty_title}</strong>
          <button type="button" style={{backgroundColor: configuration.theme_color}}>{configuration.empty_cta_text}</button>
        </div>
      ) : (
        <>
          <div className="preview-progress">
            <span>You're Rs. 450 away from free shipping</span>
            <i><b style={{backgroundColor: configuration.theme_color, width: '62%'}} /></i>
          </div>
          <div className="preview-products">
            {configuration.show_free_gift_first && itemCount > 0 && (
              <div className="preview-product preview-product--gift">
                <div className="preview-product-image preview-product-image--gift" style={{backgroundColor: accentTint, color: configuration.theme_color}}><Gift size={20} /></div>
                <div><span className="free-label" style={{color: configuration.theme_color}}>FREE GIFT</span><strong>Travel pouch</strong><small>Complimentary</small>{configuration.allow_free_item_quantity_changes && <div className="preview-quantity preview-quantity--gift"><button type="button"><Minus size={11} /></button><span>1</span><button type="button"><Plus size={11} /></button></div>}</div>
                <strong>Rs. 0</strong>
              </div>
            )}
            {toteVisible && <div className="preview-product">
              <div className="preview-product-image" />
              <div>
                <strong>Everyday tote</strong>
                {configuration.show_variant_names && (configuration.variant_selection_enabled ? <select className="preview-variant" defaultValue="black-medium" aria-label="Everyday tote variant"><option value="black-medium">Black / Medium</option><option value="olive-medium">Olive / Medium</option></select> : <small>Black / Medium</small>)}
                {configuration.show_item_properties && <small>Monogram: PR</small>}
                <div className="preview-line-actions"><div className="preview-quantity"><button type="button" aria-label="Decrease quantity"><Minus size={12} /></button><span>1</span><button type="button" aria-label="Increase quantity"><Plus size={12} /></button></div><button className="preview-remove" type="button" aria-label="Remove Everyday tote from cart" title="Remove item" onClick={() => removeItem('tote')}><Trash2 size={14} /></button></div>
              </div>
              <div className="preview-price"><strong>Rs. 1,249</strong>{configuration.show_mrp_discounts && <s>Rs. 1,499</s>}</div>
            </div>}
            {capVisible && <div className="preview-product">
              <div className="preview-product-image preview-product-image--second" />
              <div><strong>Classic cap</strong>{configuration.show_variant_names && <small>Olive</small>}<div className="preview-line-actions"><div className="preview-quantity"><button type="button" aria-label="Decrease quantity"><Minus size={12} /></button><span>1</span><button type="button" aria-label="Increase quantity"><Plus size={12} /></button></div><button className="preview-remove" type="button" aria-label="Remove Classic cap from cart" title="Remove item" onClick={() => removeItem('cap')}><Trash2 size={14} /></button></div></div>
              <div className="preview-price"><strong>Rs. 699</strong></div>
            </div>}
          </div>
          <div className="preview-checkout">
            {configuration.show_savings && <div className="preview-saving" style={{backgroundColor: accentTint, color: configuration.theme_color}}>You save Rs. 250 on this order</div>}
            <div className="preview-total"><span>Estimated total</span><strong>Rs. {total.toLocaleString('en-IN')} {configuration.show_estimated_total_breakup && <ChevronDown size={14} />}</strong></div>
            {configuration.terms_checkbox_enabled && <label className="preview-terms"><input type="checkbox" /><span>{configuration.terms_checkbox_text}</span></label>}
            <button className="preview-checkout-button" type="button" style={{backgroundColor: configuration.checkout_background, color: configuration.checkout_text_color, textAlign: configuration.checkout_alignment}}>
              <span><PreviewText value={configuration.checkout_text} />{configuration.checkout_subtext_enabled && <small><PreviewText value={configuration.checkout_subtext} /></small>}</span>
              <span>Rs. {total.toLocaleString('en-IN')}</span>
            </button>
            {configuration.show_payment_icons && <div className="payment-icons" aria-label="Accepted payment methods"><span>VISA</span><span>UPI</span><span>RuPay</span></div>}
            {configuration.footer_enabled && <div className={`preview-footer preview-footer--${configuration.footer_alignment}`} style={{color: configuration.footer_text_color, textAlign: configuration.footer_alignment}}><ShieldCheck size={14} /><PreviewText value={configuration.footer_text} /></div>}
          </div>
        </>
      )}
      {configuration.sticky_cart_enabled && !effectiveEmpty && <div className="preview-sticky-cart" style={{backgroundColor: configuration.theme_color}}><span><ShoppingBag size={16} />{itemCount} items</span><strong>Rs. {total.toLocaleString('en-IN')}</strong></div>}
    </aside>
  );
}

const conditionTypeOptions: {value: BannerConditionType; label: string}[] = [
  {value: 'cart_quantity', label: 'Cart quantity'},
  {value: 'cart_value', label: 'Cart value'},
  {value: 'product_title', label: 'Product in cart'},
];

function operatorsFor(type: BannerConditionType): {value: BannerConditionOperator; label: string}[] {
  if (type === 'product_title') return [{value: 'contains', label: 'Contains'}, {value: 'does_not_contain', label: 'Does not contain'}];
  return [{value: 'greater_than', label: 'Greater than'}, {value: 'less_than', label: 'Less than'}, {value: 'equals', label: 'Equals'}];
}

function BannerEditor({banner, canRemove, advanced, onChange, onRemove}: {banner: AnnouncementBanner; canRemove: boolean; advanced: boolean; onChange: (banner: AnnouncementBanner) => void; onRemove: () => void}) {
  const addCondition = () => onChange({...banner, conditions: [...banner.conditions, newCondition()]});
  const updateCondition = (id: string, next: BannerCondition) => onChange({...banner, conditions: banner.conditions.map((condition) => condition.id === id ? next : condition)});
  return (
    <div className="banner-editor">
      <div className="banner-editor__header"><strong>Banner message</strong>{canRemove && <button className="icon-button icon-button--danger" type="button" onClick={onRemove} aria-label="Remove banner" title="Remove banner"><Trash2 size={16} /></button>}</div>
      <RichTextField label="Title text" value={banner.title} onChange={(title) => onChange({...banner, title})} />
      <Toggle checked={banner.show_subtext} label="Add subtext" onChange={(show_subtext) => onChange({...banner, show_subtext})} />
      {banner.show_subtext && <RichTextField label="Subtext" value={banner.subtext} onChange={(subtext) => onChange({...banner, subtext})} />}
      {advanced && <div className="banner-conditions">
        <strong>Conditions</strong>
        {banner.conditions.map((condition) => <div className="condition-row" key={condition.id}>
          <label><span>Type</span><select value={condition.type} onChange={(event) => { const type = event.target.value as BannerConditionType; updateCondition(condition.id, {...condition, type, operator: type === 'product_title' ? 'contains' : 'greater_than'}); }}>{conditionTypeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
          <label><span>Condition</span><select value={condition.operator} onChange={(event) => updateCondition(condition.id, {...condition, operator: event.target.value as BannerConditionOperator})}>{operatorsFor(condition.type).map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
          <label><span>Value</span><input type={condition.type === 'product_title' ? 'text' : 'number'} min="0" value={condition.value} onChange={(event) => updateCondition(condition.id, {...condition, value: event.target.value})} /></label>
          <button className="icon-button icon-button--danger" type="button" aria-label="Remove condition" title="Remove condition" onClick={() => onChange({...banner, conditions: banner.conditions.filter((item) => item.id !== condition.id)})}><Trash2 size={15} /></button>
        </div>)}
        <button className="text-button" type="button" onClick={addCondition} disabled={banner.conditions.length >= 8}><Plus size={15} />Add condition</button>
      </div>}
    </div>
  );
}

function EditorSection({title, description, children}: {title: string; description?: string; children: React.ReactNode}) {
  return <section className="appearance-section"><header><h2>{title}</h2>{description && <p>{description}</p>}</header><div className="appearance-section__body">{children}</div></section>;
}

function validate(configuration: CartAppearanceConfiguration): string | null {
  const colors = [configuration.theme_color, configuration.announcement_background, configuration.announcement_text_color, configuration.checkout_background, configuration.checkout_text_color, configuration.footer_text_color, configuration.confirmation_background, configuration.confirmation_text_color, configuration.scarcity_timer_background, configuration.scarcity_timer_text_color];
  if (colors.some((color) => !/^#[0-9A-F]{6}$/i.test(color))) return 'Enter valid six-digit hex colors.';
  if (!configuration.empty_cta_url.startsWith('/') && !/^https?:\/\//i.test(configuration.empty_cta_url)) return 'The empty-cart link must be a store path or an HTTP(S) URL.';
  if (!configuration.checkout_text.text.trim()) return 'Checkout button text cannot be empty.';
  if (configuration.banners.some((banner) => !banner.title.text.trim())) return 'Every announcement banner needs title text.';
  if (configuration.advanced_conditions && configuration.banners.some((banner) => !banner.conditions.length)) return 'Every advanced banner needs at least one condition.';
  if (configuration.advanced_conditions && configuration.banners.some((banner) => banner.conditions.some((condition) => !condition.value.trim()))) return 'Enter a value for every advanced banner condition.';
  if (/<script\b|javascript:/i.test(configuration.custom_script)) return 'Paste script contents only; script tags and javascript: URLs are not accepted.';
  const selectorLists = [...configuration.custom_cart_icon_selectors, ...configuration.custom_cart_drawer_selectors];
  for (const selector of selectorLists) {
    try { document.createDocumentFragment().querySelector(selector); } catch { return `Invalid CSS selector: ${selector}`; }
  }
  if (configuration.custom_cart_drawer_selectors.some((selector) => ['*', 'html', 'body', ':root'].includes(selector.toLowerCase()))) return 'Custom drawer selectors cannot target the entire document.';
  if (configuration.scarcity_timer_enabled) {
    if (!configuration.scarcity_timer_title.text.trim()) return 'Scarcity timer title cannot be empty.';
    if (configuration.scarcity_timer_type === 'sales') {
      const startsAt = Date.parse(configuration.scarcity_sale_starts_at || '');
      const endsAt = Date.parse(configuration.scarcity_sale_ends_at || '');
      if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) return 'Set the sales countdown start and end times.';
      if (endsAt <= startsAt) return 'Sales countdown end time must be after its start time.';
    } else {
      const duration = configuration.scarcity_timer_days * 86400 + configuration.scarcity_timer_hours * 3600 + configuration.scarcity_timer_minutes * 60 + configuration.scarcity_timer_seconds;
      if (duration <= 0) return 'Scarcity timer duration must be greater than zero.';
      if (![configuration.scarcity_show_days, configuration.scarcity_show_hours, configuration.scarcity_show_minutes, configuration.scarcity_show_seconds].some(Boolean)) return 'Select at least one scarcity timer display unit.';
    }
  }
  if (configuration.terms_checkbox_enabled && !configuration.terms_checkbox_text.trim()) return 'Terms checkbox text cannot be empty.';
  if (configuration.terms_checkbox_enabled && !configuration.terms_checkbox_url.startsWith('/') && !/^https?:\/\//i.test(configuration.terms_checkbox_url)) return 'The terms link must be a store path or an HTTP(S) URL.';
  if (configuration.checkout_on_cart_enabled && configuration.checkout_login_banner_enabled && !configuration.checkout_login_banner_text.trim()) return 'Login banner text cannot be empty.';
  if (configuration.checkout_on_cart_enabled && !configuration.checkout_personalisation_message.trim()) return 'Personalisation message cannot be empty.';
  if (configuration.product_quantity_limit_enabled && !configuration.quantity_limit_variant_id) return 'Select a product variant for the quantity limit.';
  return null;
}

export function CartAppearancePage({previewMode}: {previewMode: boolean}) {
  const [configuration, setConfiguration] = useState(() => cloneConfiguration(defaultAppearance));
  const [saved, setSaved] = useState(() => cloneConfiguration(defaultAppearance));
  const [loading, setLoading] = useState(!previewMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [emptyPreview, setEmptyPreview] = useState(false);
  const [activeTab, setActiveTab] = useState<'appearance' | 'settings'>('appearance');
  const dirty = useMemo(() => JSON.stringify(configuration) !== JSON.stringify(saved), [configuration, saved]);

  useEffect(() => {
    if (previewMode) return;
    let active = true;
    getCartAppearance().then((result) => {
      if (!active) return;
      const {updated_at: _updatedAt, ...next} = result;
      setConfiguration(cloneConfiguration(next));
      setSaved(cloneConfiguration(next));
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not load cart appearance.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [previewMode]);

  useEffect(() => {
    if (!dirty) return;
    const preventNavigation = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', preventNavigation);
    return () => window.removeEventListener('beforeunload', preventNavigation);
  }, [dirty]);

  const update = useCallback(<K extends keyof CartAppearanceConfiguration>(key: K, value: CartAppearanceConfiguration[K]) => {
    setConfiguration((current) => ({...current, [key]: value}));
    setNotice(null);
  }, []);

  const save = async () => {
    const validationError = validate(configuration);
    if (validationError) { setError(validationError); return; }
    setSaving(true);
    setError(null);
    try {
      let persisted = configuration;
      if (!previewMode) {
        const {updated_at: _updatedAt, ...responseConfiguration} = await saveCartAppearance(configuration);
        persisted = responseConfiguration;
        setConfiguration(cloneConfiguration(persisted));
      }
      setSaved(cloneConfiguration(persisted));
      setNotice('Cart configuration saved.');
      window.setTimeout(() => setNotice(null), 2600);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save cart appearance.');
    } finally {
      setSaving(false);
    }
  };

  const addBanner = () => update('banners', [...configuration.banners, {id: crypto.randomUUID().replaceAll('-', '').slice(0, 16), title: defaultRichText('New announcement'), show_subtext: false, subtext: defaultRichText('', 12), conditions: configuration.advanced_conditions ? [newCondition()] : []}]);

  const toggleAdvancedConditions = (value: boolean) => {
    setConfiguration((current) => ({
      ...current,
      advanced_conditions: value,
      dynamic_banners: value ? false : current.dynamic_banners,
      banners: value
        ? current.banners.map((banner) => ({...banner, conditions: banner.conditions.length ? banner.conditions : [newCondition()]}))
        : current.banners,
    }));
    setNotice(null);
  };

  const toggleDynamicBanners = (value: boolean) => {
    setConfiguration((current) => ({...current, dynamic_banners: value, advanced_conditions: value ? false : current.advanced_conditions}));
    setNotice(null);
  };

  if (loading) return <div className="appearance-loading"><span className="spinner" /><p>Loading cart appearance...</p></div>;

  return (
    <div className="appearance-page">
      <header className="appearance-header">
        <div><p className="eyebrow">Cart appearance &amp; settings</p><h1>{activeTab === 'appearance' ? 'Design your cart' : 'Configure cart behavior'}</h1><p>{activeTab === 'appearance' ? 'Set the visual language customers see in the cart drawer.' : 'Control add-to-cart handling, routing, limits, and storefront interactions.'}</p></div>
        <div className="preview-state-switch" role="group" aria-label="Preview state"><button type="button" className={!emptyPreview ? 'is-active' : ''} onClick={() => setEmptyPreview(false)}>With items</button><button type="button" className={emptyPreview ? 'is-active' : ''} onClick={() => setEmptyPreview(true)}>Empty</button></div>
      </header>

      <nav className="appearance-tabs" aria-label="Cart appearance views"><button className={activeTab === 'appearance' ? 'is-active' : ''} type="button" aria-current={activeTab === 'appearance' ? 'page' : undefined} onClick={() => setActiveTab('appearance')}>Appearance</button><button className={activeTab === 'settings' ? 'is-active' : ''} type="button" aria-current={activeTab === 'settings' ? 'page' : undefined} onClick={() => setActiveTab('settings')}>Cart settings</button></nav>

      {error && <div className="inline-alert" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Dismiss error"><X size={16} /></button></div>}
      {notice && <div className="save-toast" role="status"><ShieldCheck size={17} />{notice}</div>}

      <div className="appearance-workspace">
        <div className="appearance-editor">
          {activeTab === 'appearance' ? <>
          <EditorSection title="Font style">
            <div className="choice-list" role="radiogroup" aria-label="Font style">
              <label><input type="radio" name="font" checked={configuration.font_source === 'pragma-site-cart'} onChange={() => update('font_source', 'pragma-site-cart')} /><span><strong>Default pragma-site-cart font</strong><small>Clean, neutral interface typeface</small></span></label>
              <label><input type="radio" name="font" checked={configuration.font_source === 'theme'} onChange={() => update('font_source', 'theme')} /><span><strong>Import from current theme</strong><small>Inherit your storefront typography</small></span></label>
            </div>
          </EditorSection>

          <EditorSection title="Theme color"><ColorField label="Primary color" value={configuration.theme_color} onChange={(value) => update('theme_color', value)} /><p className="field-help">Used for reward progress, savings highlights, gift accents, and the empty-cart CTA. The checkout button uses its dedicated color below.</p></EditorSection>

          <EditorSection title="Cart announcement banners" description="Messages appear at the top of the cart drawer.">
            <Toggle checked={configuration.announcement_enabled} label="Enable announcements" onChange={(value) => update('announcement_enabled', value)} />
            {configuration.announcement_enabled && <>
              <div className="field-grid"><ColorField label="Background color" value={configuration.announcement_background} onChange={(value) => update('announcement_background', value)} /><ColorField label="Text color" value={configuration.announcement_text_color} onChange={(value) => update('announcement_text_color', value)} /></div>
              <AlignmentPicker value={configuration.announcement_alignment} onChange={(value) => update('announcement_alignment', value)} />
              <Toggle checked={configuration.advanced_conditions} disabled={configuration.dynamic_banners} label="Advanced conditions" description={configuration.dynamic_banners ? 'Switch off Dynamic banners to enable conditional messages.' : 'Show the first banner whose cart conditions match.'} onChange={toggleAdvancedConditions} />
              <Toggle checked={configuration.dynamic_banners} disabled={configuration.advanced_conditions} label="Dynamic banners" description={configuration.advanced_conditions ? 'Switch off Advanced conditions to enable rotation.' : 'Slide through multiple messages automatically.'} onChange={toggleDynamicBanners} />
              {configuration.dynamic_banners && <Field label="Auto change time (seconds)" type="number" value={configuration.auto_change_seconds} onChange={(value) => update('auto_change_seconds', Math.min(60, Math.max(2, Number(value))))} />}
              <div className="banner-list">{configuration.banners.map((banner, index) => <BannerEditor key={banner.id} banner={banner} advanced={configuration.advanced_conditions} canRemove={configuration.banners.length > 1} onChange={(next) => update('banners', configuration.banners.map((item, itemIndex) => itemIndex === index ? next : item))} onRemove={() => update('banners', configuration.banners.filter((item) => item.id !== banner.id))} />)}</div>
              <button className="text-button" type="button" onClick={addBanner} disabled={configuration.banners.length >= 8}><Plus size={16} />Add another banner</button>
            </>}
          </EditorSection>

          <EditorSection title="Product display">
            <Toggle checked={configuration.display_all_products} label="Display all products on cart" description="Show every cart line without compact optimization." onChange={(value) => update('display_all_products', value)} />
            <Toggle checked={configuration.show_variant_names} label="Show variant names on product" onChange={(value) => update('show_variant_names', value)} />
            <Toggle checked={configuration.show_item_properties} label="Show item-level properties" description="Displays details such as engraving or personalization." onChange={(value) => update('show_item_properties', value)} />
            <Toggle checked={configuration.show_free_gift_first} label="Show free gift on top" onChange={(value) => update('show_free_gift_first', value)} />
          </EditorSection>

          <EditorSection title="Empty cart message">
            <Field label="Title text" value={configuration.empty_title} placeholder="Your Cart is Empty" onChange={(value) => update('empty_title', value)} />
            <Field label="CTA text" value={configuration.empty_cta_text} placeholder="Continue Shopping" onChange={(value) => update('empty_cta_text', value)} />
            <Field label="CTA redirection link" type="url" value={configuration.empty_cta_url} placeholder="/collections/all" onChange={(value) => update('empty_cta_url', value)} />
          </EditorSection>

          <EditorSection title="Pricing and savings">
            <Toggle checked={configuration.show_savings} label="Show savings when discounts are applied" onChange={(value) => update('show_savings', value)} />
            <Toggle checked={configuration.show_mrp_discounts} label="Show discounts on MRP" description="Requires compare-at prices on Shopify products." onChange={(value) => update('show_mrp_discounts', value)} />
          </EditorSection>

          <EditorSection title="Primary checkout section">
            <div className="field-grid"><ColorField label="Background color" value={configuration.checkout_background} onChange={(value) => update('checkout_background', value)} /><ColorField label="Text color" value={configuration.checkout_text_color} onChange={(value) => update('checkout_text_color', value)} /></div>
            <RichTextField label="Button text" value={configuration.checkout_text} onChange={(value) => update('checkout_text', value)} />
            <Toggle checked={configuration.checkout_subtext_enabled} label="Add subtext" onChange={(value) => update('checkout_subtext_enabled', value)} />
            {configuration.checkout_subtext_enabled && <RichTextField label="Button subtext" value={configuration.checkout_subtext} onChange={(value) => update('checkout_subtext', value)} />}
            <AlignmentPicker value={configuration.checkout_alignment} onChange={(value) => update('checkout_alignment', value)} />
            <Toggle checked={configuration.pragma_site_cart_checkout} label="pragma-site-cart Checkout" description="On uses the Pragma Site Cart checkout experience. Off uses standard Shopify Checkout." onChange={(value) => update('pragma_site_cart_checkout', value)} />
            <Toggle checked={configuration.show_payment_icons} label="Show payment icons on checkout button" onChange={(value) => update('show_payment_icons', value)} />
          </EditorSection>

          <EditorSection title="Estimated total and footer">
            <Toggle checked={configuration.show_estimated_total_breakup} label="Show estimated total breakup" onChange={(value) => update('show_estimated_total_breakup', value)} />
            <Toggle checked={configuration.footer_enabled} label="Add footer message" onChange={(value) => update('footer_enabled', value)} />
            {configuration.footer_enabled && <><ColorField label="Text color" value={configuration.footer_text_color} onChange={(value) => update('footer_text_color', value)} /><RichTextField label="Footer text" value={configuration.footer_text} onChange={(value) => update('footer_text', value)} /><AlignmentPicker value={configuration.footer_alignment} onChange={(value) => update('footer_alignment', value)} /></>}
          </EditorSection>

          <EditorSection title="Custom script" description="Runs inside the cart drawer after saved configuration is published.">
            <label className="field"><span>Script contents</span><textarea rows={7} value={configuration.custom_script} maxLength={20000} spellCheck={false} placeholder="// Optional cart customization" onChange={(event) => update('custom_script', event.target.value)} /><small>{configuration.custom_script.length.toLocaleString()} / 20,000</small></label>
          </EditorSection>
          </> : <CartSettingsEditor configuration={configuration} update={update} previewMode={previewMode} />}
        </div>

        <div className="preview-column"><div className="preview-column__heading"><span>Live preview</span><small>{emptyPreview ? 'Empty cart' : 'Cart with products'}</small></div><CartPreview configuration={configuration} empty={emptyPreview} /></div>
      </div>

      {dirty && <div className="save-bar" role="region" aria-label="Unsaved changes"><span>Unsaved changes</span><div><button className="button button--secondary" type="button" onClick={() => { setConfiguration(cloneConfiguration(saved)); setError(null); }}><RotateCcw size={16} />Discard</button><button className="button button--primary" type="button" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button></div></div>}
    </div>
  );
}
