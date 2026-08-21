import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const KEYLEN = 32;

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function loadKey() {
  if (process.env.MT_APP_SECRET) return crypto.createHash('sha256').update(process.env.MT_APP_SECRET).digest();
  const file = path.join(config.dataDir, '.secret');
  if (fs.existsSync(file)) return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
  const key = crypto.randomBytes(KEYLEN);
  fs.writeFileSync(file, key.toString('hex'), { mode: 0o600 });
  return key;
}

let _key = null;
function key() {
  if (!_key) _key = loadKey();
  return _key;
}

export function encryptSecret(plain) {
  if (!plain) return { enc: '', iv: '' };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { enc: `${enc.toString('hex')}.${tag.toString('hex')}`, iv: iv.toString('hex') };
}

export function decryptSecret(stored, ivHex) {
  if (!stored) return '';
  try {
    const [dataHex, tagHex] = stored.split('.');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  try {
    const [saltHex, hashHex] = stored.split(':');
    const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
    return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
  } catch {
    return false;
  }
}