const numericId = (gid) => Number(String(gid || '').split('/').pop());
const truthy = (value) => value === true || ['true', '1', 'yes'].includes(String(value).toLowerCase());

export const configuredAvailableVariant = (product, variantId) => (
  (product?.variants || []).find((variant) => (
    Number(variant.id) === numericId(variantId) && variant.available
  )) || null
);

export const isManagedCartItem = (item) => (
  truthy(item?.properties?._pragma_site_cart_upsell)
  || truthy(item?.properties?._pragma_site_cart_free_gift)
  || truthy(item?.properties?._pragma_site_cart_one_tick)
);

export const regularCartItems = (cart) => (cart?.items || []).filter((item) => !isManagedCartItem(item));

export const matchingUpsellRule = (cart, rules = []) => {
  const cartProducts = new Set(
    regularCartItems(cart).map((item) => `gid://shopify/Product/${item.product_id}`),
  );
  const matches = (rule) => {
    if (rule.applicable_on === 'all') return true;
    const snapshots = (rule.trigger_product_ids || []).flat();
    const targets = snapshots.length ? snapshots : rule.trigger_ids || [];
    return targets.some((id) => cartProducts.has(id));
  };
  return rules.find((rule) => rule.applicable_on !== 'all' && matches(rule))
    || rules.find((rule) => rule.applicable_on === 'all');
};

export const ruleRecommendations = (cart, rule) => {
  if (!rule) return [];
  const inCart = new Set((cart?.items || []).map((item) => Number(item.product_id)));
  const unique = new Map();
  for (const recommendation of rule.recommendations || []) {
    if (inCart.has(numericId(recommendation.product_id))) continue;
    if (!unique.has(recommendation.variant_id)) {
      unique.set(recommendation.variant_id, recommendation);
    }
  }
  return [...unique.values()].slice(0, Math.max(1, Number(rule.product_count || 1)));
};

export const upsellVariantQuantity = (cart, variantId) => (cart?.items || [])
  .filter((item) => Number(item.variant_id) === Number(variantId))
  .reduce((total, item) => total + Math.max(0, Number(item.quantity || 0)), 0);

export const upsellLimitReached = (cart, variantId, configuration = {}) => (
  configuration.upsell_cap_quantity === true
  && upsellVariantQuantity(cart, variantId) >= Math.max(1, Number(configuration.upsell_max_quantity || 1))
);
