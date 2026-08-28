import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRAGMA_SITE_CHECKOUT_URL,
  checkoutDestination,
} from './checkout-destination.js';

test('enabled Pragma checkout uses the temporary Pragma destination', () => {
  assert.equal(checkoutDestination(true, '/checkout'), PRAGMA_SITE_CHECKOUT_URL);
});

test('disabled Pragma checkout preserves the Shopify checkout destination', () => {
  assert.equal(checkoutDestination(false, '/checkout'), '/checkout');
});
