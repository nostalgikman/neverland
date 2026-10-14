const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  tg.setHeaderColor('#020617');
  tg.setBackgroundColor('#020617');
}

const DELIVERY_FEE = 10;
let products = [];
let categories = [];
let cart = {}; // key: productId_offerIndex -> count
let currentTab = 'tout';
let openProductId = null;

function createStars() {
  const c = document.getElementById('stars-container');
  if (!c) return;
  for (let i = 0; i < 90; i++) {
    const s = document.createElement('div');
    s.className = 'star';
    const size = Math.random() * 2.4 + 0.3;
    s.style.width = size + 'px';
    s.style.height = size + 'px';
    s.style.left = (Math.random() * 100) + '%';
    s.style.top = (Math.random() * 100) + '%';
    s.style.setProperty('--opacity', (Math.random() * 0.6 + 0.2).toFixed(2));
    s.style.setProperty('--duration', (Math.random() * 5 + 2).toFixed(1) + 's');
    s.style.animationDelay = (Math.random() * 7).toFixed(1) + 's';
    c.appendChild(s);
  }
}

function createShootingStars() {
  const box = document.getElementById('shooting-stars');
  if (!box) return;
  function spawn() {
    const s = document.createElement('div');
    s.className = 'shooting-star';
    s.style.left = (Math.random() * 70 + 5) + '%';
    s.style.top = (Math.random() * 40) + '%';
    box.appendChild(s);
    setTimeout(function() { s.remove(); }, 2000);
  }
  spawn();
  setInterval(spawn, 4000 + Math.random() * 4000);
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
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function formatPrice(n) {
  return Number(n).toFixed(2).replace('.', ',') + ' €';
}

function cartKey(pid, oi) { return pid + '_' + oi; }

function cartCount() {
  return Object.values(cart).reduce(function(a, b) { return a + b; }, 0);
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
  nav.querySelectorAll('.tab').forEach(function(t) {
    t.addEventListener('click', function() { switchTab(t.dataset.tab); });
  });
  updateCartUI();
}

function lowestPrice(p) {
  if (!p.offers || !p.offers.length) return null;
  return Math.min.apply(null, p.offers.map(function(o) { return o.price; }));
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
    let media;
    const firstMedia = (p.media && p.media[0]) || null;
    if (firstMedia && firstMedia.type === 'video') {
      media = '<div class="product-thumb video-thumb">▶</div>';
    } else if (firstMedia && firstMedia.url) {
      media = '<img class="product-img" src="' + escapeHtml(firstMedia.url) + '" alt="" />';
    } else if (p.video_url) {
      media = '<div class="product-thumb video-thumb">▶</div>';
    } else if (p.image_url) {
      media = '<img class="product-img" src="' + escapeHtml(p.image_url) + '" alt="" />';
    } else {
      media = '<div class="product-emoji">' + (p.image_emoji || '🎁') + '</div>';
    }
    const low = lowestPrice(p);
    const priceLine = low != null ? 'dès ' + formatPrice(low) : '';
    return '<article class="product-card" data-id="' + p.id + '">' +
      media +
      '<div class="product-info">' +
      '<div class="product-name">' + escapeHtml(p.name) + '</div>' +
      '<div class="product-price">' + priceLine + '</div>' +
      '</div></article>';
  }).join('');

  grid.querySelectorAll('.product-card').forEach(function(card) {
    card.addEventListener('click', function() { openProduct(Number(card.dataset.id)); });
  });
}

let carouselIndex = 0;
let carouselMedia = [];

function openProduct(id) {
  const p = products.find(function(x) { return x.id === id; });
  if (!p) return;
  openProductId = id;
  carouselIndex = 0;
  carouselMedia = (p.media && p.media.length) ? p.media.slice() : [];
  if (!carouselMedia.length) {
    if (p.video_url) carouselMedia.push({ type: 'video', url: p.video_url });
    if (p.image_url) carouselMedia.push({ type: 'image', url: p.image_url });
  }
  renderCarousel();
  document.getElementById('pp-name').textContent = p.name;
  document.getElementById('pp-desc').textContent = p.description || '';
  const offersBox = document.getElementById('pp-offers');
  const offers = p.offers || [];
  if (!offers.length) {
    offersBox.innerHTML = '<p class="empty-cat">Aucune offre pour ce produit</p>';
  } else {
    offersBox.innerHTML = offers.map(function(o, i) {
      const label = o.label || (o.qty + ' ' + o.unit);
      return '<button class="offer-btn" data-oi="' + i + '">' +
        '<span class="offer-label">' + escapeHtml(label) + '</span>' +
        '<span class="offer-price">' + formatPrice(o.price) + '</span>' +
        '</button>';
    }).join('');
    offersBox.querySelectorAll('.offer-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        addOffer(id, Number(btn.dataset.oi));
      });
    });
  }
  document.getElementById('product-page').classList.remove('hidden');
  document.getElementById('app').classList.add('page-open');
}

function renderCarousel() {
  const media = document.getElementById('pp-media');
  if (!carouselMedia.length) {
    const p = products.find(function(x) { return x.id === openProductId; });
    media.innerHTML = '<div class="pp-emoji">' + ((p && p.image_emoji) || '🎁') + '</div>';
    return;
  }
  const m = carouselMedia[carouselIndex];
  let inner = '';
  if (m.type === 'video') {
    inner = '<video class="pp-video" src="' + escapeHtml(m.url) + '" controls playsinline></video>';
  } else {
    inner = '<img class="pp-img" src="' + escapeHtml(m.url) + '" alt="" />';
  }
  const dots = carouselMedia.length > 1
    ? '<div class="carousel-dots">' + carouselMedia.map(function(_, i) {
        return '<span class="dot' + (i === carouselIndex ? ' active' : '') + '" data-i="' + i + '"></span>';
      }).join('') + '</div>'
    : '';
  const arrows = carouselMedia.length > 1
    ? '<button class="carousel-nav prev" type="button" aria-label="Précédent">‹</button>' +
      '<button class="carousel-nav next" type="button" aria-label="Suivant">›</button>'
    : '';
  media.innerHTML = '<div class="carousel-wrap">' + inner + arrows + dots + '</div>';

  const prev = media.querySelector('.carousel-nav.prev');
  const next = media.querySelector('.carousel-nav.next');
  if (prev) prev.onclick = function() { carouselGo(-1); };
  if (next) next.onclick = function() { carouselGo(1); };
  media.querySelectorAll('.dot').forEach(function(d) {
    d.onclick = function() {
      carouselIndex = Number(d.dataset.i);
      renderCarousel();
    };
  });

  // swipe
  let startX = 0;
  const wrap = media.querySelector('.carousel-wrap');
  if (wrap && carouselMedia.length > 1) {
    wrap.addEventListener('touchstart', function(e) {
      startX = e.changedTouches[0].screenX;
    }, { passive: true });
    wrap.addEventListener('touchend', function(e) {
      const dx = e.changedTouches[0].screenX - startX;
      if (Math.abs(dx) > 40) carouselGo(dx < 0 ? 1 : -1);
    }, { passive: true });
  }
}

function carouselGo(dir) {
  if (!carouselMedia.length) return;
  const v = document.querySelector('#pp-media video');
  if (v) { try { v.pause(); } catch (e) {} }
  carouselIndex = (carouselIndex + dir + carouselMedia.length) % carouselMedia.length;
  renderCarousel();
}

function closeProduct() {
  openProductId = null;
  const v = document.querySelector('#pp-media video');
  if (v) { try { v.pause(); } catch (e) {} }
  document.getElementById('product-page').classList.add('hidden');
  document.getElementById('app').classList.remove('page-open');
}

function addOffer(productId, offerIndex) {
  const k = cartKey(productId, offerIndex);
  cart[k] = (cart[k] || 0) + 1;
  updateCartUI();
  showToast('Ajouté au panier ✨');
  const ppBtn = document.getElementById('pp-cart-btn');
  if (ppBtn) {
    ppBtn.classList.remove('hidden');
    ppBtn.classList.add('pulse-once');
    setTimeout(function() { ppBtn.classList.remove('pulse-once'); }, 600);
  }
  const fab = document.getElementById('fab-cart');
  if (fab) {
    fab.classList.add('fab-bounce');
    setTimeout(function() { fab.classList.remove('fab-bounce'); }, 650);
  }
  if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
}

function changeOfferCount(key, delta) {
  cart[key] = (cart[key] || 0) + delta;
  if (cart[key] <= 0) delete cart[key];
  updateCartUI();
}

function updateCartUI() {
  const count = cartCount();
  const countEl = document.getElementById('cart-count');
  if (countEl) {
    countEl.textContent = count;
    countEl.dataset.count = count;
  }
  const fabCount = document.getElementById('fab-count');
  const fab = document.getElementById('fab-cart');
  if (fabCount) fabCount.textContent = count;
  if (fab) {
    fab.classList.toggle('has-items', count > 0);
    fabCount && fabCount.classList.toggle('hidden', count === 0);
  }
  const ppBtn = document.getElementById('pp-cart-btn');
  if (ppBtn && openProductId) ppBtn.classList.toggle('hidden', count === 0);
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
    itemsEl.innerHTML = Object.keys(cart).map(function(key) {
      const parts = key.split('_');
      const pid = Number(parts[0]);
      const oi = Number(parts[1]);
      const p = products.find(function(x) { return x.id === pid; });
      if (!p || !p.offers || !p.offers[oi]) return '';
      const o = p.offers[oi];
      const cnt = cart[key];
      const label = o.label || (o.qty + ' ' + o.unit);
      const line = o.price * cnt;
      return '<div class="cart-item"><div class="cart-item-left"><span class="cart-item-emoji">' + (p.image_emoji || '🎁') + '</span><div>' +
        '<div class="cart-item-name">' + escapeHtml(p.name) + '</div>' +
        '<div class="cart-item-price">' + escapeHtml(label) + ' — ' + formatPrice(line) + '</div></div></div>' +
        '<div class="qty-controls">' +
        '<button class="qty-btn" data-key="' + key + '" data-delta="-1">−</button>' +
        '<span class="qty-value">' + cnt + '</span>' +
        '<button class="qty-btn" data-key="' + key + '" data-delta="1">+</button></div></div>';
    }).join('');
    itemsEl.querySelectorAll('.qty-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        changeOfferCount(btn.dataset.key, Number(btn.dataset.delta));
      });
    });
  }
  updateTotal();
}

function updateTotal() {
  let subtotal = 0;
  Object.keys(cart).forEach(function(key) {
    const parts = key.split('_');
    const p = products.find(function(x) { return x.id === Number(parts[0]); });
    if (!p || !p.offers) return;
    const o = p.offers[Number(parts[1])];
    if (o) subtotal += o.price * cart[key];
  });
  const deliveryType = document.querySelector('input[name="delivery"]:checked');
  const fee = deliveryType && deliveryType.value === 'delivery' ? DELIVERY_FEE : 0;
  const subEl = document.getElementById('subtotal-price');
  const feeRow = document.getElementById('delivery-fee-row');
  const totalEl = document.getElementById('total-price');
  if (subEl) subEl.textContent = formatPrice(subtotal);
  if (feeRow) feeRow.classList.toggle('hidden', fee === 0);
  if (totalEl) totalEl.textContent = formatPrice(subtotal + fee);
}

function setupDelivery() {
  document.querySelectorAll('input[name="delivery"]').forEach(function(radio) {
    radio.addEventListener('change', function() {
      const fields = document.getElementById('delivery-fields');
      if (radio.value === 'delivery' && radio.checked) fields && fields.classList.remove('hidden');
      else if (radio.checked) fields && fields.classList.add('hidden');
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
  const items = Object.keys(cart).map(function(key) {
    const parts = key.split('_');
    return { id: Number(parts[0]), offer_index: Number(parts[1]), count: cart[key] };
  });
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
    showToast(result.message, false, true);
    if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    setTimeout(function() { switchTab('tout'); }, 1500);
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
  closeProduct();
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(function(t) {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.getElementById('catalog')?.classList.toggle('active', tab !== 'cart');
  document.getElementById('cart-section')?.classList.toggle('active', tab === 'cart');
  if (tab !== 'cart') renderCatalog();
}

document.addEventListener('DOMContentLoaded', function() {
  createStars();
  createShootingStars();
  setupDelivery();
  document.getElementById('submit-order')?.addEventListener('click', submitOrder);
  document.getElementById('pp-back')?.addEventListener('click', closeProduct);
  document.getElementById('fab-cart')?.addEventListener('click', function() {
    closeProduct();
    switchTab('cart');
  });
  document.getElementById('pp-cart-btn')?.addEventListener('click', function() {
    closeProduct();
    switchTab('cart');
  });
  loadCategories().then(loadProducts);
});
