import assert from 'node:assert/strict';
import test from 'node:test';

import {oneTickSkuRuleState} from './one-tick-rules.js';

const item = (productId, quantity, properties = {}) => ({
  product_id: productId,
  quantity,
  properties,
});

test('specific-product rules match only configured parent products', () => {
  const state = oneTickSkuRuleState(
    {items: [item(101, 2), item(202, 1)]},
    {
      id: 'rule_1',
      applicable_on: 'products',
      trigger_product_ids: [['gid://shopify/Product/101']],
    },
  );
  assert.equal(state.parentItems.length, 1);
  assert.equal(state.parentItems[0].item.product_id, 101);
  assert.equal(state.desiredQuantity, 2);
});

test('collection rules use their selected product snapshot', () => {
  const state = oneTickSkuRuleState(
    {items: [item(101, 1), item(202, 3)]},
    {
      id: 'rule_1',
      applicable_on: 'collections',
      trigger_product_ids: [[
        'gid://shopify/Product/101',
        'gid://shopify/Product/202',
      ]],
    },
  );
  assert.equal(state.parentItems.length, 2);
  assert.equal(state.desiredQuantity, 4);
});

test('managed add-ons and free gifts never count as parent products', () => {
  const state = oneTickSkuRuleState(
    {
      items: [
        item(101, 1),
        item(303, 1, {
          _pragma_site_cart_one_tick: 'true',
          _pragma_site_cart_one_tick_rule: 'rule_1',
        }),
        item(404, 1, {_pragma_site_cart_free_gift: 'true'}),
      ],
    },
    {id: 'rule_1', applicable_on: 'all', trigger_product_ids: []},
  );
  assert.equal(state.parentItems.length, 1);
  assert.equal(state.addOnItems.length, 1);
  assert.equal(state.desiredQuantity, 1);
});

test('removed parent products produce zero desired quantity', () => {
  const state = oneTickSkuRuleState(
    {
      items: [
        item(303, 2, {
          _pragma_site_cart_one_tick: 'true',
          _pragma_site_cart_one_tick_rule: 'rule_1',
        }),
      ],
    },
    {id: 'rule_1', applicable_on: 'products', trigger_product_ids: [['gid://shopify/Product/101']]},
  );
  assert.equal(state.parentItems.length, 0);
  assert.equal(state.addOnItems.length, 1);
  assert.equal(state.desiredQuantity, 0);
});
