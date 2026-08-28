import {
  BadgePercent,
  Gift,
  Sparkles,
  Truck,
  createElement as createLucideElement,
} from 'lucide';

import {rewardMetric} from './reward-metric.js';
import {isOneTickItem, oneTickSkuRuleState} from './one-tick-rules.js';
import {
  matchingSwapRule,
  shouldShowOneTickOffers,
  sizeGroupCandidates,
} from './product-swap-rules.js';

(() => {
  const initialize = (api) => {
    if (!api?.root || window.__pragmaSiteCartFeaturesLoaded) return;
    window.__pragmaSiteCartFeaturesLoaded = true;

    const {root, configuration} = api;
    const drawer = root.querySelector('[data-psc-drawer]');
    const footer = root.querySelector('[data-psc-footer]');
    const notice = root.querySelector('[data-psc-notice]');
    const routesRoot = window.Shopify?.routes?.root || '/';
    const cartAddUrl = root.dataset.cartAddUrl || `${routesRoot}cart/add`;
    const cartChangeUrl = root.dataset.cartChangeUrl || `${routesRoot}cart/change`;
    const cartUpdateUrl = `${routesRoot}cart/update`;
    const nativeFetch = window.fetch.bind(window);
    const host = document.createElement('section');
    host.className = 'psc-cart-features';
    host.hidden = true;
    drawer.insertBefore(host, footer);
    let noteTimer = null;
    const productCache = new Map();
    const celebratedRewards = new Set();
    const manualDiscountCodes = new Set();
    const rewardDiscountCodes = new Set();
    let rewardDiscountMutationRunning = false;
    let oneTickSyncRunning = false;

    const isTruthy = (value) => value === true || ['true', '1', 'yes'].includes(String(value).toLowerCase());
    const numericId = (gid) => Number(String(gid || '').split('/').pop());
    const showNotice = (message, error = false) => {
      notice.textContent = message;
      notice.hidden = !message;
      notice.classList.toggle('psc-cart-notice--error', error);
    };
    const checkout = root.querySelector('.psc-cart-checkout-button');
    const termsCheckbox = root.querySelector('[data-psc-terms-checkbox]');
    const checkoutHref = checkout?.dataset.pscCheckoutDestination
      || checkout?.getAttribute('href')
      || `${routesRoot}checkout`;
    const termsAreAccepted = () => configuration.terms_checkbox_enabled !== true || termsCheckbox?.checked === true;
    const updateTermsCheckoutGuard = () => {
      if (!checkout) return;
      const blocked = !termsAreAccepted();
      checkout.classList.toggle('psc-cart-checkout-button--disabled', blocked);
      checkout.setAttribute('aria-disabled', String(blocked));
      if (blocked) checkout.removeAttribute('href');
      else checkout.setAttribute('href', checkoutHref);
    };
    const blockCheckoutWithoutTerms = (event) => {
      if (termsAreAccepted()) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      showNotice('Accept the Terms & Conditions to continue.', true);
    };
    checkout?.addEventListener('click', blockCheckoutWithoutTerms, {capture: true});
    checkout?.addEventListener('keydown', (event) => {
      if (!['Enter', ' '].includes(event.key)) return;
      blockCheckoutWithoutTerms(event);
    }, {capture: true});
    termsCheckbox?.addEventListener('change', updateTermsCheckoutGuard);
    updateTermsCheckoutGuard();
    const button = (label, className = '') => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = className;
      element.textContent = label;
      return element;
    };
    const section = (className) => {
      const element = document.createElement('div');
      element.className = `psc-cart-feature ${className}`;
      return element;
    };
    const rewardIcon = (type) => {
      const definition = type === 'shipping'
        ? Truck
        : type === 'free_gift'
          ? Gift
          : type === 'discount'
            ? BadgePercent
            : Sparkles;
      const icon = createLucideElement(definition);
      icon.classList.add('psc-cart-reward-icon');
      icon.setAttribute('width', '15');
      icon.setAttribute('height', '15');
      icon.setAttribute('aria-hidden', 'true');
      return icon;
    };
    const addVariant = async (variantId, properties, quantity = 1) => {
      const response = await nativeFetch(`${cartAddUrl}.js`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
        credentials: 'same-origin',
        body: JSON.stringify({items: [{id: numericId(variantId), quantity, properties}]}),
      });
      if (!response.ok) throw new Error(`Cart add failed (${response.status})`);
    };
    const changeLine = async (item, line, quantity) => {
      const response = await nativeFetch(`${cartChangeUrl}.js`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
        credentials: 'same-origin',
        body: JSON.stringify({id: item.key || line, quantity}),
      });
      if (!response.ok) throw new Error(`Cart change failed (${response.status})`);
    };
    const removeLine = (item, line) => changeLine(item, line, 0);
    const discountCodes = (cart) => {
      const applications = [
        ...(cart.cart_level_discount_applications || []),
        ...(cart.items || []).flatMap((item) =>
          (item.line_level_discount_allocations || []).map(
            (allocation) => allocation.discount_application,
          ),
        ),
      ];
      return [...new Set(
        applications
          .filter((application) => application?.type === 'discount_code')
          .map((application) => String(application.title || '').trim())
          .filter(Boolean),
      )];
    };
    const updateDiscounts = async (discount) => {
      const response = await nativeFetch(`${cartUpdateUrl}.js`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
        credentials: 'same-origin',
        body: JSON.stringify({discount}),
      });
      if (!response.ok) throw new Error(`Cart discount failed (${response.status})`);
      return response.json();
    };
    const renderDiscounts = (cart) => {
      if (configuration.discount_mode === 'hide') return;
      const block = section('psc-cart-feature--discount');
      if (configuration.discount_mode === 'checkout_offers') {
        block.innerHTML = '<strong>Available offers</strong><span>Discounts configured in pragma-site-cart Checkout will be validated at checkout.</span>';
      } else {
        const form = document.createElement('form');
        const input = document.createElement('input');
        input.name = 'discount';
        input.placeholder = 'Enter coupon code';
        input.setAttribute('aria-label', 'Coupon code');
        const apply = button('Apply');
        apply.type = 'submit';
        form.append(input, apply);
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const code = input.value.trim();
          if (!code) return;
          apply.disabled = true;
          apply.textContent = 'Applying...';
          try {
            manualDiscountCodes.add(code);
            const updatedCart = await updateDiscounts(
              [...manualDiscountCodes, ...rewardDiscountCodes].join(','),
            );
            const appliedCodes = discountCodes(updatedCart);
            const invalid = !appliedCodes.some(
              (value) => value.toLowerCase() === code.toLowerCase(),
            );
            if (invalid) {
              manualDiscountCodes.delete(code);
            }
            await api.sync();
            showNotice(
              invalid ? `${code} is invalid or not eligible for this cart.` : `${code} applied.`,
              invalid,
            );
          } catch (error) {
            console.error('[pragma-site-cart] Unable to apply coupon', error);
            showNotice('The coupon could not be applied. Please try again.', true);
            apply.disabled = false;
            apply.textContent = 'Apply';
          }
        });
        block.append(form);
        const appliedCodes = discountCodes(cart);
        if (appliedCodes.length) {
          const applied = document.createElement('div');
          applied.className = 'psc-cart-discount-applied';
          const label = document.createElement('span');
          label.textContent = `${appliedCodes.join(', ')} applied`;
          const remove = button('Remove');
          remove.addEventListener('click', async () => {
            remove.disabled = true;
            remove.textContent = 'Removing...';
            try {
              manualDiscountCodes.clear();
              rewardDiscountCodes.clear();
              await updateDiscounts('');
              await api.sync();
              showNotice('Coupon removed.');
            } catch (error) {
              console.error('[pragma-site-cart] Unable to remove coupon', error);
              showNotice('The coupon could not be removed. Please try again.', true);
              remove.disabled = false;
              remove.textContent = 'Remove';
            }
          });
          applied.append(label, remove);
          block.append(applied);
        }
      }
      host.append(block);
    };

    const renderOrderNotes = (cart) => {
      if (!configuration.order_notes_enabled) return;
      const block = section('psc-cart-feature--notes');
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      const title = document.createElement('span');
      title.textContent = configuration.order_notes_title || 'Add special instructions';
      const savedNote = document.createElement('small');
      savedNote.className = 'psc-cart-order-note-value';
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
      const saveNote = async (closeAfterSave = false) => {
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
          if (closeAfterSave) details.open = false;
          showNotice('Order note saved.');
        } catch (error) {
          console.error('[pragma-site-cart] Unable to save order note', error);
          showNotice('Your order note could not be saved.', true);
        }
      };
      textarea.addEventListener('input', () => {
        window.clearTimeout(noteTimer);
        noteTimer = window.setTimeout(saveNote, 500);
      });
      textarea.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.shiftKey) return;
        event.preventDefault();
        window.clearTimeout(noteTimer);
        saveNote(true);
      });
      details.append(summary, textarea);
      block.append(details);
      host.append(block);
    };

    const celebrateReward = (reward) => {
      if (!configuration.tiered_confetti_enabled || celebratedRewards.has(reward.id)) return;
      celebratedRewards.add(reward.id);
      const confetti = document.createElement('div');
      confetti.className = 'psc-cart-confetti';
      confetti.setAttribute('aria-hidden', 'true');
      const colors = [
        configuration.tiered_primary_color || '#F10A0A',
        '#F2B84B',
        '#238457',
        '#2D6CDF',
        '#D94B82',
      ];
      for (let index = 0; index < 42; index += 1) {
        const piece = document.createElement('i');
        piece.style.setProperty('--psc-confetti-x', `${(index * 37) % 100}%`);
        piece.style.setProperty('--psc-confetti-delay', `${(index % 9) * 35}ms`);
        piece.style.setProperty('--psc-confetti-drift', `${-55 + (index * 29) % 110}px`);
        piece.style.setProperty('--psc-confetti-turn', `${180 + (index * 47) % 420}deg`);
        piece.style.backgroundColor = colors[index % colors.length];
        piece.classList.toggle('is-round', index % 4 === 0);
        confetti.append(piece);
      }
      drawer.append(confetti);
      window.setTimeout(() => confetti.remove(), 2100);
    };
    const reconcileRewardDiscounts = async (completed) => {
      if (rewardDiscountMutationRunning) return;
      const desired = new Set(
        completed
          .filter((reward) => ['shipping', 'discount'].includes(reward.reward_type))
          .map((reward) => String(reward.discount_code || '').trim())
          .filter(Boolean),
      );
      const changed = desired.size !== rewardDiscountCodes.size
        || [...desired].some((code) => !rewardDiscountCodes.has(code));
      if (!changed) return;
      rewardDiscountMutationRunning = true;
      rewardDiscountCodes.clear();
      desired.forEach((code) => rewardDiscountCodes.add(code));
      try {
        await updateDiscounts([...manualDiscountCodes, ...rewardDiscountCodes].join(','));
        await api.sync();
        if (desired.size) showNotice('Your unlocked cart reward was applied.');
      } catch (error) {
        console.error('[pragma-site-cart] Unable to apply tier reward discount', error);
        showNotice('Your cart reward could not be applied. Please try again.', true);
      } finally {
        rewardDiscountMutationRunning = false;
      }
    };
    const renderRewards = (cart) => {
      if (!configuration.tiered_rewards_enabled || !configuration.tiered_rewards?.length) return;
      const rewards = [...configuration.tiered_rewards].sort((left, right) => left.goal - right.goal);
      const metric = rewardMetric(cart, configuration);
      const next = rewards.find((reward) => metric < reward.goal);
      const completed = rewards.filter((reward) => metric >= reward.goal);
      const block = section('psc-cart-feature--rewards');
      const message = document.createElement('span');
      message.textContent = next ? next.before_text : configuration.tiered_completion_text;
      const track = document.createElement('i');
      track.style.backgroundColor = configuration.tiered_secondary_color || '#E5E7EB';
      const progress = document.createElement('b');
      const target = next?.goal || rewards.at(-1).goal;
      progress.style.backgroundColor = configuration.tiered_primary_color || '#F10A0A';
      progress.style.width = `${Math.min(100, metric / target * 100)}%`;
      track.append(progress);
      const milestones = document.createElement('div');
      milestones.className = 'psc-cart-reward-milestones';
      rewards.forEach((reward) => {
        const milestone = document.createElement('span');
        milestone.classList.toggle('is-unlocked', metric >= reward.goal);
        const copy = document.createElement('small');
        copy.textContent = `${reward.reward_text} · ${reward.goal}`;
        milestone.append(rewardIcon(reward.reward_type), copy);
        milestones.append(milestone);
      });
      block.append(message, track, milestones);
      host.append(block);
      if (completed.length) celebrateReward(completed.at(-1));
      void reconcileRewardDiscounts(completed);
    };

    const oneTickAction = ({existing, text, title, onAdd}) => {
      const block = section('psc-cart-feature--one-tick');
      const action = button('', 'psc-cart-one-tick');
      action.setAttribute('role', 'checkbox');
      action.setAttribute('aria-checked', String(Boolean(existing)));
      const check = document.createElement('i');
      const copy = document.createElement('span');
      copy.textContent = text || 'Add cart add-on';
      const product = document.createElement('small');
      product.textContent = title || 'Selected add-on';
      action.append(check, copy, product);
      action.addEventListener('click', async () => {
        action.disabled = true;
        try {
          if (existing) await removeLine(existing.item, existing.line);
          else await onAdd();
          await api.sync();
        } catch (error) {
          console.error('[pragma-site-cart] Unable to update one-tick add-on', error);
          showNotice('The add-on could not be updated.', true);
        } finally {
          action.disabled = false;
        }
      });
      block.append(action);
      host.append(block);
    };
    const renderOneTick = (cart) => {
      if (!shouldShowOneTickOffers(configuration)) return;
      if (configuration.one_tick_enabled && configuration.one_tick_variant_id) {
        const existing = cart.items.map((item, index) => ({item, line: index + 1})).find(
          ({item}) => isOneTickItem(item) && !item.properties?._pragma_site_cart_one_tick_rule,
        );
        oneTickAction({
          existing,
          text: configuration.one_tick_text?.text,
          title: configuration.one_tick_variant_title,
          onAdd: () => addVariant(
            configuration.one_tick_variant_id,
            {_pragma_site_cart_one_tick: 'true'},
          ),
        });
      }
      if (!configuration.one_tick_sku_enabled) return;
      (configuration.one_tick_sku_rules || []).forEach((rule) => {
        const state = oneTickSkuRuleState(cart, rule);
        if (!state.parentItems.length) return;
        const existing = state.addOnItems[0];
        oneTickAction({
          existing,
          text: rule.text?.text,
          title: rule.variant_title,
          onAdd: () => addVariant(
            rule.variant_id,
            {
              _pragma_site_cart_one_tick: 'true',
              _pragma_site_cart_one_tick_rule: rule.id,
            },
            configuration.one_tick_match_parent_quantity
              ? Math.max(1, state.desiredQuantity)
              : 1,
          ),
        });
      });
    };
    const reconcileSkuOneTick = async (cart) => {
      if (!configuration.one_tick_sku_enabled || oneTickSyncRunning) return;
      const rules = configuration.one_tick_sku_rules || [];
      const ruleIds = new Set(rules.map((rule) => rule.id));
      const changes = [];
      rules.forEach((rule) => {
        const state = oneTickSkuRuleState(cart, rule);
        state.addOnItems.forEach(({item, line}, index) => {
          if (index > 0) {
            changes.push(() => removeLine(item, line));
            return;
          }
          if (!state.parentItems.length && configuration.one_tick_remove_with_parent) {
            changes.push(() => removeLine(item, line));
            return;
          }
          if (
            state.parentItems.length
            && configuration.one_tick_match_parent_quantity
            && Number(item.quantity || 0) !== state.desiredQuantity
          ) changes.push(() => changeLine(item, line, state.desiredQuantity));
        });
      });
      if (configuration.one_tick_remove_with_parent) {
        cart.items.forEach((item, index) => {
          const ruleId = String(item.properties?._pragma_site_cart_one_tick_rule || '');
          if (ruleId && !ruleIds.has(ruleId)) changes.push(() => removeLine(item, index + 1));
        });
      }
      if (!changes.length) return;
      oneTickSyncRunning = true;
      try {
        for (const change of changes) await change();
        await api.sync();
      } catch (error) {
        console.error('[pragma-site-cart] Unable to synchronize SKU one-tick add-ons', error);
        showNotice('The targeted add-on could not be synchronized.', true);
      } finally {
        oneTickSyncRunning = false;
      }
    };

    const loadProduct = (handle) => {
      if (!productCache.has(handle)) {
        productCache.set(handle, nativeFetch(`${routesRoot}products/${encodeURIComponent(handle)}.js`, {headers: {'Accept': 'application/json'}, credentials: 'same-origin'}).then((response) => response.ok ? response.json() : null).catch(() => null));
      }
      return productCache.get(handle);
    };
    const swapTargetFor = async (item) => {
      const manual = matchingSwapRule(item, configuration.product_swap_rules);
      if (manual) return {variantId: manual.target_variant_id, label: manual.pill_label};
      const currentPrice = Number(item.original_price || item.final_price);
      for (const candidate of sizeGroupCandidates(item, configuration.product_swap_size_groups)) {
        if (!candidate.handle) {
          return {variantId: candidate.variantId, label: `Upgrade to ${candidate.productTitle}`};
        }
        const product = await loadProduct(candidate.handle);
        const configuredVariantId = numericId(candidate.variantId);
        const variant = product?.variants?.find((option) => (
          Number(option.id) === configuredVariantId && option.available
        ));
        if (variant && Number(variant.price) > currentPrice) {
          return {variantId: String(variant.id), label: `Upgrade to ${candidate.productTitle}`};
        }
      }
      if (!configuration.product_swap_automatic_upgrade || !item.handle) return null;
      const product = await loadProduct(item.handle);
      const next = product?.variants?.filter((variant) => variant.available && Number(variant.price) > currentPrice).sort((left, right) => Number(left.price) - Number(right.price))[0];
      return next ? {variantId: String(next.id), label: `Upgrade to ${next.title}`} : null;
    };
    const renderSwaps = async (cart) => {
      if (!configuration.product_swap_enabled || configuration.product_swap_coexistence !== 'swap') return;
      await Promise.all([...root.querySelectorAll('[data-psc-line]')].map(async (row) => {
        const line = Number(row.dataset.pscLine);
        const item = cart.items[line - 1];
        if (!item || isTruthy(item.properties?._pragma_site_cart_free_gift)) return;
        const target = await swapTargetFor(item);
        if (!target || api.getCart() !== cart) return;
        const action = button(target.label, 'psc-cart-swap-action');
        action.addEventListener('click', async () => {
          action.disabled = true;
          try {
            await addVariant(target.variantId, {...(item.properties || {}), _pragma_site_cart_swap: 'true'});
            await removeLine(item, line);
            await api.sync();
          } catch (error) {
            console.error('[pragma-site-cart] Unable to swap product', error);
            action.disabled = false;
            showNotice('That product upgrade is unavailable.', true);
          }
        });
        row.querySelector('.psc-cart-item-details')?.append(action);
      }));
    };

    const render = (cart) => {
      host.replaceChildren();
      host.hidden = cart.item_count === 0;
      if (host.hidden) return;
      renderRewards(cart);
      renderOneTick(cart);
      void reconcileSkuOneTick(cart);
      renderDiscounts(cart);
      renderOrderNotes(cart);
      renderSwaps(cart);
    };

    document.addEventListener('pragma-site-cart:cart:rendered', (event) => {
      if (event.detail?.root === root) render(event.detail.cart);
    });
    if (api.getCart()) render(api.getCart());
  };

  if (window.pragmaSiteCart) initialize(window.pragmaSiteCart);
  else document.addEventListener('pragma-site-cart:cart:ready', (event) => initialize(event.detail.api), {once: true});
})();
