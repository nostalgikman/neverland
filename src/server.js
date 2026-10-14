require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const {
  getOrCreateUser,
  getUserPoints,
  addPoints,
  spendPoints,
  createOrder,
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  getOrders,
  getSettings,
  updateSettings,
  getCategories,
  saveCategories,
  renameCategoryOnProducts
} = require('./db');
const { initBot, sendOrderNotification } = require('./telegram');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me-now';

initBot(BOT_TOKEN);

app.use(cors());
app.use(express.json({ limit: '6mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
const fs = require('fs');
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

app.post('/api/admin/upload', requireAdmin, (req, res) => {
  try {
    const { image, filename } = req.body || {};
    if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Image invalide' });
    }
    const match = image.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/i);
    if (!match) return res.status(400).json({ error: 'Format image non supporté' });
    const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
    const buf = Buffer.from(match[2], 'base64');
    if (buf.length > 4.5 * 1024 * 1024) {
      return res.status(400).json({ error: 'Image trop lourde (max 4,5 Mo)' });
    }
    const safe = String(filename || 'photo').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'photo';
    const name = `${Date.now()}_${safe}.${ext}`;
    fs.writeFileSync(path.join(uploadsDir, name), buf);
    res.json({ success: true, url: `/uploads/${name}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur upload' });
  }
});

function validateInitData(initData) {
  if (!initData || !BOT_TOKEN) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (calculatedHash !== hash) return null;
    const authDate = parseInt(params.get('auth_date') || '0', 10);
    if (Date.now() / 1000 - authDate > 86400) return null;
    const userStr = params.get('user');
    if (!userStr) return null;
    return JSON.parse(userStr);
  } catch (e) {
    return null;
  }
}

function requireTelegramUser(req, res, next) {
  const initData = req.headers['x-telegram-init-data'] || req.body.initData;
  const user = validateInitData(initData);
  if (!user) return res.status(401).json({ error: 'Authentification Telegram invalide' });
  req.telegramUser = user;
  next();
}

function requireAdmin(req, res, next) {
  const pwd = req.headers['x-admin-password'] || req.body?.password;
  if (pwd !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Mot de passe admin incorrect' });
  }
  next();
}

// ===== Routes publiques =====
app.get('/api/products', (req, res) => {
  try {
    res.json(getProducts(true));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/settings', (req, res) => {
  try {
    res.json(getSettings());
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/categories', (req, res) => {
  try {
    res.json(getCategories());
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/points', requireTelegramUser, (req, res) => {
  try {
    const user = getOrCreateUser(req.telegramUser.id, req.telegramUser.username, req.telegramUser.first_name);
    res.json({ points: user.points });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/order', requireTelegramUser, async (req, res) => {
  try {
    const { items, delivery_type, telegram_username, address, use_points } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Panier vide' });
    }
    if (!['delivery', 'pickup'].includes(delivery_type)) {
      return res.status(400).json({ error: 'Type de livraison invalide' });
    }
    if (delivery_type === 'delivery') {
      if (!telegram_username || !address || address.trim().length < 10) {
        return res.status(400).json({ error: 'Pseudo Telegram et adresse complets requis pour la livraison' });
      }
    }

    const settings = getSettings();
    const products = getProducts(true);
    const productsMap = {};
    products.forEach(p => { productsMap[p.id] = p; });

    let total = 0;
    const validatedItems = [];
    for (const item of items) {
      const p = productsMap[item.id];
      const qty = Number(item.qty);
      if (!p || !qty || qty <= 0) {
        return res.status(400).json({ error: 'Produit invalide' });
      }
      total += p.price * qty;
      validatedItems.push({ id: p.id, qty, price: p.price, name: p.name, unit: p.unit });
    }

    const DELIVERY_FEE = 10;
    if (delivery_type === 'delivery') {
      total += DELIVERY_FEE;
    }

    const tgUser = req.telegramUser;
    const user = getOrCreateUser(tgUser.id, tgUser.username, tgUser.first_name);
    let pointsSpent = 0;
    let pointsEarned = settings.points_per_order;

    if (use_points && user.points >= settings.points_for_reward) {
      const cheapest = validatedItems.reduce((a, b) => a.price < b.price ? a : b);
      total = Math.max(0, total - cheapest.price);
      pointsSpent = settings.points_for_reward;
      spendPoints(tgUser.id, settings.points_for_reward);
    }

    addPoints(tgUser.id, pointsEarned);

    const orderId = createOrder({
      telegram_id: String(tgUser.id),
      username: tgUser.username || null,
      first_name: tgUser.first_name || null,
      items_json: JSON.stringify(validatedItems),
      total,
      points_earned: pointsEarned,
      points_spent: pointsSpent,
      delivery_type,
      telegram_username: telegram_username ? telegram_username.replace('@', '') : null,
      address: address || null
    });

    await sendOrderNotification(ADMIN_CHAT_ID, {
      id: orderId,
      telegram_id: tgUser.id,
      username: tgUser.username,
      first_name: tgUser.first_name,
      items: validatedItems,
      total,
      delivery_fee: delivery_type === 'delivery' ? DELIVERY_FEE : 0,
      points_earned: pointsEarned,
      points_spent: pointsSpent,
      delivery_type,
      telegram_username: telegram_username ? telegram_username.replace('@', '') : null,
      address
    }, productsMap);

    const newPoints = getUserPoints(tgUser.id);

    res.json({
      success: true,
      order_id: orderId,
      total,
      points: newPoints,
      message: pointsSpent > 0
        ? `Commande enregistrée ! ${settings.reward_label} grâce à tes points ✨`
        : `Commande enregistrée ! +${pointsEarned} points de fidélité ✨`
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la commande' });
  }
});

// ===== Routes Admin =====
app.post('/api/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    return res.json({ success: true });
  }
  res.status(401).json({ error: 'Mot de passe incorrect' });
});

app.get('/api/admin/products', requireAdmin, (req, res) => {
  try {
    res.json(getProducts(false));
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/admin/products', requireAdmin, (req, res) => {
  try {
    const id = createProduct(req.body);
    res.json({ success: true, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur création produit' });
  }
});

app.put('/api/admin/products/:id', requireAdmin, (req, res) => {
  try {
    updateProduct(Number(req.params.id), req.body);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur mise à jour' });
  }
});

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  try {
    deleteProduct(Number(req.params.id));
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur suppression' });
  }
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  try {
    res.json(getOrders(100));
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/admin/settings', requireAdmin, (req, res) => {
  try {
    res.json(getSettings());
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  try {
    updateSettings(req.body);
    res.json({ success: true, settings: getSettings() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur mise à jour paramètres' });
  }
});

app.get('/api/admin/categories', requireAdmin, (req, res) => {
  try {
    res.json(getCategories());
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/api/admin/categories', requireAdmin, (req, res) => {
  try {
    const list = req.body.categories;
    if (!Array.isArray(list)) {
      return res.status(400).json({ error: 'categories doit être une liste' });
    }
    // Si un id a changé, mettre à jour les produits
    const oldList = getCategories();
    const oldByLabel = {};
    oldList.forEach(c => { oldByLabel[c.label] = c.id; });
    list.forEach(c => {
      if (c._oldId && c._oldId !== c.id) {
        renameCategoryOnProducts(c._oldId, c.id);
      }
    });
    const saved = saveCategories(list);
    res.json({ success: true, categories: saved });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erreur catégories' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🌙 Neverland Mini App écoute sur le port ${PORT}`);
  if (!BOT_TOKEN) console.warn('⚠️  BOT_TOKEN non défini');
  if (!ADMIN_CHAT_ID) console.warn('⚠️  ADMIN_CHAT_ID non défini');
  if (ADMIN_PASSWORD === 'change-me-now') console.warn('⚠️  Change ADMIN_PASSWORD dans le .env !');
});
