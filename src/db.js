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
    price REAL NOT NULL,
    unit TEXT DEFAULT '€ / g',
    category TEXT NOT NULL,
    image_emoji TEXT,
    image_url TEXT,
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

try { db.exec(`ALTER TABLE products ADD COLUMN unit TEXT DEFAULT '€ / g'`); } catch (e) {}
try { db.exec(`ALTER TABLE products ADD COLUMN image_url TEXT`); } catch (e) {}
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

const defaultProducts = [
  { name: 'Chocolat des Étoiles', description: 'Tablette noire 70% cacao, parfumée à la vanille de la Forêt Perdue.', price: 0.50, unit: '€ / g', category: 'chocolat', image_emoji: '✨🍫', offers_json: JSON.stringify([{ grams: 10, price: 4.50, label: 'Offre 10 g' }]) },
  { name: 'Truffes de la Lune', description: 'Douze truffes crémeuses au cœur fondant.', price: 0.80, unit: '€ / g', category: 'chocolat', image_emoji: '🌙🍫', offers_json: '[]' },
  { name: 'Bouquet Clair de Lune', description: 'Roses blanches et bleuets, enveloppés d’un papier étoilé.', price: 32.00, unit: '€', category: 'fleurs', image_emoji: '🌕🌸', offers_json: '[]' },
  { name: 'Roses de la Forêt', description: 'Roses anciennes rouge profond, parfumées.', price: 28.50, unit: '€', category: 'fleurs', image_emoji: '🌹', offers_json: '[]' },
  { name: 'Poudre Étoilée', description: 'Poudre fine aux notes sucrées et magiques.', price: 1.20, unit: '€ / g', category: 'poudre', image_emoji: '✨', offers_json: JSON.stringify([{ grams: 5, price: 5.00, label: 'Offre 5 g' }, { grams: 10, price: 9.00, label: 'Offre 10 g' }]) }
];

const count = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
if (count === 0) {
  const insert = db.prepare(`
    INSERT INTO products (name, description, price, unit, category, image_emoji, offers_json)
    VALUES (@name, @description, @price, @unit, @category, @image_emoji, @offers_json)
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

function parseOffers(raw) {
  try {
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list.filter(o => o && Number(o.grams) > 0 && Number(o.price) >= 0) : [];
  } catch (e) {
    return [];
  }
}

function mapProduct(row) {
  if (!row) return null;
  return Object.assign({}, row, { offers: parseOffers(row.offers_json) });
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
  const result = db.prepare(`
    INSERT INTO products (name, description, price, unit, category, image_emoji, image_url, active, sort_order, offers_json)
    VALUES (@name, @description, @price, @unit, @category, @image_emoji, @image_url, @active, @sort_order, @offers_json)
  `).run({
    name: data.name,
    description: data.description || '',
    price: Number(data.price),
    unit: data.unit || '€ / g',
    category: data.category,
    image_emoji: data.image_emoji || '🎁',
    image_url: data.image_url || null,
    active: data.active !== undefined ? (data.active ? 1 : 0) : 1,
    sort_order: data.sort_order || 0,
    offers_json: JSON.stringify(offers)
  });
  return result.lastInsertRowid;
}

function updateProduct(id, data) {
  const offers = Array.isArray(data.offers) ? data.offers : parseOffers(data.offers_json);
  db.prepare(`
    UPDATE products SET
      name = @name, description = @description, price = @price, unit = @unit,
      category = @category, image_emoji = @image_emoji, image_url = @image_url,
      active = @active, sort_order = @sort_order, offers_json = @offers_json
    WHERE id = @id
  `).run({
    id,
    name: data.name,
    description: data.description || '',
    price: Number(data.price),
    unit: data.unit || '€ / g',
    category: data.category,
    image_emoji: data.image_emoji || '🎁',
    image_url: data.image_url || null,
    active: data.active ? 1 : 0,
    sort_order: data.sort_order || 0,
    offers_json: JSON.stringify(offers)
  });
}

function deleteProduct(id) {
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
}

function computeLinePrice(product, grams) {
  const g = Number(grams) || 0;
  if (g <= 0) return 0;
  const offers = product.offers || parseOffers(product.offers_json);
  const exact = offers.find(o => Number(o.grams) === g);
  if (exact) return Number(exact.price);
  return Number(product.price) * g;
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

function getOrder(id) {
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
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
  computeLinePrice,
  createOrder,
  getOrders,
  getOrder,
  getCategories,
  saveCategories,
  renameCategoryOnProducts
};
