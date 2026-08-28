import assert from 'node:assert/strict';
import test from 'node:test';

import {
  matchingSwapRule,
  shouldShowOneTickOffers,
  sizeGroupCandidates,
} from './product-swap-rules.js';

test('swap-only mode suppresses one-tick offers', () => {
  assert.equal(shouldShowOneTickOffers({
    product_swap_enabled: true,
    product_swap_coexistence: 'swap',
  }), false);
});

test('upsell-only mode and disabled swaps preserve one-tick offers', () => {
  assert.equal(shouldShowOneTickOffers({
    product_swap_enabled: true,
    product_swap_coexistence: 'upsell',
  }), true);
  assert.equal(shouldShowOneTickOffers({
    product_swap_enabled: false,
    product_swap_coexistence: 'swap',
  }), true);
});

test('manual collection rules match their selected product snapshot', () => {
  const rule = matchingSwapRule(
    {product_id: 101, variant_id: 1001},
    [{
      id: 'collection_rule',
      enabled: true,
      trigger_scope: 'collection',
      trigger_id: 'gid://shopify/Collection/1',
      trigger_product_ids: ['gid://shopify/Product/101'],
    }],
  );
  assert.equal(rule?.id, 'collection_rule');
});

test('manual product rules retain compatibility with direct product IDs', () => {
  const rule = matchingSwapRule(
    {product_id: 101, variant_id: 1001},
    [{
      id: 'product_rule',
      enabled: true,
      trigger_scope: 'product',
      trigger_id: 'gid://shopify/Product/101',
      trigger_product_ids: [],
    }],
  );
  assert.equal(rule?.id, 'product_rule');
});

test('size ladders return every larger product in configured order', () => {
  const candidates = sizeGroupCandidates(
    {product_id: 101, variant_id: 1001},
    [{
      product_ids: [
        'gid://shopify/Product/101',
        'gid://shopify/Product/202',
        'gid://shopify/Product/303',
      ],
      product_titles: ['Small board', 'Medium board', 'Large board'],
      product_handles: ['small-board', 'medium-board', 'large-board'],
      variant_ids: [
        'gid://shopify/ProductVariant/1001',
        'gid://shopify/ProductVariant/2002',
        'gid://shopify/ProductVariant/3003',
      ],
      variant_titles: ['Default', 'Default', 'Default'],
    }],
  );
  assert.deepEqual(candidates, [
    {
      variantId: 'gid://shopify/ProductVariant/2002',
      variantTitle: 'Default',
      productTitle: 'Medium board',
      handle: 'medium-board',
    },
    {
      variantId: 'gid://shopify/ProductVariant/3003',
      variantTitle: 'Default',
      productTitle: 'Large board',
      handle: 'large-board',
    },
  ]);
});

test('largest product in a ladder has no upgrade candidate', () => {
  assert.deepEqual(sizeGroupCandidates(
    {product_id: 202, variant_id: 2002},
    [{
      product_ids: ['gid://shopify/Product/101', 'gid://shopify/Product/202'],
      product_titles: ['Small board', 'Large board'],
      product_handles: ['small-board', 'large-board'],
      variant_ids: ['gid://shopify/ProductVariant/1001', 'gid://shopify/ProductVariant/2002'],
      variant_titles: ['Default', 'Default'],
    }],
  ), []);
});
