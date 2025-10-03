// assets/sidecart.js — sidecart z losowaniem upsellu przy otwarciu
// i ponownym renderowaniem upsellu po aktualizacjach w drawerze.
(function () {
  const cartURL   = (window.routes && routes.cart_url)        || '/cart';
  const addURL    = (window.routes && routes.cart_add_url)    || '/cart/add.js';
  const changeURL = (window.routes && routes.cart_change_url) || '/cart/change.js';
  const updateURL = (window.routes && routes.cart_update_url) || '/cart/update.js';

  const qs  = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));

  window.__SC_ATC_LOCK__ = false;

  // ---- pomocnicze
  async function fetchSection(id) {
    const url = new URL(cartURL, window.location.origin);
    url.searchParams.set('section_id', id);
    url.searchParams.set('_', Date.now().toString()); // cache-buster
    const res = await fetch(url.toString(), {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin'
    });
    if (!res.ok) throw new Error(`Sekcja ${id} niezaładowana`);
    return res.text();
  }

  async function refreshDrawer() {
    const html = await fetchSection('cart-drawer');
    const doc  = new DOMParser().parseFromString(html, 'text/html');
    const fresh = doc.getElementById('CartDrawer');
    const old   = document.getElementById('CartDrawer');
    if (fresh && old) old.replaceWith(fresh);
  }

  async function refreshBubbleIfExists() {
    const t = document.getElementById('cart-icon-bubble');
    if (!t) return;
    const html = await fetchSection('cart-icon-bubble').catch(() => null);
    if (!html) return;
    const doc   = new DOMParser().parseFromString(html, 'text/html');
    const fresh = doc.getElementById('cart-icon-bubble');
    if (fresh) t.innerHTML = fresh.innerHTML;
  }

  function openDrawer() {
    const wrap = qs('cart-drawer.drawer');
    if (!wrap) return;
    wrap.classList.add('active');
    wrap.style.visibility = 'visible';
    wrap.setAttribute('aria-hidden', 'false');
    (qs('.drawer__inner', wrap) || wrap).focus();
    document.body.classList.add('overflow-hidden');
  }

  function closeDrawer() {
    const wrap = qs('cart-drawer.drawer');
    if (!wrap) return;
    wrap.classList.remove('active');
    wrap.style.visibility = 'hidden';
    wrap.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('overflow-hidden');
  }

  // ===== UPSSELL: losowanie i render =====
  let currentUpsellPick = null; // zapamiętujemy wybrany upsell między odświeżeniami

  function readUpsellPool() {
    const el = document.getElementById('sc-upsell-pool');
    if (!el) return [];
    try { return JSON.parse(el.textContent || '[]'); } catch { return []; }
  }

  function pickRandom(pool, excludeVariantId) {
    if (!Array.isArray(pool) || pool.length === 0) return null;
    let candidates = pool;
    if (excludeVariantId && pool.length > 1) {
      candidates = pool.filter(p => String(p.variant_id) !== String(excludeVariantId));
      if (!candidates.length) candidates = pool;
    }
    return candidates[Math.floor(Math.random() * candidates.length)] || null;
  }

  function renderUpsell(pick) {
    const upsellWrap = document.getElementById('CartDrawer-Upsell');
    if (!upsellWrap || !pick) return;

    const linkEls = upsellWrap.querySelectorAll('.drawer__upsell-link');
    linkEls.forEach(a => a.setAttribute('href', pick.url || '#'));

    const imgEl = upsellWrap.querySelector('.drawer__upsell-media img');
    if (imgEl) {
      imgEl.src = pick.image || '';
      imgEl.alt = pick.image_alt || pick.title || '';
    }

    const titleEl = upsellWrap.querySelector('.drawer__upsell-title');
    if (titleEl) {
      titleEl.textContent = pick.title || '';
      titleEl.setAttribute('href', pick.url || '#');
    }

    const compareEl = upsellWrap.querySelector('.drawer__upsell-compare');
    const priceEl   = upsellWrap.querySelector('.drawer__upsell-price-final');
    if (compareEl && priceEl) {
      if (pick.compare_at_price && pick.compare_at_price !== pick.price) {
        compareEl.style.display = '';
        compareEl.textContent = pick.compare_at_price;
      } else {
        compareEl.style.display = 'none';
        compareEl.textContent = '';
      }
      priceEl.textContent = pick.price || '';
    }

    const btn = upsellWrap.querySelector('.sc-upsell-add');
    if (btn) btn.dataset.variantId = pick.variant_id;

    upsellWrap.dataset.lastVariantId = String(pick.variant_id || '');
  }

  // Losowanie TYLKO przy otwarciu; przy odświeżeniach tylko renderujemy bieżący pick
  function ensureUpsellRendered({ randomize } = { randomize: false }) {
    const pool = readUpsellPool();
    if (randomize || !currentUpsellPick) {
      const exclude = currentUpsellPick && currentUpsellPick.variant_id;
      currentUpsellPick = pickRandom(pool, exclude);
    }
    if (currentUpsellPick) renderUpsell(currentUpsellPick);
  }

  async function openDrawerFresh() {
    await refreshDrawer();
    bindDrawerHandlers();         // po replaceWith
    ensureUpsellRendered({ randomize: true }); // <-- losowanie na otwarciu
    openDrawer();
  }

  // ===== Aktualizacja linii koszyka =====
  let busy = false;
  async function updateLine({ line, key, quantity }) {
    if (busy) return;
    busy = true;
    try {
      let res;
      if (key) {
        const body = { updates: {} };
        body.updates[key] = quantity;
        res = await fetch(updateURL, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: JSON.stringify(body)
        });
      } else {
        res = await fetch(changeURL, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: JSON.stringify({ line, quantity })
        });
      }

      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 300));
        return await updateLine({ line, key, quantity });
      }
      if (!res.ok) {
        let msg = 'Aktualizacja koszyka nie powiodła się.';
        try { const data = await res.json(); msg = data?.message || data?.description || msg; } catch {}
        throw new Error(msg);
      }

      await refreshDrawer();
      await refreshBubbleIfExists();
      // po odświeżeniu sekcji ponownie narysuj ten SAM upsell
      ensureUpsellRendered({ randomize: false });
    } catch (e) {
      console.error(e);
      alert(e?.message || 'Nie udało się zaktualizować koszyka.');
    } finally {
      bindDrawerHandlers();
      busy = false;
    }
  }

  // ===== Handlery drawer'a =====
  function bindDrawerHandlers() {
    const wrap = qs('cart-drawer.drawer');
    if (!wrap || wrap.dataset.bound === 'true') return;

    wrap.addEventListener('click', (e) => {
      if (e.target.closest('#CartDrawer-Overlay, #CartDrawer-CloseBtn')) {
        e.preventDefault();
        closeDrawer();
        return;
      }

      // Dodanie upsell
      const upsellBtn = e.target.closest('.sc-upsell-add');
      if (upsellBtn) {
        e.preventDefault();
        const vid = upsellBtn.dataset.variantId;
        if (!vid) return;

        (async () => {
          try {
            upsellBtn.setAttribute('aria-busy', 'true');
            const fd = new FormData();
            fd.append('id', vid);
            fd.append('quantity', '1');

            const res = await fetch(addURL, {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
              body: fd
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err?.description || 'Nie udało się dodać produktu.');
            }

            await refreshDrawer();
            await refreshBubbleIfExists();
            bindDrawerHandlers();
            ensureUpsellRendered({ randomize: false }); // zostaw ten sam upsell
            openDrawer();
          } catch (err) {
            console.error(err);
            alert(err?.message || 'Wystąpił błąd podczas dodawania do koszyka.');
          } finally {
            upsellBtn.removeAttribute('aria-busy');
          }
        })();
        return;
      }

      // +/- ilości
      const qtyBtn = e.target.closest('.quantity__button');
      if (qtyBtn) {
        e.preventDefault();
        const line = parseInt(qtyBtn.dataset.line, 10);
        const input = qs(`#Drawer-quantity-${line}`, wrap);
        if (!input) return;

        const key = input.dataset.key || (input.closest('tr.cart-item')?.dataset.key);
        const isPlus = qtyBtn.getAttribute('name') === 'plus';
        const step = parseInt(input.step || '1', 10);
        const min  = parseInt(input.min || '1', 10);
        const max  = input.max ? parseInt(input.max, 10) : null;
        let val    = parseInt(input.value || '1', 10);

        val = isPlus ? val + step : Math.max(min, val - step);
        if (max !== null) val = Math.min(max, val);
        updateLine({ line, key, quantity: val });
        return;
      }

      // usunięcie
      const removeBtn = e.target.closest('.sc-remove');
      if (removeBtn) {
        e.preventDefault();
        const line = parseInt(removeBtn.dataset.line, 10);
        const key  = removeBtn.dataset.key;
        updateLine({ line, key, quantity: 0 });
      }
    });

    wrap.addEventListener('change', (e) => {
      const input = e.target.closest('.quantity__input');
      if (!input) return;
      const line = parseInt(input.dataset.line, 10);
      const key  = input.dataset.key || (input.closest('tr.cart-item')?.dataset.key);

      let qty = parseInt(input.value || '1', 10);
      const min  = parseInt(input.min || '1', 10);
      const max  = input.max ? parseInt(input.max, 10) : null;
      qty = Math.max(min, qty);
      if (max !== null) qty = Math.min(max, qty);
      updateLine({ line, key, quantity: qty });
    });

    wrap.dataset.bound = 'true';
  }

  // ikonka koszyka
  function bindCartIcon() {
    const bubble = document.getElementById('cart-icon-bubble');
    if (!bubble || bubble.dataset.scBound === 'true') return;
    bubble.dataset.scBound = 'true';

    bubble.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openDrawerFresh();
    }, { capture: true });

    bubble.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        openDrawerFresh();
      }
    });
  }

  // init
  bindDrawerHandlers();
  bindCartIcon();

  // przechwycenie formularza PDP
  (function bindProductForm() {
    const form =
      document.querySelector('product-form form') ||
      document.querySelector('form[action*="/cart/add"]');
    if (!form || form.dataset.sidecartBound === 'true') return;
    form.dataset.sidecartBound = 'true';

    const handleAddToCart = async (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();

      if (window.__SC_ATC_LOCK__) return;
      window.__SC_ATC_LOCK__ = true;

      const btn = form.querySelector('[type="submit"]');
      if (btn) btn.setAttribute('aria-busy', 'true');

      try {
        const fd = new FormData(form);
        const res = await fetch(addURL, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: fd
        });

        if (res.status === 429) {
          await new Promise(r => setTimeout(r, 300));
          const res2 = await fetch(addURL, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
            body: fd
          });
          if (!res2.ok) throw new Error('Nie udało się dodać produktu do koszyka.');
        } else if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.description || 'Nie udało się dodać produktu do koszyka.');
        }

        await refreshBubbleIfExists();
        await openDrawerFresh(); // losowanie upsellu przy otwarciu
      } catch (err) {
        console.error(err);
        alert(err?.message || 'Wystąpił błąd podczas dodawania do koszyka.');
      } finally {
        if (btn) btn.removeAttribute('aria-busy');
        setTimeout(() => { window.__SC_ATC_LOCK__ = false; }, 200);
      }
    };

    form.addEventListener('submit', handleAddToCart, { capture: true });
    qsa('[type="submit"]', form).forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        if (!window.__SC_ATC_LOCK__) handleAddToCart(ev);
      }, { capture: true });
    });
  })();
})();
