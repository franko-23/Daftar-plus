/* =========================================================================
   MONETO PREDICTION — LIVE TEST ENGINE  (USDT ya majaribio, hakuna pesa halisi)
   -------------------------------------------------------------------------
   Moduli hii inatumia server + SQLite ya Daftari kama "backend ya majaribio"
   ya ukurasa wa Prediction wa Moneto Exchange (monetotrade.cc).

   - Akaunti za majaribio zisizo na login: kila kivinjari kinapata token yake
     (POST /api/mpx/session). Hazihusiani na watumiaji wa Daftari.
   - Wallet ya USDT ya majaribio: deposit / withdraw (zote ni simulation).
   - Biashara ya hisa (shares) kwa bei halisi ya Polymarket: nunua Yes/No,
     tazama faida/hasara moja kwa moja, cashout (kamili au sehemu) wakati wowote.
   - Soko likifungwa Polymarket: shares za mshindi = 1 USDT kila moja.
   - Data ya soko: Gamma, CLOB (book + history), Data-API (trades).
   - News: RSS za vyanzo vya crypto + Fear&Greed + bei + uwezekano wa soko.

   Routes zote ziko chini ya /api/mpx/*  (CORS wazi — hakuna cookies, token tu).
   ========================================================================= */
'use strict';
const crypto = require('crypto');

const GAMMA = process.env.PM_GAMMA_URL || 'https://gamma-api.polymarket.com';
const CLOB  = process.env.PM_CLOB_URL  || 'https://clob.polymarket.com';
const DATA  = process.env.PM_DATA_URL  || 'https://data-api.polymarket.com';

const MICRO = 1e6;                                   // 1 USDT = 1,000,000 micro
const FEE_BPS = Number(process.env.MPX_FEE_BPS || 100);   // ada ya cashout (1%)
const BUY_MIN = 1, BUY_MAX = 10000;
const DEP_MIN = 10, DEP_MAX = 50000;
const WD_MIN = 10, WD_FEE = 1;
const MAX_OPEN = 100;
const EDGE_LO = 0.02, EDGE_HI = 0.98;
const SLIPPAGE = 0.03;                               // 3% ruhusa ya bei kubadilika
const WD_DELAY_MS = 20 * 1000;                       // withdraw ya majaribio "inakamilika" baada ya sek 20

const NETWORKS = {
  TRC20: { label: 'USDT · TRON (TRC20)',  re: /^T[1-9A-HJ-NP-Za-km-z]{33}$/, demo: 'TTestMonetoDemoDepositAddress000000' },
  BEP20: { label: 'USDT · BNB Chain (BEP20)', re: /^0x[a-fA-F0-9]{40}$/, demo: '0xMoneTo000000000000000000000000DeM0' },
  ERC20: { label: 'USDT · Ethereum (ERC20)', re: /^0x[a-fA-F0-9]{40}$/, demo: '0xMoneTo000000000000000000000000DeM0' }
};

const CATS = {
  all: null, crypto: 'crypto', politics: 'politics', sports: 'sports', economy: 'economy',
  tech: 'tech', world: 'world', culture: 'pop-culture', science: 'science'
};
const SORTS = { volume24hr: 'volume24hr', volume: 'volume', liquidity: 'liquidity', newest: 'startDate', ending: 'endDate' };

const toMicro = n => Math.round(Number(n) * MICRO);
const fromMicro = n => Math.round(Number(n)) / MICRO;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const pj = (v, fb) => { try { return typeof v === 'string' ? JSON.parse(v) : (v || fb); } catch (e) { return fb; } };
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const cleanStr = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);

module.exports = function initMoneto({ db, body, fetchImpl }) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));

  /* ------------------------------------------------------------------ DB */
  db.exec(`
CREATE TABLE IF NOT EXISTS mpx_accounts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE IF NOT EXISTS mpx_tx(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  fee INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  network TEXT,
  address TEXT,
  txid TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  completes_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mpx_tx_acc ON mpx_tx(account_id, id DESC);
CREATE TABLE IF NOT EXISTS mpx_positions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  market_id TEXT NOT NULL,
  token_id TEXT,
  event_id TEXT NOT NULL DEFAULT '',
  event_title TEXT NOT NULL DEFAULT '',
  market_label TEXT NOT NULL DEFAULT '',
  icon TEXT,
  side TEXT NOT NULL CHECK(side IN ('yes','no')),
  entry_price REAL NOT NULL,
  shares REAL NOT NULL,
  cost INTEGER NOT NULL,
  invested INTEGER NOT NULL,
  realized INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  payout INTEGER NOT NULL DEFAULT 0,
  end_date TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  closed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mpx_pos_acc ON mpx_positions(account_id, status);
CREATE INDEX IF NOT EXISTS idx_mpx_pos_mkt ON mpx_positions(market_id, status);
`);

  /* -------------------------------------------------------------- helpers */
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Max-Age': '600'
  };
  function send(res, status, data) {
    res.writeHead(status, Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }, CORS));
    res.end(status === 204 ? '' : JSON.stringify(data));
  }
  const fail = (res, status, error, extra) => send(res, status, Object.assign({ error }, extra || {}));

  const rl = new Map();
  function limited(key, max, windowMs) {
    const now = Date.now();
    const a = (rl.get(key) || []).filter(t => now - t < windowMs);
    if (a.length >= max) { rl.set(key, a); return true; }
    a.push(now); rl.set(key, a);
    if (rl.size > 5000) rl.delete(rl.keys().next().value);
    return false;
  }
  function ip(req) {
    const x = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return x || (req.socket && req.socket.remoteAddress) || '?';
  }
  const hash = t => crypto.createHash('sha256').update(String(t)).digest('hex');

  function authAcc(req, res) {
    const m = (req.headers.authorization || '').match(/^Bearer\s+([a-f0-9]{64})$/i);
    const acc = m ? db.prepare('SELECT * FROM mpx_accounts WHERE token_hash=?').get(hash(m[1])) : null;
    if (!acc) { fail(res, 401, 'Session haipo. Fungua upya ukurasa.'); return null; }
    return acc;
  }
  const getAcc = id => db.prepare('SELECT * FROM mpx_accounts WHERE id=?').get(id);

  async function getJSON(url, ms = 8000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await doFetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json', 'User-Agent': 'MonetoTest/1.0' } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }
  async function getText(url, ms = 8000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await doFetch(url, { signal: ctrl.signal, headers: { Accept: 'application/rss+xml, application/xml, text/xml, */*', 'User-Agent': 'Mozilla/5.0 (compatible; MonetoNews/1.0)' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } finally { clearTimeout(t); }
  }

  /* tiny TTL cache with in-flight de-dup + stale fallback */
  const caches = new Map();
  async function cached(key, ttl, staleMax, loader) {
    const now = Date.now();
    const c = caches.get(key);
    if (c && c.data !== undefined && now - c.at < ttl) return c.data;
    if (c && c.p) return c.p;
    const p = (async () => {
      try {
        const data = await loader();
        caches.set(key, { at: Date.now(), data });
        if (caches.size > 600) caches.delete(caches.keys().next().value);
        return data;
      } catch (e) {
        if (c && c.data !== undefined && Date.now() - c.at < staleMax) { caches.set(key, { at: c.at, data: c.data }); return c.data; }
        caches.delete(key);
        throw e;
      }
    })();
    caches.set(key, Object.assign({}, c || {}, { p }));
    return p;
  }

  /* ---------------------------------------------------- Polymarket market */
  function normMarket(m) {
    if (!m) return null;
    const prices = pj(m.outcomePrices, []);
    const yes = num(prices[0]);
    const tokens = pj(m.clobTokenIds, []);
    return {
      id: String(m.id),
      label: m.groupItemTitle || '',
      question: m.question || '',
      yes,
      bestBid: num(m.bestBid), bestAsk: num(m.bestAsk), last: num(m.lastTradePrice),
      change24h: num(m.oneDayPriceChange),
      change1w: num(m.oneWeekPriceChange),
      volume24hr: num(m.volume24hr) || 0,
      volume: num(m.volumeNum != null ? m.volumeNum : m.volume) || 0,
      liquidity: num(m.liquidityNum != null ? m.liquidityNum : m.liquidity) || 0,
      token: tokens[0] ? String(tokens[0]) : null,
      tokenNo: tokens[1] ? String(tokens[1]) : null,
      conditionId: m.conditionId || null,
      endDate: m.endDate || null,
      closed: !!m.closed,
      active: m.active !== false,
      rawPrices: prices.map(num)
    };
  }
  function normEvent(ev) {
    const ms = (Array.isArray(ev.markets) ? ev.markets : [])
      .filter(m => m && !m.closed && m.active !== false)
      .map(normMarket).filter(m => m && m.yes !== null)
      .sort((a, b) => b.yes - a.yes).slice(0, 25);
    if (!ms.length) return null;
    return {
      id: String(ev.id), slug: ev.slug || '', title: ev.title || '',
      icon: ev.icon || ev.image || null,
      endDate: ev.endDate || null,
      volume: num(ev.volume) || 0, volume24hr: num(ev.volume24hr) || 0,
      liquidity: num(ev.liquidity) || 0, openInterest: num(ev.openInterest) || 0,
      commentCount: Number(ev.commentCount) || 0,
      description: String(ev.description || '').slice(0, 2500),
      resolutionSource: ev.resolutionSource || '',
      tags: (Array.isArray(ev.tags) ? ev.tags : []).map(t => t && (t.label || t.slug)).filter(Boolean).slice(0, 6),
      multi: ms.length > 1,
      markets: ms
    };
  }

  async function fetchEvents({ cat, sort, q, limit }) {
    if (q) {
      const j = await getJSON(GAMMA + '/public-search?' + new URLSearchParams({ q, limit_per_type: String(limit), events_status: 'active' }));
      return ((j && j.events) || []).map(normEvent).filter(Boolean);
    }
    const p = new URLSearchParams({ active: 'true', closed: 'false', order: SORTS[sort] || 'volume24hr', ascending: sort === 'ending' ? 'true' : 'false', limit: String(limit) });
    if (CATS[cat]) p.set('tag_slug', CATS[cat]);
    if (sort === 'ending') p.set('end_date_min', new Date().toISOString());
    const j = await getJSON(GAMMA + '/events?' + p);
    return (Array.isArray(j) ? j : (j && j.events) || []).map(normEvent).filter(Boolean);
  }
  const getEvents = (o) => cached('ev|' + o.cat + '|' + o.sort + '|' + o.q + '|' + o.limit, 20000, 10 * 60000, () => fetchEvents(o));

  /** Fresh single-market quote. maxAge: how stale (ms) we tolerate. */
  async function getMarket(id, maxAge = 6000) {
    if (!/^\d{1,20}$/.test(String(id))) return null;
    const key = 'mk|' + id;
    return cached(key, maxAge, 5 * 60000, async () => {
      const j = await getJSON(GAMMA + '/markets/' + id);
      if (!j) return null;
      const m = normMarket(j);
      m.eventTitle = j.events && j.events[0] ? j.events[0].title : '';
      m.eventId = j.events && j.events[0] ? String(j.events[0].id) : '';
      m.icon = j.icon || j.image || (j.events && j.events[0] && (j.events[0].icon || j.events[0].image)) || null;
      return m;
    });
  }

  const sidePrice = (m, side) => side === 'yes' ? m.yes : 1 - m.yes;
  const r4 = x => Math.round(x * 10000) / 10000;

  /* -------------------------------------------------------------- wallet */
  function addTx(accId, o) {
    db.prepare('INSERT INTO mpx_tx(account_id,type,amount,fee,status,network,address,txid,note,completes_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(accId, o.type, o.amount, o.fee || 0, o.status || 'completed', o.network || null, o.address || null, o.txid || null, o.note || null, o.completes_at || null);
  }
  const fakeTx = () => '0xtest' + crypto.randomBytes(16).toString('hex');
  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; }
  }
  class Biz extends Error { constructor(msg, code) { super(msg); this.code = code || 400; } }

  function refreshWithdrawals(accId) {
    db.prepare("UPDATE mpx_tx SET status='completed' WHERE account_id=? AND type='withdraw' AND status='pending' AND completes_at<=?").run(accId, Date.now());
  }

  /* ------------------------------------------------------------ portfolio */
  function posView(p, m) {
    const live = m && m.yes !== null && !m.closed;
    const cur = live ? sidePrice(m, p.side) : null;
    const base = {
      id: p.id, market_id: p.market_id, token_id: p.token_id, event_id: p.event_id,
      title: p.event_title, label: p.market_label, icon: p.icon, side: p.side,
      entry_price: p.entry_price, shares: r4(p.shares), invested: fromMicro(p.invested),
      cost: fromMicro(p.cost), realized: fromMicro(p.realized), status: p.status,
      payout: fromMicro(p.payout), end_date: p.end_date, created_at: p.created_at, closed_at: p.closed_at
    };
    if (p.status !== 'open') {
      base.pnl = fromMicro((p.status === 'closed' ? p.realized : p.realized + p.payout - p.cost));
      if (p.status === 'void') base.pnl = fromMicro(p.realized + p.payout - p.cost - 0);
      return base;
    }
    base.max_payout = r4(p.shares);                       // kila share = 1 USDT ikishinda
    base.potential_profit = r4(p.shares - fromMicro(p.cost));
    base.win_chance = cur;                                // bei ya upande wako = uwezekano ulioonyeshwa na soko
    base.current_price = cur;
    base.price_change = cur === null ? null : r4(cur - p.entry_price);
    if (cur !== null) {
      const gross = p.shares * cur;
      const net = gross * (1 - FEE_BPS / 10000);
      base.market_value = r4(gross);
      base.cashout_value = r4(net);
      base.pnl = r4(net - fromMicro(p.cost));
      base.pnl_pct = p.cost ? r4(100 * (net - fromMicro(p.cost)) / fromMicro(p.cost)) : 0;
    } else base.cashout_value = null;
    base.market_closed = !!(m && m.closed);
    return base;
  }

  async function marketsFor(ids) {
    const out = {};
    const list = [...new Set(ids)].slice(0, 60);
    let i = 0;
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (i < list.length) {
        const id = list[i++];
        try { out[id] = await getMarket(id, 8000); } catch (e) { out[id] = null; }
      }
    }));
    return out;
  }

  async function portfolio(acc) {
    const rows = db.prepare('SELECT * FROM mpx_positions WHERE account_id=? ORDER BY id DESC LIMIT 300').all(acc.id);
    const open = rows.filter(r => r.status === 'open');
    const mk = await marketsFor(open.map(r => r.market_id));
    const openV = open.map(p => posView(p, mk[p.market_id]));
    const hist = rows.filter(r => r.status !== 'open').slice(0, 100).map(p => posView(p, null));
    const costOpen = open.reduce((s, p) => s + p.cost, 0);
    const value = openV.reduce((s, p) => s + (p.cashout_value != null ? p.cashout_value : fromMicro(open.find(o => o.id === p.id).cost)), 0);
    const realizedAll = rows.reduce((s, p) => s + p.realized + (['won', 'lost', 'void'].includes(p.status) ? p.payout - p.cost : 0), 0);
    return {
      open: openV, history: hist,
      summary: {
        positions_value: r4(value), invested_open: fromMicro(costOpen),
        unrealized_pnl: r4(value - fromMicro(costOpen)),
        realized_pnl: fromMicro(realizedAll),
        equity: r4(fromMicro(acc.balance) + value),
        wins: rows.filter(r => r.status === 'won' || (r.status === 'closed' && r.realized > 0)).length,
        losses: rows.filter(r => r.status === 'lost' || (r.status === 'closed' && r.realized < 0)).length
      }
    };
  }

  /* ----------------------------------------------------------- settlement */
  function settleMarket(marketId, result) {
    const picks = db.prepare("SELECT * FROM mpx_positions WHERE market_id=? AND status='open'").all(marketId);
    if (!picks.length) return 0;
    tx(() => {
      for (const p of picks) {
        let status, payout;
        if (result === 'void') { status = 'void'; payout = p.cost; }
        else if (result === p.side) { status = 'won'; payout = Math.floor(p.shares * MICRO); }
        else { status = 'lost'; payout = 0; }
        db.prepare("UPDATE mpx_positions SET status=?, payout=?, closed_at=datetime('now') WHERE id=?").run(status, payout, p.id);
        if (payout > 0) {
          db.prepare('UPDATE mpx_accounts SET balance=balance+? WHERE id=?').run(payout, p.account_id);
          addTx(p.account_id, { type: status === 'void' ? 'refund' : 'payout', amount: payout, note: (p.event_title + ' · ' + p.market_label).slice(0, 160) });
        }
      }
    });
    return picks.length;
  }
  function resultOf(m) {
    const y = m.rawPrices[0], n = m.rawPrices[1];
    if (y == null || n == null) return null;
    if (y >= 0.99 && n <= 0.01) return 'yes';
    if (n >= 0.99 && y <= 0.01) return 'no';
    if (Math.abs(y - 0.5) < 0.01 && Math.abs(n - 0.5) < 0.01) return 'void';
    return null;
  }
  let settling = false, lastSettle = 0;
  async function settleAll() {
    if (settling) return; settling = true; lastSettle = Date.now();
    try {
      const ids = db.prepare("SELECT DISTINCT market_id FROM mpx_positions WHERE status='open' LIMIT 80").all();
      for (const r of ids) {
        let m; try { m = await getMarket(r.market_id, 0); } catch (e) { continue; }
        if (!m || !m.closed) continue;
        const res = resultOf(m);
        if (res) settleMarket(r.market_id, res);
      }
    } catch (e) { console.error('[mpx] settle', e.message); }
    finally { settling = false; }
  }
  const maybeSettle = () => { if (Date.now() - lastSettle > 45000) settleAll().catch(() => {}); };

  /* ----------------------------------------------------------------- news */
  const FEEDS = [
    { id: 'coindesk', name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
    { id: 'cointelegraph', name: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
    { id: 'decrypt', name: 'Decrypt', url: 'https://decrypt.co/feed' },
    { id: 'theblock', name: 'The Block', url: 'https://www.theblock.co/rss.xml' },
    { id: 'bitcoinmagazine', name: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/.rss/full/' },
    { id: 'cryptoslate', name: 'CryptoSlate', url: 'https://cryptoslate.com/feed/' },
    { id: 'cryptopotato', name: 'CryptoPotato', url: 'https://cryptopotato.com/feed/' },
    { id: 'bitcoinist', name: 'Bitcoinist', url: 'https://bitcoinist.com/feed/' },
    { id: 'newsbtc', name: 'NewsBTC', url: 'https://www.newsbtc.com/feed/' },
    { id: 'utoday', name: 'U.Today', url: 'https://u.today/rss' }
  ];
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…' };
  const unent = s => String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const c = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return c > 0 && c < 0x10ffff ? String.fromCodePoint(c) : ''; }
    return ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m;
  });
  const strip = s => unent(String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  function tag(block, name) {
    const m = block.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i'));
    return m ? m[1] : '';
  }
  function attr(block, tagName, a) {
    const m = block.match(new RegExp('<' + tagName + '\\s[^>]*?' + a + '\\s*=\\s*["\']([^"\']+)["\']', 'i'));
    return m ? unent(m[1]) : '';
  }
  function cleanSummary(sum, title, source) {
    let t = String(sum || '');
    t = t.replace(/\s*(The|This) (post|article|story)\b[\s\S]*$/i, '').replace(/\s*appeared first on[\s\S]*$/i, '')
         .replace(/\s*\[?(…|\.\.\.)\]?\s*(Read more|Continue reading)?[\s\S]{0,20}$/i, m => /read|continue/i.test(m) ? '' : m);
    const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (source) t = t.replace(new RegExp('^' + esc(source) + '\\s+', 'i'), '');
    if (title) { const a = title.toLowerCase(), b = t.toLowerCase(); if (b.startsWith(a)) t = t.slice(title.length).replace(/^[\s:–—.-]+/, ''); }
    t = t.replace(/^[\s,:;–—.-]+/, '').trim();
    if (t) t = t[0].toUpperCase() + t.slice(1);
    if (t.length < 25 || t.toLowerCase() === String(title).toLowerCase()) return '';
    return t.slice(0, 260);
  }
  function safeUrl(u) { try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : ''; } catch (e) { return ''; } }

  function parseFeed(xml, src) {
    const items = [];
    const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
    for (const b of blocks.slice(0, 30)) {
      const title = strip(tag(b, 'title'));
      let link = strip(tag(b, 'link')) || attr(b, 'link', 'href');
      link = safeUrl(link);
      if (!title || !link) continue;
      const date = new Date(strip(tag(b, 'pubDate')) || strip(tag(b, 'published')) || strip(tag(b, 'updated')) || strip(tag(b, 'dc:date')));
      const rawDesc = tag(b, 'description') || tag(b, 'summary') || tag(b, 'content:encoded');
      const full = tag(b, 'content:encoded') || rawDesc;
      let img = attr(b, 'media:content', 'url') || attr(b, 'media:thumbnail', 'url') || attr(b, 'enclosure', 'url');
      if (!img) { const m = unent(full).match(/<img[^>]+src=["']([^"']+)["']/i) || full.match(/<img[^>]+src=["']([^"']+)["']/i); img = m ? m[1] : ''; }
      img = safeUrl(img);
      const cats = [...b.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi)].map(m => strip(m[1])).filter(Boolean).slice(0, 5);
      const it = {
        id: crypto.createHash('md5').update(link).digest('hex').slice(0, 12),
        title: title.slice(0, 220),
        summary: cleanSummary(strip(rawDesc), title, src.name),
        url: link, image: img || null,
        source: src.name, source_id: src.id,
        author: strip(tag(b, 'dc:creator') || tag(b, 'author')).slice(0, 60) || null,
        ts: isNaN(date) ? Date.now() : date.getTime(),
        cats
      };
      Object.assign(it, analyze(it));
      items.push(it);
    }
    return items;
  }

  const COINS = [
    ['BTC', /\b(bitcoin|btc)\b/i], ['ETH', /\b(ethereum|ether|eth)\b/i], ['SOL', /\b(solana|sol)\b/i],
    ['XRP', /\b(xrp|ripple)\b/i], ['BNB', /\b(bnb|binance coin)\b/i], ['DOGE', /\b(dogecoin|doge)\b/i],
    ['ADA', /\b(cardano|ada)\b/i], ['USDT', /\b(tether|usdt|stablecoins?|usdc)\b/i]
  ];
  const TOPICS = [
    ['ETF', /\betfs?\b/i], ['Regulation', /\b(SEC|CFTC|MiCA|regulat\w*|lawsuit|legislation|congress)\b/],
    ['DeFi', /\b(defi|dex|dexs)\b/i], ['Macro', /\b(the fed|fomc|inflation|cpi|rate cuts?|interest rates?|tariffs?|recession)\b/i],
    ['Hacks', /\b(hack\w*|exploit\w*|stolen|breach|rug)\b/i]
  ];
  const BULL = /\b(surge[sd]?|soar\w*|rall(y|ies|ied)|jump\w*|rall|bullish|breakout|all-time high|ath|record high|gains?|climb\w*|rebound\w*|upside|rises?|pump\w*|buy)\b/i;
  const BEAR = /\b(plung\w*|crash\w*|drop\w*|fall[s]?|slump\w*|bearish|sell-?off|dump\w*|tumble\w*|slide[s]?|decline\w*|downside|liquidat\w*|loss(es)?|fear|hack\w*)\b/i;
  const PRED = /\b(predict\w*|forecast\w*|price target|could (hit|reach|surge|drop|crash|fall|rally)|may (hit|reach|surge|drop|crash|fall|rally)|expects?|projects?|outlook|sees?\b.*\$|targets?|will (hit|reach)|analysts?|strategists?)\b/i;
  function analyze(it) {
    const text = it.title + ' ' + it.summary;
    const coins = COINS.filter(c => c[1].test(it.title)).map(c => c[0]);
    if (!coins.length) COINS.forEach(c => { if (c[1].test(text) && coins.length < 2) coins.push(c[0]); });
    const topics = TOPICS.filter(t => t[1].test(text)).map(t => t[0]).slice(0, 2);
    const bull = (it.title.match(BULL) ? 2 : 0) + (it.summary.match(BULL) ? 1 : 0);
    const bear = (it.title.match(BEAR) ? 2 : 0) + (it.summary.match(BEAR) ? 1 : 0);
    const sentiment = bull > bear ? 'bullish' : bear > bull ? 'bearish' : 'neutral';
    const isPred = PRED.test(it.title) || (PRED.test(it.summary) && /\$\s?\d/.test(text));
    const targets = [];
    for (const m of it.title.concat(' ', it.summary).matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)\s?(k|m|b|thousand|million|billion|trillion)?\b/gi)) {
      let v = parseFloat(m[1].replace(/,/g, '')); const u = (m[2] || '').toLowerCase();
      if (u === 'k' || u === 'thousand') v *= 1e3; else if (u === 'm' || u === 'million') v *= 1e6; else if (u === 'b' || u === 'billion') v *= 1e9; else if (u === 'trillion') v *= 1e12;
      if (Number.isFinite(v) && v >= 0.01 && !targets.includes(v) && targets.length < 2) targets.push(v);
    }
    return { coins, topics, sentiment, kind: isPred ? 'prediction' : 'news', targets: isPred ? targets : [] };
  }

  async function loadNews() {
    const status = {};
    const results = await Promise.all(FEEDS.map(async f => {
      try {
        const items = parseFeed(await getText(f.url, 8000), f);
        status[f.id] = items.length;
        return items;
      } catch (e) { status[f.id] = 0; return []; }
    }));
    const seen = new Set();
    const all = results.flat().filter(i => { const k = i.title.toLowerCase().replace(/\W+/g, '').slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; })
      .filter(i => i.ts < Date.now() + 3600e3)
      .sort((a, b) => b.ts - a.ts).slice(0, 300);
    if (!all.length) throw new Error('no feeds');
    return { items: all, status, at: Date.now() };
  }
  const getNews = () => cached('news', 5 * 60000, 3 * 3600e3, loadNews);

  function sentimentOf(items, coin) {
    const cut = Date.now() - 48 * 3600e3;
    const rel = items.filter(i => i.ts > cut && (!coin || i.coins.includes(coin)));
    const b = rel.filter(i => i.sentiment === 'bullish').length, r = rel.filter(i => i.sentiment === 'bearish').length;
    return { coin: coin || 'ALL', bullish: b, bearish: r, neutral: rel.length - b - r, total: rel.length, score: (b + r) ? Math.round(100 * b / (b + r)) : 50 };
  }

  const GECKO = { BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', XRP: 'ripple', BNB: 'binancecoin', DOGE: 'dogecoin', ADA: 'cardano' };
  async function loadPrices() {
    const ids = Object.values(GECKO).join(',');
    try {
      const j = await getJSON('https://api.coingecko.com/api/v3/simple/price?ids=' + ids + '&vs_currencies=usd&include_24hr_change=true');
      const out = Object.entries(GECKO).map(([sym, id]) => j && j[id] ? { sym, price: j[id].usd, change24h: j[id].usd_24h_change } : null).filter(Boolean);
      if (out.length) return out;
    } catch (e) { /* fall through to Binance.US */ }
    const syms = Object.keys(GECKO).map(k => k + 'USDT');
    const b = await getJSON('https://api.binance.us/api/v3/ticker/24hr?symbols=' + encodeURIComponent(JSON.stringify(syms)));
    const out = (Array.isArray(b) ? b : []).map(x => ({ sym: String(x.symbol).replace('USDT', ''), price: +x.lastPrice, change24h: +x.priceChangePercent })).filter(x => isFinite(x.price));
    if (!out.length) throw new Error('no prices');
    return out;
  }
  async function loadFng() {
    const j = await getJSON('https://api.alternative.me/fng/?limit=30');
    const d = (j && j.data) || [];
    return d.length ? { value: +d[0].value, label: d[0].value_classification, history: d.map(x => +x.value).reverse() } : null;
  }
  async function loadOdds() {
    const evs = await getEvents({ cat: 'crypto', sort: 'volume24hr', q: '', limit: 30 });
    return evs.slice(0, 12).map(e => ({
      id: e.id, title: e.title, icon: e.icon, volume24hr: e.volume24hr, endDate: e.endDate,
      top: e.markets.slice(0, 3).map(m => ({ label: m.label || 'Yes', yes: m.yes, change24h: m.change24h })), multi: e.multi
    }));
  }

  /* --------------------------------------------------------------- router */
  async function handle(req, res, p, m, q) {
    if (!p.startsWith('/api/mpx/')) return false;
    if (m === 'OPTIONS') { send(res, 204, {}); return true; }
    const route = p.slice('/api/mpx/'.length);
    const I = ip(req);
    try {
      if (route === 'ping') { send(res, 200, { ok: true, engine: 'moneto-test', time: new Date().toISOString() }); return true; }
      /* ---------- public: market data ---------- */
      if (route === 'markets' && m === 'GET') {
        const cat = Object.prototype.hasOwnProperty.call(CATS, q.cat) ? q.cat : 'crypto';
        const sort = SORTS[q.sort] ? q.sort : 'volume24hr';
        const s = cleanStr(q.q, 80);
        const limit = clamp(parseInt(q.limit, 10) || 30, 1, 50);
        if (limited('mk' + I, 120, 60000)) return fail(res, 429, 'Maombi mengi.'), true;
        const events = await getEvents({ cat, sort, q: s, limit });
        send(res, 200, { source: 'polymarket', cat, sort, updated_at: new Date().toISOString(), events });
        return true;
      }
      if (route === 'event' && m === 'GET') {
        if (!/^\d{1,20}$/.test(String(q.id || ''))) return fail(res, 400, 'Id si sahihi.'), true;
        const j = await cached('evd|' + q.id, 20000, 600000, () => getJSON(GAMMA + '/events/' + q.id));
        const e = j && normEvent(j);
        if (!e) return fail(res, 404, 'Soko halipatikani.'), true;
        send(res, 200, { event: e });
        return true;
      }
      if (route === 'book' && m === 'GET') {
        if (!/^\d{10,100}$/.test(String(q.token || ''))) return fail(res, 400, 'Token si sahihi.'), true;
        const b = await cached('book|' + q.token, 4000, 60000, () => getJSON(CLOB + '/book?token_id=' + q.token));
        const side = a => (a || []).map(x => ({ price: +x.price, size: +x.size })).filter(x => isFinite(x.price) && isFinite(x.size));
        const bids = side(b && b.bids).sort((x, y) => y.price - x.price).slice(0, 8);
        const asks = side(b && b.asks).sort((x, y) => x.price - y.price).slice(0, 8);
        send(res, 200, { bids, asks, spread: bids[0] && asks[0] ? r4(asks[0].price - bids[0].price) : null });
        return true;
      }
      if (route === 'trades' && m === 'GET') {
        if (!/^0x[a-fA-F0-9]{64}$/.test(String(q.market || ''))) return fail(res, 400, 'Market si sahihi.'), true;
        const t = await cached('tr|' + q.market, 10000, 120000, () => getJSON(DATA + '/trades?limit=20&market=' + q.market));
        send(res, 200, {
          trades: (Array.isArray(t) ? t : []).slice(0, 20).map(x => ({
            side: x.side, outcome: x.outcome, size: +x.size, price: +x.price, ts: +x.timestamp,
            user: cleanStr(x.pseudonym || x.name || '', 30)
          }))
        });
        return true;
      }
      if (route === 'history' && m === 'GET') {
        const iv = { '1d': 15, '1w': 60, '1m': 180, 'max': 720 };
        const interval = iv[q.interval] ? q.interval : '1w';
        if (!/^\d{10,100}$/.test(String(q.token || ''))) return fail(res, 400, 'Token si sahihi.'), true;
        const start = /^\d{9,11}$/.test(String(q.start || '')) ? q.start : '';
        const params = new URLSearchParams({ market: q.token, fidelity: String(start ? 5 : iv[interval]) });
        if (start) params.set('startTs', start); else params.set('interval', interval);
        const raw = await cached('h|' + params, 45000, 600000, () => getJSON(CLOB + '/prices-history?' + params));
        let pts = ((raw && raw.history) || []).map(x => ({ t: +x.t, p: +x.p })).filter(x => isFinite(x.t) && isFinite(x.p));
        if (pts.length > 120) { const st = pts.length / 120; pts = Array.from({ length: 120 }, (_, i) => pts[Math.min(pts.length - 1, Math.floor(i * st))]); }
        send(res, 200, { points: pts });
        return true;
      }

      /* ---------- public: news ---------- */
      if (route === 'news' && m === 'GET') {
        const n = await getNews();
        const kind = ['news', 'prediction'].includes(q.kind) ? q.kind : '';
        const coin = cleanStr(q.coin, 8).toUpperCase();
        const src = cleanStr(q.source, 30);
        const sent = ['bullish', 'bearish', 'neutral'].includes(q.sentiment) ? q.sentiment : '';
        const s = cleanStr(q.q, 60).toLowerCase();
        const limit = clamp(parseInt(q.limit, 10) || 40, 1, 100);
        let items = n.items;
        if (kind) items = items.filter(i => i.kind === kind);
        if (coin) items = items.filter(i => i.coins.includes(coin));
        if (src) items = items.filter(i => i.source_id === src);
        if (sent) items = items.filter(i => i.sentiment === sent);
        if (s) items = items.filter(i => (i.title + ' ' + i.summary).toLowerCase().includes(s));
        send(res, 200, {
          updated_at: new Date(n.at).toISOString(), total: items.length,
          sources: FEEDS.map(f => ({ id: f.id, name: f.name, count: n.status[f.id] || 0 })),
          items: items.slice(0, limit)
        });
        return true;
      }
      if (route === 'pulse' && m === 'GET') {
        const [fng, prices, odds, news] = await Promise.all([
          cached('fng', 10 * 60000, 6 * 3600e3, loadFng).catch(() => null),
          cached('prices', 60000, 30 * 60000, loadPrices).catch(() => []),
          cached('odds', 30000, 10 * 60000, loadOdds).catch(() => []),
          getNews().catch(() => null)
        ]);
        const items = news ? news.items : [];
        send(res, 200, {
          fng, prices, odds,
          sentiment: { all: sentimentOf(items), coins: ['BTC', 'ETH', 'SOL', 'XRP'].map(c => sentimentOf(items, c)) },
          experts: items.filter(i => i.kind === 'prediction').slice(0, 8)
        });
        return true;
      }

      /* ---------- account ---------- */
      if (route === 'session' && m === 'POST') {
        if (limited('sess' + I, 30, 3600e3)) return fail(res, 429, 'Majaribio mengi. Jaribu baadaye.'), true;
        const token = crypto.randomBytes(32).toString('hex');
        const name = 'Trader-' + crypto.randomBytes(2).toString('hex').toUpperCase();
        db.prepare('INSERT INTO mpx_accounts(token_hash,name,balance) VALUES(?,?,0)').run(hash(token), name);
        send(res, 200, { token, name });
        return true;
      }
      const acc = authAcc(req, res); if (!acc) return true;

      if (route === 'config' && m === 'GET') {
        send(res, 200, {
          fee_bps: FEE_BPS, buy_min: BUY_MIN, buy_max: BUY_MAX, dep_min: DEP_MIN, dep_max: DEP_MAX,
          wd_min: WD_MIN, wd_fee: WD_FEE, edge: [EDGE_LO, EDGE_HI], slippage: SLIPPAGE,
          networks: Object.entries(NETWORKS).map(([k, v]) => ({ id: k, label: v.label, demo_address: v.demo }))
        });
        return true;
      }
      if (route === 'me' && m === 'GET') {
        refreshWithdrawals(acc.id); maybeSettle();
        const a = getAcc(acc.id);
        send(res, 200, { name: a.name, balance: fromMicro(a.balance), created_at: a.created_at });
        return true;
      }
      if (route === 'deposit' && m === 'POST') {
        const x = await body(req);
        const amt = Math.round(Number(x.amount) * 100) / 100;
        const net = NETWORKS[x.network] ? x.network : 'TRC20';
        if (!isFinite(amt) || amt < DEP_MIN || amt > DEP_MAX) return fail(res, 400, `Deposit ya majaribio ni kati ya ${DEP_MIN} na ${DEP_MAX} USDT.`), true;
        if (limited('dep' + acc.id, 20, 3600e3)) return fail(res, 429, 'Deposit nyingi sana kwa saa moja.'), true;
        tx(() => {
          db.prepare('UPDATE mpx_accounts SET balance=balance+? WHERE id=?').run(toMicro(amt), acc.id);
          addTx(acc.id, { type: 'deposit', amount: toMicro(amt), network: net, txid: fakeTx(), note: 'Test deposit (simulation)' });
        });
        send(res, 200, { ok: true, balance: fromMicro(getAcc(acc.id).balance) });
        return true;
      }
      if (route === 'withdraw' && m === 'POST') {
        const x = await body(req);
        const amt = Math.round(Number(x.amount) * 100) / 100;
        const net = NETWORKS[x.network] ? x.network : null;
        const addr = cleanStr(x.address, 100);
        if (!net) return fail(res, 400, 'Chagua network.'), true;
        if (!NETWORKS[net].re.test(addr)) return fail(res, 400, 'Anwani ya ' + net + ' si sahihi.'), true;
        if (!isFinite(amt) || amt < WD_MIN) return fail(res, 400, `Kiwango cha chini cha withdraw ni ${WD_MIN} USDT.`), true;
        if (limited('wd' + acc.id, 10, 3600e3)) return fail(res, 429, 'Withdraw nyingi sana kwa saa moja.'), true;
        tx(() => {
          const a = getAcc(acc.id), total = toMicro(amt) + toMicro(WD_FEE);
          if (a.balance < total) throw new Biz('Balance haitoshi (amount + ada ya ' + WD_FEE + ' USDT).');
          db.prepare('UPDATE mpx_accounts SET balance=balance-? WHERE id=?').run(total, acc.id);
          addTx(acc.id, { type: 'withdraw', amount: -toMicro(amt), fee: toMicro(WD_FEE), status: 'pending', network: net, address: addr, txid: fakeTx(), note: 'Test withdrawal (simulation)', completes_at: Date.now() + WD_DELAY_MS });
        });
        send(res, 200, { ok: true, balance: fromMicro(getAcc(acc.id).balance) });
        return true;
      }
      if (route === 'transactions' && m === 'GET') {
        refreshWithdrawals(acc.id);
        const rows = db.prepare('SELECT * FROM mpx_tx WHERE account_id=? ORDER BY id DESC LIMIT 100').all(acc.id);
        send(res, 200, {
          items: rows.map(r => ({ id: r.id, type: r.type, amount: fromMicro(r.amount), fee: fromMicro(r.fee), status: r.status, network: r.network, address: r.address, txid: r.txid, note: r.note, created_at: r.created_at }))
        });
        return true;
      }

      /* ---------- trading ---------- */
      if (route === 'quote' && m === 'POST') {
        const x = await body(req);
        const side = x.side === 'no' ? 'no' : 'yes', amt = Number(x.amount);
        const mk = await getMarket(String(x.market_id || ''), 4000);
        if (!mk || mk.closed || !mk.active || mk.yes === null) return fail(res, 400, 'Soko limefungwa.'), true;
        const price = sidePrice(mk, side);
        const shares = isFinite(amt) && amt > 0 ? amt / price : 0;
        send(res, 200, {
          price: r4(price), yes: mk.yes, shares: r4(shares), max_payout: r4(shares), profit_if_win: r4(shares - (amt || 0)),
          roi_if_win: amt > 0 ? r4(100 * (shares - amt) / amt) : 0, tradable: mk.yes > EDGE_LO && mk.yes < EDGE_HI,
          cashout_now: r4(shares * price * (1 - FEE_BPS / 10000))
        });
        return true;
      }
      if (route === 'buy' && m === 'POST') {
        const x = await body(req);
        const side = x.side === 'yes' || x.side === 'no' ? x.side : null;
        const amt = Math.round(Number(x.amount) * 100) / 100;
        if (!side || !/^\d{1,20}$/.test(String(x.market_id || ''))) return fail(res, 400, 'Chaguo si sahihi.'), true;
        if (!isFinite(amt) || amt < BUY_MIN || amt > BUY_MAX) return fail(res, 400, `Stake ni kati ya ${BUY_MIN} na ${BUY_MAX} USDT.`), true;
        if (limited('buy' + acc.id, 40, 60000)) return fail(res, 429, 'Polepole — maombi mengi.'), true;
        if (db.prepare("SELECT COUNT(*) c FROM mpx_positions WHERE account_id=? AND status='open'").get(acc.id).c >= MAX_OPEN)
          return fail(res, 400, `Umefikia positions ${MAX_OPEN} zilizo wazi.`), true;
        let mk;
        try { mk = await getMarket(x.market_id, 0); } catch (e) { return fail(res, 502, 'Imeshindwa kuthibitisha bei ya Polymarket. Jaribu tena.'), true; }
        if (!mk || mk.closed || !mk.active) return fail(res, 400, 'Soko hili limefungwa.'), true;
        if (mk.endDate && new Date(mk.endDate).getTime() <= Date.now()) return fail(res, 400, 'Muda wa soko umeisha.'), true;
        if (mk.yes === null || mk.yes >= EDGE_HI || mk.yes <= EDGE_LO) return fail(res, 400, 'Soko limeshaamuliwa karibu kabisa — biashara imefungwa.'), true;
        const price = r4(sidePrice(mk, side));
        const exp = Number(x.expected_price);
        if (isFinite(exp) && exp > 0 && Math.abs(price - exp) / exp > SLIPPAGE)
          return fail(res, 409, 'Bei imebadilika. Angalia bei mpya kisha thibitisha tena.', { price, code: 'price_moved' }), true;
        const shares = amt / price;
        const label = cleanStr(mk.label || mk.question, 200);
        const title = cleanStr(mk.eventTitle || x.event_title || mk.question, 200);
        const pos = tx(() => {
          const a = getAcc(acc.id);
          if (a.balance < toMicro(amt)) throw new Biz('Balance haitoshi. Fanya deposit ya majaribio kwanza.');
          db.prepare('UPDATE mpx_accounts SET balance=balance-? WHERE id=?').run(toMicro(amt), acc.id);
          const r = db.prepare('INSERT INTO mpx_positions(account_id,market_id,token_id,event_id,event_title,market_label,icon,side,entry_price,shares,cost,invested,end_date) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
            .run(acc.id, mk.id, side === 'yes' ? mk.token : (mk.tokenNo || mk.token), mk.eventId || cleanStr(x.event_id, 40), title, label, safeUrl(mk.icon || '') || null, side, price, shares, toMicro(amt), toMicro(amt), mk.endDate);
          addTx(acc.id, { type: 'buy', amount: -toMicro(amt), note: (title + ' · ' + label + ' · ' + side.toUpperCase() + ' @ ' + Math.round(price * 100) + '¢').slice(0, 200) });
          return r.lastInsertRowid;
        });
        send(res, 200, { ok: true, position_id: Number(pos), price, shares: r4(shares), max_payout: r4(shares), balance: fromMicro(getAcc(acc.id).balance) });
        return true;
      }
      if (route === 'portfolio' && m === 'GET') {
        maybeSettle();
        const pf = await portfolio(getAcc(acc.id));
        pf.balance = fromMicro(getAcc(acc.id).balance);
        pf.summary.equity = r4(pf.balance + pf.summary.positions_value);
        send(res, 200, pf);
        return true;
      }
      if (route === 'cashout' && m === 'POST') {
        const x = await body(req);
        const id = parseInt(x.position_id, 10);
        const pct = clamp(Number(x.pct) || 100, 1, 100);
        const pos = db.prepare("SELECT * FROM mpx_positions WHERE id=? AND account_id=? AND status='open'").get(id, acc.id);
        if (!pos) return fail(res, 404, 'Position haipo au imeshafungwa.'), true;
        let mk;
        try { mk = await getMarket(pos.market_id, 0); } catch (e) { return fail(res, 502, 'Imeshindwa kupata bei ya sasa. Jaribu tena.'), true; }
        if (!mk || mk.yes === null) return fail(res, 502, 'Bei haipatikani kwa sasa.'), true;
        if (mk.closed) return fail(res, 400, 'Soko limefungwa — subiri matokeo yatangazwe, malipo yatakuja yenyewe.'), true;
        const price = r4(sidePrice(mk, pos.side));
        const exp = Number(x.expected_value);
        const full = pct >= 99.999;
        const sold = full ? pos.shares : pos.shares * pct / 100;
        const gross = sold * price, net = Math.floor(gross * MICRO * (1 - FEE_BPS / 10000));
        if (isFinite(exp) && exp > 0) {
          const expNet = exp * (full ? 1 : pct / 100);
          if (Math.abs(fromMicro(net) - expNet) / Math.max(expNet, 0.01) > SLIPPAGE + 0.005)
            return fail(res, 409, 'Thamani ya cashout imebadilika. Angalia na uthibitishe tena.', { price, cashout: fromMicro(net) / (full ? 1 : pct / 100), code: 'price_moved' }), true;
        }
        const costSold = full ? pos.cost : Math.round(pos.cost * pct / 100);
        tx(() => {
          db.prepare('UPDATE mpx_accounts SET balance=balance+? WHERE id=?').run(net, acc.id);
          if (full) db.prepare("UPDATE mpx_positions SET status='closed', shares=0, cost=0, realized=realized+?, payout=0, closed_at=datetime('now') WHERE id=?").run(net - costSold, pos.id);
          else db.prepare('UPDATE mpx_positions SET shares=shares-?, cost=cost-?, realized=realized+? WHERE id=?').run(sold, costSold, net - costSold, pos.id);
          addTx(acc.id, { type: 'sell', amount: net, fee: Math.floor(gross * MICRO) - net, note: ((full ? 'Cashout ' : 'Partial cashout ' + Math.round(pct) + '% ') + pos.event_title + ' · ' + pos.market_label).slice(0, 200) });
        });
        send(res, 200, { ok: true, received: fromMicro(net), pnl: fromMicro(net - costSold), price, balance: fromMicro(getAcc(acc.id).balance) });
        return true;
      }
      return fail(res, 404, 'Not found'), true;
    } catch (e) {
      if (e instanceof Biz) return fail(res, e.code, e.message), true;
      console.error('[mpx]', route, e && e.message);
      if (/HTTP|abort|fetch|no feeds/i.test(String(e && e.message))) return fail(res, 502, 'Chanzo cha data hakipatikani kwa sasa. Jaribu tena baada ya muda mfupi.'), true;
      return fail(res, 500, 'Server error.'), true;
    }
  }

  function start() {
    console.log('[mpx] Moneto test engine imewashwa — /api/mpx/ping');
    setTimeout(() => settleAll().catch(() => {}), 45000).unref();
    setInterval(() => settleAll().catch(() => {}), 60000).unref();
  }

  return { handle, start, _t: { parseFeed, analyze, settleMarket, resultOf, normMarket, settleAll } };
};
