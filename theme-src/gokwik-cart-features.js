(() => {
  const initialize = (api) => {
    if (!api?.root || window.__gokwikCartFeaturesLoaded) return;
    window.__gokwikCartFeaturesLoaded = true;

    const {root, configuration} = api;
    const drawer = root.querySelector('[data-gk-drawer]');
    const footer = root.querySelector('[data-gk-footer]');
    const notice = root.querySelector('[data-gk-notice]');
    const checkout = root.querySelector('.gk-cart-checkout-button');
    const routesRoot = window.Shopify?.routes?.root || '/';
    const cartAddUrl = root.dataset.cartAddUrl || `${routesRoot}cart/add`;
    const cartChangeUrl = root.dataset.cartChangeUrl || `${routesRoot}cart/change`;
    const cartUpdateUrl = `${routesRoot}cart/update`;
    const currency = root.dataset.currency || window.Shopify?.currency?.active || 'USD';
    const nativeFetch = window.fetch.bind(window);
    const host = document.createElement('section');
    host.className = 'gk-cart-features';
    host.hidden = true;
    drawer.insertBefore(host, footer);
    let giftMutationRunning = false;
    let noteTimer = null;
    const productCache = new Map();
    const celebratedRewards = new Set();

    const isTruthy = (value) => value === true || ['true', '1', 'yes'].includes(String(value).toLowerCase());
    const numericId = (gid) => Number(String(gid || '').split('/').pop());
    const money = (amount) => {
      try {
        return new Intl.NumberFormat(document.documentElement.lang || 'en', {style: 'currency', currency}).format(amount / 100);
      } catch {
        return `${(amount / 100).toFixed(2)} ${currency}`;
      }
    };
    const showNotice = (message, error = false) => {
      notice.textContent = message;
      notice.hidden = !message;
      notice.classList.toggle('gk-cart-notice--error', error);
    };
    const button = (label, className = '') => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = className;
      element.textContent = label;
      return element;
    };
    const section = (className) => {
      const element = document.createElement('div');
      element.className = `gk-cart-feature ${className}`;
      return element;
    };
    const addVariant = async (variantId, properties) => {
      const response = await nativeFetch(`${cartAddUrl}.js`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
        credentials: 'same-origin',
        body: JSON.stringify({items: [{id: numericId(variantId), quantity: 1, properties}]}),
      });
      if (!response.ok) throw new Error(`Cart add failed (${response.status})`);
    };
    const removeLine = async (item, line) => {
      const response = await nativeFetch(`${cartChangeUrl}.js`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
        credentials: 'same-origin',
        body: JSON.stringify({id: item.key || line, quantity: 0}),
      });
      if (!response.ok) throw new Error(`Cart change failed (${response.status})`);
    };
    const eligibilityMetric = (offer, cart) => offer.eligibility_type === 'cart_quantity'
      ? cart.item_count
      : cart.total_price / 100;
    const offerIsActive = (offer, cart) => {
      const now = Date.now();
      return now >= Date.parse(offer.starts_at)
        && now < Date.parse(offer.ends_at)
        && eligibilityMetric(offer, cart) >= Number(offer.threshold || 0);
    };

    const reconcileAutoGifts = async (cart) => {
      if (giftMutationRunning || !configuration.free_gifts_enabled || configuration.free_gift_method !== 'auto') return;
      const offers = (configuration.free_gift_offers || []).filter((offer) => offerIsActive(offer, cart));
      const giftItems = cart.items.map((item, index) => ({item, line: index + 1})).filter(({item}) => item.properties?._gokwik_free_gift_offer);
      const validIds = new Set(offers.map((offer) => offer.id));
      const stale = giftItems.filter(({item}) => !validIds.has(String(item.properties._gokwik_free_gift_offer)));
      const currentIds = new Set(giftItems.map(({item}) => String(item.properties._gokwik_free_gift_offer)));
      const missing = offers.filter((offer) => !currentIds.has(offer.id));
      if (!stale.length && !missing.length) return;
      giftMutationRunning = true;
      try {
        for (const {item, line} of stale) await removeLine(item, line);
        for (const offer of missing) {
          await addVariant(offer.variant_id, {_gokwik_free_gift: 'true', _gokwik_free_gift_offer: offer.id});
        }
        await api.sync();
        if (missing.length && configuration.free_gift_congratulations) showNotice('Congratulations! Your free gift was added.');
      } catch (error) {
        console.error('[GoKwik Cart] Unable to update free gifts', error);
        showNotice('Your free gift could not be updated. Please try again.', true);
      } finally {
        giftMutationRunning = false;
      }
    };

    const renderDiscounts = () => {
      if (configuration.discount_mode === 'hide') return;
      const block = section('gk-cart-feature--discount');
      if (configuration.discount_mode === 'checkout_offers') {
        block.innerHTML = '<strong>Available offers</strong><span>Discounts configured in GoKwik Checkout will be validated at checkout.</span>';
      } else {
        const form = document.createElement('form');
        const input = document.createElement('input');
        input.name = 'discount';
        input.placeholder = 'Enter coupon code';
        input.setAttribute('aria-label', 'Coupon code');
        const apply = button('Apply');
        form.append(input, apply);
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          const code = input.value.trim();
          if (!code) return;
          checkout.href = `${routesRoot}discount/${encodeURIComponent(code)}?redirect=${encodeURIComponent(`${routesRoot}checkout`)}`;
          block.classList.add('is-applied');
          showNotice(`${code} will be validated at checkout.`);
        });
        block.append(form);
      }
      host.append(block);
    };

    const renderOrderNotes = (cart) => {
      if (!configuration.order_notes_enabled) return;
      const block = section('gk-cart-feature--notes');
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      const title = document.createElement('span');
      title.textContent = configuration.order_notes_title || 'Add special instructions';
      const savedNote = document.createElement('small');
      savedNote.className = 'gk-cart-order-note-value';
      const displaySavedNote = (value) => {
        const note = String(value || '').trim();
        savedNote.textContent = note;
        savedNote.hidden = !note;
      };
      displaySavedNote(cart.note);
      summary.append(title, savedNote);
      const textarea = document.createElement('textarea');
      textarea.value = cart.note || '';
      textarea.maxLength = 500;
      textarea.placeholder = 'Add instructions for this order';
      textarea.setAttribute('aria-label', configuration.order_notes_title || 'Order note');
      textarea.addEventListener('input', () => {
        window.clearTimeout(noteTimer);
        noteTimer = window.setTimeout(async () => {
          try {
            const response = await nativeFetch(`${cartUpdateUrl}.js`, {
              method: 'POST',
              headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
              credentials: 'same-origin',
              body: JSON.stringify({note: textarea.value}),
            });
            if (!response.ok) throw new Error(`Cart note failed (${response.status})`);
            const updatedCart = await response.json();
            displaySavedNote(updatedCart.note ?? textarea.value);
            showNotice('Order note saved.');
          } catch (error) {
            console.error('[GoKwik Cart] Unable to save order note', error);
            showNotice('Your order note could not be saved.', true);
          }
        }, 500);
      });
      details.append(summary, textarea);
      block.append(details);
      host.append(block);
    };

    const rewardMetric = (cart) => {
      if (configuration.tiered_reward_condition === 'cart_quantity') return cart.item_count;
      if (configuration.tiered_reward_condition === 'cart_discount_price') return (cart.total_price - Number(cart.total_discount || 0)) / 100;
      return (configuration.tiered_exclude_discounts ? Number(cart.items_subtotal_price || cart.total_price) : cart.total_price) / 100;
    };
    const renderRewards = (cart) => {
      if (!configuration.tiered_rewards_enabled || !configuration.tiered_rewards?.length) return;
      const rewards = [...configuration.tiered_rewards].sort((left, right) => left.goal - right.goal);
      const metric = rewardMetric(cart);
      const next = rewards.find((reward) => metric < reward.goal);
      const completed = rewards.filter((reward) => metric >= reward.goal);
      const block = section('gk-cart-feature--rewards');
      const message = document.createElement('span');
      message.textContent = next ? next.before_text : configuration.tiered_completion_text;
      const track = document.createElement('i');
      track.style.backgroundColor = configuration.tiered_secondary_color || '#E5E7EB';
      const progress = document.createElement('b');
      const target = next?.goal || rewards.at(-1).goal;
      progress.style.backgroundColor = configuration.tiered_primary_color || '#F10A0A';
      progress.style.width = `${Math.min(100, metric / target * 100)}%`;
      track.append(progress);
      const milestones = document.createElement('small');
      milestones.textContent = rewards.map((reward) => `${reward.reward_text}: ${reward.goal}`).join('  |  ');
      block.append(message, track, milestones);
      host.append(block);
      if (configuration.tiered_confetti_enabled && completed.length) {
        const latest = completed.at(-1);
        if (!celebratedRewards.has(latest.id)) {
          celebratedRewards.add(latest.id);
          block.classList.add('is-celebrating');
          for (let index = 0; index < 8; index += 1) {
            const piece = document.createElement('em');
            piece.style.left = `${8 + index * 12}%`;
            piece.style.backgroundColor = index % 2 ? configuration.tiered_primary_color : '#F2B84B';
            block.append(piece);
          }
        }
      }
    };

    const renderGiftChoices = (cart) => {
      if (!configuration.free_gifts_enabled || configuration.free_gift_method !== 'choice') return;
      const active = (configuration.free_gift_offers || []).filter((offer) => offerIsActive(offer, cart));
      const selected = new Set(cart.items.map((item) => String(item.properties?._gokwik_free_gift_offer || '')));
      if (!active.length) return;
      const block = section('gk-cart-feature--gifts');
      const title = document.createElement('strong');
      title.textContent = 'Choose your free gift';
      block.append(title);
      active.forEach((offer) => {
        const action = button(selected.has(offer.id) ? `${offer.title} added` : offer.title);
        action.disabled = selected.has(offer.id);
        action.addEventListener('click', async () => {
          action.disabled = true;
          try {
            await addVariant(offer.variant_id, {_gokwik_free_gift: 'true', _gokwik_free_gift_offer: offer.id});
            await api.sync();
            if (configuration.free_gift_congratulations) showNotice('Congratulations! Your free gift was added.');
          } catch (error) {
            console.error('[GoKwik Cart] Unable to add selected gift', error);
            action.disabled = false;
            showNotice('That gift could not be added.', true);
          }
        });
        block.append(action);
      });
      host.append(block);
    };

    const renderOneTick = (cart) => {
      if (!configuration.one_tick_enabled || !configuration.one_tick_variant_id) return;
      const existing = cart.items.map((item, index) => ({item, line: index + 1})).find(({item}) => isTruthy(item.properties?._gokwik_one_tick));
      const block = section('gk-cart-feature--one-tick');
      const action = button('', 'gk-cart-one-tick');
      action.setAttribute('role', 'checkbox');
      action.setAttribute('aria-checked', String(Boolean(existing)));
      const check = document.createElement('i');
      const copy = document.createElement('span');
      copy.textContent = configuration.one_tick_text?.text || 'Add cart add-on';
      const product = document.createElement('small');
      product.textContent = configuration.one_tick_variant_title || 'Selected add-on';
      action.append(check, copy, product);
      action.addEventListener('click', async () => {
        action.disabled = true;
        try {
          if (existing) await removeLine(existing.item, existing.line);
          else await addVariant(configuration.one_tick_variant_id, {_gokwik_one_tick: 'true'});
          await api.sync();
        } catch (error) {
          console.error('[GoKwik Cart] Unable to update one-tick add-on', error);
          showNotice('The add-on could not be updated.', true);
        } finally {
          action.disabled = false;
        }
      });
      block.append(action);
      host.append(block);
    };

    const loadProduct = (handle) => {
      if (!productCache.has(handle)) {
        productCache.set(handle, nativeFetch(`${routesRoot}products/${encodeURIComponent(handle)}.js`, {headers: {'Accept': 'application/json'}, credentials: 'same-origin'}).then((response) => response.ok ? response.json() : null).catch(() => null));
      }
      return productCache.get(handle);
    };
    const swapTargetFor = async (item) => {
      const manual = (configuration.product_swap_rules || []).find((rule) => {
        if (!rule.enabled || rule.trigger_scope !== 'product') return false;
        const trigger = numericId(rule.trigger_id);
        return trigger === Number(item.product_id) || trigger === Number(item.variant_id);
      });
      if (manual) return {variantId: manual.target_variant_id, label: manual.pill_label};
      const group = (configuration.product_swap_size_groups || []).find((candidate) => candidate.variant_ids.some((id) => numericId(id) === Number(item.variant_id)));
      if (group) {
        const index = group.variant_ids.findIndex((id) => numericId(id) === Number(item.variant_id));
        if (index >= 0 && index < group.variant_ids.length - 1) return {variantId: group.variant_ids[index + 1], label: `Upgrade to ${group.variant_titles[index + 1]}`};
      }
      if (!configuration.product_swap_automatic_upgrade || !item.handle) return null;
      const product = await loadProduct(item.handle);
      const currentPrice = Number(item.original_price || item.final_price);
      const next = product?.variants?.filter((variant) => variant.available && Number(variant.price) > currentPrice).sort((left, right) => Number(left.price) - Number(right.price))[0];
      return next ? {variantId: String(next.id), label: `Upgrade to ${next.title}`} : null;
    };
    const renderSwaps = async (cart) => {
      if (!configuration.product_swap_enabled || configuration.product_swap_coexistence !== 'swap') return;
      await Promise.all([...root.querySelectorAll('[data-gk-line]')].map(async (row) => {
        const line = Number(row.dataset.gkLine);
        const item = cart.items[line - 1];
        if (!item || isTruthy(item.properties?._gokwik_free_gift)) return;
        const target = await swapTargetFor(item);
        if (!target || api.getCart() !== cart) return;
        const action = button(target.label, 'gk-cart-swap-action');
        action.addEventListener('click', async () => {
          action.disabled = true;
          try {
            await addVariant(target.variantId, {...(item.properties || {}), _gokwik_swap: 'true'});
            await removeLine(item, line);
            await api.sync();
          } catch (error) {
            console.error('[GoKwik Cart] Unable to swap product', error);
            action.disabled = false;
            showNotice('That product upgrade is unavailable.', true);
          }
        });
        row.querySelector('.gk-cart-item-details')?.append(action);
      }));
    };

    const render = (cart) => {
      host.replaceChildren();
      host.hidden = cart.item_count === 0;
      if (host.hidden) return;
      renderRewards(cart);
      renderGiftChoices(cart);
      renderOneTick(cart);
      renderDiscounts();
      renderOrderNotes(cart);
      renderSwaps(cart);
      reconcileAutoGifts(cart);
    };

    document.addEventListener('gokwik:cart:rendered', (event) => {
      if (event.detail?.root === root) render(event.detail.cart);
    });
    if (api.getCart()) render(api.getCart());
  };

  if (window.gokwikCart) initialize(window.gokwikCart);
  else document.addEventListener('gokwik:cart:ready', (event) => initialize(event.detail.api), {once: true});
})();
