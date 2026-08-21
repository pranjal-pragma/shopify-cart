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
    const footer = root.querySelector('[data-gk-footer]');
    const total = root.querySelector('[data-gk-total]');
    const notice = root.querySelector('[data-gk-notice]');
    const closeButton = root.querySelector('.gk-cart-icon-button');
    const continueButton = root.querySelector('[data-gk-continue]');
    const nativeFetch = window.fetch.bind(window);
    const routesRoot = window.Shopify?.routes?.root || '/';
    const cartUrl = root.dataset.cartUrl || `${routesRoot}cart`;
    const cartAddUrl = root.dataset.cartAddUrl || `${routesRoot}cart/add`;
    const cartChangeUrl = root.dataset.cartChangeUrl || `${routesRoot}cart/change`;
    const cartJsonUrl = `${cartUrl.replace(/\/$/, '')}.js`;
    const openOnAdd = root.dataset.openOnAdd === 'true';
    const currency = root.dataset.currency || window.Shopify?.currency?.active || 'USD';

    let cart = null;
    let previousFocus = null;
    let requestSequence = 0;
    let submitTimer = null;

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

    const createCartItem = (item, index) => {
      const line = index + 1;
      const row = document.createElement('li');
      row.className = 'gk-cart-item';

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
      details.append(titleLink);

      if (item.variant_title && item.variant_title !== 'Default Title') {
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
      quantity.append(
        createButton(`Decrease ${item.product_title} quantity`, 'decrease', line, '\u2212'),
      );
      const quantityValue = document.createElement('span');
      quantityValue.className = 'gk-cart-quantity-value';
      quantityValue.textContent = String(item.quantity);
      quantityValue.setAttribute('aria-live', 'polite');
      quantity.append(quantityValue, createButton(`Increase ${item.product_title} quantity`, 'increase', line, '+'));

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'gk-cart-remove';
      remove.dataset.gkAction = 'remove';
      remove.dataset.line = String(line);
      remove.textContent = 'Remove';

      const price = document.createElement('strong');
      price.className = 'gk-cart-line-price';
      price.textContent = formatMoney(item.final_line_price);
      controls.append(quantity, remove, price);
      details.append(controls);
      row.append(imageLink, details);
      return row;
    };

    const renderCart = (nextCart) => {
      cart = nextCart;
      items.replaceChildren(...nextCart.items.map(createCartItem));
      empty.hidden = nextCart.item_count > 0;
      items.hidden = nextCart.item_count === 0;
      footer.hidden = nextCart.item_count === 0;
      total.textContent = formatMoney(nextCart.total_price);
      updateThemeCounts(nextCart.item_count);
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

    const isCartPath = (value, expectedPath) => {
      try {
        const normalizePath = (path) => path.replace(/\.(js|json)$/, '').replace(/\/$/, '');
        return normalizePath(new URL(value, window.location.origin).pathname) === normalizePath(expectedPath);
      } catch {
        return false;
      }
    };

    const announceAddToCart = (source) => {
      if (source === 'fetch') clearTimeout(submitTimer);
      document.dispatchEvent(new CustomEvent('KwikCartAtcButtonClicked', {detail: {source}}));
      if (openOnAdd) openCart();
      else loadCart();
    };

    root.addEventListener('click', (event) => {
      if (!(event.target instanceof Element)) return;
      const closeTarget = event.target.closest('[data-gk-close]');
      if (closeTarget) {
        closeCart();
        return;
      }

      const actionTarget = event.target.closest('[data-gk-action]');
      if (!actionTarget || !cart) return;
      const line = Number(actionTarget.dataset.line);
      const currentItem = cart.items[line - 1];
      if (!currentItem) return;
      const action = actionTarget.dataset.gkAction;
      const quantity = action === 'remove' ? 0 : currentItem.quantity + (action === 'increase' ? 1 : -1);
      changeLine(line, Math.max(0, quantity));
    });

    document.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;
      const target = event.target.closest('a[href], [data-cart-icon-bubble], #cart-icon-bubble');
      if (!target || root.contains(target)) return;
      const href = target.getAttribute('href');
      if (href && !isCartPath(href, cartUrl)) return;
      if (!href && !target.matches('[data-cart-icon-bubble], #cart-icon-bubble')) return;
      event.preventDefault();
      openCart();
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

    document.addEventListener('submit', (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !isCartPath(form.action, cartAddUrl)) return;
      clearTimeout(submitTimer);
      submitTimer = setTimeout(() => announceAddToCart('form'), 450);
    });

    window.fetch = async (...args) => {
      const request = args[0];
      const url = typeof request === 'string' || request instanceof URL ? String(request) : request.url;
      const response = await nativeFetch(...args);
      if (response.ok && isCartPath(url, cartAddUrl)) announceAddToCart('fetch');
      return response;
    };

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
