import assert from 'node:assert/strict';
import test from 'node:test';

import {
  configuredAvailableVariant,
  matchingUpsellRule,
  regularCartItems,
  ruleRecommendations,
  upsellDialogMode,
  upsellLimitReached,
  upsellVariantQuantity,
} from './upsell-rules.js';

test('configured recommendations use the exact selected in-stock variant', () => {
  const product = {variants: [
    {id: 1001, available: true, price: 1000},
    {id: 2002, available: true, price: 2500},
    {id: 3003, available: false, price: 3000},
  ]};
  assert.equal(
    configuredAvailableVariant(product, 'gid://shopify/ProductVariant/2002')?.price,
    2500,
  );
  assert.equal(
    configuredAvailableVariant(product, 'gid://shopify/ProductVariant/3003'),
    null,
  );
});

test('targeted upsell rules take priority over an all-products fallback', () => {
  const rule = matchingUpsellRule(
    {items: [{product_id: 101, quantity: 1, properties: {}}]},
    [
      {id: 'fallback', applicable_on: 'all'},
      {
        id: 'targeted',
        applicable_on: 'products',
        trigger_product_ids: [['gid://shopify/Product/101']],
      },
    ],
  );
  assert.equal(rule?.id, 'targeted');
});

test('first matching targeted rule wins in configured order', () => {
  const rule = matchingUpsellRule(
    {items: [{product_id: 101, quantity: 1, properties: {}}]},
    [
      {id: 'first', applicable_on: 'products', trigger_ids: ['gid://shopify/Product/101']},
      {id: 'second', applicable_on: 'products', trigger_ids: ['gid://shopify/Product/101']},
    ],
  );
  assert.equal(rule?.id, 'first');
});

test('all-products rule is used only when targeted rules do not match', () => {
  const rule = matchingUpsellRule(
    {items: [{product_id: 404, quantity: 1, properties: {}}]},
    [
      {id: 'targeted', applicable_on: 'products', trigger_ids: ['gid://shopify/Product/101']},
      {id: 'fallback', applicable_on: 'all'},
    ],
  );
  assert.equal(rule?.id, 'fallback');
});

test('collection rules match flattened product snapshots', () => {
  const rule = matchingUpsellRule(
    {items: [{product_id: 202, quantity: 1, properties: {}}]},
    [{
      id: 'collection',
      applicable_on: 'collections',
      trigger_product_ids: [[
        'gid://shopify/Product/101',
        'gid://shopify/Product/202',
      ]],
    }],
  );
  assert.equal(rule?.id, 'collection');
});

test('managed cart lines do not trigger upsell rules', () => {
  const cart = {items: [
    {product_id: 101, properties: {_pragma_site_cart_upsell: 'true'}},
    {product_id: 202, properties: {_pragma_site_cart_free_gift: 'true'}},
  ]};
  assert.deepEqual(regularCartItems(cart), []);
  assert.equal(matchingUpsellRule(cart, [{
    id: 'targeted',
    applicable_on: 'products',
    trigger_product_ids: [['gid://shopify/Product/101']],
  }]), undefined);
});

test('rule recommendations preserve selected variants, remove duplicates, and limit results', () => {
  const recommendation = (variantId, productId) => ({
    variant_id: `gid://shopify/ProductVariant/${variantId}`,
    product_id: `gid://shopify/Product/${productId}`,
  });
  const recommendations = ruleRecommendations(
    {items: [{product_id: 101}]},
    {
      product_count: 2,
      recommendations: [
        recommendation(1001, 101),
        recommendation(2002, 202),
        recommendation(2002, 202),
        recommendation(3003, 303),
        recommendation(4004, 404),
      ],
    },
  );
  assert.deepEqual(recommendations.map((item) => item.variant_id), [
    'gid://shopify/ProductVariant/1001',
    'gid://shopify/ProductVariant/2002',
  ]);
});

test('manual rules can recommend multiple variants of a product already in the cart', () => {
  const recommendations = ruleRecommendations(
    {items: [{product_id: 101, variant_id: 1001}]},
    {
      product_count: 4,
      recommendations: [1001, 1002, 1003, 1004].map((variantId) => ({
        variant_id: `gid://shopify/ProductVariant/${variantId}`,
        product_id: 'gid://shopify/Product/101',
      })),
    },
  );
  assert.equal(recommendations.length, 4);
});

test('quantity caps count every cart line for the recommended variant', () => {
  const cart = {items: [
    {variant_id: 2002, quantity: 1},
    {variant_id: 2002, quantity: 2, properties: {_pragma_site_cart_upsell: 'true'}},
  ]};
  assert.equal(upsellVariantQuantity(cart, 2002), 3);
  assert.equal(upsellLimitReached(cart, 2002, {
    upsell_cap_quantity: true,
    upsell_max_quantity: 3,
  }), true);
  assert.equal(upsellLimitReached(cart, 2002, {
    upsell_cap_quantity: false,
    upsell_max_quantity: 1,
  }), false);
});

test('variant selection opens a chooser only when alternatives are available', () => {
  assert.equal(upsellDialogMode('variant_popup', 3), 'variant');
  assert.equal(upsellDialogMode('variant_popup', 1), null);
});

test('product details always opens the product modal', () => {
  assert.equal(upsellDialogMode('product_popup', 1), 'product');
  assert.equal(upsellDialogMode('product_popup', 4), 'product');
});
