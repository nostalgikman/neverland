const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'neverland.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id TEXT PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    points INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    unit TEXT DEFAULT '€',
    category TEXT NOT NULL,
    image_emoji TEXT,
    image_url TEXT,
    active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL,
    username TEXT,
    first_name TEXT,
    items_json TEXT NOT NULL,
    total REAL NOT NULL,
    points_earned INTEGER DEFAULT 5,
    points_spent INTEGER DEFAULT 0,
    delivery_type TEXT NOT NULL,
    telegram_username TEXT,
    address TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Migration douce
try { db.exec(`ALTER TABLE products ADD COLUMN unit TEXT DEFAULT '€'`); } catch (e) {}
try { db.exec(`ALTER TABLE products ADD COLUMN image_url TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE products ADD COLUMN sort_order INTEGER DEFAULT 0`); } catch (e) {}

// Paramètres par défaut (fidélité)
const defaultSettings = {
  points_per_order: '5',
  points_for_reward: '30',
  reward_label: '1 article offert'
};

const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSettingStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

for (const [key, value] of Object.entries(defaultSettings)) {
  if (!getSettingStmt.get(key)) {
    setSettingStmt.run(key, value);
  }
}

const defaultProducts = [
  { name: 'Chocolat des Étoiles', description: 'Tablette noire 70% cacao, parfumée à la vanille de la Forêt Perdue.', price: 12.90, unit: '€', category: 'chocolat', image_emoji: '✨🍫' },
  { name: 'Truffes de la Lune', description: 'Douze truffes crémeuses au cœur fondant, saupoudrées d’or comestible.', price: 18.50, unit: '€', category: 'chocolat', image_emoji: '🌙🍫' },
  { name: 'Carrés de Neverland', description: 'Assortiment de chocolats blancs et noirs aux notes de fruits rouges.', price: 15.00, unit: '€', category: 'chocolat', image_emoji: '🏰🍫' },
  { name: 'Cœur de Pixie', description: 'Chocolat au lait fourré d’une ganache légère aux framboises sauvages.', price: 9.90, unit: '€', category: 'chocolat', image_emoji: '🧚🍫' },
  { name: 'Bouquet Clair de Lune', description: 'Roses blanches et bleuets, enveloppés d’un papier étoilé argenté.', price: 32.00, unit: '€', category: 'fleurs', image_emoji: '🌕🌸' },
  { name: 'Roses de la Forêt', description: 'Roses anciennes rouge profond, parfumées, comme dans un rêve.', price: 28.50, unit: '€', category: 'fleurs', image_emoji: '🌹' },
  { name: 'Étoiles Filantes', description: 'Composition de gypsophile, eucalyptus et petites fleurs lumineuses.', price: 24.00, unit: '€', category: 'fleurs', image_emoji: '💫🌼' },
  { name: 'Couronne de Fées', description: 'Petite couronne de fleurs séchées et fraîches, prête à offrir.', price: 19.90, unit: '€', category: 'fleurs', image_emoji: '👑🌸' }
];

const count = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
if (count === 0) {
  const insert = db.prepare(`
    INSERT INTO products (name, description, price, unit, category, image_emoji)
    VALUES (@name, @description, @price, @unit, @category, @image_emoji)
  `);
  for (const p of defaultProducts) insert.run(p);
  console.log('✨ Produits Neverland initialisés');
}

function getOrCreateUser(telegramId, username, firstName) {
  let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(telegramId));
  if (!user) {
    db.prepare(`INSERT INTO users (telegram_id, username, first_name, points) VALUES (?, ?, ?, 0)`)
      .run(String(telegramId), username || null, firstName || null);
    user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(telegramId));
  } else {
    db.prepare(`UPDATE users SET username = ?, first_name = ?, updated_at = datetime('now') WHERE telegram_id = ?`)
      .run(username || user.username, firstName || user.first_name, String(telegramId));
  }
  return user;
}

function getUserPoints(telegramId) {
  const user = db.prepare('SELECT points FROM users WHERE telegram_id = ?').get(String(telegramId));
  return user ? user.points : 0;
}

function addPoints(telegramId, amount) {
  db.prepare(`UPDATE users SET points = points + ?, updated_at = datetime('now') WHERE telegram_id = ?`)
    .run(amount, String(telegramId));
}

function spendPoints(telegramId, amount) {
  db.prepare(`UPDATE users SET points = points - ?, updated_at = datetime('now') WHERE telegram_id = ?`)
    .run(amount, String(telegramId));
}

function getProducts(activeOnly = true) {
  if (activeOnly) {
    return db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY sort_order, category, id').all();
  }
  return db.prepare('SELECT * FROM products ORDER BY sort_order, category, id').all();
}

function getProduct(id) {
  return db.prepare('SELECT * FROM products WHERE id = ?').get(id);
}

function createProduct(data) {
  const result = db.prepare(`
    INSERT INTO products (name, description, price, unit, category, image_emoji, image_url, active, sort_order)
    VALUES (@name, @description, @price, @unit, @category, @image_emoji, @image_url, @active, @sort_order)
  `).run({
    name: data.name,
    description: data.description || '',
    price: Number(data.price),
    unit: data.unit || '€',
    category: data.category,
    image_emoji: data.image_emoji || '🎁',
    image_url: data.image_url || null,
    active: data.active !== undefined ? (data.active ? 1 : 0) : 1,
    sort_order: data.sort_order || 0
  });
  return result.lastInsertRowid;
}

function updateProduct(id, data) {
  db.prepare(`
    UPDATE products SET
      name = @name, description = @description, price = @price, unit = @unit,
      category = @category, image_emoji = @image_emoji, image_url = @image_url,
      active = @active, sort_order = @sort_order
    WHERE id = @id
  `).run({
    id,
    name: data.name,
    description: data.description || '',
    price: Number(data.price),
    unit: data.unit || '€',
    category: data.category,
    image_emoji: data.image_emoji || '🎁',
    image_url: data.image_url || null,
    active: data.active ? 1 : 0,
    sort_order: data.sort_order || 0
  });
}

function deleteProduct(id) {
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
}

function createOrder(order) {
  const result = db.prepare(`
    INSERT INTO orders (
      telegram_id, username, first_name, items_json, total,
      points_earned, points_spent, delivery_type, telegram_username, address
    ) VALUES (
      @telegram_id, @username, @first_name, @items_json, @total,
      @points_earned, @points_spent, @delivery_type, @telegram_username, @address
    )
  `).run(order);
  return result.lastInsertRowid;
}

function getOrders(limit = 50) {
  return db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT ?').all(limit);
}

function getOrder(id) {
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
}

// ===== Settings (fidélité configurable) =====
function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const obj = {};
  rows.forEach(r => { obj[r.key] = r.value; });
  return {
    points_per_order: parseInt(obj.points_per_order || '5', 10),
    points_for_reward: parseInt(obj.points_for_reward || '30', 10),
    reward_label: obj.reward_label || '1 article offert'
  };
}

function updateSettings(data) {
  if (data.points_per_order !== undefined) {
    setSettingStmt.run('points_per_order', String(data.points_per_order));
  }
  if (data.points_for_reward !== undefined) {
    setSettingStmt.run('points_for_reward', String(data.points_for_reward));
  }
  if (data.reward_label !== undefined) {
    setSettingStmt.run('reward_label', String(data.reward_label));
  }
}

module.exports = {
  db,
  getOrCreateUser,
  getUserPoints,
  addPoints,
  spendPoints,
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  createOrder,
  getOrders,
  getOrder,
  getSettings,
  updateSettings
};
