/* ===== Neverland Mini App ===== */
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  tg.setHeaderColor('#0a0a1a');
  tg.setBackgroundColor('#0a0a1a');
}

// État
let products = [];
let cart = {}; // { productId: qty }
let currentTab = 'Menu';
let userPoints = 0;
let loyaltySettings = { points_per_order: 5, points_for_reward: 30, reward_label: '1 article offert' };

// ===== Étoiles animées =====
function createStars() {
  const container = document.getElementById('stars-container');
  const count = 80;
  for (let i = 0; i < count; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    const size = Math.random() * 2.5 + 0.5;
    star.style.width = `${size}px`;
    star.style.height = `${size}px`;
    star.style.left = `${Math.random() * 100}%`;
    star.style.top = `${Math.random() * 100}%`;
    star.style.setProperty('--opacity', (Math.random() * 0.7 + 0.3).toFixed(2));
    star.style.setProperty('--duration', `${(Math.random() * 4 + 2).toFixed(1)}s`);
    star.style.animationDelay = `${(Math.random() * 5).toFixed(1)}s`;
    container.appendChild(star);
  }
}

// ===== API helpers =====
function getInitData() {
  return tg?.initData || '';
}

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Telegram-Init-Data': getInitData(),
    ...options.headers
  };
  const res = await fetch(path, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erreur réseau');
  return data;
}

// ===== Chargement =====
async function loadProducts() {
  products = await api('/api/products');
  renderCatalog();
}

async function loadPoints() {
  try {
    const data = await api('/api/points');
    userPoints = data.points;
    updatePointsUI();
  } catch (e) {
    console.warn('Points non chargés (hors Telegram ?)', e.message);
  }
}

async function loadSettings() {
  try {
    loyaltySettings = await api('/api/settings');
    updatePointsUI();
  } catch (e) {
    console.warn('Settings non chargés', e.message);
  }
}

function updatePointsUI() {
  document.getElementById('points-value').textContent = userPoints;
  document.getElementById('loyalty-points').textContent = userPoints;
  const threshold = loyaltySettings.points_for_reward || 30;
  const label = loyaltySettings.reward_label || '1 article offert';
  const infoEl = document.querySelector('.loyalty-info');
  if (infoEl) infoEl.textContent = threshold + ' points = ' + label;
  const usePointsLabel = document.getElementById('use-points-label');
  const usePointsCheck = document.getElementById('use-points');
  const span = usePointsLabel ? usePointsLabel.querySelector('span') : null;
  if (span) span.textContent = 'Utiliser ' + threshold + ' points pour : ' + label;
  if (userPoints >= threshold) {
    usePointsLabel.classList.remove('hidden');
  } else {
    usePointsLabel.classList.add('hidden');
    usePointsCheck.checked = false;
  }
  updateTotal();
}

// ===== Catalogue =====
function renderCatalog() {
  const grid = document.getElementById('products-grid');
  const filtered = products.filter(p => p.category === currentTab);
  grid.innerHTML = filtered.map(p => {
    const img = p.image_url
      ? `<img src="${escapeHtml(p.image_url)}" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:14px;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><div class="product-emoji" style="display:none;">${p.image_emoji || '🎁'}</div>`
      : `<div class="product-emoji">${p.image_emoji || '🎁'}</div>`;
    const unit = '/g';
    return `
    <article class="product-card">
      ${img}
      <div class="product-info">
        <div class="product-name">${escapeHtml(p.name)}</div>
        <div class="product-desc">${escapeHtml(p.description || '')}</div>
        <div class="product-footer">
          <span class="product-price">${p.price.toFixed(2)} € ${unit}</span>
          <button class="btn-add" data-id="${p.id}">Ajouter</button>
        </div>
      </div>
    </article>
  `;
  }).join('');

  grid.querySelectorAll('.btn-add').forEach(btn => {
    btn.addEventListener('click', () => addToCart(Number(btn.dataset.id)));
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatPrice(price) {
  return price.toFixed(2).replace('.', ',') + ' €';
}

// ===== Panier =====
function addToCart(id) {
  cart[id] = (cart[id] || 0) + 1;
  updateCartUI();
  showToast('1g ajouté au panier 🪄');
  if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}

function changeQty(id, delta) {
  cart[id] = (cart[id] || 0) + delta;
  if (cart[id] <= 0) delete cart[id];
  updateCartUI();
}

function updateCartUI() {
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const countEl = document.getElementById('cart-count');
  countEl.textContent = count;
  countEl.dataset.count = count;

  const empty = document.getElementById('cart-empty');
  const content = document.getElementById('cart-content');
  const itemsEl = document.getElementById('cart-items');
  const submitBtn = document.getElementById('submit-order');

  if (count === 0) {
    empty.classList.remove('hidden');
    content.classList.add('hidden');
    submitBtn.disabled = true;
    return;
  }

  empty.classList.add('hidden');
  content.classList.remove('hidden');
  submitBtn.disabled = false;

  itemsEl.innerHTML = Object.entries(cart).map(([id, qty]) => {
    const p = products.find(x => x.id === Number(id));
    if (!p) return '';
    const unit = p.unit && p.unit !== '€' ? ` ${escapeHtml(p.unit)}` : ' €';
    return `
      <div class="cart-item">
        <div class="cart-item-left">
          <span class="cart-item-emoji">${p.image_emoji || '🎁'}</span>
          <div>
            <div class="cart-item-name">${escapeHtml(p.name)}</div>
            <div class="cart-item-price">${p.price.toFixed(2).replace('.', ',')}${unit}</div>
          </div>
        </div>
        <div class="qty-controls">
          <button class="qty-btn" data-id="${id}" data-delta="-1">−</button>
          <span class="qty-value">${qty}g</span>
          <button class="qty-btn" data-id="${id}" data-delta="1">+</button>
        </div>
      </div>
    `;
  }).join('');

  itemsEl.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => changeQty(Number(btn.dataset.id), Number(btn.dataset.delta)));
  });

  updateTotal();
}

function updateTotal() {
  let total = 0;
  for (const [id, qty] of Object.entries(cart)) {
    const p = products.find(x => x.id === Number(id));
    if (p) total += p.price * qty;
  }

  const threshold = loyaltySettings.points_for_reward || 30;
  const usePoints = document.getElementById('use-points').checked && userPoints >= threshold;
  if (usePoints && Object.keys(cart).length > 0) {
    // On soustrait le produit le moins cher
    const prices = Object.keys(cart).map(id => {
      const p = products.find(x => x.id === Number(id));
      return p ? p.price : 999;
    });
    const cheapest = Math.min(...prices);
    total = Math.max(0, total - cheapest);
  }

  document.getElementById('total-price').textContent = formatPrice(total);
}

// ===== Livraison =====
function setupDelivery() {
  document.querySelectorAll('input[name="delivery"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const fields = document.getElementById('delivery-fields');
      if (radio.value === 'delivery' && radio.checked) {
        fields.classList.remove('hidden');
      } else {
        fields.classList.add('hidden');
      }
    });
  });
}

// ===== Commande =====
async function submitOrder() {
  const deliveryType = document.querySelector('input[name="delivery"]:checked').value;
  const username = document.getElementById('tg-username').value.trim();
  const address = document.getElementById('address').value.trim();
  const threshold = loyaltySettings.points_for_reward || 30;
  const usePoints = document.getElementById('use-points').checked && userPoints >= threshold;

  if (deliveryType === 'delivery') {
    if (!username || username.length < 3) {
      showToast('Indique ton pseudo Telegram', true);
      return;
    }
    if (!address || address.length < 10) {
      showToast('Indique une adresse complète', true);
      return;
    }
  }

  const items = Object.entries(cart).map(([id, qty]) => ({
    id: Number(id),
    qty
  }));

  const btn = document.getElementById('submit-order');
  btn.disabled = true;
  btn.textContent = 'Envoi en cours…';

  try {
    const result = await api('/api/order', {
      method: 'POST',
      body: JSON.stringify({
        items,
        delivery_type: deliveryType,
        telegram_username: username,
        address,
        use_points: usePoints
      })
    });

    // Succès
    cart = {};
    userPoints = result.points;
    updateCartUI();
    updatePointsUI();
    showToast(result.message, false, true);

    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');

    // Retour au catalogue après un court délai
    setTimeout(() => {
      switchTab('chocolat');
    }, 1800);
  } catch (err) {
    showToast(err.message || 'Erreur lors de la commande', true);
    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Commander ✨';
  }
}

// ===== Toast =====
function showToast(msg, isError = false, isSuccess = false) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = 'toast show' + (isSuccess ? ' success' : '');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.remove('show');
  }, 3200);
}

// ===== Navigation =====
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.getElementById('catalog').classList.toggle('active', tab !== 'cart');
  document.getElementById('cart-section').classList.toggle('active', tab === 'cart');

  if (tab === 'chocolat' || tab === 'fleurs') {
    renderCatalog();
  }
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  createStars();
  setupDelivery();

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  document.getElementById('use-points').addEventListener('change', updateTotal);
  document.getElementById('submit-order').addEventListener('click', submitOrder);

  loadProducts().then(() => { loadPoints(); loadSettings(); });
});
// ===== Générateur d'étoiles filantes optimisé =====
function createShootingStar() {
  const container = document.getElementById('stars-container');
  if (!container) return;

  const star = document.createElement('div');
  star.className = 'shooting-star';

  // Position de départ aléatoire sur l'écran
  star.style.top = `${Math.random() * 60}%`;
  star.style.left = `${Math.random() * 80 + 10}%`;

  container.appendChild(star);

  // Supprime l'élément une fois l'animation terminée (1.5s)
  setTimeout(() => {
    star.remove();
  }, 1500);
}

function scheduleShootingStar() {
  // Délai réduit : entre 3 et 7 secondes pour que ce soit plus fréquent et vivant
  const delay = Math.random() * 4000 + 3000;
  setTimeout(() => {
    createShootingStar();
    scheduleShootingStar();
  }, delay);
}

// Lancement automatique au chargement de la page
document.addEventListener('DOMContentLoaded', () => {
  scheduleShootingStar();
});
