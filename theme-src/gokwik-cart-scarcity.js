(() => {
  const initialize = (api) => {
    if (!api?.root || window.__gokwikCartScarcityLoaded) return;
    window.__gokwikCartScarcityLoaded = true;

    const {root, configuration} = api;
    const scarcity = root.querySelector('[data-gk-scarcity]');
    const titleElement = root.querySelector('[data-gk-scarcity-title]');
    const timeElement = root.querySelector('[data-gk-scarcity-time]');
    const duration = Math.max(1000, (
      (configuration.scarcity_timer_days || 0) * 86_400
      + (configuration.scarcity_timer_hours || 0) * 3_600
      + (configuration.scarcity_timer_minutes ?? 10) * 60
      + (configuration.scarcity_timer_seconds || 0)
    ) * 1000);
    const startedAt = Date.parse(configuration.scarcity_timer_started_at || '') || Date.now();
    const signature = JSON.stringify([
      configuration.scarcity_timer_type || 'urgency',
      duration,
      configuration.scarcity_timer_started_at || '',
    ]);
    let interval = null;
    let fallbackExpiry = null;

    const readExpiry = () => {
      try {
        if (sessionStorage.getItem('gokwik-cart-scarcity-signature') !== signature) return null;
        return Number(sessionStorage.getItem('gokwik-cart-scarcity-expires')) || null;
      } catch {
        return fallbackExpiry;
      }
    };

    const writeExpiry = (value) => {
      fallbackExpiry = value;
      try {
        if (value) {
          sessionStorage.setItem('gokwik-cart-scarcity-expires', String(value));
          sessionStorage.setItem('gokwik-cart-scarcity-signature', signature);
        } else {
          sessionStorage.removeItem('gokwik-cart-scarcity-expires');
          sessionStorage.removeItem('gokwik-cart-scarcity-signature');
        }
      } catch {
        // Session storage can be unavailable in privacy modes.
      }
    };

    const nextSalesExpiry = () => {
      if (configuration.scarcity_timer_expiry_action === 'remove') return startedAt + duration;
      const elapsed = Math.max(0, Date.now() - startedAt);
      return startedAt + (Math.floor(elapsed / duration) + 1) * duration;
    };

    const formatTime = (remaining) => {
      const totalSeconds = Math.max(0, Math.ceil(remaining / 1000));
      const showDays = configuration.scarcity_show_days === true;
      const showHours = configuration.scarcity_show_hours === true;
      const showMinutes = configuration.scarcity_show_minutes !== false;
      const showSeconds = configuration.scarcity_show_seconds !== false;
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
      if (scarcity.hidden) {
        if (cart.item_count === 0 && configuration.scarcity_timer_type !== 'sales') writeExpiry(null);
        return;
      }

      applyStyle();
      let expiresAt = configuration.scarcity_timer_type === 'sales' ? nextSalesExpiry() : readExpiry();
      if (!expiresAt) {
        expiresAt = Date.now() + duration;
        writeExpiry(expiresAt);
      }
      const render = () => {
        const remaining = Math.max(0, expiresAt - Date.now());
        timeElement.textContent = formatTime(remaining);
        if (remaining > 0) return;
        if (configuration.scarcity_timer_expiry_action === 'restart') {
          expiresAt = configuration.scarcity_timer_type === 'sales'
            ? nextSalesExpiry()
            : Date.now() + duration;
          if (configuration.scarcity_timer_type !== 'sales') writeExpiry(expiresAt);
          timeElement.textContent = formatTime(expiresAt - Date.now());
          return;
        }
        scarcity.hidden = true;
        window.clearInterval(interval);
      };
      render();
      interval = window.setInterval(render, 1000);
    };

    document.addEventListener('gokwik:cart:rendered', (event) => {
      if (event.detail?.root === root) update(event.detail.cart);
    });
  };

  if (window.gokwikCart) initialize(window.gokwikCart);
  else document.addEventListener('gokwik:cart:ready', (event) => initialize(event.detail.api), {once: true});
})();
