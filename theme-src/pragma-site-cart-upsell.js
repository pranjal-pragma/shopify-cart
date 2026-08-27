(() => {
  const initialize = (api) => {
    if (!api?.root || window.__pragmaSiteCartUpsellLoaded) return;
    window.__pragmaSiteCartUpsellLoaded = true;
    const {root, configuration} = api;
    const drawer = root.querySelector('[data-psc-drawer]');
    const footer = root.querySelector('[data-psc-footer]');
    const notice = root.querySelector('[data-psc-notice]');
    const host = document.createElement('section');
    host.className = 'psc-cart-upsell';
    host.hidden = true;
    drawer.insertBefore(host, root.querySelector('.psc-cart-features') || footer);
    const nativeFetch = window.fetch.bind(window);
    const routesRoot = window.Shopify?.routes?.root || '/';
    const currency = root.dataset.currency || window.Shopify?.currency?.active || 'USD';
    const productCache = new Map();
    let renderSequence = 0;

    const numericId = (gid) => Number(String(gid || '').split('/').pop());
    const gid = (type, id) => `gid://shopify/${type}/${id}`;
    const formatMoney = (cents) => new Intl.NumberFormat(undefined, {style: 'currency', currency}).format(Number(cents || 0) / 100);
    const styleTitle = (element, style) => {
      element.textContent = style?.text || 'Recommended for you';
      element.style.fontSize = `${style?.font_size || 16}px`;
      element.style.fontWeight = style?.bold ? '700' : '600';
      element.style.fontStyle = style?.italic ? 'italic' : '';
      element.style.textDecoration = style?.underline ? 'underline' : '';
    };
    const showNotice = (message, error = false) => {
      notice.textContent = message;
      notice.hidden = !message;
      notice.classList.toggle('psc-cart-notice--error', error);
    };
    const productJson = async (handle) => {
      if (!handle) return null;
      if (!productCache.has(handle)) {
        productCache.set(handle, nativeFetch(`${routesRoot}products/${encodeURIComponent(handle)}.js`, {headers: {Accept: 'application/json'}}).then((response) => response.ok ? response.json() : null).catch(() => null));
      }
      return productCache.get(handle);
    };
    const normalizeProduct = (product) => {
      const variant = product.variants?.find((item) => item.available) || product.variants?.[0];
      if (!variant) return null;
      return {product_id: gid('Product', product.id), product_title: product.title, product_handle: product.handle, image_url: product.featured_image || product.images?.[0] || '', variant_id: gid('ProductVariant', variant.id), variant_title: variant.title, price_cents: Number(variant.price || product.price || 0), variants: product.variants || [], description: product.description || ''};
    };
    const aiRecommendations = async (cart) => {
      if (!configuration.upsell_ai_enabled) return [];
      const count = Math.min(10, Math.max(1, Number(configuration.upsell_ai_product_count || 6)));
      const productIds = [...new Set(cart.items.filter((item) => !item.properties?._pragma_site_cart_upsell).map((item) => item.product_id))];
      const results = await Promise.all(productIds.slice(0, 3).map(async (productId) => {
        const url = `${routesRoot}recommendations/products.json?product_id=${productId}&limit=${count}&intent=${configuration.upsell_ai_preference || 'complementary'}`;
        const response = await nativeFetch(url, {headers: {Accept: 'application/json'}});
        if (!response.ok) return [];
        const body = await response.json();
        return (body.products || []).map(normalizeProduct).filter(Boolean);
      }));
      const inCart = new Set(cart.items.map((item) => String(item.product_id)));
      return [...new Map(results.flat().filter((item) => !inCart.has(String(numericId(item.product_id)))).map((item) => [item.product_id, item])).values()].slice(0, count);
    };
    const matchingRule = (cart) => (configuration.upsell_rules || []).find((rule) => {
      if (rule.applicable_on === 'all') return true;
      const cartProducts = new Set(cart.items.map((item) => gid('Product', item.product_id)));
      const targets = rule.applicable_on === 'collections' && rule.trigger_product_ids?.length ? rule.trigger_product_ids : rule.trigger_ids;
      return targets.some((id) => cartProducts.has(id));
    });
    const ruleProducts = async (rule) => {
      if (!rule) return [];
      const products = await Promise.all(rule.recommendations.slice(0, rule.product_count).map(async (item) => {
        const product = await productJson(item.product_handle);
        const normalized = product ? normalizeProduct(product) : null;
        return normalized ? {...normalized, variant_id: item.variant_id, variant_title: item.variant_title, image_url: item.image_url || normalized.image_url} : {...item, price_cents: Math.round(Number(item.price || 0) * 100), variants: [{id: numericId(item.variant_id), title: item.variant_title, available: true, price: Math.round(Number(item.price || 0) * 100)}], description: ''};
      }));
      return products.filter(Boolean);
    };
    const addVariant = async (variantId, cart) => {
      if (configuration.upsell_cap_quantity) {
        const quantity = cart.items.filter((item) => item.variant_id === Number(variantId)).reduce((total, item) => total + item.quantity, 0);
        if (quantity >= Number(configuration.upsell_max_quantity || 1)) {
          showNotice(`Maximum upsell quantity is ${configuration.upsell_max_quantity || 1}.`, true);
          return;
        }
      }
      const response = await nativeFetch(`${root.dataset.cartAddUrl || `${routesRoot}cart/add`}.js`, {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json', Accept: 'application/json'}, body: JSON.stringify({items: [{id: Number(variantId), quantity: 1, properties: {_pragma_site_cart_upsell: 'true'}}]})});
      if (!response.ok) throw new Error('Could not add this recommendation.');
      showNotice('Recommendation added to your cart.');
      await api.refresh();
    };
    const openProduct = (item, cart, variantOnly) => {
      const dialog = document.createElement('div');
      dialog.className = 'psc-cart-upsell-dialog';
      dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
      const panel = document.createElement('div'); panel.className = 'psc-cart-upsell-dialog__panel';
      const close = document.createElement('button'); close.type = 'button'; close.className = 'psc-cart-upsell-dialog__close'; close.setAttribute('aria-label', 'Close'); close.textContent = '\u00d7';
      const title = document.createElement('h3'); title.textContent = variantOnly ? 'Choose an option' : item.product_title;
      const select = document.createElement('select'); select.setAttribute('aria-label', 'Product variant');
      item.variants.filter((variant) => variant.available).forEach((variant) => {const option = document.createElement('option'); option.value = variant.id; option.textContent = `${variant.title}${variant.price != null ? ` - ${formatMoney(variant.price)}` : ''}`; select.append(option);});
      const description = document.createElement('p'); description.innerHTML = variantOnly ? '' : item.description;
      const add = document.createElement('button'); add.type = 'button'; add.className = 'psc-cart-upsell-add'; add.textContent = 'Add to cart';
      const dismiss = () => dialog.remove(); close.addEventListener('click', dismiss); dialog.addEventListener('click', (event) => {if (event.target === dialog) dismiss();});
      add.addEventListener('click', async () => {add.disabled = true; try {await addVariant(select.value, cart); dismiss();} catch (error) {showNotice(error.message, true); add.disabled = false;}});
      panel.append(close, title, description, select, add); dialog.append(panel); root.append(dialog); close.focus();
    };
    const render = async (cart) => {
      const sequence = ++renderSequence;
      host.hidden = true; host.replaceChildren();
      if (!configuration.upsell_enabled || !cart?.item_count) return;
      let items = [];
      let rule = null;
      try { items = await aiRecommendations(cart); } catch (error) { console.warn('[pragma-site-cart] AI upsell unavailable', error); }
      if (!items.length && (!configuration.upsell_ai_enabled || configuration.upsell_rule_fallback_enabled)) {rule = matchingRule(cart); items = await ruleProducts(rule);}
      if (sequence !== renderSequence || !items.length) return;
      const title = document.createElement('h3');
      styleTitle(title, rule?.title || configuration.upsell_ai_title);
      host.style.background = rule?.background_color || configuration.upsell_ai_background_color || '#FFFFFF';
      host.style.color = rule?.text_color || configuration.upsell_ai_text_color || '#202124';
      const list = document.createElement('div'); list.className = 'psc-cart-upsell-list';
      items.forEach((item) => {
        const card = document.createElement('article'); card.className = 'psc-cart-upsell-card';
        if (item.image_url) {const image = document.createElement('img'); image.src = item.image_url; image.alt = ''; image.loading = 'lazy'; card.append(image);}
        const name = document.createElement('strong'); name.textContent = item.product_title;
        const price = document.createElement('span'); price.textContent = formatMoney(item.price_cents);
        const add = document.createElement('button'); add.type = 'button'; add.className = 'psc-cart-upsell-add'; add.textContent = '+ Add';
        add.addEventListener('click', async () => {
          if (configuration.upsell_variant_behavior === 'product_popup' || item.variants.filter((variant) => variant.available).length > 1) {openProduct(item, cart, configuration.upsell_variant_behavior === 'variant_popup'); return;}
          add.disabled = true; try {await addVariant(numericId(item.variant_id), cart);} catch (error) {showNotice(error.message, true); add.disabled = false;}
        });
        card.append(name, price, add); list.append(card);
      });
      host.append(title, list); host.hidden = false;
    };
    document.addEventListener('pragma-site-cart:cart:rendered', (event) => {if (event.detail?.root === root) render(event.detail.cart);});
    if (api.getCart()) render(api.getCart());
  };
  if (window.pragmaSiteCart) initialize(window.pragmaSiteCart);
  else document.addEventListener('pragma-site-cart:cart:ready', (event) => initialize(event.detail.api), {once: true});
})();
