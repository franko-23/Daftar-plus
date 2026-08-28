/**
 * Daftari Plus — backend v4 (multi-tenant + reports, zero external dependencies)
 * -----------------------------------------------------
 * Multi-tenancy: every business is isolated. Registering as 'admin'
 * creates a new business and generates a unique Business Code.
 * Registering as 'saler' requires an existing Business Code to join
 * that specific business. All data is scoped to business_id.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const FRONTEND_DIR = path.join(__dirname, '..');
const DB_PATH = path.join(__dirname, 'data', 'daftari.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS businesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    owner_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    business_id INTEGER NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'saler',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    buy_price REAL NOT NULL,
    sell_price REAL NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    sell_price REAL NOT NULL,
    buy_price REAL NOT NULL,
    total REAL NOT NULL,
    sold_by INTEGER NOT NULL,
    sold_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    created_by INTEGER NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS debts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    person_name TEXT NOT NULL,
    description TEXT,
    amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'unpaid',
    created_by INTEGER NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

function generateBusinessCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(chars.length)];
    const existing = db.prepare('SELECT id FROM businesses WHERE code = ?').get(code);
    if (!existing) return code;
  }
  throw new Error('Imeshindwa kutengeneza code ya kipekee.');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
  return token;
}

function getUserByToken(token) {
  if (!token) return null;
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return db.prepare('SELECT id, full_name, business_id, email, role, created_at FROM users WHERE id = ?').get(session.user_id);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function getBearerToken(req) {
  const auth = req.headers['authorization'] || '';
  const match = auth.match(/^Bearer (.+)$/);
  return match ? match[1] : null;
}

function parseQuery(req) {
  const idx = req.url.indexOf('?');
  if (idx === -1) return {};
  const params = new URLSearchParams(req.url.slice(idx + 1));
  return Object.fromEntries(params.entries());
}

function requireAuth(req, res) {
  const user = getUserByToken(getBearerToken(req));
  if (!user) { sendJSON(res, 401, { error: 'Haujaingia (unauthorized).' }); return null; }
  return user;
}

function requireAdmin(req, res) {
  const user = requireAuth(req, res);
  if (!user) return null;
  if (user.role !== 'admin') { sendJSON(res, 403, { error: 'Ruhusa hii ni ya Admin pekee.' }); return null; }
  return user;
}

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
};

function serveStatic(req, res) {
  let filePath = req.url.split('?')[0];
  if (filePath === '/') filePath = '/index.html';
  const fullPath = path.join(FRONTEND_DIR, filePath);
  if (!fullPath.startsWith(FRONTEND_DIR)) { res.writeHead(403); return res.end('Forbidden'); }

  fs.readFile(fullPath, (err, content) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

async function handleRegister(req, res) {
  let body;
  try { body = await readBody(req); } catch { return sendJSON(res, 400, { error: 'Invalid JSON' }); }

  const fullName = (body.fullName || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const role = body.role === 'admin' ? 'admin' : 'saler';

  if (!fullName || !email || !password) {
    return sendJSON(res, 400, { error: 'Jina, email na password vinahitajika.' });
  }
  if (!isValidEmail(email)) {
    return sendJSON(res, 400, { error: 'Email si sahihi.' });
  }
  if (password.length < 8) {
    return sendJSON(res, 400, { error: 'Password lazima iwe na angalau herufi 8.' });
  }

  const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existingUser) {
    return sendJSON(res, 409, { error: 'Email hii tayari imesajiliwa.' });
  }

  let businessId;

  if (role === 'admin') {
    const businessName = (body.businessName || '').trim();
    if (!businessName) {
      return sendJSON(res, 400, { error: 'Jina la biashara linahitajika kwa Admin.' });
    }
    const code = generateBusinessCode();
    const bizResult = db.prepare('INSERT INTO businesses (name, code) VALUES (?, ?)').run(businessName, code);
    businessId = Number(bizResult.lastInsertRowid);
  } else {
    const businessCode = (body.businessCode || '').trim().toUpperCase();
    if (!businessCode) {
      return sendJSON(res, 400, { error: 'Business Code inahitajika kwa Muuzaji.' });
    }
    const business = db.prepare('SELECT id FROM businesses WHERE code = ?').get(businessCode);
    if (!business) {
      return sendJSON(res, 404, { error: 'Business Code hii haipo. Uliza Admin wako akupe code sahihi.' });
    }
    businessId = business.id;
  }

  const passwordHash = hashPassword(password);
  const result = db.prepare(
    'INSERT INTO users (full_name, business_id, email, password_hash, role) VALUES (?, ?, ?, ?, ?)'
  ).run(fullName, businessId, email, passwordHash, role);

  const userId = Number(result.lastInsertRowid);

  if (role === 'admin') {
    db.prepare('UPDATE businesses SET owner_id = ? WHERE id = ?').run(userId, businessId);
  }

  const token = createSession(userId);
  const user = db.prepare('SELECT id, full_name, business_id, email, role, created_at FROM users WHERE id = ?').get(userId);
  const business = db.prepare('SELECT name, code FROM businesses WHERE id = ?').get(businessId);

  sendJSON(res, 201, { token, user, business });
}

async function handleLogin(req, res) {
  let body;
  try { body = await readBody(req); } catch { return sendJSON(res, 400, { error: 'Invalid JSON' }); }

  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';

  if (!email || !password) {
    return sendJSON(res, 400, { error: 'Email na password vinahitajika.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return sendJSON(res, 401, { error: 'Email au password si sahihi.' });
  }

  const token = createSession(user.id);
  const business = db.prepare('SELECT name, code FROM businesses WHERE id = ?').get(user.business_id);
  sendJSON(res, 200, {
    token,
    user: { id: user.id, full_name: user.full_name, business_id: user.business_id, email: user.email, role: user.role, created_at: user.created_at },
    business
  });
}

function handleMe(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  const business = db.prepare('SELECT name, code FROM businesses WHERE id = ?').get(user.business_id);
  sendJSON(res, 200, { user, business });
}

function handleLogout(req, res) {
  const token = getBearerToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  sendJSON(res, 200, { ok: true });
}

function handleBusiness(req, res) {
  const user = requireAdmin(req, res);
  if (!user) return;
  const business = db.prepare('SELECT name, code FROM businesses WHERE id = ?').get(user.business_id);
  sendJSON(res, 200, { business });
}

function handleProductsGet(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  const rows = db.prepare('SELECT * FROM products WHERE business_id = ? ORDER BY name ASC').all(user.business_id);
  const out = rows.map(p => user.role === 'admin' ? p : { id: p.id, name: p.name, sell_price: p.sell_price, quantity: p.quantity });
  sendJSON(res, 200, { products: out });
}

async function handleProductsPost(req, res) {
  const user = requireAdmin(req, res);
  if (!user) return;
  let body;
  try { body = await readBody(req); } catch { return sendJSON(res, 400, { error: 'Invalid JSON' }); }

  const name = (body.name || '').trim();
  const buyPrice = Number(body.buyPrice);
  const sellPrice = Number(body.sellPrice);
  const quantity = Number.isFinite(Number(body.quantity)) ? Number(body.quantity) : 0;

  if (!name || !Number.isFinite(buyPrice) || !Number.isFinite(sellPrice)) {
    return sendJSON(res, 400, { error: 'Jina, bei ya kununua na bei ya kuuza vinahitajika.' });
  }

  const result = db.prepare(
    'INSERT INTO products (business_id, name, buy_price, sell_price, quantity, created_by) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(user.business_id, name, buyPrice, sellPrice, quantity, user.id);

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(result.lastInsertRowid));
  sendJSON(res, 201, { product });
}

async function handleProductPut(req, res, id) {
  const user = requireAdmin(req, res);
  if (!user) return;
  let body;
  try { body = await readBody(req); } catch { return sendJSON(res, 400, { error: 'Invalid JSON' }); }

  const existing = db.prepare('SELECT * FROM products WHERE id = ? AND business_id = ?').get(id, user.business_id);
  if (!existing) return sendJSON(res, 404, { error: 'Bidhaa haipo.' });

  const name = body.name !== undefined ? String(body.name).trim() : existing.name;
  const buyPrice = body.buyPrice !== undefined ? Number(body.buyPrice) : existing.buy_price;
  const sellPrice = body.sellPrice !== undefined ? Number(body.sellPrice) : existing.sell_price;
  const quantity = body.quantity !== undefined ? Number(body.quantity) : existing.quantity;

  db.prepare(
    `UPDATE products SET name = ?, buy_price = ?, sell_price = ?, quantity = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(name, buyPrice, sellPrice, quantity, id);

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  sendJSON(res, 200, { product });
}

function handleProductDelete(req, res, id) {
  const user = requireAdmin(req, res);
  if (!user) return;
  db.prepare('DELETE FROM products WHERE id = ? AND business_id = ?').run(id, user.business_id);
  sendJSON(res, 200, { ok: true });
}

function handleSalesGet(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  const rows = db.prepare('SELECT * FROM sales WHERE business_id = ? ORDER BY created_at DESC LIMIT 200').all(user.business_id);
  const out = rows.map(s => {
    if (user.role === 'admin') {
      return { ...s, profit: (s.sell_price - s.buy_price) * s.quantity };
    }
    const { buy_price, ...rest } = s;
    return rest;
  });
  sendJSON(res, 200, { sales: out });
}

async function handleSalesPost(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  let body;
  try { body = await readBody(req); } catch { return sendJSON(res, 400, { error: 'Invalid JSON' }); }

  const productId = Number(body.productId);
  const quantity = Number(body.quantity);

  if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
    return sendJSON(res, 400, { error: 'Chagua bidhaa na idadi sahihi.' });
  }

  const product = db.prepare('SELECT * FROM products WHERE id = ? AND business_id = ?').get(productId, user.business_id);
  if (!product) return sendJSON(res, 404, { error: 'Bidhaa haipo.' });
  if (product.quantity < quantity) {
    return sendJSON(res, 400, { error: `Stock haitoshi. Iliyopo: ${product.quantity}.` });
  }

  const total = product.sell_price * quantity;

  db.prepare("UPDATE products SET quantity = quantity - ?, updated_at = datetime('now') WHERE id = ?").run(quantity, productId);

  const result = db.prepare(
    `INSERT INTO sales (business_id, product_id, product_name, quantity, sell_price, buy_price, total, sold_by, sold_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(user.business_id, productId, product.name, quantity, product.sell_price, product.buy_price, total, user.id, user.full_name);

  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(Number(result.lastInsertRowid));
  sendJSON(res, 201, { sale: user.role === 'admin' ? sale : (({ buy_price, ...rest }) => rest)(sale) });
}

function handleExpensesGet(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  const rows = db.prepare('SELECT * FROM expenses WHERE business_id = ? ORDER BY created_at DESC LIMIT 200').all(user.business_id);
  sendJSON(res, 200, { expenses: rows });
}

async function handleExpensesPost(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  let body;
  try { body = await readBody(req); } catch { return sendJSON(res, 400, { error: 'Invalid JSON' }); }

  const description = (body.description || '').trim();
  const amount = Number(body.amount);

  if (!description || !Number.isFinite(amount) || amount <= 0) {
    return sendJSON(res, 400, { error: 'Maelezo na kiasi sahihi vinahitajika.' });
  }

  const result = db.prepare(
    'INSERT INTO expenses (business_id, description, amount, created_by, created_by_name) VALUES (?, ?, ?, ?, ?)'
  ).run(user.business_id, description, amount, user.id, user.full_name);

  const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(Number(result.lastInsertRowid));
  sendJSON(res, 201, { expense });
}

function handleDebtsGet(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  const rows = db.prepare('SELECT * FROM debts WHERE business_id = ? ORDER BY created_at DESC LIMIT 200').all(user.business_id);
  sendJSON(res, 200, { debts: rows });
}

async function handleDebtsPost(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  let body;
  try { body = await readBody(req); } catch { return sendJSON(res, 400, { error: 'Invalid JSON' }); }

  const personName = (body.personName || '').trim();
  const description = (body.description || '').trim();
  const amount = Number(body.amount);

  if (!personName || !Number.isFinite(amount) || amount <= 0) {
    return sendJSON(res, 400, { error: 'Jina la mtu na kiasi sahihi vinahitajika.' });
  }

  const result = db.prepare(
    'INSERT INTO debts (business_id, person_name, description, amount, created_by, created_by_name) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(user.business_id, personName, description || null, amount, user.id, user.full_name);

  const debt = db.prepare('SELECT * FROM debts WHERE id = ?').get(Number(result.lastInsertRowid));
  sendJSON(res, 201, { debt });
}

async function handleDebtPut(req, res, id) {
  const user = requireAuth(req, res);
  if (!user) return;
  let body;
  try { body = await readBody(req); } catch { return sendJSON(res, 400, { error: 'Invalid JSON' }); }

  const existing = db.prepare('SELECT id FROM debts WHERE id = ? AND business_id = ?').get(id, user.business_id);
  if (!existing) return sendJSON(res, 404, { error: 'Deni halipo.' });

  const status = body.status === 'paid' ? 'paid' : 'unpaid';
  db.prepare('UPDATE debts SET status = ? WHERE id = ?').run(status, id);
  const debt = db.prepare('SELECT * FROM debts WHERE id = ?').get(id);
  sendJSON(res, 200, { debt });
}

function handleDashboard(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;

  const salesAgg = db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(total),0) as revenue FROM sales WHERE business_id = ?').get(user.business_id);
  const expensesAgg = db.prepare('SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE business_id = ?').get(user.business_id);
  const debtsAgg = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM debts WHERE business_id = ? AND status = 'unpaid'").get(user.business_id);
  const productCount = db.prepare('SELECT COUNT(*) as count FROM products WHERE business_id = ?').get(user.business_id);
  const lowStock = db.prepare('SELECT id, name, quantity FROM products WHERE business_id = ? AND quantity <= 5 ORDER BY quantity ASC LIMIT 10').all(user.business_id);

  const base = {
    totalSales: salesAgg.count,
    totalRevenue: salesAgg.revenue,
    totalExpenses: expensesAgg.total,
    totalDebts: debtsAgg.total,
    productCount: productCount.count,
    lowStock,
  };

  if (user.role === 'admin') {
    const costAgg = db.prepare('SELECT COALESCE(SUM(buy_price * quantity),0) as cost FROM sales WHERE business_id = ?').get(user.business_id);
    base.totalCost = costAgg.cost;
    base.totalProfit = salesAgg.revenue - costAgg.cost - expensesAgg.total;
  }

  sendJSON(res, 200, { summary: base, role: user.role });
}

function handleReports(req, res, query) {
  const user = requireAdmin(req, res);
  if (!user) return;

  const from = query.from ? `${query.from} 00:00:00` : '1970-01-01 00:00:00';
  const to = query.to ? `${query.to} 23:59:59` : '2999-12-31 23:59:59';

  const sales = db.prepare(
    'SELECT id, created_at, quantity, sell_price, buy_price, total FROM sales WHERE business_id = ? AND created_at BETWEEN ? AND ? ORDER BY created_at ASC'
  ).all(user.business_id, from, to);

  const expenses = db.prepare(
    'SELECT id, created_at, amount FROM expenses WHERE business_id = ? AND created_at BETWEEN ? AND ? ORDER BY created_at ASC'
  ).all(user.business_id, from, to);

  const earliest = db.prepare(
    'SELECT MIN(created_at) as first FROM sales WHERE business_id = ?'
  ).get(user.business_id);

  sendJSON(res, 200, { sales, expenses, earliest: earliest.first });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return sendJSON(res, 204, {});

  const url = req.url.split('?')[0];

  if (url === '/api/register' && req.method === 'POST') return handleRegister(req, res);
  if (url === '/api/login' && req.method === 'POST') return handleLogin(req, res);
  if (url === '/api/me' && req.method === 'GET') return handleMe(req, res);
  if (url === '/api/logout' && req.method === 'POST') return handleLogout(req, res);
  if (url === '/api/business' && req.method === 'GET') return handleBusiness(req, res);

  if (url === '/api/products' && req.method === 'GET') return handleProductsGet(req, res);
  if (url === '/api/products' && req.method === 'POST') return handleProductsPost(req, res);
  const productMatch = url.match(/^\/api\/products\/(\d+)$/);
  if (productMatch && req.method === 'PUT') return handleProductPut(req, res, Number(productMatch[1]));
  if (productMatch && req.method === 'DELETE') return handleProductDelete(req, res, Number(productMatch[1]));

  if (url === '/api/sales' && req.method === 'GET') return handleSalesGet(req, res);
  if (url === '/api/sales' && req.method === 'POST') return handleSalesPost(req, res);

  if (url === '/api/expenses' && req.method === 'GET') return handleExpensesGet(req, res);
  if (url === '/api/expenses' && req.method === 'POST') return handleExpensesPost(req, res);

  if (url === '/api/debts' && req.method === 'GET') return handleDebtsGet(req, res);
  if (url === '/api/debts' && req.method === 'POST') return handleDebtsPost(req, res);
  const debtMatch = url.match(/^\/api\/debts\/(\d+)$/);
  if (debtMatch && req.method === 'PUT') return handleDebtPut(req, res, Number(debtMatch[1]));

  if (url === '/api/dashboard' && req.method === 'GET') return handleDashboard(req, res);
  if (url === '/api/reports' && req.method === 'GET') return handleReports(req, res, parseQuery(req));

  if (url.startsWith('/api/')) return sendJSON(res, 404, { error: 'Not found' });

  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Daftari Plus backend running at http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
});
