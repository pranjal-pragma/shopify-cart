import {ArrowDown, ArrowUp, Bold, Italic, PackageSearch, Plus, RotateCcw, Sparkles, Trash2, Underline, X} from 'lucide-react';
import {useEffect, useMemo, useState} from 'react';

import {getCartUpsell, saveCartUpsell, type CartUpsellConfiguration, type RichTextStyle, type ShopifyResource, type UpsellRecommendation, type UpsellRule} from './api';

const richText = (text: string): RichTextStyle => ({text, bold: true, italic: false, underline: false, font_size: 16});
const itemId = () => (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replaceAll('-', '').replace('.', '').slice(0, 16);
const copy = (value: CartUpsellConfiguration) => structuredClone(value);
export const defaultUpsell: CartUpsellConfiguration = {upsell_enabled: false, upsell_cap_quantity: true, upsell_max_quantity: 1, upsell_variant_behavior: 'variant_popup', upsell_ai_enabled: true, upsell_ai_title: richText('Recommended for you'), upsell_ai_background_color: '#FFFFFF', upsell_ai_text_color: '#202124', upsell_ai_preference: 'complementary', upsell_ai_product_count: 6, upsell_rule_fallback_enabled: false, upsell_rules: []};
const newRule = (): UpsellRule => ({id: itemId(), title: richText('You may also like'), product_count: 4, background_color: '#FFFFFF', text_color: '#202124', applicable_on: 'all', trigger_ids: [], trigger_titles: [], trigger_product_ids: [], recommendations: []});

function Toggle({checked, label, description, onChange}: {checked: boolean; label: string; description: string; onChange: (value: boolean) => void}) {
  return <label className="setting-toggle"><span className="setting-toggle__copy"><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="toggle-track" aria-hidden="true"><span /></span></label>;
}
function NumberField({label, value, max = 99, onChange}: {label: string; value: number; max?: number; onChange: (value: number) => void}) {
  return <label className="field"><span>{label}</span><input type="number" min={1} max={max} value={value} onChange={(event) => onChange(Math.min(max, Math.max(1, Number(event.target.value))))} /></label>;
}
function ColorField({label, value, onChange}: {label: string; value: string; onChange: (value: string) => void}) {
  return <label className="field color-field"><span>{label}</span><span className="color-input-wrap"><input className="color-swatch" type="color" value={value} onChange={(event) => onChange(event.target.value.toUpperCase())} /><input value={value} maxLength={7} onChange={(event) => onChange(event.target.value.toUpperCase())} /></span></label>;
}
function RichField({label, value, onChange}: {label: string; value: RichTextStyle; onChange: (value: RichTextStyle) => void}) {
  const set = <K extends keyof RichTextStyle>(key: K, next: RichTextStyle[K]) => onChange({...value, [key]: next});
  return <div className="field rich-field"><span>{label}</span><div className="rich-toolbar"><button className={value.bold ? 'is-active' : ''} type="button" onClick={() => set('bold', !value.bold)} aria-label="Bold"><Bold size={15} /></button><button className={value.italic ? 'is-active' : ''} type="button" onClick={() => set('italic', !value.italic)} aria-label="Italic"><Italic size={15} /></button><button className={value.underline ? 'is-active' : ''} type="button" onClick={() => set('underline', !value.underline)} aria-label="Underline"><Underline size={15} /></button><select value={value.font_size} onChange={(event) => set('font_size', Number(event.target.value) as RichTextStyle['font_size'])}>{[12, 14, 16, 18, 20].map((size) => <option value={size} key={size}>{size}px</option>)}</select></div><input value={value.text} maxLength={64} onChange={(event) => set('text', event.target.value)} /><small>{value.text.length} / 64</small></div>;
}
function ChoiceGroup({name, value, options, onChange}: {name: string; value: string; options: {value: string; label: string; description: string}[]; onChange: (value: string) => void}) {
  return <div className="choice-list choice-list--two" role="radiogroup" aria-label={name}>{options.map((option) => <label key={option.value}><input type="radio" name={name} checked={value === option.value} onChange={() => onChange(option.value)} /><span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}</div>;
}
function Section({title, description, children}: {title: string; description: string; children: React.ReactNode}) {
  return <section className="appearance-section"><header><h2>{title}</h2><p>{description}</p></header><div className="appearance-section__body">{children}</div></section>;
}
async function pickMany(type: 'variant' | 'product' | 'collection', selectedIds: string[] = [], limit = 20) {
  return window.shopify?.resourcePicker ? (await window.shopify.resourcePicker({type, action: 'select', multiple: limit, selectionIds: selectedIds.map((id) => ({id}))}) ?? []) : [];
}
function asRecommendation(resource: ShopifyResource): UpsellRecommendation | null {
  const product = resource.product ?? resource;
  const variant = resource.product ? resource : resource.variants?.[0];
  if (!variant || !variant.id.includes('/ProductVariant/') || !product.id.includes('/Product/')) return null;
  return {variant_id: variant.id, variant_title: variant.displayName ?? variant.title ?? 'Default variant', product_id: product.id, product_title: product.title ?? product.displayName ?? 'Product', product_handle: product.handle ?? '', image_url: product.image?.originalSrc ?? product.image?.url ?? product.images?.[0]?.originalSrc ?? product.images?.[0]?.url ?? '', price: variant.price ?? ''};
}

function validationError(configuration: CartUpsellConfiguration): string | null {
  if (!configuration.upsell_enabled) return null;
  if (!configuration.upsell_ai_enabled && !configuration.upsell_rules.length) return 'Enable AI recommendations or add a recommendation rule.';
  if (configuration.upsell_rule_fallback_enabled && !configuration.upsell_rules.length) return 'Add a rule before enabling rule-based fallback.';
  for (const rule of configuration.upsell_rules) {
    if (!rule.title.text.trim()) return 'Every upsell rule needs a title.';
    if (rule.applicable_on !== 'all' && !rule.trigger_ids.length) return 'Select products or collections for every targeted rule.';
    if (!rule.recommendations.length) return 'Select at least one recommended variant for every rule.';
  }
  return null;
}

export function CartUpsellPage({previewMode}: {previewMode: boolean}) {
  const [configuration, setConfiguration] = useState(copy(defaultUpsell));
  const [saved, setSaved] = useState(copy(defaultUpsell));
  const [loading, setLoading] = useState(!previewMode);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const dirty = useMemo(() => JSON.stringify(configuration) !== JSON.stringify(saved), [configuration, saved]);
  const update = <K extends keyof CartUpsellConfiguration>(key: K, value: CartUpsellConfiguration[K]) => setConfiguration((current) => ({...current, [key]: value}));
  const updateRule = (id: string, change: Partial<UpsellRule>) => update('upsell_rules', configuration.upsell_rules.map((rule) => rule.id === id ? {...rule, ...change} : rule));
  const moveRule = (from: number, to: number) => {
    if (to < 0 || to >= configuration.upsell_rules.length) return;
    const rules = [...configuration.upsell_rules];
    const [rule] = rules.splice(from, 1);
    rules.splice(to, 0, rule);
    update('upsell_rules', rules);
  };

  useEffect(() => {
    if (previewMode) return;
    getCartUpsell().then(({updated_at: _, ...next}) => {setConfiguration(copy(next)); setSaved(copy(next));}).catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Could not load upsells.')).finally(() => setLoading(false));
  }, [previewMode]);
  const save = async () => {
    const invalid = validationError(configuration);
    if (invalid) {setMessage(invalid); return;}
    setSaving(true); setMessage('');
    try { const {updated_at: _, ...next} = await saveCartUpsell(configuration); setConfiguration(copy(next)); setSaved(copy(next)); setMessage('Cart upsells published.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save upsells.'); }
    finally { setSaving(false); }
  };
  if (loading) return <section className="state-panel"><div className="spinner" /><p>Loading cart upsells.</p></section>;

  const previewRule = !configuration.upsell_ai_enabled ? configuration.upsell_rules[0] : null;
  const previewTitle = previewRule?.title || configuration.upsell_ai_title;
  const previewBackground = previewRule?.background_color || configuration.upsell_ai_background_color;
  const previewColor = previewRule?.text_color || configuration.upsell_ai_text_color;
  const previewItems = previewRule?.recommendations.slice(0, previewRule.product_count) || [
    {product_title: 'Everyday tote', price: '799', image_url: ''},
    {product_title: 'Travel bottle', price: '499', image_url: ''},
  ];

  return <div className="appearance-page">
    <header className="appearance-header">
      <div><p className="eyebrow">Cart experience</p><h1>Cart upsell</h1><p>Recommend relevant products and recalculate suggestions as the cart changes.</p></div>
      <div className="appearance-header__actions">
        <button className="button button--secondary" type="button" disabled={!dirty} onClick={() => {setConfiguration(copy(saved)); setMessage('');}}><RotateCcw size={16} />Discard</button>
        <button className="button button--primary" type="button" disabled={!dirty || saving || previewMode} onClick={save}>{saving ? 'Saving...' : 'Save'}</button>
      </div>
    </header>
    {message && <p className="appearance-message" role="status">{message}</p>}
    <div className="appearance-workspace"><div className="appearance-editor">
      <Section title="Upsell settings" description="Control shared recommendation behaviour.">
        <Toggle checked={configuration.upsell_enabled} label="Enable cart upsells" description="Show recommendations when the cart contains regular products." onChange={(value) => update('upsell_enabled', value)} />
        {configuration.upsell_enabled && <div className="nested-settings">
          <Toggle checked={configuration.upsell_cap_quantity} label="Cap quantity per upsell SKU" description="Limit quantities added from recommendation cards." onChange={(value) => update('upsell_cap_quantity', value)} />
          {configuration.upsell_cap_quantity && <NumberField label="Maximum quantity" value={configuration.upsell_max_quantity} onChange={(value) => update('upsell_max_quantity', value)} />}
          <ChoiceGroup name="variant-behaviour" value={configuration.upsell_variant_behavior} onChange={(value) => update('upsell_variant_behavior', value as CartUpsellConfiguration['upsell_variant_behavior'])} options={[{value: 'variant_popup', label: 'Variant selection', description: 'Choose an available variant before adding.'}, {value: 'product_popup', label: 'Product details', description: 'Open product information and add controls.'}]} />
        </div>}
      </Section>

      <Section title="AI recommendations" description="Use Shopify recommendations with an optional rules fallback.">
        <Toggle checked={configuration.upsell_ai_enabled} label="Enable AI recommendations" description="Recommend products based on current cart lines." onChange={(value) => update('upsell_ai_enabled', value)} />
        {configuration.upsell_ai_enabled && <div className="nested-settings">
          <RichField label="Section title" value={configuration.upsell_ai_title} onChange={(value) => update('upsell_ai_title', value)} />
          <div className="field-grid"><ColorField label="Background color" value={configuration.upsell_ai_background_color} onChange={(value) => update('upsell_ai_background_color', value)} /><ColorField label="Text color" value={configuration.upsell_ai_text_color} onChange={(value) => update('upsell_ai_text_color', value)} /></div>
          <ChoiceGroup name="ai-preference" value={configuration.upsell_ai_preference} onChange={(value) => update('upsell_ai_preference', value as CartUpsellConfiguration['upsell_ai_preference'])} options={[{value: 'complementary', label: 'Complementary', description: 'Products commonly bought together.'}, {value: 'related', label: 'Related', description: 'Similar products shoppers may consider.'}]} />
          <NumberField label="Maximum products" max={10} value={configuration.upsell_ai_product_count} onChange={(value) => update('upsell_ai_product_count', value)} />
          <Toggle checked={configuration.upsell_rule_fallback_enabled} label="Use rules as fallback" description="Use matching rules only when Shopify returns no products." onChange={(value) => update('upsell_rule_fallback_enabled', value)} />
        </div>}
      </Section>

      <Section title="Rule-based recommendations" description="Choose exact recommendations for all carts or selected products and collections. Targeted rules take priority over all-product rules.">
        <div className="feature-list">{configuration.upsell_rules.map((rule, index) => <article className="feature-item" key={rule.id}>
          <div className="feature-item__header"><strong>Rule {index + 1}</strong><div className="feature-item__actions">
            <button className="icon-button" type="button" disabled={index === 0} onClick={() => moveRule(index, index - 1)} aria-label={`Move rule ${index + 1} up`} title="Move up"><ArrowUp size={15} /></button>
            <button className="icon-button" type="button" disabled={index === configuration.upsell_rules.length - 1} onClick={() => moveRule(index, index + 1)} aria-label={`Move rule ${index + 1} down`} title="Move down"><ArrowDown size={15} /></button>
            <button className="icon-button icon-button--danger" type="button" onClick={() => update('upsell_rules', configuration.upsell_rules.filter((item) => item.id !== rule.id))} aria-label={`Remove rule ${index + 1}`} title="Remove"><Trash2 size={16} /></button>
          </div></div>
          <RichField label="Title" value={rule.title} onChange={(value) => updateRule(rule.id, {title: value})} />
          <div className="field-grid"><NumberField label="Products to display" max={10} value={rule.product_count} onChange={(value) => updateRule(rule.id, {product_count: value})} /><ColorField label="Background color" value={rule.background_color} onChange={(value) => updateRule(rule.id, {background_color: value})} /><ColorField label="Text color" value={rule.text_color} onChange={(value) => updateRule(rule.id, {text_color: value})} /></div>
          <ChoiceGroup name={`scope-${rule.id}`} value={rule.applicable_on} onChange={(value) => updateRule(rule.id, {applicable_on: value as UpsellRule['applicable_on'], trigger_ids: [], trigger_titles: [], trigger_product_ids: []})} options={[{value: 'all', label: 'All products', description: 'Use as the fallback for every non-empty cart.'}, {value: 'products', label: 'Specific products', description: 'Match selected cart products.'}, {value: 'collections', label: 'Specific collections', description: 'Match products in selected collections.'}]} />
          {rule.applicable_on !== 'all' && <ResourceList label={`Applicable ${rule.applicable_on}`} items={rule.trigger_titles} disabled={previewMode} onPick={async () => {
            const resources = await pickMany(rule.applicable_on === 'products' ? 'product' : 'collection', rule.trigger_ids, 50);
            updateRule(rule.id, {
              trigger_ids: resources.map((item) => item.id),
              trigger_titles: resources.map((item) => item.title ?? item.displayName ?? 'Selected item'),
              trigger_product_ids: resources.map((item) => rule.applicable_on === 'products' ? [item.id] : (item.products || []).map((product) => product.id)),
            });
          }} onRemove={(position) => updateRule(rule.id, {
            trigger_ids: rule.trigger_ids.filter((_, itemIndex) => itemIndex !== position),
            trigger_titles: rule.trigger_titles.filter((_, itemIndex) => itemIndex !== position),
            trigger_product_ids: rule.trigger_product_ids.filter((_, itemIndex) => itemIndex !== position),
          })} />}
          <ResourceList label="Recommended variants" items={rule.recommendations.map((item) => `${item.product_title} - ${item.variant_title}`)} disabled={previewMode || rule.recommendations.length >= 20} onPick={async () => {
            const selected = (await pickMany('variant', rule.recommendations.map((item) => item.variant_id), 20)).map(asRecommendation).filter((item): item is UpsellRecommendation => Boolean(item));
            updateRule(rule.id, {recommendations: Array.from(new Map([...rule.recommendations, ...selected].map((item) => [item.variant_id, item])).values()).slice(0, 20)});
          }} onRemove={(position) => updateRule(rule.id, {recommendations: rule.recommendations.filter((_, itemIndex) => itemIndex !== position)})} />
        </article>)}</div>
        <button className="button button--secondary" type="button" disabled={configuration.upsell_rules.length >= 20} onClick={() => update('upsell_rules', [...configuration.upsell_rules, newRule()])}><Plus size={16} />Add rule</button>
      </Section>
    </div>
    <aside className="cart-preview" aria-label="Cart preview"><div className="cart-preview__label"><Sparkles size={15} />Live preview</div>
      {!configuration.upsell_enabled ? <div className="upsell-preview upsell-preview--empty"><strong>Cart upsells are disabled</strong><small>Enable cart upsells to publish recommendations.</small></div> : <div className="upsell-preview" style={{background: previewBackground, color: previewColor}}>
        <strong style={{fontSize: previewTitle.font_size, fontWeight: previewTitle.bold ? 700 : 600, fontStyle: previewTitle.italic ? 'italic' : undefined, textDecoration: previewTitle.underline ? 'underline' : undefined}}>{previewTitle.text}</strong>
        <div>{previewItems.map((item) => <article key={'variant_id' in item ? item.variant_id : item.product_title}>{item.image_url ? <img className="upsell-preview__image" src={item.image_url} alt="" /> : <span className="upsell-preview__image" />}<b>{item.product_title}</b><small>{item.price ? `Rs. ${item.price}` : 'Price from Shopify'}</small><button type="button" disabled>+ Add</button></article>)}</div>
      </div>}
      <p className="preview-note">Preview controls are intentionally disabled.</p>
    </aside></div>
  </div>;
}

function ResourceList({label, items, disabled, onPick, onRemove}: {label: string; items: string[]; disabled: boolean; onPick: () => void; onRemove: (position: number) => void}) {
  return <div className="field"><span>{label}</span><button className="button button--secondary resource-picker-button" type="button" disabled={disabled || !window.shopify?.resourcePicker} onClick={onPick}><PackageSearch size={16} />Select</button><div className="resource-chips">{items.map((item, index) => <span key={`${item}-${index}`}>{item}<button type="button" onClick={() => onRemove(index)} aria-label={`Remove ${item}`}><X size={13} /></button></span>)}</div></div>;
}
