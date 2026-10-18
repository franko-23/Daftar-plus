// Telegram Cleaner — module ya kuunganisha kwenye server.js ya Daftari+ (Super Admin pekee)
// Inahitaji: npm install telegram
const fs = require('fs');
const path = require('path');
// Package ya "telegram" inahitajika kwa hali ya Akaunti tu. Hali ya Bot haihitaji npm yoyote.
let TelegramClient, Api, StringSession, gramErr = null;
try {
  ({ TelegramClient, Api } = require('telegram'));
  ({ StringSession } = require('telegram/sessions'));
} catch (e) { gramErr = e; }

module.exports = function createTelegramCleaner({ dataDir, authorize }) {
  if (typeof authorize !== 'function') throw new Error('authorize(req) inahitajika (super_admin tu)');
  const SESSION_FILE = path.join(dataDir, 'telegram-session.json');
  let client = null, creds = null, pending = null;
  let job = { running: false, deleted: 0, total: 0, done: false, error: null, title: '' };

  async function connect(apiId, apiHash, session = '') {
    client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 5, floodSleepThreshold: 300 });
    await client.connect();
    creds = { apiId, apiHash };
  }
  (async () => {
    try {
      const s = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      await connect(s.apiId, s.apiHash, s.session);
      if (!(await client.checkAuthorization())) client = null;
    } catch { client = null; }
  })();

  /* ---------- BOT MODE (BotFather) ---------- */
  const BOT_FILE = path.join(dataDir, 'telegram-bot.json');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let botToken = null, botInfo = null;
  try { const x = JSON.parse(fs.readFileSync(BOT_FILE, 'utf8')); botToken = x.token; botInfo = x.info; } catch {}

  async function bot(method, params = {}, token = botToken) {
    for (let i = 0; i < 6; i++) {
      const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
      });
      const d = await r.json();
      if (d.ok) return d.result;
      if (d.error_code === 429) { await sleep(((d.parameters && d.parameters.retry_after) || 5) * 1000 + 500); continue; }
      const e = new Error(d.description || 'Hitilafu ya Telegram'); e.code = d.error_code; throw e;
    }
    throw new Error('Telegram imezuia kwa muda (rate limit). Jaribu tena baadaye.');
  }

  // Bot haisomi historia: inatuma ujumbe mmoja kupata ID ya juu, kisha inafuta ID zote chini yake (100 kwa mara).
  async function runBotClean(chatId, title) {
    job = { running: true, deleted: 0, total: 0, done: false, error: null, title, mode: 'bot' };
    try {
      const probe = await bot('sendMessage', { chat_id: chatId, text: '🧹', disable_notification: true });
      const top = probe.message_id; job.total = top;
      for (let hi = top; hi >= 1; hi -= 100) {
        const ids = [];
        for (let id = hi; id > hi - 100 && id >= 1; id--) ids.push(id);
        try { await bot('deleteMessages', { chat_id: chatId, message_ids: ids }); }
        catch (e) { if (e.code === 403 || /rights|forbidden|not enough/i.test(e.message)) throw e; }
        job.deleted = top - hi + ids.length;
        await sleep(150);
      }
      job.done = true;
    } catch (e) { job.error = e.message; }
    job.running = false;
  }

  const canDelete = (e) => e.creator || (e.adminRights && e.adminRights.deleteMessages);

  async function runClean(entity, title) {
    job = { running: true, deleted: 0, total: 0, done: false, error: null, title };
    try {
      job.total = (await client.getMessages(entity, { limit: 1 })).total || 0;
      let batch = [];
      const flush = async () => {
        if (!batch.length) return;
        await client.deleteMessages(entity, batch, { revoke: true });
        job.deleted += batch.length; batch = [];
        await new Promise((r) => setTimeout(r, 400));
      };
      for await (const m of client.iterMessages(entity, { limit: undefined })) {
        batch.push(m.id);
        if (batch.length >= 100) await flush();
      }
      await flush();
      job.done = true;
    } catch (e) { job.error = e.errorMessage || e.message; }
    job.running = false;
  }

  const readBody = (req) => new Promise((res) => {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => { try { res(JSON.parse(b || '{}')); } catch { res({}); } });
  });
  const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

  // Inarudisha true ikiwa imeshughulikia ombi
  return async function handle(req, res) {
    const url = req.url.split('?')[0];
    if (!url.startsWith('/api/super/telegram/')) return false;
    try {
      if (!(await authorize(req))) { send(res, 403, { error: 'Super Admin tu' }); return true; }
      const route = url.slice('/api/super/telegram/'.length);
      const b = req.method === 'POST' ? await readBody(req) : {};
      if (gramErr && ['send-code', 'login', 'logout', 'chats', 'clean'].includes(route))
        return send(res, 501, { error: 'Hali ya Akaunti inahitaji package ya "telegram" (npm install telegram). Tumia hali ya Bot.' }), true;

      if (route === 'status') {
        const loggedIn = !!client && (await client.checkAuthorization());
        return send(res, 200, { loggedIn, job, bot: { connected: !!botToken, username: botInfo && botInfo.username } }), true;
      }
      if (route === 'send-code') {
        const apiId = Number(b.apiId), apiHash = String(b.apiHash || '');
        await connect(apiId, apiHash);
        const r = await client.sendCode({ apiId, apiHash }, String(b.phone));
        pending = { phone: String(b.phone), hash: r.phoneCodeHash };
        return send(res, 200, { ok: true }), true;
      }
      if (route === 'login') {
        if (!pending) return send(res, 400, { error: 'Omba code kwanza' }), true;
        try {
          await client.invoke(new Api.auth.SignIn({ phoneNumber: pending.phone, phoneCodeHash: pending.hash, phoneCode: String(b.code) }));
        } catch (e) {
          if (e.errorMessage !== 'SESSION_PASSWORD_NEEDED') throw e;
          if (!b.password) return send(res, 200, { needPassword: true }), true;
          await client.signInWithPassword(creds, { password: async () => b.password, onError: (er) => { throw er; } });
        }
        fs.writeFileSync(SESSION_FILE, JSON.stringify({ ...creds, session: client.session.save() }), { mode: 0o600 });
        pending = null;
        return send(res, 200, { ok: true }), true;
      }
      if (route === 'logout') {
        try { await client?.invoke(new Api.auth.LogOut()); } catch {}
        client = null; try { fs.unlinkSync(SESSION_FILE); } catch {}
        return send(res, 200, { ok: true }), true;
      }
      if (route === 'bot/connect') {
        const t = String(b.token || '').trim();
        if (!/^\d+:[\w-]{30,}$/.test(t)) return send(res, 400, { error: 'Token si sahihi' }), true;
        const me = await bot('getMe', {}, t);
        botToken = t; botInfo = { id: me.id, username: me.username };
        fs.writeFileSync(BOT_FILE, JSON.stringify({ token: botToken, info: botInfo }), { mode: 0o600 });
        return send(res, 200, { ok: true, username: me.username }), true;
      }
      if (route === 'bot/disconnect') {
        botToken = null; botInfo = null; try { fs.unlinkSync(BOT_FILE); } catch {}
        return send(res, 200, { ok: true }), true;
      }
      if (route === 'bot/clean') {
        if (!botToken) return send(res, 401, { error: 'Weka token ya bot kwanza' }), true;
        if (job.running) return send(res, 409, { error: 'Kazi nyingine inaendelea' }), true;
        const chat = await bot('getChat', { chat_id: String(b.chat || '').trim() });
        if (b.confirm !== chat.title) return send(res, 400, { error: 'Jina la uthibitisho halilingani. Jina ni: ' + chat.title }), true;
        const me = await bot('getChatMember', { chat_id: chat.id, user_id: botInfo.id });
        if (!(me.status === 'creator' || (me.status === 'administrator' && me.can_delete_messages)))
          return send(res, 403, { error: 'Bot si admin mwenye ruhusa ya "Delete messages" hapa' }), true;
        runBotClean(chat.id, chat.title);
        return send(res, 200, { ok: true }), true;
      }
      if (!client) return send(res, 401, { error: 'Ingia kwenye Telegram kwanza' }), true;

      if (route === 'chats') {
        const ds = await client.getDialogs({ limit: 300 });
        const chats = ds.filter((d) => (d.isChannel || d.isGroup) && canDelete(d.entity))
          .map((d) => ({ id: d.id.toString(), title: d.title, channel: !!d.isChannel && !d.isGroup }));
        return send(res, 200, { chats }), true;
      }
      if (route === 'clean') {
        if (job.running) return send(res, 409, { error: 'Kazi nyingine inaendelea' }), true;
        const ds = await client.getDialogs({ limit: 300 });
        const d = ds.find((x) => x.id.toString() === String(b.id));
        if (!d || !canDelete(d.entity)) return send(res, 403, { error: 'Huna ruhusa ya kufuta hapa' }), true;
        if (b.confirm !== d.title) return send(res, 400, { error: 'Jina la uthibitisho halilingani' }), true;
        runClean(d.entity, d.title);
        return send(res, 200, { ok: true }), true;
      }
      send(res, 404, { error: 'Haipo' });
    } catch (e) { send(res, 500, { error: e.errorMessage || e.message }); }
    return true;
  };
};
