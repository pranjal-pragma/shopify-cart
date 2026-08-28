import {
  ArrowRight,
  Check,
  CircleHelp,
  ExternalLink,
  Gift,
  LayoutPanelTop,
  LifeBuoy,
  Palette,
  RefreshCw,
  ShoppingCart,
  Sparkles,
  X,
  type LucideIcon,
} from 'lucide-react';
import {useCallback, useEffect, useState} from 'react';

import {connectMerchant, type Merchant} from './api';
import {CartAppearancePage} from './CartAppearancePage';
import {CartCheckoutPage} from './CartCheckoutPage';
import {CartFeaturesPage} from './CartFeaturesPage';
import {CartUpsellPage} from './CartUpsellPage';
import './styles.css';

const GUIDE_URL =
  'https://docs.google.com/document/d/1yK8wEmM5OltWt4gCXPPuReYck5SCe3VEYUyhcgTV7SE/edit?usp=sharing';
const previewMerchant: Merchant | null = import.meta.env.DEV && new URLSearchParams(window.location.search).has('preview')
  ? {
      shop_domain: 'sample-store.myshopify.com',
      connected: true,
      scopes: [],
      onboarding_completed: false,
    }
  : null;

const setupActions: Array<{
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  accent: string;
}> = [
  {
    title: 'Cart appearance',
    description: 'Style the drawer to match your storefront.',
    href: '/appearance',
    icon: Palette,
    accent: 'coral',
  },
  {
    title: 'Cart features',
    description: 'Configure offers, rewards, notes and gifts.',
    href: '/features',
    icon: Gift,
    accent: 'green',
  },
  {
    title: 'Cart upsell',
    description: 'Build product recommendations that lift AOV.',
    href: '/upsell',
    icon: Sparkles,
    accent: 'blue',
  },
];

function AppShell({children, pageId = 'home'}: {children: React.ReactNode; pageId?: string}) {
  return (
    <div className="app-shell">
      <s-app-nav>
        <s-link href="/" rel="home">Home</s-link>
        <s-link href="/appearance">Cart appearance</s-link>
        <s-link href="/features">Cart features</s-link>
        <s-link href="/upsell">Cart upsell</s-link>
        <s-link href="/checkout">Checkout</s-link>
      </s-app-nav>
      <main className={`page${['appearance', 'features', 'upsell', 'checkout'].includes(pageId) ? ' page--appearance' : ''}`} id={pageId}>
        {children}
      </main>
    </div>
  );
}

function LoadingState() {
  return (
    <AppShell>
      <section className="state-panel" aria-live="polite">
        <div className="spinner" aria-hidden="true" />
        <div>
          <h1>Connecting your store</h1>
          <p>Loading your pragma-site-cart workspace.</p>
        </div>
      </section>
    </AppShell>
  );
}

function ErrorState({message, onRetry}: {message: string; onRetry: () => void}) {
  return (
    <AppShell>
      <section className="state-panel state-panel--error" role="alert">
        <div className="state-icon" aria-hidden="true">
          <X size={20} />
        </div>
        <div className="state-copy">
          <h1>Unable to connect to Shopify</h1>
          <p>{message}</p>
        </div>
        <button className="button button--secondary" type="button" onClick={onRetry}>
          <RefreshCw size={17} aria-hidden />
          Retry
        </button>
      </section>
    </AppShell>
  );
}

function HomePage({merchant}: {merchant: Merchant}) {
  const appApiKey = document.querySelector<HTMLMetaElement>('meta[name="shopify-api-key"]')?.content;
  const activationTarget = appApiKey ? `&activateAppId=${appApiKey}/pragma-site-cart` : '';
  const themeEditorUrl = `https://${merchant.shop_domain}/admin/themes/current/editor?context=apps${activationTarget}`;
  const activationLabel = merchant.onboarding_completed ? 'Setup complete' : 'Action required';

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <p className="eyebrow">Overview</p>
          <h1>Welcome to pragma-site-cart</h1>
          <p className="page-subtitle">Set up your cart, publish it to your theme, and start selling.</p>
        </div>
        <div className="store-pill" title={merchant.shop_domain}>
          <span className="connection-dot" aria-hidden="true" />
          <span>{merchant.shop_domain}</span>
        </div>
      </header>

      <section className="activation-panel" aria-labelledby="cart-status-title">
        <div className="activation-main">
          <div className="section-heading-row">
            <div className="section-icon section-icon--coral" aria-hidden="true">
              <ShoppingCart size={22} strokeWidth={2} />
            </div>
            <div>
              <div className="title-with-badge">
                <h2 id="cart-status-title">Cart status</h2>
                <span className={`status-badge${merchant.onboarding_completed ? ' status-badge--ready' : ''}`}>
                  {activationLabel}
                </span>
              </div>
              <p>Enable pragma-site-cart in your live theme to publish the cart and begin your 14-day trial.</p>
            </div>
          </div>

          <a className="button button--primary" href={themeEditorUrl} target="_blank" rel="noreferrer">
            Enable pragma-site-cart
            <ExternalLink size={17} aria-hidden />
          </a>
        </div>

        <div className="activation-checklist" aria-label="Before you enable pragma-site-cart">
          <p className="checklist-title">Before you enable</p>
          <div className="checklist-item">
            <span className="check-icon" aria-hidden="true">
              <Check size={15} strokeWidth={2.5} />
            </span>
            <span>Disable other slide-cart, upsell, and free-gift apps.</span>
          </div>
          <div className="checklist-item">
            <span className="check-icon" aria-hidden="true">
              <Check size={15} strokeWidth={2.5} />
            </span>
            <span>Set your Shopify theme cart type to <strong>Drawer</strong>.</span>
          </div>
        </div>
      </section>

      <section className="section-block" aria-labelledby="setup-title">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Quick setup</p>
            <h2 id="setup-title">Build your cart experience</h2>
          </div>
          <span className="step-count">3 essentials</span>
        </div>

        <div className="setup-grid">
          {setupActions.map(({title, description, href, icon: SetupIcon, accent}) => (
            <article className="setup-card" key={title}>
              <div className={`section-icon section-icon--${accent}`} aria-hidden="true">
                <SetupIcon size={21} strokeWidth={2} />
              </div>
              <div className="setup-card-copy">
                <h3>{title}</h3>
                <p>{description}</p>
              </div>
              <a className="setup-link" href={href} aria-label={`Set up ${title}`}>
                Set up
                <ArrowRight size={16} aria-hidden />
              </a>
            </article>
          ))}
        </div>
      </section>

      <section className="support-panel" aria-labelledby="support-title">
        <div className="support-intro">
          <div className="section-icon section-icon--ink" aria-hidden="true">
            <LifeBuoy size={21} strokeWidth={2} />
          </div>
          <div>
            <h2 id="support-title">Need a hand?</h2>
            <p>Product guides are available when you need them.</p>
          </div>
        </div>

        <div className="support-actions">
          <a className="support-link" href={GUIDE_URL} target="_blank" rel="noreferrer">
            <span className="support-link-icon" aria-hidden="true">
              <CircleHelp size={18} />
            </span>
            <span>
              <strong>View FAQs and guides</strong>
              <small>Browse pragma-site-cart resources</small>
            </span>
            <ExternalLink size={17} aria-hidden />
          </a>
        </div>
      </section>

      <footer className="page-footer">
        <LayoutPanelTop size={16} aria-hidden />
        <span>pragma-site-cart is securely connected to Shopify.</span>
      </footer>
    </AppShell>
  );
}

export default function App() {
  const [merchant, setMerchant] = useState<Merchant | null>(previewMerchant);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [route, setRoute] = useState(window.location.pathname);

  const retry = useCallback(() => {
    setMerchant(null);
    setError(null);
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    if (previewMerchant) return;

    let active = true;
    connectMerchant()
      .then((result) => {
        if (active) setMerchant(result);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Authentication failed.');
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  useEffect(() => {
    const updateRoute = () => setRoute(window.location.pathname);
    window.addEventListener('popstate', updateRoute);
    return () => window.removeEventListener('popstate', updateRoute);
  }, []);

  if (error) return <ErrorState message={error} onRetry={retry} />;
  if (!merchant) return <LoadingState />;
  if (route === '/appearance') {
    return <AppShell pageId="appearance"><CartAppearancePage previewMode={Boolean(previewMerchant)} /></AppShell>;
  }
  if (route === '/features') {
    return <AppShell pageId="features"><CartFeaturesPage previewMode={Boolean(previewMerchant)} /></AppShell>;
  }
  if (route === '/upsell') {
    return <AppShell pageId="upsell"><CartUpsellPage previewMode={Boolean(previewMerchant)} /></AppShell>;
  }
  if (route === '/checkout') {
    return <AppShell pageId="checkout"><CartCheckoutPage previewMode={Boolean(previewMerchant)} /></AppShell>;
  }
  return <HomePage merchant={merchant} />;
}
