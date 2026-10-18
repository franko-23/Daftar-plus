// Telegram Cleaner — module ya kuunganisha kwenye server.js ya Daftari+ (Super Admin pekee)
// Inahitaji: npm install telegram
const fs = require('fs');
const path = require('path');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');

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

      if (route === 'status') {
        const loggedIn = !!client && (await client.checkAuthorization());
        return send(res, 200, { loggedIn, job }), true;
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
