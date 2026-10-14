require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const {
  getOrCreateUser,
  createOrder,
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  computeLinePrice,
  getOrders,
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
const DELIVERY_FEE = 10;

initBot(BOT_TOKEN);

app.use(cors());
app.use(express.json({ limit: '6mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

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

app.get('/api/products', (req, res) => {
  try {
    res.json(getProducts(true));
  } catch (err) {
    console.error(err);
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

app.post('/api/order', requireTelegramUser, async (req, res) => {
  try {
    const { items, delivery_type, telegram_username, address } = req.body;

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
      const line = computeLinePrice(p, qty);
      total += line;
      validatedItems.push({
        id: p.id,
        qty,
        price: p.price,
        line_total: line,
        name: p.name,
        unit: p.unit,
        offer_applied: (p.offers || []).some(o => Number(o.grams) === qty)
      });
    }

    if (delivery_type === 'delivery') total += DELIVERY_FEE;

    const tgUser = req.telegramUser;
    getOrCreateUser(tgUser.id, tgUser.username, tgUser.first_name);

    const orderId = createOrder({
      telegram_id: String(tgUser.id),
      username: tgUser.username || null,
      first_name: tgUser.first_name || null,
      items_json: JSON.stringify(validatedItems),
      total,
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
      delivery_type,
      telegram_username: telegram_username ? telegram_username.replace('@', '') : null,
      address
    }, productsMap);

    res.json({
      success: true,
      order_id: orderId,
      total,
      message: 'Commande enregistrée ! Paiement en espèces ✨'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la commande' });
  }
});

app.post('/api/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) return res.json({ success: true });
  res.status(401).json({ error: 'Mot de passe incorrect' });
});

app.get('/api/admin/products', requireAdmin, (req, res) => {
  try { res.json(getProducts(false)); }
  catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
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
    res.status(500).json({ error: 'Erreur suppression' });
  }
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  try { res.json(getOrders(100)); }
  catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

app.get('/api/admin/categories', requireAdmin, (req, res) => {
  try { res.json(getCategories()); }
  catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

app.put('/api/admin/categories', requireAdmin, (req, res) => {
  try {
    const list = req.body.categories;
    if (!Array.isArray(list)) return res.status(400).json({ error: 'categories doit être une liste' });
    list.forEach(c => {
      if (c._oldId && c._oldId !== c.id) renameCategoryOnProducts(c._oldId, c.id);
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
  console.log(`✨ Neverland écoute sur le port ${PORT}`);
});
