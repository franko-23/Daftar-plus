/**
 * Daftari Plus — backend (zero external dependencies)
 * -----------------------------------------------------
 * Uses only Node.js built-in modules: http, node:sqlite, node:crypto, fs, path.
 * Run with:  node server.js
 * Requires Node.js v22.5+ (for the built-in node:sqlite module).
 *
 * Endpoints:
 *   POST /api/register   { fullName, businessName, email, password } -> { token, user }
 *   POST /api/login       { email, password }                        -> { token, user }
 *   GET  /api/me          (Authorization: Bearer <token>)             -> { user }
 *   POST /api/logout      (Authorization: Bearer <token>)             -> { ok: true }
 *
 * Also serves the static frontend (index.html, register.html, login.html, css/)
 * from the ../ folder, so you can run this one file and open http://localhost:3000
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const FRONTEND_DIR = path.join(__dirname, '..');
const DB_PATH = path.join(__dirname, 'data', 'daftari.db');

// ---------- Database setup ----------

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    business_name TEXT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// ---------- Password hashing (scrypt, built into Node's crypto) ----------

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

// ---------- Sessions ----------

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(); // 30 days
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
  return db.prepare('SELECT id, full_name, business_name, email, created_at FROM users WHERE id = ?').get(session.user_id);
}

// ---------- Validation helpers ----------

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---------- HTTP helpers ----------

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

// ---------- Static file serving ----------

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

// ---------- API routes ----------

async function handleRegister(req, res) {
  let body;
  try { body = await readBody(req); } catch { return sendJSON(res, 400, { error: 'Invalid JSON' }); }

  const fullName = (body.fullName || '').trim();
  const businessName = (body.businessName || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';

  if (!fullName || !email || !password) {
    return sendJSON(res, 400, { error: 'Jina, email na password vinahitajika.' });
  }
  if (!isValidEmail(email)) {
    return sendJSON(res, 400, { error: 'Email si sahihi.' });
  }
  if (password.length < 8) {
    return sendJSON(res, 400, { error: 'Password lazima iwe na angalau herufi 8.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return sendJSON(res, 409, { error: 'Email hii tayari imesajiliwa.' });
  }

  const passwordHash = hashPassword(password);
  const result = db.prepare(
    'INSERT INTO users (full_name, business_name, email, password_hash) VALUES (?, ?, ?, ?)'
  ).run(fullName, businessName || null, email, passwordHash);

  const userId = Number(result.lastInsertRowid);
  const token = createSession(userId);
  const user = db.prepare('SELECT id, full_name, business_name, email, created_at FROM users WHERE id = ?').get(userId);

  sendJSON(res, 201, { token, user });
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
  sendJSON(res, 200, {
    token,
    user: { id: user.id, full_name: user.full_name, business_name: user.business_name, email: user.email, created_at: user.created_at }
  });
}

function handleMe(req, res) {
  const token = getBearerToken(req);
  const user = getUserByToken(token);
  if (!user) return sendJSON(res, 401, { error: 'Haujaingia (unauthorized).' });
  sendJSON(res, 200, { user });
}

function handleLogout(req, res) {
  const token = getBearerToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  sendJSON(res, 200, { ok: true });
}

// ---------- Server ----------

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return sendJSON(res, 204, {});
  }

  if (req.url === '/api/register' && req.method === 'POST') return handleRegister(req, res);
  if (req.url === '/api/login' && req.method === 'POST') return handleLogin(req, res);
  if (req.url === '/api/me' && req.method === 'GET') return handleMe(req, res);
  if (req.url === '/api/logout' && req.method === 'POST') return handleLogout(req, res);

  if (req.url.startsWith('/api/')) {
    return sendJSON(res, 404, { error: 'Not found' });
  }

  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Daftari Plus backend running at http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
});
