(() => {
  const initialize = (api) => {
    if (!api?.root || window.__gokwikCartGiftsLoaded) return;
    window.__gokwikCartGiftsLoaded = true;
    const {root, configuration} = api;
    if (!configuration.free_gifts_enabled) return;

    const drawer = root.querySelector('[data-gk-drawer]');
    const notice = root.querySelector('[data-gk-notice]');
    const routesRoot = window.Shopify?.routes?.root || '/';
    const cartAddUrl = root.dataset.cartAddUrl || `${routesRoot}cart/add`;
    const cartChangeUrl = root.dataset.cartChangeUrl || `${routesRoot}cart/change`;
    const nativeFetch = window.fetch.bind(window);
    const host = document.createElement('div');
    host.className = 'gk-cart-feature gk-cart-feature--gifts';
    host.hidden = true;
    drawer.insertBefore(host, drawer.querySelector('.gk-cart-features') || root.querySelector('[data-gk-footer]'));
    const handledOffers = new Set();
    let mutationRunning = false;

    const numericId = (gid) => Number(String(gid || '').split('/').pop());
    const giftOfferId = (item) => String(item.properties?._gokwik_free_gift_offer || '');
    const isGift = (item) => Boolean(giftOfferId(item));
    const showNotice = (message, error = false) => {
      notice.textContent = message;
      notice.hidden = !message;
      notice.classList.toggle('gk-cart-notice--error', error);
    };
    const addGift = async (offer) => {
      const response = await nativeFetch(`${cartAddUrl}.js`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
        credentials: 'same-origin',
        body: JSON.stringify({items: [{id: numericId(offer.variant_id), quantity: Number(offer.quantity || 1), properties: {_gokwik_free_gift: 'true', _gokwik_free_gift_offer: offer.id}}]}),
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
      const selected = new Set(cart.items.map(giftOfferId));
      host.hidden = configuration.free_gift_method !== 'choice' || !offers.length;
      if (host.hidden) return;
      const title = document.createElement('strong');
      title.textContent = 'Choose your free gift';
      host.append(title);
      offers.forEach((offer) => {
        const action = document.createElement('button');
        action.type = 'button';
        action.textContent = selected.has(offer.id) ? `${offer.title} added` : `${offer.title} · Qty ${offer.quantity || 1}`;
        action.disabled = selected.has(offer.id);
        action.addEventListener('click', async () => {
          action.disabled = true;
          try {
            await addGift(offer);
            await api.sync();
            if (configuration.free_gift_congratulations) showNotice('Congratulations! Your free gift was added.');
          } catch (error) {
            console.error('[pragma-site-cart] Unable to add selected gift', error);
            action.disabled = false;
            showNotice('That gift could not be added.', true);
          }
        });
        host.append(action);
      });
    };
    const reconcile = async (cart) => {
      if (mutationRunning) return;
      const offers = activeOffers(cart);
      renderChoices(cart, offers);
      const validIds = new Set(offers.map((offer) => offer.id));
      const giftItems = cart.items.map((item, index) => ({item, line: index + 1})).filter(({item}) => isGift(item));
      giftItems.forEach(({item}) => handledOffers.add(giftOfferId(item)));
      const stale = giftItems.filter(({item}) => !validIds.has(giftOfferId(item)));
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

    document.addEventListener('gokwik:cart:rendered', (event) => {
      if (event.detail?.root === root) reconcile(event.detail.cart);
    });
    if (api.getCart()) reconcile(api.getCart());
  };

  if (window.gokwikCart) initialize(window.gokwikCart);
  else document.addEventListener('gokwik:cart:ready', (event) => initialize(event.detail.api), {once: true});
})();
