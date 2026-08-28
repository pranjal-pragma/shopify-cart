const truthy = (value) => value === true || ['true', '1', 'yes'].includes(String(value).toLowerCase());

export const renderCustomerTemplate = (template, customer = {}) => String(template || '').replace(
  /\{(first_name|last_name|name|phone_number|email)\}/g,
  (_match, key) => customer[key] || '',
).replace(/\s+/g, ' ').trim();

export const checkoutSettingsBlockReason = (configuration, customer, cart) => {
  const loginRequired = Boolean(
    configuration.checkout_on_cart_enabled
    && configuration.checkout_guest_checkout_enabled !== true
    && customer.logged_in !== true,
  );
  if (loginRequired) return 'Log in to continue checkout.';

  const upsellOnly = Boolean(
    configuration.disable_checkout_for_upsell_only
    && cart?.items?.length
    && cart.items.every((item) => truthy(item.properties?._pragma_site_cart_upsell)),
  );
  const oneTickOnly = Boolean(
    configuration.one_tick_disable_checkout_only
    && cart?.items?.length
    && cart.items.every((item) => truthy(item.properties?._pragma_site_cart_one_tick)),
  );
  return upsellOnly || oneTickOnly ? 'Add a regular product before checkout.' : '';
};

export const setCheckoutGuard = (checkout, source, reason, destination) => {
  if (!checkout) return '';
  const key = source === 'terms' ? 'pscTermsBlockedReason' : 'pscSettingsBlockedReason';
  checkout.dataset[key] = reason || '';
  const blockedReason = checkout.dataset.pscSettingsBlockedReason
    || checkout.dataset.pscTermsBlockedReason
    || '';
  checkout.dataset.pscBlockedReason = blockedReason;
  checkout.classList.toggle('psc-cart-checkout-button--disabled', Boolean(blockedReason));
  checkout.setAttribute('aria-disabled', String(Boolean(blockedReason)));
  if (blockedReason) checkout.removeAttribute('href');
  else checkout.setAttribute('href', destination);
  return blockedReason;
};
