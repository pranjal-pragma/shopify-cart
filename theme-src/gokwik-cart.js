(() => {
  const initialize = () => {
    const root = document.querySelector('[data-gokwik-cart-root]');
    if (!root || window.__gokwikCartLoaded) return;
    window.__gokwikCartLoaded = true;

    const drawer = root.querySelector('[data-gk-drawer]');
    const content = root.querySelector('[data-gk-content]');
    const loading = root.querySelector('[data-gk-loading]');
    const empty = root.querySelector('[data-gk-empty]');
    const items = root.querySelector('[data-gk-items]');
    const viewAllButton = root.querySelector('[data-gk-view-all]');
    const footer = root.querySelector('[data-gk-footer]');
    const total = root.querySelector('[data-gk-total]');
    const notice = root.querySelector('[data-gk-notice]');
    const checkoutLabel = root.querySelector('[data-gk-checkout-label]');
    const footerMessage = root.querySelector('[data-gk-footer-message]');
    const closeButton = root.querySelector('.gk-cart-icon-button');
    const continueButton = root.querySelector('[data-gk-continue]');
    const nativeFetch = window.fetch.bind(window);
    const routesRoot = window.Shopify?.routes?.root || '/';
    const cartUrl = root.dataset.cartUrl || `${routesRoot}cart`;
    const cartChangeUrl = root.dataset.cartChangeUrl || `${routesRoot}cart/change`;
    const cartJsonUrl = `${cartUrl.replace(/\/$/, '')}.js`;
    const currency = root.dataset.currency || window.Shopify?.currency?.active || 'USD';
    let appearance = {};
    try {
      appearance = JSON.parse(root.dataset.appearance || '{}') || {};
    } catch (error) {
      console.error('[GoKwik Cart] Unable to read published appearance', error);
    }
    const country = root.dataset.country || window.Shopify?.country || '';
    if (appearance.disable_on_non_indian_store && country && country !== 'IN') {
      root.remove();
      return;
    }

    let cart = null;
    let previousFocus = null;
    let requestSequence = 0;
    let productsExpanded = false;
    const compactProductLimit = 3;

    if (appearance.font_source === 'gokwik') root.classList.add('gk-cart-root--app-font');

    const applyRichText = (element, value) => {
      if (!element || !value) return;
      element.textContent = value.text || '';
      element.style.fontSize = `${value.font_size || 14}px`;
      element.style.fontWeight = value.bold ? '700' : '400';
      element.style.fontStyle = value.italic ? 'italic' : 'normal';
      element.style.textDecoration = value.underline ? 'underline' : 'none';
    };

    applyRichText(checkoutLabel, appearance.checkout_text);
    if (appearance.checkout_alignment) {
      root.querySelector('.gk-cart-checkout-button').style.textAlign = appearance.checkout_alignment;
    }
    if (appearance.footer_enabled && appearance.footer_text?.text) {
      footerMessage.hidden = false;
      footerMessage.style.textAlign = appearance.footer_alignment || 'left';
      applyRichText(footerMessage, appearance.footer_text);
    }

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

    const setNotice = (message = '', isError = false) => {
      notice.textContent = message;
      notice.classList.toggle('gk-cart-notice--error', isError);
      notice.hidden = !message;
    };

    const setLoading = (isLoading) => {
      loading.hidden = !isLoading;
      content.setAttribute('aria-busy', String(isLoading));
    };

    const updateThemeCounts = (itemCount) => {
      document.querySelectorAll('[data-cart-count], .cart-count-bubble span[aria-hidden="true"]').forEach((element) => {
        element.textContent = String(itemCount);
      });
    };

    const createButton = (label, action, line, text) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gk-cart-quantity-button';
      button.dataset.gkAction = action;
      button.dataset.line = String(line);
      button.setAttribute('aria-label', label);
      button.textContent = text;
      return button;
    };

    const createPropertyList = (properties) => {
      if (appearance.show_item_properties === false) return null;
      const visibleProperties = Object.entries(properties || {}).filter(
        ([key, value]) => !key.startsWith('_') && value !== null && value !== '',
      );
      if (!visibleProperties.length) return null;

      const list = document.createElement('dl');
      list.className = 'gk-cart-properties';
      visibleProperties.forEach(([key, value]) => {
        const term = document.createElement('dt');
        const description = document.createElement('dd');
        term.textContent = key;
        description.textContent = String(value);
        list.append(term, description);
      });
      return list;
    };

    const isFreeGift = (item) => {
      const marker = item.properties?._gokwik_free_gift;
      const marked = marker === true || ['true', '1', 'yes'].includes(String(marker).toLowerCase());
      const fullyDiscounted = Number(item.final_line_price) === 0;
      return marked || fullyDiscounted;
    };

    const isOneTickItem = (item) => {
      const marker = item.properties?._gokwik_one_tick;
      return marker === true || ['true', '1', 'yes'].includes(String(marker).toLowerCase());
    };

    const createCartItem = (item, line, freeGift) => {
      const row = document.createElement('li');
      row.className = 'gk-cart-item';
      row.dataset.gkLine = String(line);
      row.classList.toggle('gk-cart-item--gift', freeGift);

    const imageLink = document.createElement('a');
    imageLink.className = 'gk-cart-image-link';
    imageLink.href = item.url;
    const imageUrl = item.featured_image?.url || item.image;
    if (imageUrl) {
      const image = document.createElement('img');
      image.className = 'gk-cart-image';
      image.src = imageUrl;
      image.alt = item.featured_image?.alt || item.product_title;
      image.width = 88;
      image.height = 106;
      image.loading = 'lazy';
      imageLink.append(image);
    } else {
      const placeholder = document.createElement('span');
      placeholder.className = 'gk-cart-image-placeholder';
      placeholder.setAttribute('aria-hidden', 'true');
      imageLink.append(placeholder);
    }

      const details = document.createElement('div');
      details.className = 'gk-cart-item-details';
      const titleLink = document.createElement('a');
      titleLink.className = 'gk-cart-item-title';
      titleLink.href = item.url;
      titleLink.textContent = item.product_title;
      if (freeGift) {
        const giftLabel = document.createElement('span');
        giftLabel.className = 'gk-cart-gift-label';
        giftLabel.textContent = 'Free gift';
        details.append(giftLabel);
      }
      details.append(titleLink);

      if (appearance.show_variant_names !== false && item.variant_title && item.variant_title !== 'Default Title') {
        const variant = document.createElement('p');
        variant.className = 'gk-cart-variant';
        variant.textContent = item.variant_title;
        details.append(variant);
      }

      const propertyList = createPropertyList(item.properties);
      if (propertyList) details.append(propertyList);

      const controls = document.createElement('div');
      controls.className = 'gk-cart-item-controls';
      const quantity = document.createElement('div');
      quantity.className = 'gk-cart-quantity';
      quantity.setAttribute('aria-label', `Quantity for ${item.product_title}`);
      const decrease = createButton(`Decrease ${item.product_title} quantity`, 'decrease', line, '\u2212');
      const increase = createButton(`Increase ${item.product_title} quantity`, 'increase', line, '+');
      const lockFreeGift = freeGift && appearance.allow_free_item_quantity_changes !== true;
      const lockOneTick = isOneTickItem(item) && appearance.one_tick_disable_quantity_changes === true;
      if (lockFreeGift || lockOneTick) {
        [decrease, increase].forEach((button) => {
          button.disabled = true;
          button.title = lockFreeGift ? 'Quantity is fixed for free items' : 'Quantity is fixed for this add-on';
        });
      }
      quantity.append(decrease);
      const quantityValue = document.createElement('span');
      quantityValue.className = 'gk-cart-quantity-value';
      quantityValue.textContent = String(item.quantity);
      quantityValue.setAttribute('aria-live', 'polite');
      quantity.append(quantityValue, increase);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'gk-cart-remove';
      remove.dataset.gkAction = 'remove';
      remove.dataset.line = String(line);
      remove.setAttribute('aria-label', `Remove ${item.product_title} from cart`);
      remove.title = 'Remove item';
      const removeIcon = document.createElement('span');
      removeIcon.className = 'gk-cart-remove-icon';
      removeIcon.setAttribute('aria-hidden', 'true');
      remove.append(removeIcon);

      const priceWrap = document.createElement('span');
      priceWrap.className = 'gk-cart-line-prices';
      const price = document.createElement('strong');
      price.className = 'gk-cart-line-price';
      price.textContent = formatMoney(item.final_line_price);
      priceWrap.append(price);
      controls.append(quantity, remove, priceWrap);
      details.append(controls);
      row.append(imageLink, details);
      return row;
    };

    const renderCart = (nextCart) => {
      cart = nextCart;
      if (nextCart.items.length <= compactProductLimit) productsExpanded = false;
      const compact = appearance.display_all_products !== true && nextCart.items.length > compactProductLimit;
      const indexedItems = nextCart.items.map((item, index) => ({
        item,
        line: index + 1,
        freeGift: isFreeGift(item),
      }));
      if (appearance.show_free_gift_first) {
        indexedItems.sort((left, right) => Number(right.freeGift) - Number(left.freeGift));
      }
      const visibleItems = compact && !productsExpanded
        ? indexedItems.slice(0, compactProductLimit)
        : indexedItems;
      items.replaceChildren(...visibleItems.map(({item, line, freeGift}) => createCartItem(item, line, freeGift)));
      viewAllButton.hidden = !compact;
      viewAllButton.setAttribute('aria-expanded', String(productsExpanded));
      const hiddenItemCount = nextCart.items.length - compactProductLimit;
      viewAllButton.textContent = productsExpanded
        ? 'Show fewer items'
        : `View ${hiddenItemCount} more ${hiddenItemCount === 1 ? 'item' : 'items'}`;
      empty.hidden = nextCart.item_count > 0;
      items.hidden = nextCart.item_count === 0;
      footer.hidden = nextCart.item_count === 0;
      total.textContent = formatMoney(nextCart.total_price);
      updateThemeCounts(nextCart.item_count);
      document.dispatchEvent(new CustomEvent('gokwik:cart:rendered', {
        detail: {cart: nextCart, root},
      }));
    };

    const loadCart = async ({announce = false} = {}) => {
      const sequence = ++requestSequence;
      setLoading(true);
      try {
        const response = await nativeFetch(cartJsonUrl, {
          headers: {'Accept': 'application/json'},
          credentials: 'same-origin',
        });
        if (!response.ok) throw new Error(`Cart request failed (${response.status})`);
        const nextCart = await response.json();
        if (sequence !== requestSequence) return;
        renderCart(nextCart);
        setNotice(announce ? 'Cart updated.' : '');
      } catch (error) {
        if (sequence !== requestSequence) return;
        setNotice('We could not update your cart. Please try again.', true);
        console.error('[GoKwik Cart] Unable to load cart', error);
      } finally {
        if (sequence === requestSequence) setLoading(false);
      }
    };

    const openCart = () => {
      previousFocus = document.activeElement;
      root.classList.add('gk-cart-root--open');
      drawer.setAttribute('aria-hidden', 'false');
      document.body.classList.add('gk-cart-page-locked');
      loadCart();
      requestAnimationFrame(() => closeButton.focus());
      document.dispatchEvent(new CustomEvent('gokwik:cart:opened'));
    };

    const closeCart = () => {
      root.classList.remove('gk-cart-root--open');
      drawer.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('gk-cart-page-locked');
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
      document.dispatchEvent(new CustomEvent('gokwik:cart:closed'));
    };

    const changeLine = async (line, quantity) => {
      setNotice('Updating cart...');
      root.classList.add('gk-cart-root--updating');
      try {
        const response = await nativeFetch(`${cartChangeUrl}.js`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
          credentials: 'same-origin',
          body: JSON.stringify({line, quantity}),
        });
        if (!response.ok) throw new Error(`Cart update failed (${response.status})`);
        renderCart(await response.json());
        setNotice(quantity === 0 ? 'Item removed.' : 'Cart updated.');
      } catch (error) {
        setNotice('That change could not be saved. Please try again.', true);
        console.error('[GoKwik Cart] Unable to change cart line', error);
      } finally {
        root.classList.remove('gk-cart-root--updating');
      }
    };

    root.addEventListener('click', (event) => {
      if (!(event.target instanceof Element)) return;
      const closeTarget = event.target.closest('[data-gk-close]');
      if (closeTarget) {
        closeCart();
        return;
      }

      const viewAllTarget = event.target.closest('[data-gk-view-all]');
      if (viewAllTarget && cart) {
        productsExpanded = !productsExpanded;
        renderCart(cart);
        return;
      }

      const actionTarget = event.target.closest('[data-gk-action]');
      if (!actionTarget || !cart) return;
      const line = Number(actionTarget.dataset.line);
      const currentItem = cart.items[line - 1];
      if (!currentItem) return;
      const action = actionTarget.dataset.gkAction;
      if (
        action !== 'remove'
        && (
          (isFreeGift(currentItem) && appearance.allow_free_item_quantity_changes !== true)
          || (isOneTickItem(currentItem) && appearance.one_tick_disable_quantity_changes === true)
        )
      ) return;
      const quantity = action === 'remove' ? 0 : currentItem.quantity + (action === 'increase' ? 1 : -1);
      changeLine(line, Math.max(0, quantity));
    });

    document.addEventListener('keydown', (event) => {
      if (!root.classList.contains('gk-cart-root--open')) return;
      if (event.key === 'Escape') {
        closeCart();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        drawer.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      ).filter((element) => !element.hidden && element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    const gokwikCartApi = Object.freeze({
      root,
      configuration: Object.freeze({...appearance}),
      open: openCart,
      close: closeCart,
      refresh: () => loadCart({announce: true}),
      sync: () => loadCart(),
      getCart: () => cart,
      on: (eventName, listener) => {
        document.addEventListener(eventName, listener);
        return () => document.removeEventListener(eventName, listener);
      },
    });
    Object.defineProperty(window, 'gokwikCart', {
      configurable: true,
      value: gokwikCartApi,
    });
    document.dispatchEvent(new CustomEvent('gokwik:cart:ready', {detail: {api: gokwikCartApi}}));

    continueButton.addEventListener('click', closeCart);
    window.addEventListener('pageshow', () => loadCart());
    loadCart();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, {once: true});
  } else {
    initialize();
  }
})();
