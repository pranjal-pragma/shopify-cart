import {MapPin, RotateCcw, ShieldCheck, UserRound, X} from 'lucide-react';
import {useCallback, useEffect, useMemo, useState} from 'react';

import {
  getCartAppearance,
  saveCartAppearance,
  type CartAppearanceConfiguration,
} from './api';
import {defaultAppearance} from './CartAppearancePage';

type Update = <K extends keyof CartAppearanceConfiguration>(key: K, value: CartAppearanceConfiguration[K]) => void;

const clone = (configuration: CartAppearanceConfiguration) => structuredClone(configuration);

function Toggle({
  checked,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  label: string;
  description?: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="setting-toggle">
      <span className="setting-toggle__copy">
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="toggle-track" aria-hidden="true"><span /></span>
    </label>
  );
}

function Field({
  label,
  value,
  maxLength,
  onChange,
}: {
  label: string;
  value: string;
  maxLength?: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} />
      {maxLength && <small>{value.length} / {maxLength}</small>}
    </label>
  );
}

function Section({title, description, children}: {title: string; description?: string; children: React.ReactNode}) {
  return (
    <section className="appearance-section">
      <header>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </header>
      <div className="appearance-section__body">{children}</div>
    </section>
  );
}

function renderTemplate(template: string) {
  const customer = {
    first_name: 'Priya',
    last_name: 'Rana',
    name: 'Priya Rana',
    phone_number: '+91 98765 43210',
    email: 'priya@example.com',
  };
  return template.replace(/\{(first_name|last_name|name|phone_number|email)\}/g, (_, key: keyof typeof customer) => customer[key] || '');
}

function CheckoutPreview({configuration, customerState}: {configuration: CartAppearanceConfiguration; customerState: 'guest' | 'logged_in'}) {
  const topPlacement = configuration.checkout_address_placement === 'top';
  const loggedIn = customerState === 'logged_in';
  const customerBlock = (
    <div className="checkout-preview-card">
      <div className="checkout-preview-title">
        <UserRound size={17} />
        <strong>{renderTemplate(configuration.checkout_personalisation_message)}</strong>
      </div>
      <label>
        <span>Delivery address</span>
        <select defaultValue="home">
          <option value="home">Home - 12 MG Road, Bengaluru</option>
          <option value="work">Work - Indiranagar, Bengaluru</option>
        </select>
      </label>
      <small>Saved to the cart before checkout.</small>
    </div>
  );

  return (
    <aside className="checkout-preview" aria-label="Checkout on cart preview">
      <div className="checkout-preview__header">
        <strong>Your cart</strong>
        <span>2 items</span>
      </div>
      {configuration.checkout_on_cart_enabled && loggedIn && topPlacement && customerBlock}
      {configuration.checkout_on_cart_enabled && !loggedIn && configuration.checkout_login_banner_enabled && (
        <div className="checkout-preview-banner">
          <MapPin size={16} />
          <span>{configuration.checkout_login_banner_text}</span>
          <button type="button">Log in</button>
        </div>
      )}
      <div className="checkout-preview-products">
        <div><span /><strong>Everyday tote</strong><b>Rs. 1,249</b></div>
        <div><span /><strong>Classic cap</strong><b>Rs. 699</b></div>
      </div>
      {configuration.checkout_on_cart_enabled && loggedIn && !topPlacement && customerBlock}
      <div className="checkout-preview-footer">
        <span>Estimated total</span>
        <strong>Rs. 1,948</strong>
        <button type="button" disabled={configuration.checkout_on_cart_enabled && !loggedIn && !configuration.checkout_guest_checkout_enabled}>
          {!configuration.checkout_on_cart_enabled || loggedIn || configuration.checkout_guest_checkout_enabled ? 'Checkout' : 'Login required'}
        </button>
      </div>
    </aside>
  );
}

function validate(configuration: CartAppearanceConfiguration): string | null {
  if (!configuration.checkout_on_cart_enabled) return null;
  if (configuration.checkout_login_banner_enabled && !configuration.checkout_login_banner_text.trim()) {
    return 'Login banner text cannot be empty.';
  }
  if (!configuration.checkout_personalisation_message.trim()) {
    return 'Personalisation message cannot be empty.';
  }
  return null;
}

export function CartCheckoutPage({previewMode}: {previewMode: boolean}) {
  const [configuration, setConfiguration] = useState(() => clone(defaultAppearance));
  const [saved, setSaved] = useState(() => clone(defaultAppearance));
  const [loading, setLoading] = useState(!previewMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewCustomerState, setPreviewCustomerState] = useState<'guest' | 'logged_in'>('guest');
  const dirty = useMemo(() => JSON.stringify(configuration) !== JSON.stringify(saved), [configuration, saved]);
  const update: Update = useCallback((key, value) => {
    setConfiguration((current) => ({...current, [key]: value}));
    setNotice(null);
  }, []);

  useEffect(() => {
    if (previewMode) return;
    let active = true;
    getCartAppearance()
      .then(({updated_at: _updatedAt, ...next}) => {
        if (!active) return;
        setConfiguration(clone(next));
        setSaved(clone(next));
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load checkout settings.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
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
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let persisted = configuration;
      if (!previewMode) {
        const {updated_at: _updatedAt, ...response} = await saveCartAppearance(configuration);
        persisted = response;
        setConfiguration(clone(response));
      }
      setSaved(clone(persisted));
      setNotice('Checkout settings saved.');
      window.setTimeout(() => setNotice(null), 2600);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save checkout settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="appearance-loading"><span className="spinner" /><p>Loading checkout settings...</p></div>;

  return (
    <div className="appearance-page checkout-page">
      <header className="appearance-header">
        <div>
          <p className="eyebrow">Checkout on cart</p>
          <h1>Bring login and address choice into the cart</h1>
          <p>Control the in-cart login prompt, guest access, personalization, and saved-address placement.</p>
        </div>
        <div className="preview-state-switch" role="group" aria-label="Preview customer state">
          <button type="button" className={previewCustomerState === 'guest' ? 'is-active' : ''} onClick={() => setPreviewCustomerState('guest')}>Guest</button>
          <button type="button" className={previewCustomerState === 'logged_in' ? 'is-active' : ''} onClick={() => setPreviewCustomerState('logged_in')}>Logged in</button>
        </div>
      </header>

      {error && <div className="inline-alert" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Dismiss error"><X size={16} /></button></div>}
      {notice && <div className="save-toast" role="status"><ShieldCheck size={17} />{notice}</div>}

      <div className="appearance-workspace">
        <div className="appearance-editor">
          <Section title="Checkout on cart" description="Let shoppers complete identity and delivery-address steps before entering checkout.">
            <Toggle checked={configuration.checkout_on_cart_enabled} label="Enable checkout on cart" onChange={(value) => update('checkout_on_cart_enabled', value)} />
          </Section>

          {configuration.checkout_on_cart_enabled && (
            <>
              <Section title="Login settings">
                <Toggle checked={configuration.checkout_guest_checkout_enabled} label="Allow guest checkout" description="When off, unauthenticated shoppers must log in before continuing." onChange={(value) => update('checkout_guest_checkout_enabled', value)} />
                <Toggle checked={configuration.checkout_login_banner_enabled} label="Show login banner" onChange={(value) => update('checkout_login_banner_enabled', value)} />
                {configuration.checkout_login_banner_enabled && <Field label="Login banner text" value={configuration.checkout_login_banner_text} maxLength={160} onChange={(value) => update('checkout_login_banner_text', value)} />}
              </Section>

              <Section title="Personalisation message" description="Use customer variables to greet logged-in shoppers.">
                <Field label="Title text" value={configuration.checkout_personalisation_message} maxLength={200} onChange={(value) => update('checkout_personalisation_message', value)} />
                <div className="variable-pills" aria-label="Supported variables">
                  {['{first_name}', '{last_name}', '{name}', '{phone_number}', '{email}'].map((variable) => <code key={variable}>{variable}</code>)}
                </div>
              </Section>

              <Section title="Address selection">
                <div className="choice-list choice-list--two" role="radiogroup" aria-label="Address placement">
                  {[{value: 'top', label: 'Top'}, {value: 'bottom', label: 'Bottom'}].map((option) => (
                    <label key={option.value}>
                      <input type="radio" name="address-placement" checked={configuration.checkout_address_placement === option.value} onChange={() => update('checkout_address_placement', option.value as CartAppearanceConfiguration['checkout_address_placement'])} />
                      <span><strong>{option.label}</strong></span>
                    </label>
                  ))}
                </div>
              </Section>
            </>
          )}
        </div>

        <div className="preview-column">
          <div className="preview-column__heading"><span>Live preview</span><small>Logged-in and guest states</small></div>
          <CheckoutPreview configuration={configuration} customerState={previewCustomerState} />
        </div>
      </div>

      {dirty && <div className="save-bar" role="region" aria-label="Unsaved changes"><span>Unsaved changes</span><div><button className="button button--secondary" type="button" onClick={() => { setConfiguration(clone(saved)); setError(null); }}><RotateCcw size={16} />Discard</button><button className="button button--primary" type="button" disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save'}</button></div></div>}
    </div>
  );
}
