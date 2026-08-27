(() => {
  const initialize = (api) => {
    if (!api?.root || window.__pragmaSiteCartGiftsLoaded) return;
    window.__pragmaSiteCartGiftsLoaded = true;
    const {root, configuration} = api;
    if (!configuration.free_gifts_enabled) return;

    const content = root.querySelector('[data-psc-content]');
    const items = root.querySelector('[data-psc-items]');
    const notice = root.querySelector('[data-psc-notice]');
    const routesRoot = window.Shopify?.routes?.root || '/';
    const cartAddUrl = root.dataset.cartAddUrl || `${routesRoot}cart/add`;
    const cartChangeUrl = root.dataset.cartChangeUrl || `${routesRoot}cart/change`;
    const nativeFetch = window.fetch.bind(window);
    const host = document.createElement('div');
    host.className = 'psc-cart-feature psc-cart-feature--gifts';
    host.setAttribute('aria-label', 'Free gift selection');
    host.hidden = true;
    content.insertBefore(host, items);
    const handledOffers = new Set();
    let mutationRunning = false;

    const numericId = (gid) => Number(String(gid || '').split('/').pop());
    const giftOfferId = (item) => String(item.properties?._pragma_site_cart_free_gift_offer || '');
    const isGift = (item) => Boolean(giftOfferId(item));
    const giftOptions = (offer) => offer.gift_variants?.length
      ? offer.gift_variants
      : [{variant_id: offer.variant_id, variant_title: offer.variant_title}];
    const giftVariantIds = (offer) => new Set(giftOptions(offer).map((gift) => numericId(gift.variant_id)));
    const showNotice = (message, error = false) => {
      notice.textContent = message;
      notice.hidden = !message;
      notice.classList.toggle('psc-cart-notice--error', error);
    };
    const addGift = async (offer, gift = giftOptions(offer)[0]) => {
      const response = await nativeFetch(`${cartAddUrl}.js`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
        credentials: 'same-origin',
        body: JSON.stringify({items: [{id: numericId(gift.variant_id), quantity: Number(offer.quantity || 1), properties: {_pragma_site_cart_free_gift: 'true', _pragma_site_cart_free_gift_offer: offer.id}}]}),
      });
      if (!response.ok) throw new Error(`Gift add failed (${response.status})`);
      handledOffers.add(offer.id);
    };
    const removeGift = async (item, line) => {
      const response = await nativeFetch(`${cartChangeUrl}.js`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
        credentials: 'same-origin',
        body: JSON.stringify({id: item.key || line, quantity: 0}),
      });
      if (!response.ok) throw new Error(`Gift removal failed (${response.status})`);
    };
    const conditionMetric = (condition, cart) => {
      const selected = new Set((condition.product_ids || []).map(numericId));
      const items = cart.items.filter((item) => !isGift(item) && (condition.applicable_on !== 'products' || selected.has(Number(item.product_id))));
      return condition.condition_type === 'cart_quantity'
        ? items.reduce((total, item) => total + Number(item.quantity || 0), 0)
        : items.reduce((total, item) => total + Number(item.final_line_price || item.line_price || 0), 0) / 100;
    };
    const conditionMatches = (condition, cart) => {
      const metric = conditionMetric(condition, cart);
      const target = Number(condition.value || 0);
      if (condition.operator === 'equal_to') return metric === target;
      if (condition.operator === 'greater_than_or_equal') return metric >= target;
      return metric > target;
    };
    const offerIsActive = (offer, cart) => {
      const now = Date.now();
      const conditions = offer.conditions?.length ? offer.conditions : [{condition_type: offer.eligibility_type, operator: 'greater_than_or_equal', value: offer.threshold, applicable_on: 'all'}];
      return now >= Date.parse(offer.starts_at) && now < Date.parse(offer.ends_at) && conditions.every((condition) => conditionMatches(condition, cart));
    };
    const activeOffers = (cart) => (configuration.free_gift_offers || []).filter((offer) => offerIsActive(offer, cart));
    const renderChoices = (cart, offers) => {
      host.replaceChildren();
      const selected = new Map(
        cart.items.filter(isGift).map((item) => [giftOfferId(item), Number(item.variant_id)]),
      );
      host.hidden = configuration.free_gift_method !== 'choice' || !offers.length;
      if (host.hidden) return;
      const header = document.createElement('div');
      header.className = 'psc-cart-gift-header';
      const badge = document.createElement('span');
      badge.textContent = 'Free gift';
      const title = document.createElement('strong');
      title.textContent = 'Choose your free gift';
      const helper = document.createElement('small');
      helper.textContent = 'Select one option to add to your order.';
      header.append(badge, title, helper);
      host.append(header);
      offers.forEach((offer) => {
        const group = document.createElement('div');
        group.className = 'psc-cart-gift-options';
        const offerTitle = document.createElement('span');
        offerTitle.className = 'psc-cart-gift-offer-title';
        offerTitle.textContent = offer.title;
        group.append(offerTitle);
        giftOptions(offer).forEach((gift) => {
          const action = document.createElement('button');
          action.type = 'button';
          const giftTitle = gift.source_variant_title || gift.variant_title;
          const isSelected = selected.get(offer.id) === numericId(gift.variant_id);
          const copy = document.createElement('span');
          copy.className = 'psc-cart-gift-option__copy';
          const optionTitle = document.createElement('strong');
          optionTitle.textContent = giftTitle;
          const quantity = document.createElement('small');
          quantity.textContent = `Quantity ${offer.quantity || 1}`;
          const state = document.createElement('span');
          state.className = 'psc-cart-gift-option__state';
          state.textContent = isSelected ? 'Added' : 'Select';
          copy.append(optionTitle, quantity);
          action.append(copy, state);
          action.className = 'psc-cart-gift-option';
          action.classList.toggle('is-selected', isSelected);
          action.setAttribute('aria-pressed', String(isSelected));
          action.disabled = selected.has(offer.id);
          action.addEventListener('click', async () => {
            group.querySelectorAll('button').forEach((button) => { button.disabled = true; });
            try {
              await addGift(offer, gift);
              await api.sync();
              if (configuration.free_gift_congratulations) showNotice('Congratulations! Your free gift was added.');
            } catch (error) {
              console.error('[pragma-site-cart] Unable to add selected gift', error);
              group.querySelectorAll('button').forEach((button) => { button.disabled = false; });
              showNotice('That gift could not be added.', true);
            }
          });
          group.append(action);
        });
        host.append(group);
      });
    };
    const reconcile = async (cart) => {
      if (mutationRunning) return;
      const offers = activeOffers(cart);
      renderChoices(cart, offers);
      const offersById = new Map(offers.map((offer) => [offer.id, offer]));
      const giftItems = cart.items.map((item, index) => ({item, line: index + 1})).filter(({item}) => isGift(item));
      giftItems.forEach(({item}) => handledOffers.add(giftOfferId(item)));
      const stale = giftItems.filter(({item}) => {
        const offer = offersById.get(giftOfferId(item));
        return !offer || !giftVariantIds(offer).has(Number(item.variant_id));
      });
      const currentIds = new Set(giftItems.map(({item}) => giftOfferId(item)));
      const missing = configuration.free_gift_method === 'auto'
        ? offers.filter((offer) => !currentIds.has(offer.id) && (offer.re_add_each_time || !handledOffers.has(offer.id)))
        : [];
      if (!stale.length && !missing.length) return;
      mutationRunning = true;
      try {
        for (const {item, line} of stale) await removeGift(item, line);
        for (const offer of missing) await addGift(offer);
        await api.sync();
        if (missing.length && configuration.free_gift_congratulations) showNotice('Congratulations! Your free gift was added.');
      } catch (error) {
        console.error('[pragma-site-cart] Unable to update free gifts', error);
        showNotice('Your free gift could not be updated. Please try again.', true);
      } finally {
        mutationRunning = false;
      }
    };

    document.addEventListener('pragma-site-cart:cart:rendered', (event) => {
      if (event.detail?.root === root) reconcile(event.detail.cart);
    });
    if (api.getCart()) reconcile(api.getCart());
  };

  if (window.pragmaSiteCart) initialize(window.pragmaSiteCart);
  else document.addEventListener('pragma-site-cart:cart:ready', (event) => initialize(event.detail.api), {once: true});
})();
