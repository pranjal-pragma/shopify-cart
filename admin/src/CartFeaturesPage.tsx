import {
  Bold,
  BadgePercent,
  ChevronDown,
  Gift,
  Italic,
  PackageSearch,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Truck,
  Trash2,
  Underline,
  X,
} from 'lucide-react';
import {useCallback, useEffect, useMemo, useState} from 'react';

import {
  getCartFeatures,
  getShopifyDiscounts,
  saveCartFeatures,
  type CartFeaturesConfiguration,
  type FreeGiftCondition,
  type FreeGiftOffer,
  type FreeGiftVariant,
  type ProductSwapRule,
  type ProductSwapSizeGroup,
  type RichTextStyle,
  type ShopifyResource,
  type ShopifyDiscountOption,
  type TierReward,
} from './api';

type FeatureView = 'discounts' | 'notes' | 'gifts' | 'rewards' | 'one_tick' | 'swap';
type Update = <K extends keyof CartFeaturesConfiguration>(key: K, value: CartFeaturesConfiguration[K]) => void;

const featureViews: {id: FeatureView; label: string}[] = [
  {id: 'discounts', label: 'Discounts setup'},
  {id: 'notes', label: 'Order notes'},
  {id: 'gifts', label: 'Free gifts'},
  {id: 'rewards', label: 'Tiered reward'},
  {id: 'one_tick', label: 'One-tick upsell'},
  {id: 'swap', label: 'Product swap'},
];

const richText = (text: string): RichTextStyle => ({text, bold: false, italic: false, underline: false, font_size: 14});
const itemId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replaceAll('-', '').slice(0, 16);
const clone = (configuration: CartFeaturesConfiguration) => structuredClone(configuration);

const toLocalDateTime = (value: string) => {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};
const fromLocalDateTime = (value: string) => new Date(value).toISOString();

const newGiftCondition = (): FreeGiftCondition => ({
  id: itemId(),
  condition_type: 'cart_quantity',
  operator: 'greater_than',
  value: 1,
  applicable_on: 'all',
  product_ids: [],
  product_titles: [],
});

const newGiftOffer = (): FreeGiftOffer => {
  const startsAt = new Date();
  startsAt.setSeconds(0, 0);
  const endsAt = new Date(startsAt.getTime() + 7 * 86_400_000);
  return {
    id: itemId(),
    title: 'Free gift unlocked',
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    source_variant_id: '',
    source_variant_title: '',
    variant_id: '',
    variant_title: '',
    eligibility_type: 'cart_subtotal',
    threshold: 999,
    quantity: 1,
    re_add_each_time: false,
    gift_variants: [],
    conditions: [newGiftCondition()],
  };
};

const newReward = (): TierReward => ({
  id: itemId(),
  goal: 999,
  reward_type: 'shipping',
  reward_text: 'Free shipping',
  before_text: 'Spend more to unlock free shipping',
  gift_offer_id: null,
  gift_offer_title: '',
  discount_id: null,
  discount_title: '',
  discount_code: '',
  discount_classes: [],
});

const newSwapRule = (): ProductSwapRule => ({
  id: itemId(),
  enabled: true,
  trigger_scope: 'product',
  trigger_id: '',
  trigger_title: '',
  use_case: 'size_upgrade',
  target_variant_id: '',
  target_variant_title: '',
  pill_label: 'Upgrade now',
  nudge_strategy: 'automatic',
});

const newSizeGroup = (): ProductSwapSizeGroup => ({
  id: itemId(),
  title: 'Size ladder',
  variant_ids: [],
  variant_titles: [],
});

export const defaultFeatures: CartFeaturesConfiguration = {
  discount_mode: 'discount_box',
  order_notes_enabled: true,
  order_notes_title: 'Add special instructions',
  free_gifts_enabled: false,
  free_gifts_copy_inventory: true,
  free_gift_method: 'auto',
  free_gift_offers: [],
  free_gift_congratulations: true,
  tiered_rewards_enabled: false,
  tiered_reward_condition: 'cart_subtotal',
  tiered_rewards: [],
  tiered_primary_color: '#F10A0A',
  tiered_secondary_color: '#E5E7EB',
  tiered_confetti_enabled: true,
  tiered_applicable_on: 'all',
  tiered_exclude_discounts: false,
  tiered_completion_text: 'All rewards unlocked',
  one_tick_enabled: false,
  one_tick_text: richText('Add gift wrapping'),
  one_tick_variant_id: null,
  one_tick_variant_title: '',
  one_tick_sku_enabled: false,
  one_tick_disable_quantity_changes: false,
  one_tick_disable_checkout_only: false,
  product_swap_enabled: false,
  product_swap_coexistence: 'swap',
  product_swap_automatic_upgrade: true,
  product_swap_rules: [],
  product_swap_size_groups: [],
};

function Toggle({checked, label, description, onChange}: {checked: boolean; label: string; description?: string; onChange: (value: boolean) => void}) {
  return <label className="setting-toggle"><span className="setting-toggle__copy"><strong>{label}</strong>{description && <small>{description}</small>}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="toggle-track" aria-hidden="true"><span /></span></label>;
}

function Field({label, value, onChange, type = 'text', maxLength}: {label: string; value: string | number; onChange: (value: string) => void; type?: 'text' | 'number' | 'datetime-local'; maxLength?: number}) {
  return <label className="field"><span>{label}</span><input type={type} value={value} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} />{maxLength && <small>{String(value).length} / {maxLength}</small>}</label>;
}

function SelectField({label, value, options, onChange, disabled = false, helper}: {label: string; value: string; options: {value: string; label: string}[]; onChange: (value: string) => void; disabled?: boolean; helper?: string}) {
  return <label className="field"><span>{label}</span><select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select>{helper && <small>{helper}</small>}</label>;
}

function ColorField({label, value, onChange}: {label: string; value: string; onChange: (value: string) => void}) {
  return <label className="field color-field"><span>{label}</span><span className="color-input-wrap"><input className="color-swatch" type="color" value={value} onChange={(event) => onChange(event.target.value.toUpperCase())} /><input value={value} maxLength={7} onChange={(event) => onChange(event.target.value.toUpperCase())} aria-label={`${label} hex value`} /></span></label>;
}

function RichField({label, value, onChange}: {label: string; value: RichTextStyle; onChange: (value: RichTextStyle) => void}) {
  const set = <K extends keyof RichTextStyle>(key: K, next: RichTextStyle[K]) => onChange({...value, [key]: next});
  return <div className="field rich-field"><span>{label}</span><div className="rich-toolbar" aria-label={`${label} formatting`}><button className={value.bold ? 'is-active' : ''} type="button" onClick={() => set('bold', !value.bold)} aria-label="Bold"><Bold size={15} /></button><button className={value.italic ? 'is-active' : ''} type="button" onClick={() => set('italic', !value.italic)} aria-label="Italic"><Italic size={15} /></button><button className={value.underline ? 'is-active' : ''} type="button" onClick={() => set('underline', !value.underline)} aria-label="Underline"><Underline size={15} /></button><select value={value.font_size} onChange={(event) => set('font_size', Number(event.target.value) as RichTextStyle['font_size'])} aria-label="Font size">{[12, 14, 16, 18, 20].map((size) => <option value={size} key={size}>{size}px</option>)}</select></div><input value={value.text} maxLength={64} onChange={(event) => set('text', event.target.value)} /><small>{value.text.length} / 64</small></div>;
}

async function pickResource(type: 'variant' | 'product' | 'collection', selectedId?: string | null): Promise<ShopifyResource | null> {
  if (!window.shopify?.resourcePicker) return null;
  const selected = await window.shopify.resourcePicker({type, action: 'select', multiple: false, selectionIds: selectedId ? [{id: selectedId}] : undefined});
  return selected?.[0] ?? null;
}

function ResourceField({label, value, title, type, previewMode, onChange}: {label: string; value: string | null; title: string; type: 'variant' | 'product' | 'collection'; previewMode: boolean; onChange: (resource: ShopifyResource | null) => void}) {
  return <div className="field"><span>{label}</span>{value ? <div className="selected-resource"><span><strong>{title}</strong><small>{value}</small></span><button className="icon-button" type="button" onClick={() => onChange(null)} aria-label={`Clear ${label}`}><X size={15} /></button></div> : <button className="button button--secondary resource-picker-button" type="button" disabled={previewMode || !window.shopify?.resourcePicker} onClick={async () => onChange(await pickResource(type, value))}><PackageSearch size={16} />Select {type}</button>}</div>;
}

function Section({title, description, children}: {title: string; description?: string; children: React.ReactNode}) {
  return <section className="appearance-section"><header><h2>{title}</h2>{description && <p>{description}</p>}</header><div className="appearance-section__body">{children}</div></section>;
}

function ChoiceGroup({name, value, options, onChange, columns = 3}: {name: string; value: string; options: {value: string; label: string; description?: string}[]; onChange: (value: string) => void; columns?: 2 | 3}) {
  return <div className={`choice-list ${columns === 2 ? 'choice-list--two' : 'choice-list--compact'}`} role="radiogroup" aria-label={name}>{options.map((option) => <label key={option.value}><input type="radio" name={name} checked={value === option.value} onChange={() => onChange(option.value)} /><span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span></label>)}</div>;
}

function ItemHeader({title, onRemove}: {title: string; onRemove: () => void}) {
  return <div className="feature-item__header"><strong>{title}</strong><button className="icon-button icon-button--danger" type="button" onClick={onRemove} aria-label={`Remove ${title}`} title="Remove"><Trash2 size={15} /></button></div>;
}

function GiftVariantsEditor({offer, previewMode, onChange}: {offer: FreeGiftOffer; previewMode: boolean; onChange: (offer: FreeGiftOffer) => void}) {
  const setVariants = (giftVariants: FreeGiftVariant[]) => {
    const primary = giftVariants[0];
    onChange({...offer, gift_variants: giftVariants, source_variant_id: primary?.source_variant_id || '', source_variant_title: primary?.source_variant_title || '', variant_id: primary?.variant_id || '', variant_title: primary?.variant_title || ''});
  };
  return <div className="field gift-variants-field"><span>Select free gift options</span><div className="gift-variants-list">{offer.gift_variants.map((gift) => <div className="selected-resource" key={gift.id}><span><strong>{gift.source_variant_title}</strong><small>{gift.source_variant_id}</small></span><button className="icon-button" type="button" onClick={() => setVariants(offer.gift_variants.filter((item) => item.id !== gift.id))} aria-label={`Remove ${gift.source_variant_title}`}><X size={15} /></button></div>)}</div><button className="button button--secondary resource-picker-button" type="button" disabled={previewMode || !window.shopify?.resourcePicker || offer.gift_variants.length >= 12} onClick={async () => { const resource = await pickResource('variant'); if (!resource || offer.gift_variants.some((gift) => gift.source_variant_id === resource.id)) return; const title = resource.displayName || resource.title || resource.id; setVariants([...offer.gift_variants, {id: itemId(), source_variant_id: resource.id, source_variant_title: title, variant_id: resource.id, variant_title: title}]); }}><PackageSearch size={16} />Add gift option</button></div>;
}

function GiftOffersEditor({offers, previewMode, onChange}: {offers: FreeGiftOffer[]; previewMode: boolean; onChange: (offers: FreeGiftOffer[]) => void}) {
  const setOffer = (index: number, next: FreeGiftOffer) => onChange(offers.map((offer, offerIndex) => offerIndex === index ? next : offer));
  const setCondition = (offerIndex: number, conditionIndex: number, next: FreeGiftCondition) => {
    const offer = offers[offerIndex];
    setOffer(offerIndex, {...offer, conditions: offer.conditions.map((condition, index) => index === conditionIndex ? next : condition)});
  };
  return <Section title="Gift offers" description="Create scheduled offers and choose exactly when each gift becomes eligible."><div className="feature-item-list gift-offer-list">{offers.map((offer, offerIndex) => <details className="feature-item gift-offer" open key={offer.id}><summary><span><ChevronDown size={16} /><strong>Offer {offerIndex + 1}</strong></span><button className="button button--danger button--compact" type="button" onClick={(event) => { event.preventDefault(); onChange(offers.filter((item) => item.id !== offer.id)); }}>Remove offer</button></summary><div className="gift-offer__body"><Field label="Offer title" value={offer.title} maxLength={40} onChange={(value) => setOffer(offerIndex, {...offer, title: value})} /><div className="field-grid"><Field label="Start date" type="datetime-local" value={toLocalDateTime(offer.starts_at)} onChange={(value) => setOffer(offerIndex, {...offer, starts_at: fromLocalDateTime(value)})} /><Field label="End date" type="datetime-local" value={toLocalDateTime(offer.ends_at)} onChange={(value) => setOffer(offerIndex, {...offer, ends_at: fromLocalDateTime(value)})} /></div><Toggle checked={offer.re_add_each_time} label="Re-add each time condition is met" description="Add the gift again if it was removed and the shopper becomes eligible again." onChange={(value) => setOffer(offerIndex, {...offer, re_add_each_time: value})} /><GiftVariantsEditor offer={offer} previewMode={previewMode} onChange={(next) => setOffer(offerIndex, next)} /><Field label="Gift quantity" type="number" value={offer.quantity} onChange={(value) => setOffer(offerIndex, {...offer, quantity: Math.min(20, Math.max(1, Number(value)))})} /><div className="gift-conditions"><h3>Conditions</h3>{offer.conditions.map((condition, conditionIndex) => <div className="gift-condition" key={condition.id}><div className="gift-condition__header"><strong>Condition {conditionIndex + 1}</strong><button className="button button--secondary button--compact" type="button" disabled={offer.conditions.length === 1} onClick={() => setOffer(offerIndex, {...offer, conditions: offer.conditions.filter((item) => item.id !== condition.id)})}>Remove condition</button></div><div className="gift-condition__rule"><SelectField label="Type" value={condition.condition_type} options={[{value: 'cart_quantity', label: 'Cart quantity'}, {value: 'cart_subtotal', label: 'Cart subtotal'}]} onChange={(value) => setCondition(offerIndex, conditionIndex, {...condition, condition_type: value as FreeGiftCondition['condition_type']})} /><SelectField label="Condition" value={condition.operator} options={[{value: 'greater_than', label: 'Greater than'}, {value: 'greater_than_or_equal', label: 'Greater than or equal'}, {value: 'equal_to', label: 'Equal to'}]} onChange={(value) => setCondition(offerIndex, conditionIndex, {...condition, operator: value as FreeGiftCondition['operator']})} /><Field label="Value" type="number" value={condition.value} onChange={(value) => setCondition(offerIndex, conditionIndex, {...condition, value: Math.max(0, Number(value))})} /></div><SelectField label="Applicable on" value={condition.applicable_on} options={[{value: 'all', label: 'All products'}, {value: 'products', label: 'Specific products'}]} onChange={(value) => setCondition(offerIndex, conditionIndex, {...condition, applicable_on: value as FreeGiftCondition['applicable_on'], product_ids: [], product_titles: []})} />{condition.applicable_on === 'products' && <div className="gift-condition__products"><button className="button button--secondary resource-picker-button" type="button" disabled={previewMode || !window.shopify?.resourcePicker} onClick={async () => { const resource = await pickResource('product'); if (resource && !condition.product_ids.includes(resource.id)) setCondition(offerIndex, conditionIndex, {...condition, product_ids: [...condition.product_ids, resource.id], product_titles: [...condition.product_titles, resource.title || resource.displayName || resource.id]}); }}><PackageSearch size={16} />Search products</button>{condition.product_ids.map((id, productIndex) => <div className="selected-resource" key={id}><span><strong>{condition.product_titles[productIndex]}</strong><small>{id}</small></span><button className="icon-button" type="button" aria-label={`Remove ${condition.product_titles[productIndex]}`} onClick={() => setCondition(offerIndex, conditionIndex, {...condition, product_ids: condition.product_ids.filter((_, index) => index !== productIndex), product_titles: condition.product_titles.filter((_, index) => index !== productIndex)})}><X size={15} /></button></div>)}</div>}</div>)}<button className="button button--secondary gift-condition__add" type="button" disabled={offer.conditions.length >= 8} onClick={() => setOffer(offerIndex, {...offer, conditions: [...offer.conditions, newGiftCondition()]})}><Plus size={15} />Add more conditions</button></div></div></details>)}</div><button className="text-button" type="button" disabled={offers.length >= 12} onClick={() => onChange([...offers, newGiftOffer()])}><Plus size={16} />Create another offer</button></Section>;
}

function RewardTypeIcon({type, size = 17}: {type: TierReward['reward_type']; size?: number}) {
  if (type === 'shipping') return <Truck size={size} />;
  if (type === 'free_gift') return <Gift size={size} />;
  if (type === 'discount') return <BadgePercent size={size} />;
  return <Sparkles size={size} />;
}

function RewardFulfillmentEditor({configuration, discounts, onChange}: {configuration: CartFeaturesConfiguration; discounts: ShopifyDiscountOption[]; onChange: (index: number, reward: TierReward) => void}) {
  return <Section title="Reward fulfillment" description="Connect each milestone to the Shopify reward that should be applied."><div className="feature-item-list">{configuration.tiered_rewards.map((reward, index) => {
    const shipping = reward.reward_type === 'shipping';
    const eligibleDiscounts = discounts.filter((discount) => shipping ? discount.discount_classes.includes('SHIPPING') : !discount.discount_classes.includes('SHIPPING'));
    return <div className="feature-item reward-binding" key={reward.id}><div className="reward-binding__heading"><span><RewardTypeIcon type={reward.reward_type} /></span><div><strong>{reward.reward_text}</strong><small>Unlocks at {reward.goal}</small></div></div>{reward.reward_type === 'free_gift' && <SelectField label="Free gift offer" value={reward.gift_offer_id || ''} disabled={!configuration.free_gifts_enabled || !configuration.free_gift_offers.length} helper={configuration.free_gifts_enabled ? 'The tier goal becomes the eligibility condition for this offer.' : 'Enable Free gifts and create an offer first.'} options={[{value: '', label: 'Select a gift offer'}, ...configuration.free_gift_offers.map((offer) => ({value: offer.id, label: offer.title}))]} onChange={(value) => { const offer = configuration.free_gift_offers.find((item) => item.id === value); onChange(index, {...reward, gift_offer_id: value || null, gift_offer_title: offer?.title || '', discount_id: null, discount_title: '', discount_code: '', discount_classes: []}); }} />}{(shipping || reward.reward_type === 'discount') && <SelectField label={shipping ? 'Free shipping discount' : 'Shopify discount'} value={reward.discount_id || ''} disabled={!eligibleDiscounts.length} helper={eligibleDiscounts.length ? `The code is applied automatically when this tier unlocks. Keep its Shopify minimum aligned with ${reward.goal}.` : `Create an active ${shipping ? 'free shipping' : 'order or product'} code discount in Shopify first.`} options={[{value: '', label: 'Select an active discount'}, ...eligibleDiscounts.map((discount) => ({value: discount.id, label: `${discount.title} (${discount.code})`}))]} onChange={(value) => { const discount = discounts.find((item) => item.id === value); onChange(index, {...reward, gift_offer_id: null, gift_offer_title: '', discount_id: discount?.id || null, discount_title: discount?.title || '', discount_code: discount?.code || '', discount_classes: discount?.discount_classes || []}); }} />}{reward.reward_type === 'custom' && <p className="reward-binding__helper"><Sparkles size={15} />Custom milestones display progress and celebration only.</p>}</div>;
  })}</div></Section>;
}

function FeaturePreview({configuration, activeView}: {configuration: CartFeaturesConfiguration; activeView: FeatureView}) {
  const reward = [...configuration.tiered_rewards].sort((a, b) => a.goal - b.goal)[0];
  const progress = reward ? Math.min(100, Math.round(749 / reward.goal * 100)) : 0;
  return <aside className="features-preview" aria-label="Cart features preview"><div className="features-preview__header"><div><strong>Your cart</strong><small>2 items</small></div><X size={18} /></div>{configuration.tiered_rewards_enabled && reward && <div className="features-preview__reward"><span>{reward.before_text}</span><i style={{background: configuration.tiered_secondary_color}}><b style={{background: configuration.tiered_primary_color, width: `${progress}%`}} /></i><small><RewardTypeIcon type={reward.reward_type} size={14} />{reward.reward_text}</small></div>}<div className="features-preview__products"><div className="features-preview__product"><span className="features-preview__image" /><div><strong>Everyday tote</strong><small>Black / Medium</small>{configuration.product_swap_enabled && activeView === 'swap' && <em>{configuration.product_swap_rules[0]?.pill_label || 'Upgrade available'}</em>}</div><b>Rs. 749</b></div>{configuration.free_gifts_enabled && configuration.free_gift_offers[0] && <div className="features-preview__gift"><Gift size={17} /><span><strong>{configuration.free_gift_offers[0].title}</strong><small>{configuration.free_gift_method === 'auto' ? 'Added automatically' : 'Choose your gift'}</small></span><b>FREE</b></div>}</div><div className="features-preview__tools">{configuration.discount_mode === 'discount_box' && <div className="features-preview__coupon">Enter coupon code <button type="button">Apply</button></div>}{configuration.discount_mode === 'checkout_offers' && <div className="features-preview__offer"><Sparkles size={15} />Available checkout offers</div>}{configuration.order_notes_enabled && <div className="features-preview__note">{configuration.order_notes_title}</div>}{configuration.one_tick_enabled && <label className="features-preview__addon"><input type="checkbox" /> <span>{configuration.one_tick_text.text}<small>{configuration.one_tick_variant_title || 'Selected add-on'}</small></span></label>}</div><div className="features-preview__footer"><span>Estimated total</span><strong>Rs. 749</strong><button type="button">Checkout</button></div></aside>;
}

function validate(configuration: CartFeaturesConfiguration): string | null {
  if (configuration.free_gifts_enabled && !configuration.free_gift_offers.length) return 'Add at least one free gift offer.';
  for (const offer of configuration.free_gift_offers) {
    if (!offer.title.trim() || !offer.gift_variants.length) return 'Add at least one gift option to every offer.';
    if (configuration.free_gift_method === 'choice' && offer.gift_variants.length < 2) return 'Let customers choose requires at least two gift options in each offer.';
    if (Date.parse(offer.ends_at) <= Date.parse(offer.starts_at)) return 'Free gift end time must be after its start time.';
    if (offer.quantity < 1 || offer.quantity > 20) return 'Free gift quantity must be between 1 and 20.';
    if (!offer.conditions.length) return 'Add at least one condition to every free gift offer.';
    if (offer.conditions.some((condition) => condition.applicable_on === 'products' && !condition.product_ids.length)) return 'Select products for every product-specific gift condition.';
  }
  if (configuration.tiered_rewards_enabled && !configuration.tiered_rewards.length) return 'Add at least one tiered reward.';
  if (configuration.tiered_rewards.some((reward) => reward.goal <= 0 || !reward.reward_text.trim() || !reward.before_text.trim())) return 'Complete every tiered reward.';
  if (configuration.tiered_rewards_enabled && configuration.tiered_rewards.some((reward) => reward.reward_type === 'free_gift' && !reward.gift_offer_id)) return 'Select a free gift offer for every free gift reward.';
  if (configuration.tiered_rewards_enabled && configuration.tiered_rewards.some((reward) => ['shipping', 'discount'].includes(reward.reward_type) && !reward.discount_code)) return 'Select a Shopify discount for every shipping and discount reward.';
  if (configuration.tiered_rewards_enabled && configuration.tiered_rewards.some((reward) => reward.reward_type === 'free_gift') && !configuration.free_gifts_enabled) return 'Enable Free gifts before using a free gift reward.';
  if (configuration.tiered_rewards_enabled && configuration.tiered_reward_condition === 'cart_discount_price' && configuration.tiered_rewards.some((reward) => reward.reward_type === 'free_gift')) return 'Free gift rewards support cart subtotal or cart quantity conditions.';
  const linkedGiftOffers = configuration.tiered_rewards.filter((reward) => reward.reward_type === 'free_gift' && reward.gift_offer_id).map((reward) => reward.gift_offer_id);
  if (new Set(linkedGiftOffers).size !== linkedGiftOffers.length) return 'Use a different free gift offer for each reward tier.';
  if (!/^#[0-9A-F]{6}$/i.test(configuration.tiered_primary_color) || !/^#[0-9A-F]{6}$/i.test(configuration.tiered_secondary_color)) return 'Enter valid six-digit reward colors.';
  if (configuration.one_tick_enabled && (!configuration.one_tick_variant_id || !configuration.one_tick_text.text.trim())) return 'Select a one-tick variant and enter display text.';
  if (configuration.product_swap_rules.some((rule) => !rule.trigger_id || !rule.target_variant_id || !rule.pill_label.trim())) return 'Complete every product swap rule.';
  if (configuration.product_swap_size_groups.some((group) => group.variant_ids.length < 2)) return 'Each size group needs at least two ordered variants.';
  return null;
}

export function CartFeaturesPage({previewMode}: {previewMode: boolean}) {
  const [configuration, setConfiguration] = useState(() => clone(defaultFeatures));
  const [saved, setSaved] = useState(() => clone(defaultFeatures));
  const [activeView, setActiveView] = useState<FeatureView>('discounts');
  const [loading, setLoading] = useState(!previewMode);
  const [saving, setSaving] = useState(false);
  const [discounts, setDiscounts] = useState<ShopifyDiscountOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = useMemo(() => JSON.stringify(configuration) !== JSON.stringify(saved), [configuration, saved]);
  const update: Update = useCallback((key, value) => { setConfiguration((current) => ({...current, [key]: value})); setNotice(null); }, []);

  useEffect(() => {
    if (previewMode) return;
    let active = true;
    getCartFeatures()
      .then(({updated_at: _updatedAt, ...next}) => {
        if (active) { setConfiguration(clone(next)); setSaved(clone(next)); }
        return getShopifyDiscounts();
      })
      .then((items) => { if (active) setDiscounts(items); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load cart features.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [previewMode]);

  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);

  const save = async () => {
    const validationError = validate(configuration);
    if (validationError) { setError(validationError); return; }
    setSaving(true); setError(null);
    try {
      let persisted = configuration;
      if (!previewMode) {
        const {updated_at: _updatedAt, ...response} = await saveCartFeatures(configuration);
        persisted = response;
        setConfiguration(clone(response));
      }
      setSaved(clone(persisted));
      setNotice('Cart features saved.');
      window.setTimeout(() => setNotice(null), 2600);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save cart features.'); } finally { setSaving(false); }
  };

  const setReward = (index: number, next: TierReward) => update('tiered_rewards', configuration.tiered_rewards.map((reward, rewardIndex) => rewardIndex === index ? next : reward));
  const setRule = (index: number, next: ProductSwapRule) => update('product_swap_rules', configuration.product_swap_rules.map((rule, ruleIndex) => ruleIndex === index ? next : rule));
  const setGroup = (index: number, next: ProductSwapSizeGroup) => update('product_swap_size_groups', configuration.product_swap_size_groups.map((group, groupIndex) => groupIndex === index ? next : group));

  if (loading) return <div className="appearance-loading"><span className="spinner" /><p>Loading cart features...</p></div>;

  return <div className="appearance-page features-page"><header className="appearance-header"><div><p className="eyebrow">Cart features</p><h1>Build offers that convert</h1><p>Configure discounts, notes, gifts, rewards, add-ons, and product upgrades.</p></div></header><nav className="features-tabs" aria-label="Cart feature views">{featureViews.map((view) => <button type="button" className={activeView === view.id ? 'is-active' : ''} aria-current={activeView === view.id ? 'page' : undefined} onClick={() => setActiveView(view.id)} key={view.id}>{view.label}</button>)}</nav>{error && <div className="inline-alert" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Dismiss error"><X size={16} /></button></div>}{notice && <div className="save-toast" role="status"><ShieldCheck size={17} />{notice}</div>}<div className="appearance-workspace"><div className="appearance-editor">
    {activeView === 'discounts' && <Section title="Discounts setup" description="Choose one discount experience for the side cart."><ChoiceGroup name="Discount behavior" value={configuration.discount_mode} columns={3} onChange={(value) => update('discount_mode', value as CartFeaturesConfiguration['discount_mode'])} options={[{value: 'checkout_offers', label: 'Show checkout offers', description: 'Display discounts configured in pragma-site-cart Checkout.'}, {value: 'hide', label: 'Do not show offers', description: 'Keep discount entry out of the side cart.'}, {value: 'discount_box', label: 'Show discount box only', description: 'Let shoppers enter a coupon code.'}]} /></Section>}
    {activeView === 'notes' && <Section title="Order notes" description="Collect special instructions and save them as the Shopify cart note."><Toggle checked={configuration.order_notes_enabled} label="Enable" onChange={(value) => update('order_notes_enabled', value)} />{configuration.order_notes_enabled && <Field label="Title text" value={configuration.order_notes_title} maxLength={120} onChange={(value) => update('order_notes_title', value)} />}</Section>}
    {activeView === 'gifts' && <><Section title="Free gifts" description="Create zero-price gift offers and recalculate eligibility as the cart changes."><Toggle checked={configuration.free_gifts_enabled} label="Enable" onChange={(value) => update('free_gifts_enabled', value)} />{configuration.free_gifts_enabled && <div className="nested-settings"><Toggle checked={configuration.free_gifts_copy_inventory} label="Copy inventory setup from main product" description="Create a separate gift variant and keep its SKU, barcode, tracking, and stock aligned with the selected source variant." onChange={(value) => update('free_gifts_copy_inventory', value)} /><div className="field"><span>Choose free gift addition method</span><ChoiceGroup name="Gift addition method" value={configuration.free_gift_method} columns={2} onChange={(value) => update('free_gift_method', value as CartFeaturesConfiguration['free_gift_method'])} options={[{value: 'auto', label: 'Auto add to cart', description: 'Automatically adds the first gift option.'}, {value: 'choice', label: 'Let customers choose', description: 'Lets the shopper select one configured option.'}]} /></div><Toggle checked={configuration.free_gift_congratulations} label="Congratulations popup" description="Celebrate when a gift is added." onChange={(value) => update('free_gift_congratulations', value)} /></div>}</Section>{configuration.free_gifts_enabled && <GiftOffersEditor offers={configuration.free_gift_offers} previewMode={previewMode} onChange={(offers) => update('free_gift_offers', offers)} />}</>}
    {activeView === 'rewards' && <><Section title="Tiered reward" description="Build cart milestones that update as shoppers add products."><Toggle checked={configuration.tiered_rewards_enabled} label="Enable" onChange={(value) => update('tiered_rewards_enabled', value)} />{configuration.tiered_rewards_enabled && <div className="nested-settings"><div className="field"><span>Reward condition</span><ChoiceGroup name="Reward condition" value={configuration.tiered_reward_condition} onChange={(value) => update('tiered_reward_condition', value as CartFeaturesConfiguration['tiered_reward_condition'])} options={[{value: 'cart_subtotal', label: 'Cart subtotal'}, {value: 'cart_quantity', label: 'Cart quantity'}, {value: 'cart_discount_price', label: 'Cart discount price'}]} /></div><div className="field-grid"><ColorField label="Primary color" value={configuration.tiered_primary_color} onChange={(value) => update('tiered_primary_color', value)} /><ColorField label="Secondary color" value={configuration.tiered_secondary_color} onChange={(value) => update('tiered_secondary_color', value)} /></div><Toggle checked={configuration.tiered_confetti_enabled} label="Show confetti on goal achievement" onChange={(value) => update('tiered_confetti_enabled', value)} /><SelectField label="Applicable on" value={configuration.tiered_applicable_on} options={[{value: 'all', label: 'All products'}, {value: 'products', label: 'Specific products'}, {value: 'collections', label: 'Specific collections'}]} onChange={(value) => update('tiered_applicable_on', value as CartFeaturesConfiguration['tiered_applicable_on'])} /><Toggle checked={configuration.tiered_exclude_discounts} label="Exclude discounts from eligibility" onChange={(value) => update('tiered_exclude_discounts', value)} /><Field label="Text after all milestones" value={configuration.tiered_completion_text} maxLength={160} onChange={(value) => update('tiered_completion_text', value)} /></div>}</Section>{configuration.tiered_rewards_enabled && <Section title="Rewards"><div className="feature-item-list">{configuration.tiered_rewards.map((reward, index) => <div className="feature-item" key={reward.id}><ItemHeader title={`Reward ${index + 1}`} onRemove={() => update('tiered_rewards', configuration.tiered_rewards.filter((item) => item.id !== reward.id))} /><div className="field-grid"><Field label="Spend goal" type="number" value={reward.goal} onChange={(value) => setReward(index, {...reward, goal: Math.max(1, Number(value))})} /><SelectField label="Reward type" value={reward.reward_type} options={[{value: 'shipping', label: 'Shipping'}, {value: 'free_gift', label: 'Free gift'}, {value: 'discount', label: 'Discount'}, {value: 'custom', label: 'Custom'}]} onChange={(value) => setReward(index, {...reward, reward_type: value as TierReward['reward_type']})} /></div><Field label="Reward text" value={reward.reward_text} maxLength={16} onChange={(value) => setReward(index, {...reward, reward_text: value})} /><Field label="Text before hitting the goal" value={reward.before_text} maxLength={160} onChange={(value) => setReward(index, {...reward, before_text: value})} /></div>)}</div><button className="text-button" type="button" disabled={configuration.tiered_rewards.length >= 12} onClick={() => update('tiered_rewards', [...configuration.tiered_rewards, newReward()])}><Plus size={16} />Add reward</button></Section>}</>}
    {activeView === 'rewards' && configuration.tiered_rewards_enabled && <RewardFulfillmentEditor configuration={configuration} discounts={discounts} onChange={setReward} />}
    {activeView === 'one_tick' && <Section title="Cart-level one-tick upsell" description="Add gift wrapping or another cart add-on with one interaction."><Toggle checked={configuration.one_tick_enabled} label="Enable" onChange={(value) => update('one_tick_enabled', value)} />{configuration.one_tick_enabled && <div className="nested-settings"><RichField label="Text to display" value={configuration.one_tick_text} onChange={(value) => update('one_tick_text', value)} /><ResourceField label="Product variant" type="variant" previewMode={previewMode} value={configuration.one_tick_variant_id} title={configuration.one_tick_variant_title} onChange={(resource) => { update('one_tick_variant_id', resource?.id || null); update('one_tick_variant_title', resource?.displayName || resource?.title || ''); }} /><Toggle checked={configuration.one_tick_sku_enabled} label="Enable SKU-level add-ons" onChange={(value) => update('one_tick_sku_enabled', value)} /><Toggle checked={configuration.one_tick_disable_quantity_changes} label="Disable quantity changes on one-tick items" description="Lock each add-on to quantity one." onChange={(value) => update('one_tick_disable_quantity_changes', value)} /><Toggle checked={configuration.one_tick_disable_checkout_only} label="Disable checkout for only one-tick items" description="Require at least one regular cart item." onChange={(value) => update('one_tick_disable_checkout_only', value)} /></div>}</Section>}
    {activeView === 'swap' && <><Section title="Product swap" description="Offer a one-tap replacement with a larger size or better-value pack."><Toggle checked={configuration.product_swap_enabled} label="Enable" onChange={(value) => update('product_swap_enabled', value)} />{configuration.product_swap_enabled && <div className="nested-settings"><div className="field"><span>One-tick coexistence</span><ChoiceGroup name="Swap coexistence" columns={2} value={configuration.product_swap_coexistence} onChange={(value) => update('product_swap_coexistence', value as CartFeaturesConfiguration['product_swap_coexistence'])} options={[{value: 'swap', label: 'Show swap only'}, {value: 'upsell', label: 'Show upsell only'}]} /></div><Toggle checked={configuration.product_swap_automatic_upgrade} label="Automatic variant upgrade" description="Offer the next higher-priced in-stock variant." onChange={(value) => update('product_swap_automatic_upgrade', value)} /></div>}</Section>{configuration.product_swap_enabled && <Section title="Manual swap rules"><div className="feature-item-list">{configuration.product_swap_rules.map((rule, index) => <div className="feature-item" key={rule.id}><ItemHeader title={`Rule ${index + 1}`} onRemove={() => update('product_swap_rules', configuration.product_swap_rules.filter((item) => item.id !== rule.id))} /><Toggle checked={rule.enabled} label="Enabled" onChange={(value) => setRule(index, {...rule, enabled: value})} /><SelectField label="Trigger scope" value={rule.trigger_scope} options={[{value: 'product', label: 'Specific product'}, {value: 'collection', label: 'Collection'}]} onChange={(value) => setRule(index, {...rule, trigger_scope: value as ProductSwapRule['trigger_scope'], trigger_id: '', trigger_title: ''})} /><ResourceField label="Trigger" type={rule.trigger_scope} previewMode={previewMode} value={rule.trigger_id || null} title={rule.trigger_title} onChange={(resource) => setRule(index, {...rule, trigger_id: resource?.id || '', trigger_title: resource?.title || resource?.displayName || ''})} /><SelectField label="Use case" value={rule.use_case} options={[{value: 'size_upgrade', label: 'Size upgrade'}, {value: 'alternative', label: 'Alternative product'}, {value: 'multipack', label: 'Multipack / bundle'}]} onChange={(value) => setRule(index, {...rule, use_case: value as ProductSwapRule['use_case']})} /><ResourceField label="Target variant" type="variant" previewMode={previewMode} value={rule.target_variant_id || null} title={rule.target_variant_title} onChange={(resource) => setRule(index, {...rule, target_variant_id: resource?.id || '', target_variant_title: resource?.displayName || resource?.title || ''})} /><div className="field-grid"><Field label="Pill label" value={rule.pill_label} maxLength={40} onChange={(value) => setRule(index, {...rule, pill_label: value})} /><SelectField label="Nudge strategy" value={rule.nudge_strategy} options={[{value: 'automatic', label: 'Automatic'}, {value: 'mrp_discount', label: 'MRP discount'}, {value: 'custom', label: 'Custom claim'}]} onChange={(value) => setRule(index, {...rule, nudge_strategy: value as ProductSwapRule['nudge_strategy']})} /></div></div>)}</div><button className="text-button" type="button" onClick={() => update('product_swap_rules', [...configuration.product_swap_rules, newSwapRule()])}><Plus size={16} />Add swap rule</button></Section>}{configuration.product_swap_enabled && <Section title="Size groups" description="Build ordered ladders where each selected variant is the next upgrade."><div className="feature-item-list">{configuration.product_swap_size_groups.map((group, index) => <div className="feature-item" key={group.id}><ItemHeader title={`Size group ${index + 1}`} onRemove={() => update('product_swap_size_groups', configuration.product_swap_size_groups.filter((item) => item.id !== group.id))} /><Field label="Group title" value={group.title} maxLength={80} onChange={(value) => setGroup(index, {...group, title: value})} /><ol className="size-group-list">{group.variant_titles.map((title, variantIndex) => <li key={group.variant_ids[variantIndex]}><span>{variantIndex + 1}</span><strong>{title}</strong><button className="icon-button" type="button" onClick={() => setGroup(index, {...group, variant_ids: group.variant_ids.filter((_, itemIndex) => itemIndex !== variantIndex), variant_titles: group.variant_titles.filter((_, itemIndex) => itemIndex !== variantIndex)})} aria-label={`Remove ${title}`}><X size={14} /></button></li>)}</ol><button className="button button--secondary" type="button" disabled={previewMode || !window.shopify?.resourcePicker} onClick={async () => { const resource = await pickResource('variant'); if (resource && !group.variant_ids.includes(resource.id)) setGroup(index, {...group, variant_ids: [...group.variant_ids, resource.id], variant_titles: [...group.variant_titles, resource.displayName || resource.title || resource.id]}); }}><Plus size={15} />Add next variant</button></div>)}</div><button className="text-button" type="button" onClick={() => update('product_swap_size_groups', [...configuration.product_swap_size_groups, newSizeGroup()])}><Plus size={16} />Add size group</button></Section>}</>}
  </div><div className="preview-column"><div className="preview-column__heading"><span>Live preview</span><small>{featureViews.find((view) => view.id === activeView)?.label}</small></div><FeaturePreview configuration={configuration} activeView={activeView} /></div></div>{dirty && <div className="save-bar" role="region" aria-label="Unsaved changes"><span>Unsaved changes</span><div><button className="button button--secondary" type="button" onClick={() => { setConfiguration(clone(saved)); setError(null); }}><RotateCcw size={16} />Discard</button><button className="button button--primary" type="button" disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save'}</button></div></div>}</div>;
}
