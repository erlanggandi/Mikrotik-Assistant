import net from 'node:net';
import tls from 'node:tls';
import { createHash } from 'node:crypto';
import { config } from './config.js';

const MAX_WORD = 0x0fffffff;

export function encodeLength(len) {
  if (len <= 0x7f) return Buffer.from([len]);
  if (len <= 0x3fff) {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(len | 0x8000, 0);
    return b;
  }
  if (len <= 0x1fffff) {
    const b = Buffer.alloc(3);
    b.writeUIntBE(len | 0xc00000, 0, 3);
    return b;
  }
  if (len <= 0xffffff) {
    const b = Buffer.alloc(4);
    b.writeUIntBE((len | 0xe0000000) >>> 0, 0, 4);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = 0xf0;
  b.writeUInt32BE(len, 1);
  return b;
}

export function decodeLength(buf, pos) {
  const c = buf[pos];
  if ((c & 0x80) === 0) return { len: c, bytes: 1 };
  if ((c & 0xc0) === 0x80) return { len: ((c & 0x3f) << 8) | buf[pos + 1], bytes: 2 };
  if ((c & 0xe0) === 0xc0) return { len: ((c & 0x1f) << 16) | (buf[pos + 1] << 8) | buf[pos + 2], bytes: 3 };
  if ((c & 0xf0) === 0xe0)
    return { len: ((c & 0x0f) << 24) | (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3], bytes: 4 };
  return { len: buf.readUInt32BE(pos + 1), bytes: 5 };
}

export function encodeWord(word) {
  const data = Buffer.from(word, 'utf8');
  return Buffer.concat([encodeLength(data.length), data]);
}

export function encodeSentence(words) {
  return Buffer.concat([...words.map(encodeWord), Buffer.from([0])]);
}

export function decodeWords(buf) {
  const words = [];
  let pos = 0;
  while (pos < buf.length) {
    const { len, bytes } = decodeLength(buf, pos);
    pos += bytes;
    if (len === 0) break;
    words.push(buf.subarray(pos, pos + len).toString('utf8'));
    pos += len;
  }
  return words;
}

const WRITE_COMMAND = /(^|\/)(add|set|remove|delete|enable|disable|reset|reboot|restore|upload|download|execute|move|comment|edit|push|format|netinstall)$/;

export function isReadCommand(words) {
  const cmd = words[0];
  if (!cmd || !cmd.startsWith('/')) return false;
  const base = cmd.replace(/^\/+/, '');
  if (base === 'login') return true;
  if (base === 'logout' || base === 'cancel') return false;
  return !WRITE_COMMAND.test(cmd) && (cmd.endsWith('/print') || cmd.endsWith('/getall') || /\/(listen|status)$/.test(cmd));
}

export function tokenizeCli(line) {
  const tokens = [];
  let curr = '';
  let inQuote = false;
  let quoteChar = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if ((ch === '"' || ch === "'") && (!inQuote || quoteChar === ch)) {
      inQuote = !inQuote;
      if (inQuote) quoteChar = ch;
      else quoteChar = '';
      continue;
    }
    if (!inQuote && /\s/.test(ch)) {
      if (curr) {
        tokens.push(curr);
        curr = '';
      }
    } else {
      curr += ch;
    }
  }
  if (curr) tokens.push(curr);
  return tokens;
}

export const BLOCKED_DESTRUCTIVE = [
  /^\/system\/(reset-configuration|reboot|shutdown)$/i,
  /^\/disk\/(format|eject)/i,
  /^\/certificate\/reset-certificate-cache$/i,
  /^\/user\/(remove|set)$/i,
];

export function containsDestructiveCommand(text) {
  const str = String(text || '');
  return (
    BLOCKED_DESTRUCTIVE.some((re) => re.test(str)) ||
    /\b(?:system\s+(?:reset-configuration|reboot|shutdown))\b/i.test(str) ||
    /\/system\/(?:reset-configuration|reboot|shutdown)\b/i.test(str) ||
    /\/disk\/(?:format|eject)\b/i.test(str) ||
    /\b(?:disk\s+(?:format|eject))\b/i.test(str) ||
    /\/user\/(?:remove|set)\b/i.test(str) ||
    /\b(?:user\s+(?:remove|set))\b/i.test(str)
  );
}

export function isDestructiveCommand(words) {
  const cmd = words[0] || '';
  return BLOCKED_DESTRUCTIVE.some((re) => re.test(cmd)) || containsDestructiveCommand(words.join(' '));
}

export function normalizeCliCommand(line) {
  let s = String(line || '').trim();
  if (!s || s.startsWith('#')) return s;

  // Replace [find (?:where\s+)?(?:name|default-name)=["']?([^"'\]]+)["']?\] with "$1"
  s = s.replace(/\[\s*find\s+(?:where\s+)?(?:name|default-name)=["']?([^"'\]]+)["']?\s*\]/gi, (match, val) => {
    return /\s/.test(val) ? `"${val}"` : val;
  });

  return s;
}

export function hasCliSyntax(line) {
  const trimmed = String(line || '').trim();
  return (
    /\[\s*find\b/i.test(trimmed) ||
    /^\s*:(if|for|foreach|while|global|local|put|execute|do|log|resolve|to)\b/i.test(trimmed) ||
    /[;$]/.test(trimmed)
  );
}

const ACTION_VERBS = new Set(['add', 'set', 'remove', 'enable', 'disable', 'reset', 'print', 'get', 'export', 'move', 'comment', 'reboot']);

export function cliToApiSentence(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const rawTokens = tokenizeCli(trimmed);
  if (!rawTokens.length) return null;

  let pathParts = [];
  let attrTokens = [];
  let isCollectingPath = true;

  for (let i = 0; i < rawTokens.length; i++) {
    const tok = rawTokens[i];
    if (isCollectingPath) {
      if (tok.includes('=') && !tok.startsWith('/')) {
        isCollectingPath = false;
        attrTokens.push(tok);
      } else {
        const subParts = tok.split('/').filter(Boolean);
        pathParts.push(...subParts);
        const lastPart = pathParts[pathParts.length - 1]?.toLowerCase();
        if (ACTION_VERBS.has(lastPart)) {
          isCollectingPath = false;
        }
      }
    } else {
      if (tok.includes('=')) {
        attrTokens.push(tok);
      } else {
        attrTokens.push(`numbers=${tok}`);
      }
    }
  }

  if (!pathParts.length) return null;
  const apiCmd = '/' + pathParts.join('/');
  const words = [apiCmd];

  for (const attr of attrTokens) {
    words.push('=' + attr);
  }
  return words;
}

class BufferReader {
  constructor(onData) {
    this.buf = Buffer.alloc(0);
    this.onData = onData;
  }
  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    this._drain();
  }
  _drain() {
    while (this.buf.length > 0) {
      let d;
      try {
        d = decodeLength(this.buf, 0);
      } catch {
        return;
      }
      if (d.bytes + d.len > this.buf.length) return; // incomplete
      const word = d.len === 0 ? '' : this.buf.subarray(d.bytes, d.bytes + d.len).toString('utf8');
      this.buf = this.buf.subarray(d.bytes + d.len);
      this.onData(word);
    }
  }
}

export class RouterOSConnection {
  constructor({ host, port = 8728, secure = false, username, password }) {
    this.host = host;
    this.port = port;
    this.secure = !!secure;
    this.user = username ?? '';
    this.pass = password ?? '';
    this.socket = null;
    this.reader = null;
    this.sentences = [];
    this.waiters = [];
    this.authenticated = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const done = (err) => {
        clearTimeout(timer);
        if (err) {
          this.socket?.destroy();
          reject(err);
        } else resolve();
      };
      const sockOpts = { host: this.host, port: this.port };
      const sock = this.secure
        ? tls.connect({ ...sockOpts, rejectUnauthorized: false })
        : net.connect(sockOpts);
      const timer = setTimeout(() => done(new Error('connect timeout')), config.routerConnectTimeoutMs);
      sock.setTimeout(config.routerConnectTimeoutMs);
      sock.on('timeout', () => done(new Error('connect timeout')));
      sock.on('connect', () => {
        if (this.secure) {
          sock.once('secureConnect', () => done());
        } else done();
      });
      sock.on('error', (e) => done(e));
      sock.on('close', () => {
        this._failWaiters(new Error('connection closed by router'));
      });
      this.socket = sock;
    });
  }

  _startReader() {
    this._sentence = [];
    this.reader = new BufferReader((word) => {
      if (word === '') {
        if (this._sentence.length > 0) {
          this._onSentence({ words: this._sentence });
          this._sentence = [];
        }
      } else this._sentence.push(word);
    });
    this.socket.on('data', (chunk) => this.reader.push(chunk));
  }

  _onSentence(s) {
    const w = this.waiters.shift();
    if (w && !w.settled) w.resolve(s);
    else this.sentences.push(s);
  }

  _nextSentence() {
    if (this.sentences.length > 0) return Promise.resolve(this.sentences.shift());
    return new Promise((resolve, reject) => {
      const w = { resolve, reject, settled: false };
      w.rejectFn = (e) => { w.settled = true; reject(e); };
      this.waiters.push(w);
    });
  }

  _failWaiters(err) {
    while (this.waiters.length) this.waiters.shift().rejectFn(err);
  }

  async login() {
    if (this.authenticated) return;
    const user = this.user ?? '';
    const pass = this.pass ?? '';

    // Modern RouterOS (v6.43+ and v7.x) login
    let replies;
    try {
      replies = await this.command(['/login', `=name=${user}`, `=password=${pass}`]);
    } catch (err) {
      if (!/read-only boundary|login failed|invalid user name or password|cannot log in/i.test(err.message)) {
        throw err;
      }
      replies = [{ words: ['!trap', `=message=${err.message}`] }];
    }

    const first = replies[0];
    const isTrap = first?.words[0] === '!trap';
    const ret = first?.words.find((w) => w.startsWith('=ret='));

    // Success on modern RouterOS
    if (!isTrap && !ret) {
      this.authenticated = true;
      return;
    }

    // Challenge-response (RouterOS pre-6.43 or challenge return)
    let challengeHex = ret ? ret.slice(5) : null;
    if (isTrap && !challengeHex) {
      try {
        const legacyReplies = await this.command(['/login']);
        const legacyFirst = legacyReplies[0];
        const legacyRet = legacyFirst?.words.find((w) => w.startsWith('=ret='));
        if (legacyRet) {
          challengeHex = legacyRet.slice(5);
        }
      } catch {
        // keep original error
      }
    }

    if (challengeHex) {
      const challenge = Buffer.from(challengeHex, 'hex');
      const md = createHash('md5');
      md.update(Buffer.from([0]));
      md.update(Buffer.from(pass, 'utf8'));
      md.update(challenge);
      const response = '00' + md.digest('hex');
      const r2 = await this.command(['/login', `=name=${user}`, `=response=${response}`]);
      for (const s of r2) {
        if (s.words[0] === '!trap') throw new Error(trapMessage(s) || 'login failed');
      }
      this.authenticated = true;
      return;
    }

    if (isTrap) {
      throw new Error(trapMessage(first) || 'login failed');
    }
    this.authenticated = true;
  }

  async command(words, { allowWrite = false } = {}) {
    if (!this.socket || this.socket.destroyed) throw new Error('not connected');
    if (!allowWrite && !isReadCommand(words)) {
      throw new Error('read-only boundary: write/unsupported command rejected');
    }
    if (allowWrite && isDestructiveCommand(words)) {
      throw new Error(`Perintah berbahaya diblokir secara permanen: ${words[0]}`);
    }
    if (!this.authenticated && words[0] !== '/login') throw new Error('login required');
    await new Promise((resolve, reject) => {
      this.socket.write(encodeSentence(words), (e) => (e ? reject(e) : resolve()));
    });
    const collected = [];
    const deadline = Date.now() + config.routerCommandTimeoutMs;
    const settleMs = 2500;
    let trapSince = null;
    const settleError = new Error('trap settle');
    settleError.__trapSettle = true;
    const timer = setInterval(() => {
      if (trapSince !== null && Date.now() - trapSince > settleMs) {
        this._failWaiters(settleError);
      } else if (Date.now() > deadline) {
        this._failWaiters(new Error('command timeout'));
      }
    }, 200);
    try {
      for (;;) {
        let s;
        try {
          s = await this._nextSentence();
        } catch (e) {
          if (e && e.__trapSettle) return collected.length ? [...collected, { words: ['!done'] }] : [{ words: ['!trap'] }];
          throw e;
        }
        const kind = s.words[0];
        if (kind === '!fatal') throw new Error(trapMessage(s) || 'fatal connection error');
        if (kind === '!re') {
          collected.push(s);
          continue;
        }
        if (kind === '!trap') {
          collected.push(s);
          trapSince = Date.now();
          continue;
        }
        if (kind === '!done' || kind === '!empty') {
          trapSince = null;
          return [...collected, s];
        }
      }
    } finally {
      trapSince = null;
      clearInterval(timer);
    }
  }

  async executeNativeCliCommand(cliLine) {
    if (containsDestructiveCommand(cliLine)) {
      throw new Error(`Perintah berbahaya diblokir secara permanen: ${cliLine}`);
    }
    const scriptName = `__ma_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // 1. Add temporary script
    const addRes = await this.command(
      ['/system/script/add', `=name=${scriptName}`, `=source=${cliLine}`, '=dont-require-permissions=yes'],
      { allowWrite: true }
    );
    const addTrap = addRes.find((r) => r.words && r.words[0] === '!trap');
    if (addTrap) {
      throw new Error(trapMessage(addTrap) || 'Gagal menambahkan script temporer di RouterOS');
    }
    const retWord = addRes[0]?.words.find((w) => w.startsWith('=ret='));
    let scriptId = retWord ? retWord.slice(5) : null;

    if (!scriptId) {
      try {
        const lookup = await this.command(['/system/script/print', `?name=${scriptName}`], { allowWrite: false });
        const row = lookup.find((r) => r.words && r.words[0] === '!re');
        const idWord = row?.words.find((w) => w.startsWith('=.id='));
        if (idWord) scriptId = idWord.slice(5);
      } catch {
        /* ignore lookup error */
      }
    }

    try {
      // 2. Run the script using persistent .id or name
      const runArg = scriptId ? `numbers=${scriptId}` : `numbers=${scriptName}`;
      let runRes = await this.command(['/system/script/run', `=${runArg}`], { allowWrite: true });
      let runTrap = runRes.find((r) => r.words && r.words[0] === '!trap');
      if (runTrap && scriptId) {
        runRes = await this.command(['/system/script/run', `=number=${scriptId}`], { allowWrite: true });
        runTrap = runRes.find((r) => r.words && r.words[0] === '!trap');
      }
      if (runTrap) {
        throw new Error(trapMessage(runTrap) || 'Gagal mengeksekusi script di RouterOS');
      }
      return { ok: true, output: 'OK' };
    } finally {
      // 3. Always clean up the temporary script
      try {
        const rmArg = scriptId ? `numbers=${scriptId}` : `numbers=${scriptName}`;
        await this.command(['/system/script/remove', `=${rmArg}`], { allowWrite: true });
      } catch {
        /* failsafe cleanup */
      }
    }
  }

  async executeScript(scriptOrLines, { onProgress, continueOnError = true } = {}) {
    const lines = Array.isArray(scriptOrLines) ? scriptOrLines : String(scriptOrLines).split('\n');
    const results = [];
    let hasFailure = false;

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!raw || raw.startsWith('#')) continue;
      if (onProgress) onProgress({ lineIndex: i, total: lines.length, command: raw });

      if (containsDestructiveCommand(raw)) {
        results.push({ line: raw, ok: false, error: 'Perintah berbahaya diblokir secara permanen' });
        hasFailure = true;
        if (!continueOnError) break;
        continue;
      }

      const norm = normalizeCliCommand(raw);
      let executedOk = false;
      let lastError = '';
      let outputStr = '';

      // Strategy 1: Direct API (when no complex CLI-only syntax)
      if (!hasCliSyntax(norm)) {
        const words = cliToApiSentence(norm);
        if (words) {
          try {
            const res = await this.command(words, { allowWrite: true });
            const trap = res.find((r) => r.words && r.words[0] === '!trap');
            if (trap) {
              lastError = trapMessage(trap) || 'RouterOS error (!trap)';
            } else {
              executedOk = true;
              outputStr = res.map((r) => r.words.join(' ')).join('\n');
            }
          } catch (err) {
            lastError = err.message || String(err);
          }
        }
      }

      // Strategy 2: Fallback to Native RouterOS Script Runner
      if (!executedOk) {
        try {
          const scriptRes = await this.executeNativeCliCommand(raw);
          executedOk = true;
          outputStr = scriptRes.output || 'OK';
          lastError = '';
        } catch (scriptErr) {
          lastError = scriptErr.message || lastError || 'Eksekusi gagal';
        }
      }

      if (executedOk) {
        results.push({ line: raw, ok: true, output: outputStr });
      } else {
        hasFailure = true;
        results.push({ line: raw, ok: false, error: lastError });
        if (!continueOnError) break;
      }
    }

    if (hasFailure) {
      const failed = results.filter((r) => !r.ok);
      const firstErr = failed[0];
      return {
        ok: false,
        error: `Sebagian perintah gagal (${failed.length} dari ${results.length}): "${firstErr?.line}" -> ${firstErr?.error}`,
        results,
      };
    }
    return { ok: true, results };
  }

  close() {
    try {
      this.socket?.destroy();
    } catch {
      /* noop */
    }
    this._sentence = [];
    this.sentences = [];
    this.waiters = [];
  }
}

export function trapMessage(s) {
  const w = s.words.find((x) => x.startsWith('=message='));
  return w ? w.slice(9) : '';
}

export async function testConnection(router) {
  const rc = new RouterOSConnection(router);
  try {
    await rc.connect();
    rc._startReader();
    await rc.login();
    const res = await rc.command(['/system/resource/print']);
    const attrs = wordsToAttrs(res[0]);
    return { ok: true, version: attrs['version'], boardName: attrs['board-name'], uptime: attrs['uptime'] };
  } finally {
    rc.close();
  }
}

export function wordsToAttrs(sentence) {
  const attrs = {};
  for (const w of sentence?.words || []) {
    if (w.startsWith('=')) {
      const eq = w.indexOf('=', 1);
      if (eq === -1) attrs[w.slice(1)] = '';
      else attrs[w.slice(1, eq)] = w.slice(eq + 1);
    }
  }
  return attrs;
}

export function friendlyRouterError(msg, host, port) {
  const m = String(msg || '').toLowerCase();
  if (/invalid user name or password|login failed|authentication failed|wrong password|incorrect username|no such user|invalid username/i.test(m)) {
    return 'Username atau password router salah. Periksa akun di menu System -> Users pada MikroTik. Checklist: (1) username persis (case-sensitive), ketik ulang password jangan copy-paste; (2) user/group punya hak API (System -> Users -> Groups, pastikan policy api/read/write); (3) IP service API aktif: /ip service enable api, port 8728 (plain) atau 8729 (API-SSL), address 0.0.0.0/0 atau IP server ini; (4) jika baru Edit router di aplikasi, isi ulang password lalu Simpan (bug versi lama merusak password tersimpan); (5) coba login yang sama via Winbox untuk memastikan kredensial valid.';
  }
  if (/econnrefused/i.test(m)) {
    return `Koneksi ke port ${port || 8728} pada ${host} ditolak (ECONNREFUSED). Pastikan API MikroTik aktif (/ip service enable api) dan parameter address di service API tidak membatasi IP server ini.`;
  }
  if (/etimedout|connect timeout|timeout/i.test(m)) {
    return `Koneksi ke ${host}:${port || 8728} time out (15s). Pastikan router dapat dihubungi/ping dan port ${port || 8728} diizinkan di /ip firewall filter chain=input.`;
  }
  if (/ehostunreach|enetunreach/i.test(m)) {
    return `Alamat ${host} tidak dapat dijangkau (Network/Host Unreachable). Periksa routing jaringan atau VPN dari server/Docker ke router.`;
  }
  if (/connection closed by router/i.test(m)) {
    return `Koneksi ditutup langsung oleh router. Coba uncheck API-SSL jika tidak menggunakan sertifikat SSL, atau periksa batasan login di MikroTik.`;
  }
  return msg;
}