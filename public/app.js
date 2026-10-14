/* ===== Neverland Mini App ===== */
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
let userPoints = 0;
let loyaltySettings = { points_per_order: 5, points_for_reward: 30, reward_label: '1 article offert' };

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

function getInitData() {
  return tg?.initData || '';
}

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

async function loadProducts() {
  products = await api('/api/products');
  renderCatalog();
}

async function loadCategories() {
  try {
    categories = await api('/api/categories');
  } catch (e) {
    categories = [
      { id: 'chocolat', label: 'Chocolat', emoji: '🍫' },
      { id: 'fleurs', label: 'Fleurs', emoji: '🌸' },
      { id: 'poudre', label: 'Poudre', emoji: '✨' }
    ];
  }
  renderTabs();
}

function renderTabs() {
  const nav = document.querySelector('.tabs');
  if (!nav) return;
  const cartBtn = nav.querySelector('[data-tab="cart"]');
  const cartHtml = cartBtn ? cartBtn.outerHTML : '';
  const cats = [{ id: 'tout', label: 'Tout', emoji: '✨' }].concat(categories);
  nav.innerHTML = cats.map(function(c) {
    return '<button class="tab ' + (currentTab === c.id ? 'active' : '') + '" data-tab="' + c.id + '">' + c.label + '</button>';
  }).join('') + cartHtml;
  nav.querySelectorAll('.tab').forEach(function(tab) {
    tab.addEventListener('click', function() { switchTab(tab.dataset.tab); });
  });
  updateCartUI();
}

async function loadPoints() {
  try {
    const data = await api('/api/points');
    userPoints = data.points;
    updatePointsUI();
  } catch (e) {}
}

async function loadSettings() {
  try {
    loyaltySettings = await api('/api/settings');
    updatePointsUI();
  } catch (e) {}
}

function updatePointsUI() {
  var pointsEl = document.getElementById('points-value');
  var loyaltyEl = document.getElementById('loyalty-points');
  if (pointsEl) pointsEl.textContent = userPoints;
  if (loyaltyEl) loyaltyEl.textContent = userPoints;
  var threshold = loyaltySettings.points_for_reward || 30;
  var label = loyaltySettings.reward_label || '1 article offert';
  var infoEl = document.querySelector('.loyalty-info');
  if (infoEl) infoEl.textContent = threshold + ' points = ' + label;
  var usePointsLabel = document.getElementById('use-points-label');
  var usePointsCheck = document.getElementById('use-points');
  var span = usePointsLabel ? usePointsLabel.querySelector('span') : null;
  if (span) span.textContent = 'Utiliser ' + threshold + ' points pour : ' + label;
  if (userPoints >= threshold) {
    if (usePointsLabel) usePointsLabel.classList.remove('hidden');
  } else {
    if (usePointsLabel) usePointsLabel.classList.add('hidden');
    if (usePointsCheck) usePointsCheck.checked = false;
  }
  updateTotal();
}

function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function formatPrice(price) {
  return Number(price).toFixed(2).replace('.', ',') + ' €';
}

function renderCatalog() {
  var grid = document.getElementById('products-grid');
  if (!grid) return;
  var filtered = currentTab === 'tout' ? products : products.filter(function(p) { return p.category === currentTab; });
  if (!filtered.length) {
    grid.innerHTML = '<p class="empty-cat">Rien ici pour le moment…</p>';
    return;
  }
  grid.innerHTML = filtered.map(function(p) {
    var img = p.image_url
      ? '<img class="product-img" src="' + escapeHtml(p.image_url) + '" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';" /><div class="product-emoji" style="display:none;">' + (p.image_emoji || '🎁') + '</div>'
      : '<div class="product-emoji">' + (p.image_emoji || '🎁') + '</div>';
    var unit = p.unit ? escapeHtml(p.unit) : '€ / g';
    return '<article class="product-card">' + img +
      '<div class="product-info"><div class="product-name">' + escapeHtml(p.name) + '</div>' +
      '<div class="product-desc">' + escapeHtml(p.description || '') + '</div>' +
      '<div class="product-footer"><span class="product-price">' + Number(p.price).toFixed(2).replace('.', ',') + ' ' + unit + '</span>' +
      '<button class="btn-add" data-id="' + p.id + '">+ 1 g</button></div></div></article>';
  }).join('');
  grid.querySelectorAll('.btn-add').forEach(function(btn) {
    btn.addEventListener('click', function() { addToCart(Number(btn.dataset.id), 1); });
  });
}

function addToCart(id, grams) {
  cart[id] = (cart[id] || 0) + grams;
  updateCartUI();
  showToast('+' + grams + ' g ✨');
  if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}

function changeQty(id, delta) {
  cart[id] = (cart[id] || 0) + delta;
  if (cart[id] <= 0) delete cart[id];
  updateCartUI();
}

function updateCartUI() {
  var count = Object.values(cart).reduce(function(a, b) { return a + b; }, 0);
  var countEl = document.getElementById('cart-count');
  if (countEl) {
    countEl.textContent = count;
    countEl.dataset.count = count;
  }
  var empty = document.getElementById('cart-empty');
  var content = document.getElementById('cart-content');
  var itemsEl = document.getElementById('cart-items');
  var submitBtn = document.getElementById('submit-order');
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
    itemsEl.innerHTML = Object.entries(cart).map(function(entry) {
      var id = entry[0], qty = entry[1];
      var p = products.find(function(x) { return x.id === Number(id); });
      if (!p) return '';
      var line = p.price * qty;
      return '<div class="cart-item"><div class="cart-item-left"><span class="cart-item-emoji">' + (p.image_emoji || '🎁') + '</span><div>' +
        '<div class="cart-item-name">' + escapeHtml(p.name) + '</div>' +
        '<div class="cart-item-price">' + formatPrice(line) + ' <span style="opacity:.7">(' + qty + ' g)</span></div></div></div>' +
        '<div class="qty-controls"><button class="qty-btn" data-id="' + id + '" data-delta="-1">−</button>' +
        '<span class="qty-value">' + qty + ' g</span>' +
        '<button class="qty-btn" data-id="' + id + '" data-delta="1">+</button></div></div>';
    }).join('');
    itemsEl.querySelectorAll('.qty-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { changeQty(Number(btn.dataset.id), Number(btn.dataset.delta)); });
    });
  }
  updateTotal();
}

function updateTotal() {
  var subtotal = 0;
  Object.keys(cart).forEach(function(id) {
    var p = products.find(function(x) { return x.id === Number(id); });
    if (p) subtotal += p.price * cart[id];
  });
  var threshold = loyaltySettings.points_for_reward || 30;
  var usePoints = document.getElementById('use-points') && document.getElementById('use-points').checked && userPoints >= threshold;
  if (usePoints && Object.keys(cart).length > 0) {
    var prices = Object.keys(cart).map(function(id) {
      var p = products.find(function(x) { return x.id === Number(id); });
      return p ? p.price : 999;
    });
    subtotal = Math.max(0, subtotal - Math.min.apply(null, prices));
  }
  var deliveryType = document.querySelector('input[name="delivery"]:checked');
  deliveryType = deliveryType ? deliveryType.value : 'pickup';
  var fee = deliveryType === 'delivery' ? DELIVERY_FEE : 0;
  var total = subtotal + fee;
  var subEl = document.getElementById('subtotal-price');
  var feeRow = document.getElementById('delivery-fee-row');
  var totalEl = document.getElementById('total-price');
  if (subEl) subEl.textContent = formatPrice(subtotal);
  if (feeRow) feeRow.classList.toggle('hidden', fee === 0);
  if (totalEl) totalEl.textContent = formatPrice(total);
}

function setupDelivery() {
  document.querySelectorAll('input[name="delivery"]').forEach(function(radio) {
    radio.addEventListener('change', function() {
      var fields = document.getElementById('delivery-fields');
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
  var deliveryType = document.querySelector('input[name="delivery"]:checked');
  deliveryType = deliveryType ? deliveryType.value : 'pickup';
  var usernameEl = document.getElementById('tg-username');
  var addressEl = document.getElementById('address');
  var username = usernameEl ? usernameEl.value.trim() : '';
  var address = addressEl ? addressEl.value.trim() : '';
  var threshold = loyaltySettings.points_for_reward || 30;
  var usePoints = document.getElementById('use-points') && document.getElementById('use-points').checked && userPoints >= threshold;
  if (deliveryType === 'delivery') {
    if (!username || username.length < 3) { showToast('Indique ton pseudo Telegram', true); return; }
    if (!address || address.length < 10) { showToast('Indique une adresse complète', true); return; }
  }
  var items = Object.keys(cart).map(function(id) { return { id: Number(id), qty: cart[id] }; });
  var btn = document.getElementById('submit-order');
  if (btn) { btn.disabled = true; btn.textContent = 'Envoi en cours…'; }
  try {
    var result = await api('/api/order', {
      method: 'POST',
      body: JSON.stringify({
        items: items,
        delivery_type: deliveryType,
        telegram_username: username,
        address: address,
        use_points: usePoints
      })
    });
    cart = {};
    userPoints = result.points;
    updateCartUI();
    updatePointsUI();
    showToast(result.message, false, true);
    if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    setTimeout(function() { switchTab('tout'); }, 1800);
  } catch (err) {
    showToast(err.message || 'Erreur lors de la commande', true);
    if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Commander ✨'; }
  }
}

function showToast(msg, isError, isSuccess) {
  var toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = 'toast show' + (isSuccess ? ' success' : '') + (isError ? ' error' : '');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(function() { toast.classList.remove('show'); }, 3200);
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(function(t) {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  var catalog = document.getElementById('catalog');
  var cartSection = document.getElementById('cart-section');
  if (catalog) catalog.classList.toggle('active', tab !== 'cart');
  if (cartSection) cartSection.classList.toggle('active', tab === 'cart');
  if (tab !== 'cart') renderCatalog();
}

document.addEventListener('DOMContentLoaded', function() {
  createStars();
  createShootingStars();
  setupDelivery();
  var up = document.getElementById('use-points');
  if (up) up.addEventListener('change', updateTotal);
  var so = document.getElementById('submit-order');
  if (so) so.addEventListener('click', submitOrder);
  loadCategories().then(function() { return loadProducts(); }).then(function() {
    loadPoints();
    loadSettings();
  });
});
