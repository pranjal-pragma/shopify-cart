export const rewardMetric = (cart, configuration) => {
  const scope = configuration.tiered_applicable_on || 'all';
  if (scope === 'all') {
    if (configuration.tiered_reward_condition === 'cart_quantity') return cart.item_count;
    if (configuration.tiered_reward_condition === 'cart_discount_price') {
      return (cart.total_price - Number(cart.total_discount || 0)) / 100;
    }
    return (
      configuration.tiered_exclude_discounts
        ? Number(cart.original_total_price || cart.total_price)
        : cart.total_price
    ) / 100;
  }
  const productIds = new Set((configuration.tiered_applicable_product_ids || []).flat());
  const scopedItems = (cart.items || []).filter(
    (item) => productIds.has(`gid://shopify/Product/${item.product_id}`),
  );
  if (configuration.tiered_reward_condition === 'cart_quantity') {
    return scopedItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  }
  const finalPrice = scopedItems.reduce(
    (sum, item) => sum + Number(item.final_line_price || 0),
    0,
  );
  if (configuration.tiered_reward_condition === 'cart_discount_price') {
    const discount = scopedItems.reduce(
      (sum, item) => sum + Math.max(
        0,
        Number(item.original_line_price || item.final_line_price || 0)
          - Number(item.final_line_price || 0),
      ),
      0,
    );
    return Math.max(0, finalPrice - discount) / 100;
  }
  if (!configuration.tiered_exclude_discounts) return finalPrice / 100;
  return scopedItems.reduce(
    (sum, item) => sum + Number(item.original_line_price || item.final_line_price || 0),
    0,
  ) / 100;
};
