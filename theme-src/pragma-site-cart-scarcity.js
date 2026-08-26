(() => {
  const initialize = (api) => {
    if (!api?.root || window.__pragmaSiteCartScarcityLoaded) return;
    window.__pragmaSiteCartScarcityLoaded = true;

    const {root, configuration} = api;
    const scarcity = root.querySelector('[data-psc-scarcity]');
    const titleElement = root.querySelector('[data-psc-scarcity-title]');
    const timeElement = root.querySelector('[data-psc-scarcity-time]');
    const duration = Math.max(1000, (
      (configuration.scarcity_timer_days || 0) * 86_400
      + (configuration.scarcity_timer_hours || 0) * 3_600
      + (configuration.scarcity_timer_minutes ?? 10) * 60
      + (configuration.scarcity_timer_seconds || 0)
    ) * 1000);
    const legacySaleStart = Date.parse(configuration.scarcity_timer_started_at || '');
    const configuredSaleStart = Date.parse(configuration.scarcity_sale_starts_at || '');
    const configuredSaleEnd = Date.parse(configuration.scarcity_sale_ends_at || '');
    const saleStartsAt = Number.isFinite(configuredSaleStart) ? configuredSaleStart : legacySaleStart;
    const saleEndsAt = Number.isFinite(configuredSaleEnd) ? configuredSaleEnd : legacySaleStart + duration;
    const signature = JSON.stringify([
      configuration.scarcity_timer_type || 'urgency',
      duration,
      configuration.scarcity_sale_starts_at || '',
      configuration.scarcity_sale_ends_at || '',
    ]);
    let interval = null;
    let fallbackExpiry = null;

    const readExpiry = () => {
      try {
        if (sessionStorage.getItem('pragma-site-cart-scarcity-signature') !== signature) return null;
        return Number(sessionStorage.getItem('pragma-site-cart-scarcity-expires')) || null;
      } catch {
        return fallbackExpiry;
      }
    };

    const writeExpiry = (value) => {
      fallbackExpiry = value;
      try {
        if (value) {
          sessionStorage.setItem('pragma-site-cart-scarcity-expires', String(value));
          sessionStorage.setItem('pragma-site-cart-scarcity-signature', signature);
        } else {
          sessionStorage.removeItem('pragma-site-cart-scarcity-expires');
          sessionStorage.removeItem('pragma-site-cart-scarcity-signature');
        }
      } catch {
        // Session storage can be unavailable in privacy modes.
      }
    };

    const formatTime = (remaining) => {
      const totalSeconds = Math.max(0, Math.ceil(remaining / 1000));
      const isSales = configuration.scarcity_timer_type === 'sales';
      const showDays = isSales ? totalSeconds >= 86_400 : configuration.scarcity_show_days === true;
      const showHours = isSales ? showDays || totalSeconds >= 3_600 : configuration.scarcity_show_hours === true;
      const showMinutes = isSales || configuration.scarcity_show_minutes !== false;
      const showSeconds = isSales || configuration.scarcity_show_seconds !== false;
      const days = Math.floor(totalSeconds / 86_400);
      const hours = Math.floor((showDays ? totalSeconds % 86_400 : totalSeconds) / 3_600);
      const minutes = Math.floor((showDays || showHours ? totalSeconds % 3_600 : totalSeconds) / 60);
      const seconds = totalSeconds % 60;
      return [
        showDays && `${String(days).padStart(2, '0')}d`,
        showHours && `${String(hours).padStart(2, '0')}h`,
        showMinutes && `${String(minutes).padStart(2, '0')}m`,
        showSeconds && `${String(seconds).padStart(2, '0')}s`,
      ].filter(Boolean).join(' ');
    };

    const applyStyle = () => {
      const title = configuration.scarcity_timer_title || {
        text: String(configuration.scarcity_timer_text || 'Your cart is reserved for').replace('{time}', '').trim(),
        bold: true,
        font_size: 12,
      };
      scarcity.style.backgroundColor = configuration.scarcity_timer_background || '#FFF7E8';
      scarcity.style.color = configuration.scarcity_timer_text_color || '#7B5312';
      titleElement.textContent = title.text;
      titleElement.style.fontSize = `${title.font_size || 12}px`;
      titleElement.style.fontWeight = title.bold ? '700' : '400';
      titleElement.style.fontStyle = title.italic ? 'italic' : 'normal';
      titleElement.style.textDecoration = title.underline ? 'underline' : 'none';
    };

    const update = (cart) => {
      window.clearInterval(interval);
      scarcity.hidden = !configuration.scarcity_timer_enabled || cart.item_count === 0;
      if (configuration.scarcity_timer_type === 'sales') {
        scarcity.hidden = scarcity.hidden
          || !Number.isFinite(saleStartsAt)
          || !Number.isFinite(saleEndsAt)
          || Date.now() < saleStartsAt
          || Date.now() >= saleEndsAt;
      }
      if (scarcity.hidden) {
        if (cart.item_count === 0 && configuration.scarcity_timer_type !== 'sales') writeExpiry(null);
        return;
      }

      applyStyle();
      let expiresAt = configuration.scarcity_timer_type === 'sales' ? saleEndsAt : readExpiry();
      if (!expiresAt) {
        expiresAt = Date.now() + duration;
        writeExpiry(expiresAt);
      }
      const render = () => {
        const remaining = Math.max(0, expiresAt - Date.now());
        timeElement.textContent = formatTime(remaining);
        if (remaining > 0) return;
        if (configuration.scarcity_timer_type !== 'sales' && configuration.scarcity_timer_expiry_action === 'restart') {
          expiresAt = Date.now() + duration;
          writeExpiry(expiresAt);
          timeElement.textContent = formatTime(expiresAt - Date.now());
          return;
        }
        scarcity.hidden = true;
        window.clearInterval(interval);
      };
      render();
      interval = window.setInterval(render, 1000);
    };

    document.addEventListener('pragma-site-cart:cart:rendered', (event) => {
      if (event.detail?.root === root) update(event.detail.cart);
    });
  };

  if (window.pragmaSiteCart) initialize(window.pragmaSiteCart);
  else document.addEventListener('pragma-site-cart:cart:ready', (event) => initialize(event.detail.api), {once: true});
})();
