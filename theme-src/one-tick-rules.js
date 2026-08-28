const truthy = (value) => value === true || ['true', '1', 'yes'].includes(String(value).toLowerCase());

export const isOneTickItem = (item) => truthy(item.properties?._pragma_site_cart_one_tick);

export const oneTickSkuRuleState = (cart, rule) => {
  const productIds = new Set((rule.trigger_product_ids || []).flat());
  const parentItems = (cart.items || []).map((item, index) => ({item, line: index + 1})).filter(
    ({item}) => {
      if (isOneTickItem(item) || truthy(item.properties?._pragma_site_cart_free_gift)) return false;
      if (rule.applicable_on === 'all') return true;
      return productIds.has(`gid://shopify/Product/${item.product_id}`);
    },
  );
  const addOnItems = (cart.items || []).map((item, index) => ({item, line: index + 1})).filter(
    ({item}) => String(item.properties?._pragma_site_cart_one_tick_rule || '') === rule.id,
  );
  return {
    parentItems,
    addOnItems,
    desiredQuantity: parentItems.reduce(
      (total, {item}) => total + Math.max(0, Number(item.quantity || 0)),
      0,
    ),
  };
};
