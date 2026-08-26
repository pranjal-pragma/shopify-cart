(() => {
  const initialize = (api) => {
    if (!api?.root || window.__gokwikCartSettingsLoaded) return;
    window.__gokwikCartSettingsLoaded = true;

    const {root, configuration} = api;
    const country = root.dataset.country || window.Shopify?.country || '';
    if (configuration.disable_on_non_indian_store && country && country !== 'IN') {
      root.remove();
      return;
    }

    const nativeFetch = window.fetch.bind(window);
    const routesRoot = window.Shopify?.routes?.root || '/';
    const cartUrl = root.dataset.cartUrl || `${routesRoot}cart`;
    const cartAddUrl = root.dataset.cartAddUrl || `${routesRoot}cart/add`;
    const cartChangeUrl = root.dataset.cartChangeUrl || `${routesRoot}cart/change`;
    const currency = root.dataset.currency || window.Shopify?.currency?.active || 'USD';
    const confirmation = root.querySelector('[data-gk-confirmation]');
    const stickyCart = root.querySelector('[data-gk-sticky-cart]');
    const stickyCount = root.querySelector('[data-gk-sticky-count]');
    const stickyTotal = root.querySelector('[data-gk-sticky-total]');
    const terms = root.querySelector('[data-gk-terms]');
    const termsCheckbox = root.querySelector('[data-gk-terms-checkbox]');
    const termsText = root.querySelector('[data-gk-terms-text]');
    const termsLink = root.querySelector('[data-gk-terms-link]');
    const checkout = root.querySelector('.gk-cart-checkout-button');
    const notice = root.querySelector('[data-gk-notice]');
    const modal = root.querySelector('[data-gk-product-modal]');
    const modalImage = root.querySelector('[data-gk-modal-image]');
    const modalTitle = root.querySelector('[data-gk-modal-title]');
    const modalVariant = root.querySelector('[data-gk-modal-variant]');
    const modalPrice = root.querySelector('[data-gk-modal-price]');
    const modalDescription = root.querySelector('[data-gk-modal-description]');
    const modalLink = root.querySelector('[data-gk-modal-link]');
    const productCache = new Map();
    const blockCartPageRedirection = configuration.block_cart_page_redirection !== false;
    const variantSelectionEnabled = configuration.variant_selection_enabled !== false;
    let cart = null;
    let submitTimer = null;
    let confirmationTimer = null;

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

    const normalizePath = (path) => path.replace(/\.(js|json)$/, '').replace(/\/$/, '');
    const isCartPath = (value, expectedPath) => {
      try {
        return normalizePath(new URL(value, window.location.origin).pathname) === normalizePath(expectedPath);
      } catch {
        return false;
      }
    };

    const isTruthy = (value) => value === true || ['true', '1', 'yes'].includes(String(value).toLowerCase());
    const matchesSelector = (element, selector) => {
      try {
        return Boolean(element.closest(selector));
      } catch (error) {
        console.error(`[pragma-site-cart] Invalid selector: ${selector}`, error);
        return false;
      }
    };

    const hideNativeDrawers = () => {
      (configuration.custom_cart_drawer_selectors || []).forEach((selector) => {
        try {
          document.querySelectorAll(selector).forEach((element) => {
            if (element !== root && !root.contains(element)) {
              element.style.setProperty('display', 'none', 'important');
              element.dataset.gokwikCartHidden = 'true';
            }
          });
        } catch (error) {
          console.error(`[pragma-site-cart] Invalid drawer selector: ${selector}`, error);
        }
      });
    };

    const hideNativeAddToCartFeedback = () => {
      if (configuration.use_theme_add_to_cart_handling || configuration.add_to_cart_behavior !== 'nothing') return;
      [
        'cart-notification',
        '#cart-notification',
        '.cart-notification',
        '[data-cart-notification]',
        'cart-drawer',
        '#CartDrawer',
        '.cart-drawer',
        '[data-cart-drawer]',
      ].forEach((selector) => {
        document.querySelectorAll(selector).forEach((element) => {
          if (element !== root && !root.contains(element)) {
            element.style.setProperty('display', 'none', 'important');
            element.dataset.gokwikCartHidden = 'true';
          }
        });
      });
    };

    hideNativeDrawers();
    hideNativeAddToCartFeedback();
    (configuration.custom_cart_icon_selectors || []).forEach((selector) => {
      try {
        if (!document.querySelector(selector)) console.warn(`[pragma-site-cart] Cart icon selector did not match: ${selector}`);
      } catch {
        // Invalid selectors are reported by the guarded event matcher.
      }
    });
    if (configuration.custom_cart_drawer_selectors?.length || (
      !configuration.use_theme_add_to_cart_handling
      && configuration.add_to_cart_behavior === 'nothing'
    )) {
      new MutationObserver(() => {
        hideNativeDrawers();
        hideNativeAddToCartFeedback();
      }).observe(document.body, {childList: true, subtree: true});
    }

    const showConfirmation = () => {
      window.clearTimeout(confirmationTimer);
      confirmation.style.backgroundColor = configuration.confirmation_background || '#202124';
      confirmation.style.color = configuration.confirmation_text_color || '#FFFFFF';
      confirmation.hidden = false;
      confirmationTimer = window.setTimeout(() => { confirmation.hidden = true; }, 2600);
    };

    const handleAddToCart = (source) => {
      if (source === 'fetch') window.clearTimeout(submitTimer);
      window.dispatchEvent(new CustomEvent('KwikCartAtcButtonClicked', {detail: {source}}));
      if (configuration.add_to_cart_behavior === 'open_cart') api.open();
      else {
        api.sync();
        if (configuration.add_to_cart_behavior === 'confirmation') showConfirmation();
      }
    };

    if (!configuration.use_theme_add_to_cart_handling && configuration.add_to_cart_behavior !== 'nothing') {
      document.addEventListener('submit', (event) => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement) || !isCartPath(form.action, cartAddUrl)) return;
        window.clearTimeout(submitTimer);
        submitTimer = window.setTimeout(() => handleAddToCart('form'), 450);
      });

      window.fetch = async (...args) => {
        const request = args[0];
        const url = typeof request === 'string' || request instanceof URL ? String(request) : request.url;
        const response = await nativeFetch(...args);
        if (response.ok && isCartPath(url, cartAddUrl)) handleAddToCart('fetch');
        return response;
      };
    }

    document.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element) || root.contains(event.target)) return;
      const customIcon = (configuration.custom_cart_icon_selectors || []).some((selector) => matchesSelector(event.target, selector));
      const target = event.target.closest('a[href], [data-cart-icon-bubble], #cart-icon-bubble');
      const href = target?.getAttribute('href');
      const automaticCartTarget = Boolean(target && (
        (href && isCartPath(href, cartUrl))
        || (!href && target.matches('[data-cart-icon-bubble], #cart-icon-bubble'))
      ));
      if (!customIcon && !(blockCartPageRedirection && automaticCartTarget)) return;
      event.preventDefault();
      api.open();
    }, {capture: true});

    const updateStickyCart = (nextCart) => {
      const onProductPage = /\/products?\//.test(window.location.pathname);
      stickyCart.hidden = !configuration.sticky_cart_enabled || onProductPage || nextCart.item_count === 0;
      stickyCount.textContent = `${nextCart.item_count} ${nextCart.item_count === 1 ? 'item' : 'items'}`;
      stickyTotal.textContent = formatMoney(nextCart.total_price);
    };

    stickyCart.addEventListener('click', api.open);

    let termsAccepted = !configuration.terms_checkbox_enabled;
    if (configuration.terms_checkbox_enabled) {
      terms.hidden = false;
      termsText.textContent = configuration.terms_checkbox_text;
      termsLink.href = configuration.terms_checkbox_url;
      termsCheckbox.addEventListener('change', () => {
        termsAccepted = termsCheckbox.checked;
        updateCheckoutState();
      });
    }

    const updateCheckoutState = () => {
      const upsellOnly = Boolean(
        configuration.disable_checkout_for_upsell_only
        && cart?.items?.length
        && cart.items.every((item) => isTruthy(item.properties?._gokwik_upsell)),
      );
      const oneTickOnly = Boolean(
        configuration.one_tick_disable_checkout_only
        && cart?.items?.length
        && cart.items.every((item) => isTruthy(item.properties?._gokwik_one_tick)),
      );
      const reason = !termsAccepted
        ? 'Accept the Terms & Conditions to continue.'
        : upsellOnly || oneTickOnly ? 'Add a regular product before checkout.' : '';
      checkout.classList.toggle('gk-cart-checkout-button--disabled', Boolean(reason));
      checkout.setAttribute('aria-disabled', String(Boolean(reason)));
      checkout.dataset.gkBlockedReason = reason;
    };

    checkout.addEventListener('click', (event) => {
      const reason = checkout.dataset.gkBlockedReason;
      if (!reason) return;
      event.preventDefault();
      notice.textContent = reason;
      notice.hidden = false;
      notice.classList.add('gk-cart-notice--error');
    });

    const selectedVariantId = Number(String(configuration.quantity_limit_variant_id || '').split('/').pop());
    const applyQuantityRules = (nextCart) => {
      root.querySelectorAll('[data-gk-line]').forEach((row) => {
        const item = nextCart.items[Number(row.dataset.gkLine) - 1];
        if (!item) return;
        if (configuration.product_quantity_limit_enabled && Number(item.variant_id) === selectedVariantId && item.quantity >= configuration.product_quantity_limit) {
          const increase = row.querySelector('[data-gk-action="increase"]');
          if (increase) {
            increase.disabled = true;
            increase.title = `Maximum quantity is ${configuration.product_quantity_limit}`;
          }
        }
      });
    };

    const loadProduct = (handle) => {
      if (!productCache.has(handle)) {
        productCache.set(handle, nativeFetch(`${routesRoot}products/${encodeURIComponent(handle)}.js`, {
          headers: {'Accept': 'application/json'},
          credentials: 'same-origin',
        }).then((response) => response.ok ? response.json() : null).catch(() => null));
      }
      return productCache.get(handle);
    };

    const changeVariant = async (item, line, variantId, select) => {
      select.disabled = true;
      try {
        const addResponse = await nativeFetch(`${cartAddUrl}.js`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
          credentials: 'same-origin',
          body: JSON.stringify({items: [{id: Number(variantId), quantity: item.quantity, properties: item.properties || {}}]}),
        });
        if (!addResponse.ok) throw new Error(`Variant add failed (${addResponse.status})`);
        const removeResponse = await nativeFetch(`${cartChangeUrl}.js`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
          credentials: 'same-origin',
          body: JSON.stringify({id: item.key || line, quantity: 0}),
        });
        if (!removeResponse.ok) throw new Error(`Variant replacement failed (${removeResponse.status})`);
        await api.sync();
      } catch (error) {
        console.error('[pragma-site-cart] Unable to change variant', error);
        notice.textContent = 'That variant could not be selected. Please try again.';
        notice.hidden = false;
        notice.classList.add('gk-cart-notice--error');
        select.value = String(item.variant_id);
      } finally {
        select.disabled = false;
      }
    };

    const renderVariantSelectors = async (nextCart) => {
      if (!variantSelectionEnabled) return;
      await Promise.all([...root.querySelectorAll('[data-gk-line]')].map(async (row) => {
        const line = Number(row.dataset.gkLine);
        const item = nextCart.items[line - 1];
        if (!item?.handle) return;
        const product = await loadProduct(item.handle);
        if (api.getCart() !== nextCart || !product?.variants || product.variants.length < 2) return;
        const select = document.createElement('select');
        select.className = 'gk-cart-variant-select';
        select.setAttribute('aria-label', `Variant for ${item.product_title}`);
        product.variants.forEach((variant) => {
          if (!variant.available && Number(variant.id) !== Number(item.variant_id)) return;
          const option = document.createElement('option');
          option.value = String(variant.id);
          option.textContent = variant.title;
          option.selected = Number(variant.id) === Number(item.variant_id);
          select.append(option);
        });
        select.addEventListener('change', () => changeVariant(item, line, select.value, select));
        row.querySelector('.gk-cart-variant')?.replaceWith(select);
      }));
    };

    const closeModal = () => {
      modal.hidden = true;
      modal.setAttribute('aria-hidden', 'true');
    };

    const openProductModal = async (item) => {
      const product = item.handle ? await loadProduct(item.handle) : null;
      modalTitle.textContent = item.product_title;
      modalVariant.textContent = item.variant_title && item.variant_title !== 'Default Title' ? item.variant_title : '';
      modalPrice.textContent = formatMoney(item.final_price);
      modalLink.href = item.url;
      modalImage.hidden = !item.image;
      if (item.image) {
        modalImage.src = item.image;
        modalImage.alt = item.product_title;
      }
      const description = document.createElement('div');
      description.innerHTML = product?.description || '';
      modalDescription.textContent = description.textContent?.trim().slice(0, 260) || '';
      modal.hidden = false;
      modal.setAttribute('aria-hidden', 'false');
      modal.querySelector('[data-gk-modal-close]')?.focus();
    };

    root.addEventListener('click', (event) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('[data-gk-modal-close]')) {
        closeModal();
        return;
      }
      const productLink = event.target.closest('.gk-cart-image-link, .gk-cart-item-title');
      if (!productLink) return;
      if (configuration.product_click_behavior === 'redirect') return;
      event.preventDefault();
      if (configuration.product_click_behavior !== 'modal' || !cart) return;
      const row = productLink.closest('[data-gk-line]');
      const item = cart.items[Number(row?.dataset.gkLine) - 1];
      if (item) openProductModal(item);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.hidden) closeModal();
    });

    document.addEventListener('gokwik:cart:rendered', (event) => {
      if (event.detail?.root !== root) return;
      cart = event.detail.cart;
      updateStickyCart(cart);
      updateCheckoutState();
      applyQuantityRules(cart);
      renderVariantSelectors(cart);
    });
  };

  if (window.gokwikCart) initialize(window.gokwikCart);
  else document.addEventListener('gokwik:cart:ready', (event) => initialize(event.detail.api), {once: true});
})();
