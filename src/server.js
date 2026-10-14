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
  createProduct,
  updateProduct,
  deleteProduct,
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
app.use(express.json({ limit: '40mb' }));
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
    const { file, filename } = req.body || {};
    const data = file || req.body?.image;
    if (!data || typeof data !== 'string' || !data.startsWith('data:')) {
      return res.status(400).json({ error: 'Fichier invalide' });
    }
    const comma = data.indexOf(',');
    if (comma < 0) return res.status(400).json({ error: 'Fichier invalide' });
    const header = data.slice(0, comma).toLowerCase();
    const b64 = data.slice(comma + 1);
    const fname = String(filename || '').toLowerCase();

    let isVideo = header.includes('video') || /\.(mp4|webm|mov|m4v)$/i.test(fname);
    let ext = 'jpg';
    if (header.includes('png') || fname.endsWith('.png')) ext = 'png';
    else if (header.includes('webp') || fname.endsWith('.webp')) ext = 'webp';
    else if (header.includes('gif') || fname.endsWith('.gif')) ext = 'gif';
    else if (header.includes('webm') || fname.endsWith('.webm')) { ext = 'webm'; isVideo = true; }
    else if (header.includes('mp4') || header.includes('quicktime') || /\.(mp4|mov|m4v)$/i.test(fname)) {
      ext = 'mp4'; isVideo = true;
    } else if (header.includes('jpeg') || header.includes('jpg') || /\.(jpe?g)$/i.test(fname)) {
      ext = 'jpg';
    } else if (isVideo) {
      ext = 'mp4';
    }

    const buf = Buffer.from(b64, 'base64');
    const max = isVideo ? 25 * 1024 * 1024 : 8 * 1024 * 1024;
    if (buf.length > max) {
      return res.status(400).json({ error: isVideo ? 'Vidéo trop lourde (max 25 Mo)' : 'Image trop lourde (max 8 Mo)' });
    }
    if (buf.length < 100) {
      return res.status(400).json({ error: 'Fichier trop petit ou corrompu' });
    }
    const safe = String(filename || (isVideo ? 'video' : 'photo')).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'file';
    const name = Date.now() + '_' + safe + '.' + ext;
    fs.writeFileSync(path.join(uploadsDir, name), buf);
    res.json({ success: true, url: '/uploads/' + name, type: isVideo ? 'video' : 'image' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur upload' });
  }
});

app.get('/api/products', (req, res) => {
  try { res.json(getProducts(true)); }
  catch (err) { console.error(err); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.get('/api/categories', (req, res) => {
  try { res.json(getCategories()); }
  catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
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
      if (!p) return res.status(400).json({ error: 'Produit invalide' });
      const offers = p.offers || [];
      const offer = offers[Number(item.offer_index)];
      if (!offer) return res.status(400).json({ error: 'Offre invalide' });
      const count = Math.max(1, Number(item.count) || 1);
      const line = offer.price * count;
      total += line;
      validatedItems.push({
        id: p.id,
        name: p.name,
        offer_label: offer.label || `${offer.qty} ${offer.unit}`,
        qty: offer.qty,
        unit: offer.unit,
        count,
        price: offer.price,
        line_total: line
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
    res.json({ success: true, categories: saveCategories(list) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erreur catégories' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✨ Neverland écoute sur le port ${PORT}`);
});
