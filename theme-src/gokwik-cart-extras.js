(() => {
  const initialize = (api) => {
    if (!api?.root || window.__gokwikCartExtrasLoaded) return;
    window.__gokwikCartExtrasLoaded = true;

    const {root, configuration} = api;
    const announcement = root.querySelector('[data-gk-announcement]');
    const viewport = root.querySelector('[data-gk-announcement-viewport]');
    const dots = root.querySelector('[data-gk-announcement-dots]');
    const savings = root.querySelector('[data-gk-savings]');
    const totalRow = root.querySelector('[data-gk-total-row]');
    const breakdown = root.querySelector('[data-gk-breakdown]');
    const breakdownTotal = root.querySelector('[data-gk-breakdown-total]');
    const breakdownFinal = root.querySelector('[data-gk-breakdown-final]');
    const subtotal = root.querySelector('[data-gk-subtotal]');
    const discountRow = root.querySelector('[data-gk-discount-row]');
    const discount = root.querySelector('[data-gk-discount]');
    const currency = root.dataset.currency || window.Shopify?.currency?.active || 'USD';
    const routesRoot = window.Shopify?.routes?.root || '/';
    const compareAtPrices = new Map();
    let bannerTimer = null;
    let bannerIndex = 0;

    const formatMoney = (cents) => {
      try {
        return new Intl.NumberFormat(document.documentElement.lang || 'en', {
          style: 'currency',
          currency,
        }).format(cents / 100);
      } catch {
        return `${(cents / 100).toFixed(2)} ${currency}`;
      }
    };

    const applyRichText = (element, value) => {
      element.textContent = value?.text || '';
      element.style.fontSize = `${value?.font_size || 14}px`;
      element.style.fontWeight = value?.bold ? '700' : '400';
      element.style.fontStyle = value?.italic ? 'italic' : 'normal';
      element.style.textDecoration = value?.underline ? 'underline' : 'none';
    };

    const conditionMatches = (condition, cart) => {
      if (!condition?.value?.trim()) return false;
      if (condition.type === 'product_title') {
        const expected = condition.value.trim().toLowerCase();
        const contains = cart.items.some((item) => item.product_title.toLowerCase().includes(expected));
        return condition.operator === 'does_not_contain' ? !contains : contains;
      }
      const expected = Number(condition.value);
      if (!Number.isFinite(expected)) return false;
      const actual = condition.type === 'cart_value' ? cart.total_price / 100 : cart.item_count;
      if (condition.operator === 'less_than') return actual < expected;
      if (condition.operator === 'equals') return actual === expected;
      return actual > expected;
    };

    const createBanner = (banner, className = '') => {
      const message = document.createElement('div');
      message.className = `gk-cart-announcement-message ${className}`.trim();
      const title = document.createElement('span');
      applyRichText(title, banner.title);
      message.append(title);
      if (banner.show_subtext && banner.subtext?.text) {
        const subtext = document.createElement('small');
        applyRichText(subtext, banner.subtext);
        message.append(subtext);
      }
      return message;
    };

    const showBanner = (banners, index, animate = false) => {
      const next = createBanner(banners[index], animate ? 'gk-cart-announcement-message--entering' : '');
      const current = viewport.firstElementChild;
      if (animate && current) {
        current.classList.add('gk-cart-announcement-message--leaving');
        viewport.append(next);
        window.setTimeout(() => viewport.replaceChildren(next), 420);
      } else {
        viewport.replaceChildren(next);
      }
      dots.replaceChildren(...banners.map((banner, indexValue) => {
        const dot = document.createElement('i');
        dot.classList.toggle('is-active', indexValue === index);
        return dot;
      }));
    };

    const updateAnnouncement = (cart) => {
      window.clearInterval(bannerTimer);
      const configured = Array.isArray(configuration.banners) ? configuration.banners : [];
      const eligible = configuration.advanced_conditions
        ? configured.filter((banner) => banner.conditions?.length && banner.conditions.every((condition) => conditionMatches(condition, cart)))
        : configured;
      const banners = eligible.length ? eligible : configured.slice(0, 1);
      const enabled = configuration.announcement_enabled !== false && banners.length > 0;
      announcement.hidden = !enabled;
      if (!enabled) return;

      announcement.style.textAlign = configuration.announcement_alignment || 'center';
      bannerIndex = 0;
      showBanner(banners, bannerIndex);
      dots.hidden = !configuration.dynamic_banners || banners.length < 2;
      if (configuration.dynamic_banners && banners.length > 1) {
        const interval = Math.min(60, Math.max(2, Number(configuration.auto_change_seconds) || 9)) * 1000;
        bannerTimer = window.setInterval(() => {
          bannerIndex = (bannerIndex + 1) % banners.length;
          showBanner(banners, bannerIndex, true);
        }, interval);
      }
    };

    const updateCompareAtPrices = async (cart) => {
      if (!configuration.show_mrp_discounts) return;
      const handles = [...new Set(cart.items
        .filter((item) => item.handle && !compareAtPrices.has(Number(item.variant_id)))
        .map((item) => item.handle))];
      await Promise.all(handles.map(async (handle) => {
        try {
          const response = await fetch(`${routesRoot}products/${encodeURIComponent(handle)}.js`, {
            headers: {'Accept': 'application/json'},
            credentials: 'same-origin',
          });
          if (!response.ok) return;
          const product = await response.json();
          (product.variants || []).forEach((variant) => {
            compareAtPrices.set(Number(variant.id), Number(variant.compare_at_price) || 0);
          });
        } catch (error) {
          console.error('[pragma-site-cart] Unable to load compare-at prices', error);
        }
      }));
      if (api.getCart() !== cart) return;

      root.querySelectorAll('[data-gk-line]').forEach((row) => {
        const item = cart.items[Number(row.dataset.gkLine) - 1];
        const prices = row.querySelector('.gk-cart-line-prices');
        if (!item || !prices) return;
        prices.querySelector('.gk-cart-compare-price')?.remove();
        const compareAtPrice = compareAtPrices.get(Number(item.variant_id));
        if (!(compareAtPrice > item.final_price)) return;
        const mrp = document.createElement('s');
        mrp.className = 'gk-cart-compare-price';
        mrp.textContent = formatMoney(compareAtPrice * item.quantity);
        prices.prepend(mrp);
      });
    };

    const update = (cart) => {
      if (!cart) return;
      const formattedTotal = formatMoney(cart.total_price);
      const totalDiscount = Number(cart.total_discount) || 0;
      const showSavings = configuration.show_savings !== false && totalDiscount > 0;
      breakdownTotal.textContent = formattedTotal;
      breakdownFinal.textContent = formattedTotal;
      subtotal.textContent = formatMoney(cart.items_subtotal_price ?? cart.total_price);
      savings.hidden = !showSavings;
      savings.textContent = showSavings ? `You saved ${formatMoney(totalDiscount)} on this order` : '';
      discountRow.hidden = totalDiscount <= 0;
      discount.textContent = totalDiscount > 0 ? `-${formatMoney(totalDiscount)}` : '';
      const showBreakdown = configuration.show_estimated_total_breakup !== false;
      totalRow.hidden = showBreakdown;
      breakdown.hidden = !showBreakdown;
      updateAnnouncement(cart);
      updateCompareAtPrices(cart);
    };

    document.addEventListener('gokwik:cart:rendered', (event) => {
      if (event.detail?.root === root) update(event.detail.cart);
    });
    document.addEventListener('gokwik:cart:closed', () => window.clearInterval(bannerTimer));
    update(api.getCart());

    const customScript = String(configuration.custom_script || '').trim();
    if (customScript) {
      try {
        const execute = new Function(
          'gokwikCart',
          'configuration',
          `"use strict";\n${customScript}\n//# sourceURL=gokwik-cart-custom.js`,
        );
        execute(api, configuration);
        document.dispatchEvent(new CustomEvent('gokwik:custom-script:ready'));
      } catch (error) {
        console.error('[pragma-site-cart] Custom script failed', error);
        document.dispatchEvent(new CustomEvent('gokwik:custom-script:error', {detail: {error}}));
      }
    }
  };

  if (window.gokwikCart) initialize(window.gokwikCart);
  else document.addEventListener('gokwik:cart:ready', (event) => initialize(event.detail.api), {once: true});
})();
