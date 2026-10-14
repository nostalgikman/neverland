const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'neverland.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id TEXT PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price REAL DEFAULT 0,
    unit TEXT DEFAULT '',
    category TEXT NOT NULL,
    image_emoji TEXT,
    image_url TEXT,
    video_url TEXT,
    active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    offers_json TEXT DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL,
    username TEXT,
    first_name TEXT,
    items_json TEXT NOT NULL,
    total REAL NOT NULL,
    delivery_type TEXT NOT NULL,
    telegram_username TEXT,
    address TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

try { db.exec(`ALTER TABLE products ADD COLUMN unit TEXT DEFAULT ''`); } catch (e) {}
try { db.exec(`ALTER TABLE products ADD COLUMN image_url TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE products ADD COLUMN video_url TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE products ADD COLUMN media_json TEXT DEFAULT '[]'`); } catch (e) {}
try { db.exec(`ALTER TABLE products ADD COLUMN sort_order INTEGER DEFAULT 0`); } catch (e) {}
try { db.exec(`ALTER TABLE products ADD COLUMN offers_json TEXT DEFAULT '[]'`); } catch (e) {}

const defaultSettings = {
  categories: JSON.stringify([
    { id: 'chocolat', label: 'Chocolat', emoji: '🍫', sort: 1 },
    { id: 'fleurs', label: 'Fleurs', emoji: '🌸', sort: 2 },
    { id: 'poudre', label: 'Poudre', emoji: '✨', sort: 3 }
  ])
};

const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSettingStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(defaultSettings)) {
  if (!getSettingStmt.get(key)) setSettingStmt.run(key, value);
}

function parseOffers(raw) {
  try {
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list)
      ? list.filter(o => o && Number(o.price) >= 0 && (o.qty || o.grams))
          .map(o => ({
            qty: Number(o.qty || o.grams) || 1,
            unit: String(o.unit || 'g').trim() || 'g',
            price: Number(o.price) || 0,
            label: String(o.label || '').trim()
          }))
      : [];
  } catch (e) {
    return [];
  }
}

function parseMedia(row) {
  try {
    const list = JSON.parse(row.media_json || '[]');
    if (Array.isArray(list) && list.length) {
      return list.filter(m => m && m.url).map(m => ({
        type: m.type === 'video' ? 'video' : 'image',
        url: String(m.url)
      }));
    }
  } catch (e) {}
  const media = [];
  if (row.video_url) media.push({ type: 'video', url: row.video_url });
  if (row.image_url) media.push({ type: 'image', url: row.image_url });
  return media;
}

function mapProduct(row) {
  if (!row) return null;
  return Object.assign({}, row, {
    offers: parseOffers(row.offers_json),
    media: parseMedia(row)
  });
}

const defaultProducts = [
  {
    name: 'Chocolat des Étoiles',
    description: 'Tablette noire 70% cacao, parfumée à la vanille de la Forêt Perdue.',
    category: 'chocolat',
    image_emoji: '✨🍫',
    offers_json: JSON.stringify([
      { qty: 1, unit: 'tablette', price: 12.90, label: '1 tablette' },
      { qty: 3, unit: 'tablettes', price: 34.00, label: 'Lot de 3' }
    ])
  },
  {
    name: 'Bouquet Clair de Lune',
    description: 'Roses blanches et bleuets, enveloppés d’un papier étoilé argenté.',
    category: 'fleurs',
    image_emoji: '🌕🌸',
    offers_json: JSON.stringify([{ qty: 1, unit: 'bouquet', price: 32.00, label: '1 bouquet' }])
  },
  {
    name: 'Poudre Étoilée',
    description: 'Poudre fine aux notes sucrées et magiques.',
    category: 'poudre',
    image_emoji: '✨',
    offers_json: JSON.stringify([
      { qty: 5, unit: 'g', price: 5.00, label: '5 g' },
      { qty: 10, unit: 'g', price: 9.00, label: '10 g' }
    ])
  }
];

const count = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
if (count === 0) {
  const insert = db.prepare(`
    INSERT INTO products (name, description, category, image_emoji, offers_json)
    VALUES (@name, @description, @category, @image_emoji, @offers_json)
  `);
  for (const p of defaultProducts) insert.run(p);
  console.log('✨ Produits Neverland initialisés');
}

function getOrCreateUser(telegramId, username, firstName) {
  let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(telegramId));
  if (!user) {
    try {
      db.prepare(`INSERT INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)`)
        .run(String(telegramId), username || null, firstName || null);
    } catch (e) {
      db.prepare(`INSERT OR IGNORE INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)`)
        .run(String(telegramId), username || null, firstName || null);
    }
    user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(telegramId));
  } else {
    db.prepare(`UPDATE users SET username = ?, first_name = ?, updated_at = datetime('now') WHERE telegram_id = ?`)
      .run(username || user.username, firstName || user.first_name, String(telegramId));
  }
  return user;
}

function getProducts(activeOnly = true) {
  const rows = activeOnly
    ? db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY sort_order, category, id').all()
    : db.prepare('SELECT * FROM products ORDER BY sort_order, category, id').all();
  return rows.map(mapProduct);
}

function getProduct(id) {
  return mapProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
}

function createProduct(data) {
  const offers = Array.isArray(data.offers) ? data.offers : parseOffers(data.offers_json);
  const media = Array.isArray(data.media) ? data.media : [];
  const firstImg = media.find(m => m.type === 'image');
  const firstVid = media.find(m => m.type === 'video');
  const result = db.prepare(`
    INSERT INTO products (name, description, price, unit, category, image_emoji, image_url, video_url, media_json, active, sort_order, offers_json)
    VALUES (@name, @description, @price, @unit, @category, @image_emoji, @image_url, @video_url, @media_json, @active, @sort_order, @offers_json)
  `).run({
    name: data.name,
    description: data.description || '',
    price: 0,
    unit: '',
    category: data.category,
    image_emoji: data.image_emoji || '🎁',
    image_url: firstImg ? firstImg.url : (data.image_url || null),
    video_url: firstVid ? firstVid.url : (data.video_url || null),
    media_json: JSON.stringify(media),
    active: data.active !== undefined ? (data.active ? 1 : 0) : 1,
    sort_order: data.sort_order || 0,
    offers_json: JSON.stringify(offers)
  });
  return result.lastInsertRowid;
}

function updateProduct(id, data) {
  const offers = Array.isArray(data.offers) ? data.offers : parseOffers(data.offers_json);
  const media = Array.isArray(data.media) ? data.media : [];
  const firstImg = media.find(m => m.type === 'image');
  const firstVid = media.find(m => m.type === 'video');
  db.prepare(`
    UPDATE products SET
      name = @name, description = @description, category = @category,
      image_emoji = @image_emoji, image_url = @image_url, video_url = @video_url,
      media_json = @media_json, active = @active, sort_order = @sort_order, offers_json = @offers_json
    WHERE id = @id
  `).run({
    id,
    name: data.name,
    description: data.description || '',
    category: data.category,
    image_emoji: data.image_emoji || '🎁',
    image_url: firstImg ? firstImg.url : null,
    video_url: firstVid ? firstVid.url : null,
    media_json: JSON.stringify(media),
    active: data.active ? 1 : 0,
    sort_order: data.sort_order || 0,
    offers_json: JSON.stringify(offers)
  });
}

function deleteProduct(id) {
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
}

function createOrder(data) {
  const result = db.prepare(`
    INSERT INTO orders (telegram_id, username, first_name, items_json, total, delivery_type, telegram_username, address)
    VALUES (@telegram_id, @username, @first_name, @items_json, @total, @delivery_type, @telegram_username, @address)
  `).run(data);
  return result.lastInsertRowid;
}

function getOrders(limit = 50) {
  return db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT ?').all(limit);
}

function getCategories() {
  const row = getSettingStmt.get('categories');
  try {
    const list = JSON.parse(row?.value || '[]');
    if (Array.isArray(list) && list.length) return list.sort((a, b) => (a.sort || 0) - (b.sort || 0));
  } catch (e) {}
  return [
    { id: 'chocolat', label: 'Chocolat', emoji: '🍫', sort: 1 },
    { id: 'fleurs', label: 'Fleurs', emoji: '🌸', sort: 2 },
    { id: 'poudre', label: 'Poudre', emoji: '✨', sort: 3 }
  ];
}

function saveCategories(list) {
  if (!Array.isArray(list)) throw new Error('Liste invalide');
  const cleaned = list.map((c, i) => ({
    id: String(c.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || ('cat' + i),
    label: String(c.label || c.id || 'Catégorie').trim().slice(0, 40),
    emoji: String(c.emoji || '✨').trim().slice(0, 8),
    sort: Number(c.sort) || i + 1
  })).filter(c => c.id && c.label);
  setSettingStmt.run('categories', JSON.stringify(cleaned));
  return cleaned;
}

function renameCategoryOnProducts(oldId, newId) {
  if (!oldId || !newId || oldId === newId) return;
  db.prepare('UPDATE products SET category = ? WHERE category = ?').run(newId, oldId);
}

module.exports = {
  db,
  getOrCreateUser,
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  createOrder,
  getOrders,
  getCategories,
  saveCategories,
  renameCategoryOnProducts
};
