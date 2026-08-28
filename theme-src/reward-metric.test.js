import assert from 'node:assert/strict';
import test from 'node:test';

import {rewardMetric} from './reward-metric.js';

const cart = {
  item_count: 3,
  original_total_price: 25_000,
  total_price: 20_000,
  total_discount: 5_000,
  items: [
    {
      product_id: 101,
      quantity: 2,
      original_line_price: 20_000,
      final_line_price: 16_000,
    },
    {
      product_id: 202,
      quantity: 1,
      original_line_price: 5_000,
      final_line_price: 4_000,
    },
  ],
};

const configuration = (overrides = {}) => ({
  tiered_applicable_on: 'all',
  tiered_applicable_product_ids: [],
  tiered_reward_condition: 'cart_subtotal',
  tiered_exclude_discounts: false,
  ...overrides,
});

test('all-product subtotal uses discounted value by default', () => {
  assert.equal(rewardMetric(cart, configuration()), 200);
});

test('all-product subtotal ignores discounts when configured', () => {
  assert.equal(rewardMetric(cart, configuration({tiered_exclude_discounts: true})), 250);
});

test('product scope counts only selected products', () => {
  const scoped = {
    tiered_applicable_on: 'products',
    tiered_applicable_product_ids: [['gid://shopify/Product/101']],
  };
  assert.equal(rewardMetric(cart, configuration(scoped)), 160);
  assert.equal(
    rewardMetric(cart, configuration({...scoped, tiered_exclude_discounts: true})),
    200,
  );
});

test('discount exclusion does not affect quantity goals', () => {
  const scoped = {
    tiered_applicable_on: 'products',
    tiered_applicable_product_ids: [['gid://shopify/Product/101']],
    tiered_reward_condition: 'cart_quantity',
  };
  assert.equal(rewardMetric(cart, configuration(scoped)), 2);
  assert.equal(
    rewardMetric(cart, configuration({...scoped, tiered_exclude_discounts: true})),
    2,
  );
});
