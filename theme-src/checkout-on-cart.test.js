import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkoutSettingsBlockReason,
  renderCustomerTemplate,
  setCheckoutGuard,
} from './checkout-on-cart.js';

const configuration = {
  checkout_on_cart_enabled: true,
  checkout_guest_checkout_enabled: false,
  disable_checkout_for_upsell_only: false,
  one_tick_disable_checkout_only: false,
};

test('guest checkout is blocked when login is required', () => {
  assert.equal(
    checkoutSettingsBlockReason(configuration, {logged_in: false}, {items: [{properties: {}}]}),
    'Log in to continue checkout.',
  );
});

test('logged-in shoppers and enabled guests can continue', () => {
  assert.equal(
    checkoutSettingsBlockReason(configuration, {logged_in: true}, {items: [{properties: {}}]}),
    '',
  );
  assert.equal(
    checkoutSettingsBlockReason({...configuration, checkout_guest_checkout_enabled: true}, {logged_in: false}, {items: [{properties: {}}]}),
    '',
  );
});

test('managed-only carts remain blocked when configured', () => {
  const cart = {items: [{properties: {_pragma_site_cart_upsell: 'true'}}]};
  assert.equal(
    checkoutSettingsBlockReason({...configuration, checkout_guest_checkout_enabled: true, disable_checkout_for_upsell_only: true}, {logged_in: false}, cart),
    'Add a regular product before checkout.',
  );
});

test('personalisation replaces supported customer variables', () => {
  assert.equal(
    renderCustomerTemplate('Welcome back, {first_name} {last_name}', {first_name: 'Priya', last_name: 'Rana'}),
    'Welcome back, Priya Rana',
  );
});

test('checkout guards preserve other blocking sources', () => {
  const attributes = {};
  const checkout = {
    dataset: {},
    classList: {toggle: () => {}},
    setAttribute: (name, value) => { attributes[name] = value; },
    removeAttribute: (name) => { delete attributes[name]; },
  };
  setCheckoutGuard(checkout, 'settings', 'Log in to continue checkout.', '/checkout');
  setCheckoutGuard(checkout, 'terms', '', '/checkout');
  assert.equal(checkout.dataset.pscBlockedReason, 'Log in to continue checkout.');
  assert.equal(attributes.href, undefined);

  setCheckoutGuard(checkout, 'settings', '', '/checkout');
  assert.equal(checkout.dataset.pscBlockedReason, '');
  assert.equal(attributes.href, '/checkout');
});
