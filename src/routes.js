import express from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db, getSetting, setSetting, now } from './db.js';
import { encryptSecret, decryptSecret, verifyPassword, hashPassword, randomToken } from './security.js';
import { testConnection, RouterOSConnection } from './routeros.js';
import { collectRouter } from './collector.js';
import { chatCompletion, streamText, LlmError } from './llm.js';
import { buildDigest, buildMessages, isStale } from './orchestrator.js';
import { guardOutput, stripAdvisoryFooter } from './guard.js';
import { logger } from './logger.js';
import { listTemplates, getTemplate, renderScript } from './templates.js';
import { scanMikrotik, selfTest as discoverySelfTest } from './discovery.js';

export const app = express();
app.use(express.json({ limit: '2mb' }));

const DIGEST_CAP = 1000000;

const PROVIDER_PRESETS = [
  { key: 'custom', label: 'Kustom / 9router / gateway lain', url: '', model: '' },
  { key: 'groq', label: 'Groq', url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { key: 'abacus', label: 'Abacus AI', url: 'https://api.abacus.ai/api/v1', model: '' },
  { key: 'gemini', label: 'Gemini (Google) — format OpenAI', url: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash' },
  { key: 'openai', label: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { key: 'ollama', label: 'Ollama (lokal)', url: 'http://localhost:11434/v1', model: 'llama3.1' },
  { key: 'lmstudio', label: 'LM Studio (lokal)', url: 'http://localhost:1234/v1', model: '' },
];

function getProviderRow(id) {
  return db.prepare('SELECT * FROM ai_providers WHERE id=?').get(id);
}

function listProviderRows() {
  return db.prepare('SELECT * FROM ai_providers ORDER BY sort ASC, created_at ASC').all();
}

function decryptRowKey(row) {
  return row && row.api_key_enc ? decryptSecret(row.api_key_enc, row.api_key_iv) : '';
}

function getActiveProvider() {
  const row = listProviderRows().find((r) => r.active);
  if (row) return { baseUrl: row.base_url, apiKey: decryptRowKey(row), model: row.model, id: row.id };
  const baseUrl = getSetting('ai_base_url', '');
  if (baseUrl) return { baseUrl, apiKey: getSetting('ai_api_key', ''), model: getSetting('ai_model', ''), id: 'custom' };
  return null;
}

function requireProvider() {
  const p = getActiveProvider();
  if (!p?.baseUrl || !p?.model) return null;
  return { baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.model, streaming: getSetting('ai_streaming', '1') === '1' };
}

function keyPreview(key) {
  if (!key) return '';
  return key.length <= 8 ? '••••' : key.slice(0, 4) + '••••' + key.slice(-4);
}

function presetForUrl(url) {
  if (!url) return null;
  const host = String(url).replace(/^https?:\/\//, '').split('/')[0];
  return PROVIDER_PRESETS.find((p) => p.url && p.url.includes(host)) || null;
}

function migrateLegacyProvider() {
  const n = db.prepare('SELECT COUNT(*) AS c FROM ai_providers').get().c;
  if (n > 0) return;
  const baseUrl = getSetting('ai_base_url', '').trim();
  const model = getSetting('ai_model', '').trim();
  if (!baseUrl || !model) return;
  const preset = presetForUrl(baseUrl);
  const key = getSetting('ai_api_key', '');
  const { enc, iv } = encryptSecret(key);
  const ts = now();
  db.prepare(`INSERT INTO ai_providers (id,label,base_url,model,api_key_enc,api_key_iv,active,sort,created_at,updated_at)
              VALUES (?,?,?,?,?,?,1,0,?,?)`)
    .run(preset ? preset.key : 'custom', preset ? preset.label : 'Kustom', baseUrl, model, enc, iv, ts, ts);
  logger.info({ event: 'provider_migrate', operation: 'provider', result: 'migrated', id: preset ? preset.key : 'custom' });
}
migrateLegacyProvider();
try {
  discoverySelfTest();
} catch (e) {
  logger.warn({ event: 'discovery', operation: 'discovery', result: 'self_test_failed', error: e.message });
}

function cookieValue(req) {
  const h = req.headers.cookie || '';
  const m = /(?:^|;\s*)mt_auth=([^;]+)/.exec(h);
  return m ? decodeURIComponent(m[1]) : null;
}

function auth(req, res, next) {
  const token = cookieValue(req);
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!row || new Date(row.expires_at) < new Date()) return res.status(401).json({ error: 'unauthorized' });
  req.user = 'admin';
  next();
}

function encryptPw(pw) {
  if (!pw) return { enc: '', iv: '' };
  const { enc, iv } = encryptSecret(pw);
  return { enc, iv };
}

function decryptPw(r) {
  return decryptSecret(r.password_enc, r.password_iv);
}

function publicRouter(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    company: r.company || '',
    host: r.host,
    api_port: r.api_port,
    secure: !!r.secure,
    username: r.username,
    hasPassword: !!(r.password_enc && decryptSecret(r.password_enc, r.password_iv)),
    connection_status: r.connection_status,
    last_sync: r.last_sync,
    last_error: r.last_error,
    created_at: r.created_at,
  };
}

// Cek koneksi LANGSUNG ke router. Returns null jika online; String error jika offline/terkoneksi gagal.
// Status koneksi di DB diperbarui, dan last_error dicatat agar UI bisa menampilkan alasan.
async function requireOnline(router) {
  try {
    await testConnection(router);
    db.prepare(`UPDATE routers SET connection_status='ok', last_error=NULL WHERE id=?`).run(router.id);
    return null;
  } catch (e) {
    const msg = e?.message || String(e);
    db.prepare(`UPDATE routers SET connection_status='failed', last_error=? WHERE id=?`).run(msg, router.id);
    return msg;
  }
}

function sse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  return (name, obj) => res.write(`event: ${name}\ndata: ${JSON.stringify(obj)}\n\n`);
}

/* ---------- auth ---------- */
app.post('/api/auth/login', (req, res) => {
  const stored = getSetting('admin_password_hash');
  if (!stored) {
    setSetting('admin_password_hash', hashPassword('admin'));
  }
  const { password } = req.body || {};
  if (!password || !verifyPassword(password, stored)) {
    logger.warn({ event: 'login', operation: 'auth', result: 'failed', errorCategory: 'auth' });
    return res.status(401).json({ error: 'password salah' });
  }
  const token = randomToken();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at) VALUES (?,?,?)').run(
    token,
    now(),
    new Date(Date.now() + 14 * 86400 * 1000).toISOString()
  );
  logger.info({ event: 'login', operation: 'auth', result: 'success' });
  res.cookie('mt_auth', token, { httpOnly: true, sameSite: 'lax' });
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  const token = cookieValue(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie('mt_auth');
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const token = cookieValue(req);
  const row = token
    ? db.prepare('SELECT * FROM sessions WHERE token = ?').get(token)
    : null;
  res.json({ authenticated: !!row && new Date(row.expires_at) > new Date() });
});

/* ---------- routers ---------- */
app.get('/api/routers', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM routers ORDER BY name').all();
  res.json(rows.map(publicRouter));
});

app.post('/api/routers/test-preflight', auth, async (req, res) => {
  const { host, api_port = 8728, secure = false, username, password } = req.body || {};
  if (!host || !username) return res.status(400).json({ error: 'host dan username wajib' });
  if (!password) return res.status(400).json({ error: 'password wajib diisi untuk tes koneksi' });
  const t0 = Date.now();
  const probe = { host, port: Number(api_port), secure: !!secure, username, password };
  try {
    const info = await testConnection(probe);
    logger.info({ event: 'connection_test', operation: 'routers/test-preflight', result: 'success', durationMs: Date.now() - t0, host });
    res.json({ ok: true, ...info });
  } catch (e) {
    const msg = e?.message || String(e);
    logger.warn({
      event: 'connection_test', operation: 'routers/test-preflight', result: 'failed',
      errorCategory: classifyError(msg), durationMs: Date.now() - t0, host,
    });
    res.status(502).json({ ok: false, error: msg });
  }
});

app.post('/api/routers', auth, (req, res) => {
  const { name, company, host, api_port = 8728, secure = false, username, password } = req.body || {};
  if (!name || !host || !username) return res.status(400).json({ error: 'name, host, username wajib' });
  const id = randomUUID();
  const { enc, iv } = encryptPw(password);
  db.prepare(
    `INSERT INTO routers (id, name, company, host, api_port, secure, username, password_enc, password_iv, connection_status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, name, (company || '').trim(), host, Number(api_port), secure ? 1 : 0, username, enc, iv, 'unknown', now());
  logger.info({ event: 'router_added', operation: 'routers', result: 'success', routerId: id });
  res.json(publicRouter(db.prepare('SELECT * FROM routers WHERE id=?').get(id)));
});

app.put('/api/routers/:id', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM routers WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'router not found' });
  const { name, company, host, api_port, secure, username, password } = req.body || {};
  const keepPw = password === undefined || password === '';
  const nextPw = keepPw ? row.password_enc : encryptPw(password).enc;
  const nextIv = keepPw ? row.password_iv : encryptPw(password).iv;
  db.prepare(
    `UPDATE routers SET name=?, company=?, host=?, api_port=?, secure=?, username=?, password_enc=?, password_iv=?,
     connection_status='unknown' WHERE id=?`
  ).run(
    name ?? row.name,
    company === undefined ? row.company : (company || '').trim(),
    host ?? row.host,
    Number(api_port ?? row.api_port),
    secure === undefined ? row.secure : secure ? 1 : 0,
    username ?? row.username,
    nextPw,
    nextIv,
    row.id
  );
  logger.info({ event: 'router_updated', operation: 'routers', result: 'success', routerId: row.id });
  res.json(publicRouter(db.prepare('SELECT * FROM routers WHERE id=?').get(row.id)));
});

app.delete('/api/routers/:id', auth, (req, res) => {
  db.prepare('DELETE FROM routers WHERE id=?').run(req.params.id);
  logger.info({ event: 'router_removed', operation: 'routers', result: 'success', routerId: req.params.id });
  res.json({ ok: true });
});

function getRouter(id) {
  const row = db.prepare('SELECT * FROM routers WHERE id=?').get(id);
  if (!row) return null;
  return { ...row, secure: !!row.secure, password: decryptPw(row) };
}

app.post('/api/routers/:id/test', auth, async (req, res) => {
  const router = getRouter(req.params.id);
  if (!router) return res.status(404).json({ error: 'router not found' });
  const t0 = Date.now();
  try {
    const info = await testConnection(router);
    db.prepare(`UPDATE routers SET connection_status='ok', last_error=NULL WHERE id=?`).run(router.id);
    logger.info({
      event: 'connection_test', operation: 'routers/test', result: 'success', routerId: router.id, durationMs: Date.now() - t0,
    });
    res.json({ ok: true, ...info });
  } catch (e) {
    const msg = e?.message || String(e);
    db.prepare(`UPDATE routers SET connection_status='failed', last_error=? WHERE id=?`).run(msg, router.id);
    logger.warn({
      event: 'connection_test', operation: 'routers/test', result: 'failed', routerId: router.id,
      errorCategory: classifyError(msg), durationMs: Date.now() - t0,
    });
    res.status(502).json({ ok: false, error: msg });
  }
});

app.post('/api/routers/:id/sync', auth, async (req, res) => {
  const router = getRouter(req.params.id);
  if (!router) return res.status(404).json({ error: 'router not found' });
  const t0 = Date.now();
  try {
    const out = await collectRouter(router);
    if (!out.connected) throw new Error(out.error || 'sync gagal');
    db.prepare(
      'INSERT INTO contexts (router_id, snapshot, summary, synced_at) VALUES (?,?,?,?) ON CONFLICT(router_id) DO UPDATE SET snapshot=excluded.snapshot, summary=excluded.summary, synced_at=excluded.synced_at'
    ).run(router.id, JSON.stringify(out.results), JSON.stringify(out.summary), now());
    db.prepare(`UPDATE routers SET connection_status='ok', last_sync=?, last_error=NULL WHERE id=?`).run(now(), router.id);
    logger.info({
      event: 'sync', operation: 'routers/sync', result: 'success', routerId: router.id,
      durationMs: Date.now() - t0, synced: out.okCount, failed: out.failedCount, unsupported: out.unsupportedCount,
    });
    res.json({ ok: true, summary: out.summary, okCount: out.okCount, failedCount: out.failedCount, unsupportedCount: out.unsupportedCount });
  } catch (e) {
    const msg = e?.message || String(e);
    db.prepare(`UPDATE routers SET connection_status='failed', last_error=? WHERE id=?`).run(msg, router.id);
    logger.warn({
      event: 'sync', operation: 'routers/sync', result: 'failed', routerId: router.id,
      errorCategory: classifyError(msg), durationMs: Date.now() - t0,
    });
    res.status(502).json({ ok: false, error: msg });
  }
});

app.get('/api/routers/:id/overview', auth, async (req, res) => {
  const router = publicRouter(db.prepare('SELECT * FROM routers WHERE id=?').get(req.params.id));
  if (!router) return res.status(404).json({ error: 'router not found' });
  const offline = await requireOnline(getRouter(req.params.id));
  if (offline) return res.status(409).json({ error: `Router sedang offline / tidak dapat dihubungi. Detail: ${offline}. Hubungkan router lalu buka kembali.` });
  const ctx = db.prepare('SELECT * FROM contexts WHERE router_id=?').get(req.params.id);
  const chats = db
    .prepare('SELECT id, title, created_at, (SELECT COUNT(*) FROM messages m WHERE m.chat_id=c.id) AS msg_count FROM chats c WHERE router_id=? ORDER BY created_at DESC LIMIT 50')
    .all(req.params.id);
  let summary = [];
  let syncedAt = null;
  if (ctx) {
    summary = JSON.parse(ctx.summary);
    syncedAt = ctx.synced_at;
  }
  res.json({
    router,
    context: { available: !!ctx, syncedAt, stale: isStale(syncedAt), summary },
    chats,
  });
});

app.get('/api/dashboard', auth, (req, res) => {
  const routers = db.prepare('SELECT id, name, company, host, api_port, secure, connection_status FROM routers ORDER BY name').all();
  const cards = routers.map((r) => {
    const ctx = db.prepare('SELECT snapshot, synced_at FROM contexts WHERE router_id=?').get(r.id);
    let health = null;
    let stale = true;
    if (ctx) {
      stale = isStale(ctx.synced_at);
      try {
        const snap = JSON.parse(ctx.snapshot);
        const res1 = snap['system/resource']?.[0] || {};
        const h = snap['system/health']?.[0] || {};
        health = {
          cpu: res1['cpu-load'] ?? null,
          freeMem: res1['free-memory'] ?? null,
          totalMem: res1['total-memory'] ?? null,
          uptime: res1.uptime ?? null,
          version: res1.version ?? null,
          board: res1['board-name'] ?? null,
          temp: h.temperature ?? null,
        };
      } catch { /* ignore malformed snapshot */ }
    }
    const lastAudit = db
      .prepare("SELECT id, audit_type, result, created_at FROM audit_runs WHERE router_id=? AND ok=1 ORDER BY created_at DESC LIMIT 1")
      .get(r.id);
    let sev = null;
    if (lastAudit) {
      const t = lastAudit.result || '';
      sev = {
        critical: (t.match(/\b(KRITIS|CRITICAL)\b/gi) || []).length,
        high: (t.match(/\b(TINGGI|HIGH)\b/gi) || []).length,
        medium: (t.match(/\b(SEDANG|MEDIUM)\b/gi) || []).length,
        low: (t.match(/\b(RENDAH|LOW)\b/gi) || []).length,
      };
    }
    return {
      id: r.id,
      name: r.name,
      company: r.company,
      host: r.host,
      apiPort: r.api_port,
      secure: !!r.secure,
      connectionStatus: r.connection_status,
      lastSync: ctx ? ctx.synced_at : null,
      stale,
      hasContext: !!ctx,
      health,
      audit: lastAudit
        ? { id: lastAudit.id, type: lastAudit.audit_type, at: lastAudit.created_at, sev }
        : null,
    };
  });
  res.json(cards);
});

/* ---------- chat ---------- */
app.get('/api/routers/:id/chats', auth, (req, res) => {
  const rows = db
    .prepare('SELECT c.id, c.title, c.created_at, (SELECT COUNT(*) FROM messages m WHERE m.chat_id=c.id) AS msg_count FROM chats c WHERE c.router_id=? ORDER BY c.created_at DESC')
    .all(req.params.id);
  res.json(rows);
});

// Single-thread conversation per router (user-requested simplification):
// setiap router punya SATU chat permanen. Reuse / buat jika belum ada.
function getOrCreateChat(routerId, title) {
  let chat = db.prepare('SELECT * FROM chats WHERE router_id=? ORDER BY created_at ASC LIMIT 1').get(routerId);
  if (!chat) {
    const id = randomUUID();
    db.prepare('INSERT INTO chats (id, router_id, title, created_at) VALUES (?,?,?,?)').run(
      id, routerId, (title || 'Chat router').slice(0, 80), now()
    );
    chat = db.prepare('SELECT * FROM chats WHERE id=?').get(id);
  } else if (title && (!chat.title || chat.title === 'Chat baru')) {
    db.prepare('UPDATE chats SET title=? WHERE id=?').run(title.slice(0, 80), chat.id);
    chat.title = title.slice(0, 80);
  }
  return chat;
}

app.post('/api/routers/:id/chats', auth, (req, res) => {
  const { title } = req.body || {};
  const chat = getOrCreateChat(req.params.id, title);
  res.json({ id: chat.id, title: chat.title });
});

app.get('/api/chats/:id', auth, (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id=?').get(req.params.id);
  if (!chat) return res.status(404).json({ error: 'chat not found' });
  const messages = db.prepare('SELECT id, role, content, flags, created_at FROM messages WHERE chat_id=? ORDER BY created_at').all(chat.id);
  res.json({ ...chat, messages });
});

app.delete('/api/chats/:id', auth, (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id=?').get(req.params.id);
  if (!chat) return res.status(404).json({ error: 'chat not found' });
  const chatId = chat.id;
  db.prepare('DELETE FROM messages WHERE chat_id=?').run(chatId);
  db.prepare('DELETE FROM chats WHERE id=?').run(chatId);
  logger.info({ event: 'chat_removed', operation: 'chats', result: 'success', routerId: chat.router_id });
  res.json({ ok: true });
});

app.delete('/api/chats/:id/messages', auth, (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id=?').get(req.params.id);
  if (!chat) return res.status(404).json({ error: 'chat not found' });
  db.prepare('DELETE FROM messages WHERE chat_id=?').run(chat.id);
  logger.info({ event: 'chat_messages_cleared', operation: 'chats', result: 'success', routerId: chat.router_id });
  res.json({ ok: true });
});

app.delete('/api/routers/:id/chats', auth, (req, res) => {
  const chats = db.prepare('SELECT id FROM chats WHERE router_id=?').all(req.params.id);
  for (const c of chats) db.prepare('DELETE FROM messages WHERE chat_id=?').run(c.id);
  db.prepare('DELETE FROM chats WHERE router_id=?').run(req.params.id);
  logger.info({ event: 'chats_cleared', operation: 'chats', result: 'success', routerId: req.params.id, count: chats.length });
  res.json({ ok: true });
});

app.post('/api/routers/:id/chat', auth, async (req, res) => {
  const router = getRouter(req.params.id);
  if (!router) return res.status(404).json({ error: 'router not found' });
  const offline = await requireOnline(router);
  if (offline) return res.status(409).json({ error: `Router sedang offline / tidak dapat dihubungi. Detail: ${offline}. Hubungkan router lalu coba lagi.` });
  const provider = requireProvider();
  if (!provider) return res.status(400).json({ error: 'AI provider belum dikonfigurasi' });
  const ctx = db.prepare('SELECT * FROM contexts WHERE router_id=?').get(router.id);
  if (!ctx) return res.status(400).json({ error: 'router belum disync. Jalankan sinkronisasi dahulu.' });

  const { message, chatId, resetContext = false } = req.body || {};
  if (!message?.trim()) return res.status(400).json({ error: 'message kosong' });

  const emit = sse(res);
  const ac = new AbortController();
  res.on('close', () => ac.abort());

  // Gunakan chat aktif dari klien bila valid milik router ini; jika tidak, fallback ke chat tunggal.
  let chat = chatId
    ? db.prepare('SELECT * FROM chats WHERE id=? AND router_id=?').get(chatId, router.id)
    : null;
  if (!chat) chat = getOrCreateChat(router.id, message.trim());

  const history = db
    .prepare('SELECT role, content FROM messages WHERE chat_id=? ORDER BY created_at DESC LIMIT 20')
    .all(chat.id)
    .reverse()
    .map((h) => (h.role === 'assistant' ? { ...h, content: stripAdvisoryFooter(h.content) } : h));

  const digest = buildDigest(JSON.parse(ctx.snapshot), JSON.parse(ctx.summary), ctx.synced_at, {
    routerName: router.name,
    company: router.company,
    host: router.host,
    apiPort: router.api_port,
  }, DIGEST_CAP);
  const messages = buildMessages('chat', digest, history, message);
  const uid = randomUUID();
  db.prepare('INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?,?,?,?,?)').run(
    uid, chat.id, 'user', message, now()
  );

  const t0 = Date.now();
  let full = '';
  const append = (delta) => {
    full += delta;
    emit('delta', { delta });
  };
  try {
    if (provider.streaming) {
      try {
        await withRetry(
          async () => {
          const body = await chatCompletion({ ...provider, messages, stream: true, signal: ac.signal, maxTokens: 65536 });
            await streamText(body, append);
          },
          { retries: 5, baseDelayMs: 1000, shouldRetry: (e) => isTransientError(e) && full.length === 0 }
        );
      } catch (e) {
        if (e instanceof LlmError && e.status === 400) {
          const content = await withRetry(() => chatCompletion({ ...provider, messages, stream: false, signal: ac.signal }), { retries: 2, shouldRetry: (er) => isTransientError(er) && full.length === 0 });
          append(content);
        } else throw e;
      }
    } else {
      const content = await withRetry(() => chatCompletion({ ...provider, messages, stream: false, signal: ac.signal }), { retries: 5, shouldRetry: (er) => isTransientError(er) && full.length === 0 });
      append(content);
    }
    const guarded = guardOutput(full);
    db.prepare('INSERT INTO messages (id, chat_id, role, content, flags, created_at) VALUES (?,?,?,?,?,?)').run(
      randomUUID(), chat.id, 'assistant', guarded.content, guarded.flags, now()
    );
    logger.info({
      event: 'ai_request', operation: 'chat', result: 'success', routerId: router.id,
      durationMs: Date.now() - t0, chatId: chat.id,
    });
    emit('done', { messageId: chat.id, flags: guarded.flags });
  } catch (e) {
    const msg = e?.message || String(e);
    if (!ac.signal.aborted) {
      logger.warn({
        event: 'ai_request', operation: 'chat', result: 'failed', routerId: router.id,
        errorCategory: classifyError(msg), durationMs: Date.now() - t0,
      });
      emit('error', { error: friendlyError(msg) });
    }
  } finally {
    res.end();
  }
});

/* ---------- audit ---------- */
app.get('/api/routers/:id/audits', auth, (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 100);
  const offset = Math.max(Number(req.query.offset || 0), 0);
  const total = db.prepare('SELECT COUNT(*) AS c FROM audit_runs WHERE router_id=?').get(req.params.id).c;
  const rows = db.prepare('SELECT id, audit_type, ok, error, created_at FROM audit_runs WHERE router_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(req.params.id, limit, offset);
  res.json({ rows, total, limit, offset });
});

app.get('/api/audits/:id', auth, (req, res) => {
  const a = db.prepare('SELECT a.id, a.router_id, a.audit_type, a.ok, a.error, a.result, a.created_at, r.name AS router_name, r.company AS router_company FROM audit_runs a JOIN routers r ON r.id = a.router_id WHERE a.id=?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'audit not found' });
  res.json(a);
});

app.delete('/api/audits/:id', auth, (req, res) => {
  const a = db.prepare('SELECT * FROM audit_runs WHERE id=?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'audit not found' });
  db.prepare('DELETE FROM audit_runs WHERE id=?').run(req.params.id);
  logger.info({ event: 'audit_removed', operation: 'audits', result: 'success', routerId: a.router_id });
  res.json({ ok: true });
});

app.post('/api/routers/:id/audit', auth, async (req, res) => {
  const router = getRouter(req.params.id);
  if (!router) return res.status(404).json({ error: 'router not found' });
  const offline = await requireOnline(router);
  if (offline) return res.status(409).json({ error: `Router sedang offline / tidak dapat dihubungi. Detail: ${offline}. Hubungkan router lalu coba lagi.` });
  const provider = requireProvider();
  if (!provider) return res.status(400).json({ error: 'AI provider belum dikonfigurasi' });
  const ctx = db.prepare('SELECT * FROM contexts WHERE router_id=?').get(router.id);
  if (!ctx) return res.status(400).json({ error: 'router belum disync' });

  const kind = (req.body && req.body.kind) || 'audit-config';
  if (!['audit-config', 'audit-security', 'audit-network'].includes(kind)) {
    return res.status(400).json({ error: 'jenis audit tidak valid' });
  }

  const emit = sse(res);
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  const digest = buildDigest(JSON.parse(ctx.snapshot), JSON.parse(ctx.summary), ctx.synced_at, {
    routerName: router.name,
    company: router.company,
    host: router.host,
    apiPort: router.api_port,
  }, DIGEST_CAP);
  const messages = buildMessages(kind, digest, [], 'Lakukan audit sekarang terhadap router tersebut. Hasilkan laporan lengkap dan terstruktur sesuai instruksi sistem (Ringkasan, Temuan, Rekomendasi) berdasarkan data yang diberikan. Jawab dalam bahasa Indonesia.');
  const t0 = Date.now();
  let full = '';
  const append = (d) => {
    full += d;
    emit('delta', { delta: d });
  };
  try {
    emit('status', { step: 'context', label: 'Mengumpulkan konteks router' });
    try {
      await withRetry(
        async () => {
          const body = await chatCompletion({ ...provider, messages, stream: true, signal: ac.signal });
          emit('status', { step: 'streaming', label: 'AI menganalisis & menulis laporan' });
          await streamText(body, append);
        },
        { retries: 5, baseDelayMs: 1000, shouldRetry: (e) => isTransientError(e) && full.length === 0 }
      );
    } catch (e) {
      if (e instanceof LlmError && e.status === 400) {
        append(await withRetry(() => chatCompletion({ ...provider, messages, stream: false, signal: ac.signal, maxTokens: 65536 }), { retries: 2, shouldRetry: (er) => isTransientError(er) && full.length === 0 }));
      } else throw e;
    }
    const guarded = guardOutput(full);
    db.prepare('INSERT INTO audit_runs (id, router_id, audit_type, result, ok, created_at) VALUES (?,?,?,?,?,?)').run(
      randomUUID(), router.id, kind, guarded.content, 1, now()
    );
    emit('status', { step: 'saved', label: 'Laporan tersimpan' });
    logger.info({
      event: 'audit_execution', operation: 'audit', result: 'success', routerId: router.id,
      auditType: kind, durationMs: Date.now() - t0,
    });
    emit('done', {});
  } catch (e) {
    const msg = e?.message || String(e);
    db.prepare('INSERT INTO audit_runs (id, router_id, audit_type, result, ok, error, created_at) VALUES (?,?,?,?,?,?,?)').run(
      randomUUID(), router.id, kind, '', 0, msg.slice(0, 500), now()
    );
    if (!ac.signal.aborted) {
      logger.warn({
        event: 'audit_execution', operation: 'audit', result: 'failed', routerId: router.id,
        errorCategory: classifyError(msg), durationMs: Date.now() - t0,
      });
      emit('error', { error: friendlyError(msg) });
    }
  } finally {
    res.end();
  }
});

/* ---------- provider ---------- */
export function normalizeModelsUrl(baseUrl) {
  let u = (baseUrl || '').trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(u)) return u.replace(/\/chat\/completions$/, '/models');
  return `${u}/models`;
}

/* ---------- AI providers ---------- */
function providerView(row) {
  const key = decryptRowKey(row);
  return {
    id: row.id,
    label: row.label,
    baseUrl: row.base_url,
    model: row.model,
    active: !!row.active,
    hasKey: !!row.api_key_enc,
    keyPreview: keyPreview(key),
  };
}

app.get('/api/providers', auth, (req, res) => {
  res.json({
    providers: listProviderRows().map(providerView),
    presets: PROVIDER_PRESETS.map((p) => ({ key: p.key, label: p.label, url: p.url, model: p.model })),
    streaming: getSetting('ai_streaming', '1') === '1',
    maxContext: Number(getSetting('ai_max_context', '80000')),
  });
});

app.post('/api/providers', auth, (req, res) => {
  const { presetKey, label, baseUrl, model, apiKey } = req.body || {};
  const preset = PROVIDER_PRESETS.find((p) => p.key === presetKey) || null;
  const url = String(baseUrl ?? preset?.url ?? '').trim();
  const mdl = String(model ?? preset?.model ?? '').trim();
  const lbl = String(label ?? preset?.label ?? (url || 'Kustom')).trim();
  if (!url || !mdl) return res.status(400).json({ error: 'Base URL dan Model wajib diisi.' });
  const id = preset ? preset.key : 'custom-' + randomToken(4);
  const existing = getProviderRow(id);
  const ts = now();
  if (existing) {
    const keepKey = existing.api_key_enc;
    const { enc = keepKey, iv = existing.api_key_iv } = apiKey && String(apiKey).trim() ? encryptSecret(String(apiKey).trim()) : {};
    db.prepare('UPDATE ai_providers SET label=?, base_url=?, model=?, api_key_enc=COALESCE(?, api_key_enc), api_key_iv=COALESCE(?, api_key_iv), updated_at=? WHERE id=?')
      .run(lbl, url, mdl, enc, iv, ts, id);
    return res.json({ ok: true, provider: providerView(getProviderRow(id)) });
  }
  const { enc, iv } = apiKey && String(apiKey).trim() ? encryptSecret(String(apiKey).trim()) : { enc: '', iv: '' };
  const hasActive = listProviderRows().some((r) => r.active);
  db.prepare('INSERT INTO ai_providers (id,label,base_url,model,api_key_enc,api_key_iv,active,sort,created_at,updated_at) VALUES (?,?,?,?,?,?,?,0,?,?)')
    .run(id, lbl, url, mdl, enc, iv, hasActive ? 0 : 1, ts, ts);
  logger.info({ event: 'provider_create', operation: 'provider', result: 'success', id });
  res.json({ ok: true, provider: providerView(getProviderRow(id)) });
});

app.put('/api/providers/settings', auth, (req, res) => {
  const { streaming, maxContext } = req.body || {};
  if (streaming !== undefined) setSetting('ai_streaming', streaming ? '1' : '0');
  if (maxContext !== undefined) {
    const v = Math.max(10000, Math.min(Number(maxContext) || 80000, 500000));
    setSetting('ai_max_context', String(v));
  }
  res.json({ ok: true });
});

app.put('/api/providers/:id', auth, (req, res) => {
  const row = getProviderRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'provider tidak ditemukan' });
  const { baseUrl, model, apiKey, clearKey } = req.body || {};
  const ts = now();
  let enc = row.api_key_enc;
  let iv = row.api_key_iv;
  if (clearKey) { enc = ''; iv = ''; }
  else if (apiKey && String(apiKey).trim()) {
    const e = encryptSecret(String(apiKey).trim());
    enc = e.enc; iv = e.iv;
  }
  db.prepare('UPDATE ai_providers SET base_url=?, model=?, api_key_enc=?, api_key_iv=?, updated_at=? WHERE id=?')
    .run((baseUrl ?? row.base_url).trim(), (model ?? row.model).trim(), enc, iv, ts, row.id);
  logger.info({ event: 'provider_update', operation: 'provider', result: 'success', id: row.id });
  res.json({ ok: true, provider: providerView(getProviderRow(row.id)) });
});

app.post('/api/providers/:id/activate', auth, (req, res) => {
  const row = getProviderRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'provider tidak ditemukan' });
  db.exec('UPDATE ai_providers SET active=0');
  db.prepare('UPDATE ai_providers SET active=1, updated_at=? WHERE id=?').run(now(), row.id);
  logger.info({ event: 'provider_activate', operation: 'provider', result: 'success', id: row.id });
  res.json({ ok: true, activeId: row.id });
});

app.delete('/api/providers/:id', auth, (req, res) => {
  const row = getProviderRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'provider tidak ditemukan' });
  db.prepare('DELETE FROM ai_providers WHERE id=?').run(row.id);
  logger.info({ event: 'provider_delete', operation: 'provider', result: 'success', id: row.id });
  res.json({ ok: true });
});

app.post('/api/providers/:id/test', auth, async (req, res) => {
  const row = getProviderRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'provider tidak ditemukan' });
  const apiKey = decryptRowKey(row);
  if (!row.base_url) return res.status(400).json({ ok: false, error: 'Base URL kosong' });
  try {
    const url = normalizeModelsUrl(row.base_url);
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(config.llmTimeoutMs),
    });
    if (!resp.ok) {
      const detail = (await resp.text().catch(() => '')).slice(0, 300);
      return res.status(502).json({ ok: false, error: `HTTP ${resp.status}: ${detail}` });
    }
    const data = await resp.json();
    const models = (data?.data || []).map((m) => m.id || m).filter(Boolean);
    res.json({ ok: true, model: row.model, models });
  } catch (e) {
    res.status(502).json({ ok: false, error: friendlyError(e?.message || String(e)) });
  }
});

/* ---------- settings ---------- */
app.put('/api/settings/password', auth, (req, res) => {
  const { currentPassword, password } = req.body || {};
  if (!password || password.length < 4) return res.status(400).json({ error: 'password minimal 4 karakter' });
  const stored = getSetting('admin_password_hash');
  if (!verifyPassword(currentPassword || '', stored)) return res.status(401).json({ error: 'password saat ini salah' });
  setSetting('admin_password_hash', hashPassword(password));
  logger.info({ event: 'password_change', operation: 'settings', result: 'success' });
  res.json({ ok: true });
});

/* ---------- logs ---------- */
app.get('/api/logs', auth, (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
  const offset = Math.max(Number(req.query.offset || 0), 0);
  const file = path.join(config.logDir, 'app.log');
  if (!fs.existsSync(file)) return res.json({ rows: [], total: 0, limit, offset });
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const all = [];
  for (const line of lines) {
    try {
      all.push(JSON.parse(line));
    } catch {
      /* ignore corrupt line */
    }
  }
  all.reverse();
  res.json({ rows: all.slice(offset, offset + limit), total: all.length, limit, offset });
});

/* ---------- config templates ---------- */
app.get('/api/templates', auth, (req, res) => {
  res.json(listTemplates());
});

app.get('/api/templates/:id', auth, (req, res) => {
  const tpl = getTemplate(req.params.id);
  if (!tpl) return res.status(404).json({ error: 'Template tidak ditemukan.' });
  res.json({ id: tpl.id, label: tpl.label, desc: tpl.desc, params: tpl.params });
});

app.post('/api/templates/:id/script', auth, (req, res) => {
  try {
    res.json({ script: renderScript(req.params.id, req.body?.values || {}) });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

/* ---------- network discovery ---------- */
app.post('/api/discover', auth, async (req, res) => {
  const durationMs = Math.min(Math.max(Number(req.body?.duration) || 3500, 1000), 8000);
  try {
    const devices = await scanMikrotik({ durationMs });
    logger.info({ event: 'discover_request', operation: 'discover', result: 'done', count: devices.length });
    res.json({ devices });
  } catch (e) {
    res.status(502).json({ error: `Pemindaian gagal: ${e.message}` });
  }
});

function classifyError(msg) {
  const m = msg.toLowerCase();
  if (/auth|login|unauthor|invalid user/i.test(m)) return 'auth';
  if (/timeout|etimedout|econnrefused|econnreset|eai_again|enetunreach/i.test(m)) return 'connection';
  if (/confirm|denied|forbidden/i.test(m)) return 'permission';
  if (/provider|llm|http \d/i.test(m)) return 'ai_provider';
  return 'unknown';
}

function friendlyError(msg) {
  const m = String(msg || '');
  if (/empty response|retryrequest/i.test(m)) {
    return 'Server AI sedang sibuk dan tidak membalas (empty response). Tunggu beberapa saat lalu coba lagi.';
  }
  if (/fetch failed|econnrefused|econnreset|enotfound|etimedout|und_conn|network error/i.test(m)) {
    return 'Provider AI tidak dapat dijangkau. Periksa Base URL dan pastikan server AI aktif.';
  }
  if (/invalid user name or password/i.test(m)) return 'Kredensial router ditolak — periksa username/password di Edit router.';
  if (/login required|not connected|command timeout/i.test(m)) return 'Koneksi ke router bermasalah. Cek host/port dan jalankan Test Connection.';
  return m;
}

function isTransientError(e) {
  const m = String(e?.message || '').toLowerCase();
  return /fetch failed|econnrefused|econnreset|enotfound|eai_again|enetunreach|etimedout|network error|und_conn|socket hang up|empty response|retryrequest/i.test(m);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry(fn, { retries = 2, baseDelayMs = 800, shouldRetry } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const retry = shouldRetry ? shouldRetry(e) : isTransientError(e);
      if (!retry || i === retries) throw e;
      await sleep(baseDelayMs * (i + 1));
    }
  }
  throw lastErr;
}


