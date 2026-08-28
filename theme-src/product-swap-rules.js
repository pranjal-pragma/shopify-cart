const numericId = (gid) => Number(String(gid || '').split('/').pop());

export const shouldShowOneTickOffers = (configuration = {}) => (
  !configuration.product_swap_enabled || configuration.product_swap_coexistence !== 'swap'
);

export const matchingSwapRule = (item, rules = []) => rules.find((rule) => {
  if (!rule.enabled) return false;
  const productGid = `gid://shopify/Product/${item.product_id}`;
  if ((rule.trigger_product_ids || []).includes(productGid)) return true;
  return rule.trigger_scope === 'product' && numericId(rule.trigger_id) === Number(item.product_id);
});

export const sizeGroupCandidates = (item, groups = []) => {
  const productGid = `gid://shopify/Product/${item.product_id}`;
  const group = groups.find((candidate) => (
    (candidate.product_ids || []).includes(productGid)
    || (!(candidate.product_ids || []).length
      && (candidate.variant_ids || []).some((id) => numericId(id) === Number(item.variant_id)))
  ));
  if (!group) return [];
  const index = (group.product_ids || []).length
    ? group.product_ids.indexOf(productGid)
    : group.variant_ids.findIndex((id) => numericId(id) === Number(item.variant_id));
  return (group.variant_ids || []).slice(index + 1).map((variantId, offset) => {
    const rungIndex = index + offset + 1;
    return {
      variantId,
      variantTitle: group.variant_titles?.[rungIndex] || '',
      productTitle: group.product_titles?.[rungIndex] || group.variant_titles?.[rungIndex] || '',
      handle: group.product_handles?.[rungIndex] || '',
    };
  });
};
