const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  tg.setHeaderColor('#0a0a1a');
  tg.setBackgroundColor('#0a0a1a');
}

const DELIVERY_FEE = 10;
let products = [];
let categories = [];
let cart = {};
let currentTab = 'tout';
let modalProductId = null;

function createStars() {
  const container = document.getElementById('stars-container');
  if (!container) return;
  for (let i = 0; i < 70; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    const size = Math.random() * 2.2 + 0.4;
    star.style.width = size + 'px';
    star.style.height = size + 'px';
    star.style.left = (Math.random() * 100) + '%';
    star.style.top = (Math.random() * 100) + '%';
    star.style.setProperty('--opacity', (Math.random() * 0.55 + 0.25).toFixed(2));
    star.style.setProperty('--duration', (Math.random() * 4 + 2.5).toFixed(1) + 's');
    star.style.animationDelay = (Math.random() * 6).toFixed(1) + 's';
    container.appendChild(star);
  }
}

function createShootingStars() {
  const box = document.getElementById('shooting-stars');
  if (!box) return;
  function spawn() {
    const s = document.createElement('div');
    s.className = 'shooting-star';
    s.style.left = (Math.random() * 70 + 10) + '%';
    s.style.top = (Math.random() * 35) + '%';
    s.style.animationDuration = (Math.random() * 0.8 + 1.1).toFixed(2) + 's';
    box.appendChild(s);
    setTimeout(function() { s.remove(); }, 2000);
  }
  spawn();
  setInterval(spawn, 4500 + Math.random() * 3500);
}

function getInitData() { return tg?.initData || ''; }

async function api(path, options) {
  options = options || {};
  const headers = Object.assign({
    'Content-Type': 'application/json',
    'X-Telegram-Init-Data': getInitData()
  }, options.headers || {});
  const res = await fetch(path, Object.assign({}, options, { headers: headers }));
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erreur réseau');
  return data;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function formatPrice(price) {
  return Number(price).toFixed(2).replace('.', ',') + ' €';
}

function linePrice(p, grams) {
  const g = Number(grams) || 0;
  if (g <= 0) return 0;
  const offers = p.offers || [];
  const exact = offers.find(function(o) { return Number(o.grams) === g; });
  if (exact) return Number(exact.price);
  return Number(p.price) * g;
}

async function loadProducts() {
  products = await api('/api/products');
  renderCatalog();
}

async function loadCategories() {
  try { categories = await api('/api/categories'); }
  catch (e) {
    categories = [
      { id: 'chocolat', label: 'Chocolat' },
      { id: 'fleurs', label: 'Fleurs' },
      { id: 'poudre', label: 'Poudre' }
    ];
  }
  renderTabs();
}

function renderTabs() {
  const nav = document.querySelector('.tabs');
  if (!nav) return;
  const cartBtn = nav.querySelector('[data-tab="cart"]');
  const cartHtml = cartBtn ? cartBtn.outerHTML : '';
  const cats = [{ id: 'tout', label: 'Tout' }].concat(categories);
  nav.innerHTML = cats.map(function(c) {
    return '<button class="tab ' + (currentTab === c.id ? 'active' : '') + '" data-tab="' + c.id + '">' + c.label + '</button>';
  }).join('') + cartHtml;
  nav.querySelectorAll('.tab').forEach(function(tab) {
    tab.addEventListener('click', function() { switchTab(tab.dataset.tab); });
  });
  updateCartUI();
}

function renderCatalog() {
  const grid = document.getElementById('products-grid');
  if (!grid) return;
  const filtered = currentTab === 'tout' ? products : products.filter(function(p) { return p.category === currentTab; });
  if (!filtered.length) {
    grid.innerHTML = '<p class="empty-cat">Rien ici pour le moment…</p>';
    return;
  }
  grid.innerHTML = filtered.map(function(p) {
    const img = p.image_url
      ? '<img class="product-img" src="' + escapeHtml(p.image_url) + '" alt="" />'
      : '<div class="product-emoji">' + (p.image_emoji || '🎁') + '</div>';
    const unit = p.unit ? escapeHtml(p.unit) : '€ / g';
    const hasOffers = p.offers && p.offers.length;
    return '<article class="product-card" data-id="' + p.id + '">' +
      img +
      '<div class="product-info">' +
      '<div class="product-name">' + escapeHtml(p.name) + '</div>' +
      '<div class="product-price">' + Number(p.price).toFixed(2).replace('.', ',') + ' ' + unit + '</div>' +
      (hasOffers ? '<div class="product-offer-badge">Offres dispo</div>' : '') +
      '<div class="qty-row" onclick="event.stopPropagation()">' +
      '<button class="qty-btn" data-act="minus" data-id="' + p.id + '">−</button>' +
      '<span class="qty-mid" id="q-' + p.id + '">' + (cart[p.id] || 0) + '</span>' +
      '<button class="qty-btn" data-act="plus" data-id="' + p.id + '">+</button>' +
      '</div></div></article>';
  }).join('');

  grid.querySelectorAll('.product-card').forEach(function(card) {
    card.addEventListener('click', function() { openProductModal(Number(card.dataset.id)); });
  });
  grid.querySelectorAll('.qty-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const id = Number(btn.dataset.id);
      if (btn.dataset.act === 'plus') changeQty(id, 1);
      else changeQty(id, -1);
    });
  });
}

function openProductModal(id) {
  const p = products.find(function(x) { return x.id === id; });
  if (!p) return;
  modalProductId = id;
  const body = document.getElementById('modal-body');
  const img = p.image_url
    ? '<img class="modal-img" src="' + escapeHtml(p.image_url) + '" alt="" />'
    : '<div class="modal-emoji">' + (p.image_emoji || '🎁') + '</div>';
  const unit = p.unit || '€ / g';
  const offers = p.offers || [];
  const offersHtml = offers.length
    ? '<div class="modal-offers"><div class="modal-offers-title">Offres</div>' +
      offers.map(function(o) {
        return '<button class="offer-btn" data-grams="' + o.grams + '">' +
          (o.label || (o.grams + ' g')) + ' — ' + formatPrice(o.price) +
          '</button>';
      }).join('') + '</div>'
    : '';

  body.innerHTML =
    img +
    '<h3 class="modal-name">' + escapeHtml(p.name) + '</h3>' +
    '<p class="modal-desc">' + escapeHtml(p.description || '') + '</p>' +
    '<p class="modal-price">' + Number(p.price).toFixed(2).replace('.', ',') + ' ' + escapeHtml(unit) + '</p>' +
    offersHtml +
    '<div class="modal-qty">' +
    '<button class="qty-btn big" id="m-minus">−</button>' +
    '<span class="qty-mid big" id="m-qty">' + (cart[id] || 0) + '</span>' +
    '<button class="qty-btn big" id="m-plus">+</button>' +
    '</div>' +
    '<button class="btn-primary" id="m-add">Mettre dans le panier</button>';

  document.getElementById('product-modal').classList.remove('hidden');
  document.getElementById('m-minus').onclick = function() { changeQty(id, -1); refreshModalQty(); };
  document.getElementById('m-plus').onclick = function() { changeQty(id, 1); refreshModalQty(); };
  document.getElementById('m-add').onclick = function() {
    if (!cart[id]) changeQty(id, 1);
    closeProductModal();
    showToast('Ajouté au panier ✨');
  };
  body.querySelectorAll('.offer-btn').forEach(function(btn) {
    btn.onclick = function() {
      const g = Number(btn.dataset.grams);
      cart[id] = g;
      updateCartUI();
      renderCatalog();
      refreshModalQty();
      showToast('Offre ' + g + ' g sélectionnée ✨');
    };
  });
}

function refreshModalQty() {
  const el = document.getElementById('m-qty');
  if (el && modalProductId) el.textContent = cart[modalProductId] || 0;
}

function closeProductModal() {
  document.getElementById('product-modal').classList.add('hidden');
  modalProductId = null;
}

function changeQty(id, delta) {
  cart[id] = (cart[id] || 0) + delta;
  if (cart[id] <= 0) delete cart[id];
  updateCartUI();
  renderCatalog();
  refreshModalQty();
  if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}

function updateCartUI() {
  const count = Object.values(cart).reduce(function(a, b) { return a + b; }, 0);
  const countEl = document.getElementById('cart-count');
  if (countEl) {
    countEl.textContent = count;
    countEl.dataset.count = count;
  }
  const empty = document.getElementById('cart-empty');
  const content = document.getElementById('cart-content');
  const itemsEl = document.getElementById('cart-items');
  const submitBtn = document.getElementById('submit-order');
  if (count === 0) {
    if (empty) empty.classList.remove('hidden');
    if (content) content.classList.add('hidden');
    if (submitBtn) submitBtn.disabled = true;
    return;
  }
  if (empty) empty.classList.add('hidden');
  if (content) content.classList.remove('hidden');
  if (submitBtn) submitBtn.disabled = false;

  if (itemsEl) {
    itemsEl.innerHTML = Object.keys(cart).map(function(id) {
      const p = products.find(function(x) { return x.id === Number(id); });
      if (!p) return '';
      const qty = cart[id];
      const line = linePrice(p, qty);
      const offer = (p.offers || []).find(function(o) { return Number(o.grams) === qty; });
      return '<div class="cart-item"><div class="cart-item-left"><span class="cart-item-emoji">' + (p.image_emoji || '🎁') + '</span><div>' +
        '<div class="cart-item-name">' + escapeHtml(p.name) + '</div>' +
        '<div class="cart-item-price">' + formatPrice(line) +
        (offer ? ' <span class="offer-tag">offre</span>' : '') +
        ' <span style="opacity:.7">(' + qty + ' g)</span></div></div></div>' +
        '<div class="qty-controls">' +
        '<button class="qty-btn" data-id="' + id + '" data-delta="-1">−</button>' +
        '<span class="qty-value">' + qty + '</span>' +
        '<button class="qty-btn" data-id="' + id + '" data-delta="1">+</button></div></div>';
    }).join('');
    itemsEl.querySelectorAll('.qty-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        changeQty(Number(btn.dataset.id), Number(btn.dataset.delta));
      });
    });
  }
  updateTotal();
}

function updateTotal() {
  let subtotal = 0;
  Object.keys(cart).forEach(function(id) {
    const p = products.find(function(x) { return x.id === Number(id); });
    if (p) subtotal += linePrice(p, cart[id]);
  });
  const deliveryType = document.querySelector('input[name="delivery"]:checked');
  const fee = deliveryType && deliveryType.value === 'delivery' ? DELIVERY_FEE : 0;
  const total = subtotal + fee;
  const subEl = document.getElementById('subtotal-price');
  const feeRow = document.getElementById('delivery-fee-row');
  const totalEl = document.getElementById('total-price');
  if (subEl) subEl.textContent = formatPrice(subtotal);
  if (feeRow) feeRow.classList.toggle('hidden', fee === 0);
  if (totalEl) totalEl.textContent = formatPrice(total);
}

function setupDelivery() {
  document.querySelectorAll('input[name="delivery"]').forEach(function(radio) {
    radio.addEventListener('change', function() {
      const fields = document.getElementById('delivery-fields');
      if (radio.value === 'delivery' && radio.checked) {
        if (fields) fields.classList.remove('hidden');
      } else if (radio.checked) {
        if (fields) fields.classList.add('hidden');
      }
      updateTotal();
    });
  });
}

async function submitOrder() {
  const deliveryTypeEl = document.querySelector('input[name="delivery"]:checked');
  const deliveryType = deliveryTypeEl ? deliveryTypeEl.value : 'pickup';
  const username = (document.getElementById('tg-username') || {}).value || '';
  const address = (document.getElementById('address') || {}).value || '';
  if (deliveryType === 'delivery') {
    if (username.trim().length < 3) { showToast('Indique ton pseudo Telegram', true); return; }
    if (address.trim().length < 10) { showToast('Indique une adresse complète', true); return; }
  }
  const items = Object.keys(cart).map(function(id) { return { id: Number(id), qty: cart[id] }; });
  const btn = document.getElementById('submit-order');
  if (btn) { btn.disabled = true; btn.textContent = 'Envoi…'; }
  try {
    const result = await api('/api/order', {
      method: 'POST',
      body: JSON.stringify({
        items: items,
        delivery_type: deliveryType,
        telegram_username: username.trim(),
        address: address.trim()
      })
    });
    cart = {};
    updateCartUI();
    renderCatalog();
    showToast(result.message, false, true);
    if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    setTimeout(function() { switchTab('tout'); }, 1600);
  } catch (err) {
    showToast(err.message || 'Erreur', true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Commander ✨'; }
  }
}

function showToast(msg, isError, isSuccess) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = 'toast show' + (isSuccess ? ' success' : '') + (isError ? ' error' : '');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(function() { toast.classList.remove('show'); }, 3000);
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(function(t) {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  const catalog = document.getElementById('catalog');
  const cartSection = document.getElementById('cart-section');
  if (catalog) catalog.classList.toggle('active', tab !== 'cart');
  if (cartSection) cartSection.classList.toggle('active', tab === 'cart');
  if (tab !== 'cart') renderCatalog();
}

document.addEventListener('DOMContentLoaded', function() {
  createStars();
  createShootingStars();
  setupDelivery();
  document.getElementById('submit-order')?.addEventListener('click', submitOrder);
  document.getElementById('modal-close')?.addEventListener('click', closeProductModal);
  document.getElementById('modal-backdrop')?.addEventListener('click', closeProductModal);
  loadCategories().then(loadProducts);
});
