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
    this.user = username;
    this.pass = password;
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
    const replies = await this.command(['/login', `=name=${this.user}`, `=password=${this.pass}`]);
    const first = replies[0];
    if (first?.words[0] === '!trap') throw new Error(trapMessage(first) || 'login failed');
    const ret = first?.words.find((w) => w.startsWith('=ret='));
    if (ret) {
      const challenge = Buffer.from(ret.slice(5), 'hex');
      const md = createHash('md5');
      md.update(Buffer.from([0]));
      md.update(Buffer.from(this.pass, 'utf8'));
      md.update(challenge);
      const response = '00' + md.digest('hex');
      const r2 = await this.command(['/login', `=name=${this.user}`, `=response=${response}`]);
      for (const s of r2) {
        if (s.words[0] === '!trap') throw new Error(trapMessage(s) || 'login failed');
      }
    }
    this.authenticated = true;
  }

  async command(words) {
    if (!this.socket || this.socket.destroyed) throw new Error('not connected');
    if (!isReadCommand(words)) throw new Error('read-only boundary: write/unsupported command rejected');
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