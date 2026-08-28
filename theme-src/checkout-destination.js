export const PRAGMA_SITE_CHECKOUT_URL = 'https://example.com/pragma-site-cart-checkout';

export const checkoutDestination = (usePragmaCheckout, shopifyCheckoutUrl) => (
  usePragmaCheckout === true ? PRAGMA_SITE_CHECKOUT_URL : shopifyCheckoutUrl
);
