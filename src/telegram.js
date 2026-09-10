import { randomUUID } from 'node:crypto';
import { db, getSetting, now, getTelegramActiveRouter, setTelegramActiveRouter } from './db.js';
import { decryptSecret } from './security.js';
import { collectRouter } from './collector.js';
import { RouterOSConnection } from './routeros.js';
import { chatCompletion } from './llm.js';
import { buildDigest, buildMessages, securityAuditPrompt } from './orchestrator.js';
import { guardOutput, containsWriteCommands, stripAdvisoryFooter } from './guard.js';
import { isExecutionEnabled, createExecutionJob, getExecutionJob, approveAndExecuteJob, rejectExecutionJob } from './jobs.js';
import { logger } from './logger.js';

let pollingActive = false;
let pollingAbortController = null;
const activeRouterPerChat = new Map();

export function getTelegramConfig() {
  const enc = getSetting('telegram_bot_token_enc', '');
  const iv = getSetting('telegram_bot_token_iv', '');
  let token = '';
  if (enc && iv) {
    try {
      token = decryptSecret(enc, iv);
    } catch {
      token = '';
    }
  }
  if (!token) token = process.env.TELEGRAM_BOT_TOKEN || '';

  const allowedChats = (getSetting('telegram_allowed_chats', '') || process.env.TELEGRAM_ALLOWED_CHATS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const enabled = getSetting('telegram_enabled', '0') === '1';
  const defaultRouterId = getSetting('telegram_default_router_id', '');

  return { token, allowedChats, enabled, defaultRouterId };
}

export async function telegramApi(token, method, payload = {}) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(35000),
  });
  const data = await res.json().catch(() => ({ ok: false, description: 'Invalid JSON response' }));
  return data;
}

export function splitTelegramMessage(text, maxLen = 4000) {
  if (!text || text.length <= maxLen) return [text || ''];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let splitIdx = remaining.lastIndexOf('\n\n', maxLen);
    if (splitIdx === -1 || splitIdx < maxLen / 2) {
      splitIdx = remaining.lastIndexOf('\n', maxLen);
    }
    if (splitIdx === -1 || splitIdx < maxLen / 2) {
      splitIdx = remaining.lastIndexOf(' ', maxLen);
    }
    if (splitIdx === -1) {
      splitIdx = maxLen;
    }
    chunks.push(remaining.slice(0, splitIdx).trim());
    remaining = remaining.slice(splitIdx).trim();
  }
  if (remaining.length) chunks.push(remaining);
  return chunks;
}

export async function sendTelegramMessage(token, chatId, text, opts = {}) {
  const chunks = splitTelegramMessage(text, 4000);
  let lastRes = null;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const isLast = i === chunks.length - 1;
    const payload = {
      chat_id: chatId,
      text: chunk,
      parse_mode: opts.parseMode || 'Markdown',
      reply_markup: isLast ? opts.replyMarkup : undefined,
    };
    let res = await telegramApi(token, 'sendMessage', payload);
    if (!res.ok && res.description && res.description.includes("can't parse entities")) {
      delete payload.parse_mode;
      res = await telegramApi(token, 'sendMessage', payload);
    }
    lastRes = res;
  }
  return lastRes;
}

export async function answerCallbackQuery(token, callbackQueryId, text = '', showAlert = false) {
  return telegramApi(token, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert,
  });
}

export async function editMessageText(token, chatId, messageId, text, opts = {}) {
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: opts.parseMode || 'Markdown',
    reply_markup: opts.replyMarkup,
  };
  let res = await telegramApi(token, 'editMessageText', payload);
  if (!res.ok && res.description && res.description.includes("can't parse entities")) {
    delete payload.parse_mode;
    res = await telegramApi(token, 'editMessageText', payload);
  }
  return res;
}

let botCache = null;

export async function getBotInfo(token) {
  if (botCache && botCache.token === token) return botCache.info;
  try {
    const res = await telegramApi(token, 'getMe');
    if (res.ok && res.result) {
      botCache = { token, info: res.result };
      return res.result;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function normalizeTelegramCommand(text) {
  if (!text) return '';
  return text.trim().replace(/^\/([a-zA-Z0-9_]+)@[a-zA-Z0-9_]+/i, '/$1');
}

export function isChatAllowed(chatId, fromId, allowedChats) {
  if (!allowedChats || !allowedChats.length) return false;
  const sChat = String(chatId ?? '').trim();
  const sFrom = String(fromId ?? '').trim();
  return allowedChats.some((a) => {
    const clean = String(a).trim();
    return clean.length > 0 && (clean === sChat || clean === sFrom);
  });
}

export function setActiveRouterForChat(chatId, routerId) {
  setTelegramActiveRouter(chatId, routerId);
  activeRouterPerChat.set(String(chatId), routerId);
}

export function getActiveRouterForChat(chatId, defaultRouterId) {
  // 1. Check persistent DB setting for this chat
  const savedRouterId = getTelegramActiveRouter(chatId);
  if (savedRouterId) {
    const r = db.prepare('SELECT * FROM routers WHERE id = ?').get(savedRouterId);
    if (r) return r;
  }
  // 2. Check in-memory map
  const sChat = String(chatId);
  if (activeRouterPerChat.has(sChat)) {
    const rId = activeRouterPerChat.get(sChat);
    const r = db.prepare('SELECT * FROM routers WHERE id = ?').get(rId);
    if (r) return r;
  }
  // 3. Check configured default router ID from Settings
  if (defaultRouterId) {
    const r = db.prepare('SELECT * FROM routers WHERE id = ?').get(defaultRouterId);
    if (r) {
      setActiveRouterForChat(chatId, r.id);
      return r;
    }
  }
  // 4. Default to first registered router so user is never blocked from chatting
  const all = db.prepare('SELECT * FROM routers ORDER BY name ASC').all();
  if (all.length > 0) {
    setActiveRouterForChat(chatId, all[0].id);
    return all[0];
  }
  return null;
}

export function getActiveAiProvider() {
  const row = db.prepare('SELECT * FROM ai_providers WHERE active = 1 LIMIT 1').get();
  if (row) {
    let key = '';
    if (row.api_key_enc && row.api_key_iv) {
      try {
        key = decryptSecret(row.api_key_enc, row.api_key_iv);
      } catch {
        key = '';
      }
    }
    if (!key) key = getSetting('ai_api_key', '') || '';
    return { baseUrl: row.base_url, apiKey: key, model: row.model, label: row.label };
  }
  const baseUrl = getSetting('ai_base_url', '');
  const model = getSetting('ai_model', '');
  if (baseUrl && model) {
    return { baseUrl, apiKey: getSetting('ai_api_key', '') || '', model, label: 'Default' };
  }
  return null;
}

export function extractScriptFromText(text) {
  if (!text) return [];
  // Match all markdown code blocks (routeros, rsc, mikrotik, bash, sh, or unlabelled)
  const blockRegex = /```(?:routeros|rsc|mikrotik|bash|sh)?\r?\n([\s\S]*?)```/gi;
  const cmds = [];
  let match;
  while ((match = blockRegex.exec(text)) !== null) {
    const lines = match[1].split('\n');
    for (let l of lines) {
      l = l.trim();
      if (!l || l.startsWith('#')) continue;
      if (l.startsWith('/') || l.startsWith(':')) {
        cmds.push(l);
      } else if (
        /^(add|set|remove|enable|disable|reset|print|ip|interface|queue|system|routing|tool|user|radius|bridge|ppp|certificate|snmp)\b/i.test(
          l
        )
      ) {
        cmds.push(l.startsWith('/') ? l : `/${l}`);
      }
    }
  }
  if (cmds.length) return cmds;

  // Fallback: plain text lines that start with '/'
  const lines = text.split('\n');
  for (let l of lines) {
    l = l.trim();
    if (l.startsWith('/') && !l.startsWith('//') && !l.startsWith('/*')) {
      cmds.push(l);
    }
  }
  return cmds;
}

export async function handleIncomingMessage(token, msg, allowedChats, defaultRouterId, botInfo = null) {
  const chatId = msg.chat?.id;
  const fromId = msg.from?.id;
  const chatType = msg.chat?.type || 'private';
  const isGroup = chatType === 'group' || chatType === 'supergroup';
  const rawText = (msg.text || '').trim();

  // Normalize command if it contains bot username (e.g. /status@MyBot -> /status)
  let text = normalizeTelegramCommand(rawText);

  // Check if message is directed to the bot
  const botUsername = botInfo?.username ? botInfo.username.toLowerCase() : '';
  const botId = botInfo?.id;
  const isMentioned = botUsername ? new RegExp(`@${botUsername}\\b`, 'i').test(rawText) : false;
  const isReplyToBot = Boolean(msg.reply_to_message?.from?.id && botId && msg.reply_to_message.from.id === botId);
  const isCommand = text.startsWith('/');
  // If the group is explicitly whitelisted in allowedChats, treat messages as directed to the assistant
  const isWhitelistedGroup = isGroup && isChatAllowed(chatId, fromId, allowedChats);
  const isDirectedToBot = !isGroup || isWhitelistedGroup || isCommand || isMentioned || isReplyToBot;

  if (!isChatAllowed(chatId, fromId, allowedChats)) {
    // In group chats, only alert if message was explicitly directed to this bot
    if (isDirectedToBot) {
      await sendTelegramMessage(
        token,
        chatId,
        `⛔ *Akses Ditolak*\nChat ID: \`${chatId}\`\nUser ID: \`${fromId}\`\n\nID ini belum terdaftar di whitelist MikroTik Assistant.\nSilakan daftarkan di menu *Keamanan & Akun -> Integrasi Telegram* pada web app.`,
        { parseMode: 'Markdown' }
      );
      logger.warn({ event: 'telegram_auth_rejected', chatId, fromId, chatType });
    }
    return;
  }

  // In a non-whitelisted group, ignore general chatter among members unless directed to bot
  if (isGroup && !isDirectedToBot) {
    return;
  }

  // Strip mention from question if mentioned in group
  if (isMentioned && botUsername) {
    text = text.replace(new RegExp(`@${botUsername}\\b`, 'gi'), '').trim();
  }

  if (!text) return;

  // Command: /start or /help
  if (text === '/start' || text === '/help') {
    const active = getActiveRouterForChat(chatId, defaultRouterId);
    const helpMsg = `🤖 *AI MikroTik Assistant — Telegram Console*
Selamat datang! Anda dapat memantau router, menjalankan audit, dan berdiskusi dengan AI Copilot.

*Router Aktif:* ${active ? `*${active.name}* (${active.host})` : '_Belum ada router terpilih_'}

📌 *Daftar Perintah:*
• \`/routers\` — Daftar router & pilih target dengan tombol interaktif
• \`/status\` — Cek telemetri hardware (CPU, RAM, Suhu, Uptime)
• \`/sync\` — Tarik data telemetri terbaru seketika
• \`/audit\` — Jalankan audit keamanan konfigurasi
• \`/clear\` atau \`/reset\` — Bersihkan riwayat percakapan router aktif
• \`/help\` — Tampilkan pesan panduan ini

💬 *Chat Bebas (Bahasa Alami):*
Ketik langsung pertanyaan atau perintah dalam bahasa sehari-hari. *Tidak perlu mengetik sintaks /exec manual!* AI akan otomatis menerjemahkannya dan meminta konfirmasi Anda sebelum dieksekusi.
Contoh:
- _"Tolong matikan service telnet biar aman"_
- _"Buat limit bandwidth 10 Mbps untuk IP 192.168.1.50"_
- _"Cek kenapa CPU load tinggi?"_
- _"Blokir port 23 di firewall input"_

${isExecutionEnabled() ? '⚡ *Mode Eksekusi:* AKTIF (Setiap perubahan konfigurasi memerlukan konfirmasi Anda lewat tombol approval atau cukup balas "eksekusi").' : '🛡️ *Mode Eksekusi:* NONAKTIF (Hanya konsultatif / Read-only).'}`;
    await sendTelegramMessage(token, chatId, helpMsg);
    return;
  }

  // Command: /clear or /reset
  if (text === '/clear' || text === '/reset') {
    const active = getActiveRouterForChat(chatId, defaultRouterId);
    if (active) {
      const sessionId = `tg_${chatId}_${active.id}`;
      db.prepare('DELETE FROM messages WHERE chat_id = ?').run(sessionId);
      await sendTelegramMessage(token, chatId, `🗑️ Riwayat percakapan untuk router *${active.name}* telah dibersihkan.`);
    } else {
      await sendTelegramMessage(token, chatId, '⚠️ Belum ada router aktif terpilih.');
    }
    return;
  }

  // Command: /routers
  if (text === '/routers') {
    const routers = db.prepare('SELECT id, name, company, host, connection_status FROM routers ORDER BY name ASC').all();
    if (!routers.length) {
      await sendTelegramMessage(token, chatId, '⚠️ Belum ada router terdaftar di aplikasi.');
      return;
    }
    const current = getActiveRouterForChat(chatId, defaultRouterId);
    let msgList = `📡 *Pilih Router MikroTik untuk Sesi Chat:*\n`;
    msgList += `Router Aktif Saat Ini: ${current ? `*${current.name}* (\`${current.host}\`)` : '_Belum dipilih_'}\n\n`;
    msgList += `Klik tombol router di bawah ini untuk langsung memilih router target:`;

    const inline_keyboard = routers.map((r) => [
      {
        text: `${r.connection_status === 'ok' ? '🟢' : '🔴'} ${r.name} (${r.host})${current?.id === r.id ? ' ✅ (Aktif)' : ''}`,
        callback_data: `use:${r.id}`,
      },
    ]);

    await sendTelegramMessage(token, chatId, msgList, { replyMarkup: { inline_keyboard } });
    return;
  }

  // Command: /use <query>
  if (text.startsWith('/use')) {
    const query = text.replace(/^\/use\s*/i, '').trim();
    const routers = db.prepare('SELECT * FROM routers ORDER BY name ASC').all();
    if (!routers.length) {
      await sendTelegramMessage(token, chatId, '⚠️ Belum ada router terdaftar di aplikasi.');
      return;
    }
    if (!query) {
      const inline_keyboard = routers.map((r) => [
        {
          text: `${r.connection_status === 'ok' ? '🟢' : '🔴'} ${r.name} (${r.host})`,
          callback_data: `use:${r.id}`,
        },
      ]);
      await sendTelegramMessage(token, chatId, '⚠️ Silakan klik salah satu tombol router berikut untuk dijadikan router aktif:', {
        replyMarkup: { inline_keyboard },
      });
      return;
    }
    const q = query.toLowerCase();
    const match = routers.find((r) => r.id === query || r.name.toLowerCase() === q || r.name.toLowerCase().includes(q) || r.host.includes(query));
    if (!match) {
      const inline_keyboard = routers.map((r) => [
        {
          text: `${r.connection_status === 'ok' ? '🟢' : '🔴'} ${r.name} (${r.host})`,
          callback_data: `use:${r.id}`,
        },
      ]);
      await sendTelegramMessage(
        token,
        chatId,
        `❌ Router dengan kata kunci "${query}" tidak ditemukan.\nSilakan pilih dari daftar tombol di bawah:`,
        { replyMarkup: { inline_keyboard } }
      );
      return;
    }
    setActiveRouterForChat(chatId, match.id);
    await sendTelegramMessage(token, chatId, `✅ Router aktif diatur ke: *${match.name}* (\`${match.host}\`)\nSemua pesan chat sekarang akan menganalisis router ini.`);
    return;
  }

  // Ensure active router
  const router = getActiveRouterForChat(chatId, defaultRouterId);
  if (!router) {
    const routers = db.prepare('SELECT id, name, host, connection_status FROM routers ORDER BY name ASC').all();
    if (!routers.length) {
      await sendTelegramMessage(token, chatId, '⚠️ Belum ada router terdaftar di aplikasi web. Daftarkan router terlebih dahulu.');
      return;
    }
    const inline_keyboard = routers.map((r) => [
      {
        text: `${r.connection_status === 'ok' ? '🟢' : '🔴'} ${r.name} (${r.host})`,
        callback_data: `use:${r.id}`,
      },
    ]);
    await sendTelegramMessage(
      token,
      chatId,
      '⚠️ *Pilih Router Target:*\nAnda memiliki beberapa router terdaftar. Silakan klik salah satu tombol di bawah untuk memilih router yang ingin di-chat / dianalisis:',
      { replyMarkup: { inline_keyboard } }
    );
    return;
  }

  // Conversational text approval or rejection of pending execution job
  const cleanInput = text.trim().toLowerCase();
  const isApprovalIntent = /^(ya|setuju|eksekusi|jalankan|approve|oke|ok|lanjutkan|yes|confirm|terapkan|apply)\b/i.test(cleanInput);
  const isRejectIntent = /^(batal|batalkan|jangan|cancel|reject|tidak|tolak)\b/i.test(cleanInput);

  if (isApprovalIntent || isRejectIntent) {
    const pendingJob = db.prepare(`
      SELECT * FROM execution_jobs 
      WHERE router_id = ? AND source = 'telegram' AND status = 'pending' 
      ORDER BY created_at DESC LIMIT 1
    `).get(router.id);

    if (pendingJob) {
      const userLabel = msg.from?.username ? `@${msg.from.username}` : (msg.from?.first_name || String(fromId));
      if (isRejectIntent) {
        rejectExecutionJob(pendingJob.id, { rejectedBy: `Telegram:${userLabel}` });
        await sendTelegramMessage(token, chatId, `❌ *Rencana Eksekusi Dibatalkan.*\nJob ID: \`${pendingJob.id}\``);
        return;
      }
      if (isApprovalIntent) {
        if (!isExecutionEnabled()) {
          await sendTelegramMessage(token, chatId, '🛡️ *Mode Eksekusi Nonaktif*\nEksekusi saat ini dinonaktifkan di menu Pengaturan Web App.');
          return;
        }
        await telegramApi(token, 'sendChatAction', { chat_id: chatId, action: 'typing' });
        await sendTelegramMessage(token, chatId, `⏳ *Sedang Mengeksekusi Konfigurasi ke ${router.name}...*\nJob ID: \`${pendingJob.id}\`\nMohon tunggu.`);
        const result = await approveAndExecuteJob(pendingJob.id, { approvedBy: `Telegram:${userLabel}` });
        if (result.ok) {
          const summary = (result.output || []).map((o) => `• \`${o.line}\`: OK`).join('\n');
          await sendTelegramMessage(
            token,
            chatId,
            `✅ *Eksekusi Berhasil Diterapkan!*\nRouter: *${router.name}*\nSeluruh ${result.output?.length || ''} baris perintah telah aktif di router.\n\n\`\`\`\n${summary}\n\`\`\``
          );
        } else {
          const summary = (result.output || [])
            .map((o) => `${o.ok ? '✅' : '❌'} \`${o.line}\`${o.error ? ` (${o.error})` : ''}`)
            .join('\n');
          await sendTelegramMessage(
            token,
            chatId,
            `⚠️ *Hasil Eksekusi Sebagian / Gagal*\nRouter: *${router.name}*\n${result.error || ''}\n\n*Rincian Perintah:*\n${summary || 'Tidak ada detail output.'}`
          );
        }
        return;
      }
    }
  }

  // Command: /exec <commands...>
  if (text.startsWith('/exec')) {
    const rawCmds = text.replace(/^\/exec\s*/i, '').trim();
    if (!rawCmds) {
      await sendTelegramMessage(token, chatId, '⚠️ Format perintah: `/exec <perintah_routeros>`\nContoh:\n`/exec /ip service disable telnet`');
      return;
    }
    if (!isExecutionEnabled()) {
      await sendTelegramMessage(token, chatId, '🛡️ *Mode Eksekusi Nonaktif*\nEksekusi saat ini dinonaktifkan di menu Pengaturan Web App.');
      return;
    }
    const lines = rawCmds.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    if (!lines.length) {
      await sendTelegramMessage(token, chatId, '⚠️ Tidak ada baris perintah yang valid.');
      return;
    }

    const job = createExecutionJob({
      routerId: router.id,
      source: 'telegram',
      commands: lines,
      requestedBy: msg.from?.username ? `@${msg.from.username}` : `User ${fromId}`,
    });

    const approvalPrompt = `⚡ *Konfirmasi Eksekusi Perintah*
Target Router: *${router.name}* (\`${router.host}\`)
Diajukan oleh: ${msg.from?.username ? `@${msg.from.username}` : `User ${fromId}`}

\`\`\`routeros
${lines.slice(0, 5).join('\n')}${lines.length > 5 ? `\n...dan ${lines.length - 5} baris lainnya` : ''}
\`\`\`

Apakah Anda menyetujui perintah ini dieksekusi di router?`;

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '✅ Setujui & Eksekusi', callback_data: `job:app:${job.id}` },
          { text: '❌ Batalkan', callback_data: `job:rej:${job.id}` },
        ],
      ],
    };

    await sendTelegramMessage(token, chatId, approvalPrompt, { replyMarkup });
    return;
  }

  // Command: /status
  if (text === '/status') {
    const ctx = db.prepare('SELECT * FROM contexts WHERE router_id = ?').get(router.id);
    if (!ctx) {
      await sendTelegramMessage(token, chatId, `⚠️ Router *${router.name}* belum disinkronisasi. Jalankan \`/sync\` terlebih dahulu.`);
      return;
    }
    let snap = {};
    try { snap = JSON.parse(ctx.snapshot); } catch { /* ignore */ }
    const res1 = snap['system/resource']?.[0] || {};
    const h = snap['system/health']?.[0] || {};
    const ifaces = snap.interfaces || [];
    const upIfaces = ifaces.filter((i) => i.running === 'true').length;

    const statusMsg = `📊 *Status Router: ${router.name}*
Host: \`${router.host}:${router.api_port}\`
Status Koneksi: ${router.connection_status === 'ok' ? '🟢 Terhubung' : '🔴 Terputus'}
Terakhir Sync: ${ctx.synced_at ? ctx.synced_at.slice(0, 19).replace('T', ' ') : '—'}

• *Model Board:* ${res1['board-name'] || '—'}
• *RouterOS:* ${res1.version || '—'}
• *Uptime:* ${res1.uptime || '—'}
• *CPU Load:* ${res1['cpu-load'] != null ? res1['cpu-load'] + '%' : '—'}
• *RAM:* ${res1['free-memory'] ? Math.round(Number(res1['free-memory']) / 1048576) + ' MB free' : '—'} / ${res1['total-memory'] ? Math.round(Number(res1['total-memory']) / 1048576) + ' MB' : '—'}
• *Suhu:* ${h.temperature != null ? h.temperature + ' °C' : '—'}
• *Interface Up:* ${upIfaces} / ${ifaces.length} port aktif`;

    await sendTelegramMessage(token, chatId, statusMsg);
    return;
  }

  // Command: /sync
  if (text === '/sync') {
    await telegramApi(token, 'sendChatAction', { chat_id: chatId, action: 'typing' });
    await sendTelegramMessage(token, chatId, `⏳ Memulai sinkronisasi data dari *${router.name}*...`);
    try {
      const out = await collectRouter(router);
      db.prepare(
        'INSERT INTO contexts (router_id, snapshot, summary, synced_at) VALUES (?,?,?,?) ON CONFLICT(router_id) DO UPDATE SET snapshot=excluded.snapshot, summary=excluded.summary, synced_at=excluded.synced_at'
      ).run(router.id, JSON.stringify(out.results), JSON.stringify(out.summary), now());
      db.prepare(`UPDATE routers SET connection_status='ok', last_sync=?, last_error=NULL WHERE id=?`).run(now(), router.id);

      await sendTelegramMessage(
        token,
        chatId,
        `✅ *Sinkronisasi Sukses!*\nRouter: *${router.name}*\nBerhasil menarik *${out.okCount}* resource RouterOS dalam mode read-only.`
      );
    } catch (e) {
      db.prepare(`UPDATE routers SET connection_status='failed', last_error=? WHERE id=?`).run(e.message || String(e), router.id);
      await sendTelegramMessage(token, chatId, `❌ *Sinkronisasi Gagal!*\nDetail: ${e.message || String(e)}`);
    }
    return;
  }

  // Command: /audit
  if (text === '/audit') {
    await telegramApi(token, 'sendChatAction', { chat_id: chatId, action: 'typing' });
    let ctx = db.prepare('SELECT * FROM contexts WHERE router_id = ?').get(router.id);
    if (!ctx) {
      try {
        await sendTelegramMessage(token, chatId, `⏳ Mengambil data telemetri dari *${router.name}* untuk audit...`);
        const out = await collectRouter(router);
        db.prepare(
          'INSERT INTO contexts (router_id, snapshot, summary, synced_at) VALUES (?,?,?,?) ON CONFLICT(router_id) DO UPDATE SET snapshot=excluded.snapshot, summary=excluded.summary, synced_at=excluded.synced_at'
        ).run(router.id, JSON.stringify(out.results), JSON.stringify(out.summary), now());
        db.prepare(`UPDATE routers SET connection_status='ok', last_sync=?, last_error=NULL WHERE id=?`).run(now(), router.id);
        ctx = db.prepare('SELECT * FROM contexts WHERE router_id = ?').get(router.id);
      } catch (e) {
        await sendTelegramMessage(token, chatId, `⚠️ Gagal sinkronisasi data router: ${e.message || String(e)}`);
        return;
      }
    }

    const prov = getActiveAiProvider();
    if (!prov) {
      await sendTelegramMessage(token, chatId, '⚠️ Provider AI belum dikonfigurasi di web app.');
      return;
    }

    await sendTelegramMessage(token, chatId, `🔍 *Menjalankan Audit Keamanan Konfigurasi* pada *${router.name}*...\nHarap tunggu sebentar.`);

    try {
      const digest = buildDigest(JSON.parse(ctx.snapshot), JSON.parse(ctx.summary), ctx.synced_at, {
        routerName: router.name,
        company: router.company,
        host: router.host,
        apiPort: router.api_port,
      });
      const sysPrompt = securityAuditPrompt();
      const messages = [
        { role: 'system', content: `${sysPrompt}\n\n---RICH CONTENT---\n${digest}` },
        { role: 'user', content: 'Lakukan audit keamanan konfigurasi router sekarang.' },
      ];

      const report = await chatCompletion({
        baseUrl: prov.baseUrl,
        apiKey: prov.apiKey,
        model: prov.model,
        messages,
        stream: false,
      });

      const guarded = guardOutput(report);
      await sendTelegramMessage(token, chatId, `🛡️ *Laporan Audit Keamanan: ${router.name}*\n\n${guarded.content}`);
    } catch (err) {
      await sendTelegramMessage(token, chatId, `❌ Gagal menjalankan audit: ${err.message || String(err)}`);
    }
    return;
  }

  // Free-form Natural Language Chat
  await telegramApi(token, 'sendChatAction', { chat_id: chatId, action: 'typing' });

  // Auto-sync if router doesn't have context yet
  let ctx = db.prepare('SELECT * FROM contexts WHERE router_id = ?').get(router.id);
  if (!ctx) {
    try {
      const out = await collectRouter(router);
      db.prepare(
        'INSERT INTO contexts (router_id, snapshot, summary, synced_at) VALUES (?,?,?,?) ON CONFLICT(router_id) DO UPDATE SET snapshot=excluded.snapshot, summary=excluded.summary, synced_at=excluded.synced_at'
      ).run(router.id, JSON.stringify(out.results), JSON.stringify(out.summary), now());
      db.prepare(`UPDATE routers SET connection_status='ok', last_sync=?, last_error=NULL WHERE id=?`).run(now(), router.id);
      ctx = db.prepare('SELECT * FROM contexts WHERE router_id = ?').get(router.id);
    } catch (err) {
      logger.warn({ event: 'telegram_auto_sync_error', error: err.message, routerId: router.id });
    }
  }

  const prov = getActiveAiProvider();
  if (!prov) {
    await sendTelegramMessage(token, chatId, '⚠️ Provider AI belum dikonfigurasi di web app. Buka menu AI Provider dan atur API Key terlebih dahulu.');
    return;
  }

  const sessionId = `tg_${chatId}_${router.id}`;
  let chatRow = db.prepare('SELECT id FROM chats WHERE id = ?').get(sessionId);
  if (!chatRow) {
    db.prepare('INSERT INTO chats (id, router_id, title, created_at) VALUES (?, ?, ?, ?)').run(
      sessionId,
      router.id,
      `Telegram: ${chatId}`,
      now()
    );
  }

  // Load last 10 messages for conversational memory (tanya jawab)
  const history = db
    .prepare('SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at DESC LIMIT 10')
    .all(sessionId)
    .reverse()
    .map((h) => (h.role === 'assistant' ? { ...h, content: stripAdvisoryFooter(h.content) } : h));

  let snapshot = {};
  let summary = [];
  let syncedAt = now();
  if (ctx) {
    try {
      snapshot = JSON.parse(ctx.snapshot);
      summary = JSON.parse(ctx.summary);
      syncedAt = ctx.synced_at;
    } catch {}
  }

  try {
    const digest = buildDigest(snapshot, summary, syncedAt, {
      routerName: router.name,
      company: router.company,
      host: router.host,
      apiPort: router.api_port,
    });
    const messages = buildMessages('chat', digest, history, text);

    // Save user message to DB
    db.prepare('INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run(
      randomUUID(),
      sessionId,
      'user',
      text,
      now()
    );

    const aiRes = await chatCompletion({
      baseUrl: prov.baseUrl,
      apiKey: prov.apiKey,
      model: prov.model,
      messages,
      stream: false,
    });

    const guarded = guardOutput(aiRes);

    // Save assistant response to DB
    db.prepare('INSERT INTO messages (id, chat_id, role, content, flags, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      randomUUID(),
      sessionId,
      'assistant',
      guarded.content,
      guarded.flags,
      now()
    );

    await sendTelegramMessage(token, chatId, guarded.content);

    // If AI proposed configuration script, offer approval button
    const scriptLines = extractScriptFromText(guarded.content);
    if (scriptLines.length && containsWriteCommands(guarded.content)) {
      if (isExecutionEnabled()) {
        const job = createExecutionJob({
          routerId: router.id,
          source: 'telegram',
          commands: scriptLines,
          requestedBy: msg.from?.username ? `@${msg.from.username}` : `User ${fromId}`,
        });

        const approvalPrompt = `⚡ *Konfirmasi Eksekusi Skrip*
AI menerjemahkan permintaan Anda menjadi *${scriptLines.length} baris perintah* untuk router *${router.name}*:

\`\`\`routeros
${scriptLines.slice(0, 5).join('\n')}${scriptLines.length > 5 ? `\n...dan ${scriptLines.length - 5} baris lainnya` : ''}
\`\`\`

Apakah Anda menyetujui perintah ini dieksekusi di router?
_(Klik tombol di bawah atau balas chat dengan "eksekusi" / "setuju")_`;

        const replyMarkup = {
          inline_keyboard: [
            [
              { text: '✅ Setujui & Eksekusi', callback_data: `job:app:${job.id}` },
              { text: '❌ Batalkan', callback_data: `job:rej:${job.id}` },
            ],
          ],
        };

        await sendTelegramMessage(token, chatId, approvalPrompt, { replyMarkup });
      }
    }
  } catch (err) {
    await sendTelegramMessage(token, chatId, `❌ Maaf, gagal memproses permintaan: ${err.message || String(err)}`);
  }
}

export async function handleIncomingCallbackQuery(token, cbQuery, allowedChats) {
  const queryId = cbQuery.id;
  const fromId = cbQuery.from?.id;
  const chatId = cbQuery.message?.chat?.id;
  const messageId = cbQuery.message?.message_id;
  const data = cbQuery.data || '';

  if (!isChatAllowed(chatId, fromId, allowedChats)) {
    await answerCallbackQuery(token, queryId, 'Akses ditolak. Anda tidak berwenang.', true);
    return;
  }

  if (data.startsWith('use:')) {
    const routerId = data.slice(4);
    const router = db.prepare('SELECT * FROM routers WHERE id = ?').get(routerId);
    if (!router) {
      await answerCallbackQuery(token, queryId, 'Router tidak ditemukan.', true);
      return;
    }
    setActiveRouterForChat(chatId, router.id);
    await answerCallbackQuery(token, queryId, `✅ Aktif: ${router.name}`);
    await editMessageText(
      token,
      chatId,
      messageId,
      `✅ *Router Aktif Telah Diatur ke: ${router.name}*\nHost: \`${router.host}:${router.api_port}\` · Komp: ${router.company || '—'}\n\nSekarang Anda dapat:\n• Kirim pertanyaan langsung (AI Copilot)\n• Ketik \`/status\` untuk cek CPU, RAM, Suhu\n• Ketik \`/sync\` untuk sinkronisasi telemetri\n• Ketik \`/audit\` untuk audit keamanan\n• Ketik \`/exec <perintah>\` untuk eksekusi konfigurasi`
    );
    return;
  }

  if (data.startsWith('job:app:')) {
    const jobId = data.slice(8);
    if (!isExecutionEnabled()) {
      await answerCallbackQuery(token, queryId, 'Mode eksekusi dinonaktifkan di pengaturan.', true);
      return;
    }

    const job = getExecutionJob(jobId);
    if (!job) {
      await answerCallbackQuery(token, queryId, 'Job tidak ditemukan.', true);
      return;
    }
    if (job.status !== 'pending') {
      await answerCallbackQuery(token, queryId, `Job sudah berstatus: ${job.status}`, true);
      return;
    }

    await answerCallbackQuery(token, queryId, '⏳ Menjalankan konfigurasi di router...');
    await editMessageText(token, chatId, messageId, `⏳ *Sedang Mengeksekusi Konfigurasi...*\nJob ID: \`${jobId}\`\nMohon tunggu.`);

    const userLabel = cbQuery.from?.username ? `@${cbQuery.from.username}` : cbQuery.from?.first_name || String(fromId);
    const result = await approveAndExecuteJob(jobId, { approvedBy: `Telegram:${userLabel}` });

    if (result.ok) {
      const summaryLines = (result.output || []).map((o) => `• ${o.line}: OK`).join('\n');
      await editMessageText(
        token,
        chatId,
        messageId,
        `✅ *Perubahan Berhasil Dieksekusi!*\nJob ID: \`${jobId}\`\nDisetujui oleh: ${userLabel}\n\n*Hasil RouterOS:*\n\`\`\`\n${summaryLines || 'Selesai tanpa error.'}\n\`\`\``
      );
    } else {
      const summaryLines = (result.output || [])
        .map((o) => `${o.ok ? '✅' : '❌'} \`${o.line}\`${o.error ? ` (${o.error})` : ''}`)
        .join('\n');
      await editMessageText(
        token,
        chatId,
        messageId,
        `⚠️ *Hasil Eksekusi Sebagian / Gagal*\nJob ID: \`${jobId}\`\n${result.error || ''}\n\n*Rincian Perintah:*\n${summaryLines || 'Tidak ada detail output.'}`
      );
    }
    return;
  }

  if (data.startsWith('job:rej:')) {
    const jobId = data.slice(8);
    const job = getExecutionJob(jobId);
    if (!job || job.status !== 'pending') {
      await answerCallbackQuery(token, queryId, 'Job sudah tidak pending.', true);
      return;
    }

    const userLabel = cbQuery.from?.username ? `@${cbQuery.from.username}` : cbQuery.from?.first_name || String(fromId);
    rejectExecutionJob(jobId, { rejectedBy: `Telegram:${userLabel}` });

    await answerCallbackQuery(token, queryId, 'Pekerjaan dibatalkan.');
    await editMessageText(
      token,
      chatId,
      messageId,
      `❌ *Eksekusi Dibatalkan*\nJob ID: \`${jobId}\` telah dibatalkan oleh ${userLabel}.`
    );
  }
}

export async function pollUpdates(token, allowedChats, defaultRouterId) {
  let offset = 0;
  logger.info({ event: 'telegram_bot_started', operation: 'telegram', result: 'listening' });

  const botInfo = await getBotInfo(token);
  if (botInfo) {
    logger.info({ event: 'telegram_bot_identity', username: botInfo.username, id: botInfo.id });
  }

  while (pollingActive) {
    try {
      const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=25&allowed_updates=${encodeURIComponent(
        JSON.stringify(['message', 'callback_query'])
      )}`;

      const res = await fetch(url, {
        signal: pollingAbortController ? pollingAbortController.signal : undefined,
      });

      if (!res.ok) {
        if (res.status === 401) {
          logger.warn({ event: 'telegram_bot_error', error: 'Token Bot Telegram tidak valid (HTTP 401).' });
          pollingActive = false;
          break;
        }
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      const data = await res.json();
      if (!data.ok || !Array.isArray(data.result)) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }

      for (const update of data.result) {
        offset = Math.max(offset, update.update_id + 1);
        if (update.message) {
          handleIncomingMessage(token, update.message, allowedChats, defaultRouterId, botInfo).catch((err) => {
            logger.warn({ event: 'telegram_message_error', error: err.message });
          });
        } else if (update.callback_query) {
          handleIncomingCallbackQuery(token, update.callback_query, allowedChats).catch((err) => {
            logger.warn({ event: 'telegram_callback_error', error: err.message });
          });
        }
      }
    } catch (err) {
      if (pollingAbortController?.signal?.aborted) break;
      logger.warn({ event: 'telegram_poll_error', error: err.message });
      await new Promise((r) => setTimeout(r, 4000));
    }
  }

  logger.info({ event: 'telegram_bot_stopped', operation: 'telegram' });
}

export function startTelegramBot() {
  const { token, allowedChats, enabled, defaultRouterId } = getTelegramConfig();
  if (!enabled || !token) {
    return false;
  }
  if (pollingActive) return true;

  pollingActive = true;
  pollingAbortController = new AbortController();
  pollUpdates(token, allowedChats, defaultRouterId).catch((err) => {
    logger.warn({ event: 'telegram_start_error', error: err.message });
    pollingActive = false;
  });
  return true;
}

export function stopTelegramBot() {
  if (!pollingActive) return;
  pollingActive = false;
  if (pollingAbortController) {
    pollingAbortController.abort();
    pollingAbortController = null;
  }
}

export function restartTelegramBot() {
  stopTelegramBot();
  setTimeout(() => {
    startTelegramBot();
  }, 500);
}
