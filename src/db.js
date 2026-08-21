import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { hashPassword } from './security.js';

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, 'mikrotik-assistant.db'));

db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS routers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  host TEXT NOT NULL,
  api_port INTEGER NOT NULL DEFAULT 8728,
  secure INTEGER NOT NULL DEFAULT 0,
  username TEXT NOT NULL,
  password_enc TEXT NOT NULL DEFAULT '',
  password_iv TEXT NOT NULL DEFAULT '',
  connection_status TEXT NOT NULL DEFAULT 'unknown',
  last_sync TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contexts (
  router_id TEXT PRIMARY KEY REFERENCES routers(id) ON DELETE CASCADE,
  snapshot TEXT NOT NULL,
  summary TEXT NOT NULL,
  synced_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  router_id TEXT NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  flags TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_runs (
  id TEXT PRIMARY KEY,
  router_id TEXT NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
  audit_type TEXT NOT NULL DEFAULT 'audit-config',
  result TEXT,
  ok INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_providers (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  api_key_enc TEXT NOT NULL DEFAULT '',
  api_key_iv TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  api_key_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_audit_router ON audit_runs(router_id);
`);

try {
  const cols = db.prepare("SELECT name FROM pragma_table_info('audit_runs')").all();
  if (!cols.some((c) => c.name === 'audit_type')) {
    db.exec("ALTER TABLE audit_runs ADD COLUMN audit_type TEXT NOT NULL DEFAULT 'audit-config'");
  }
} catch {
  /* migration only for existing DBs */
}

try {
  const cols = db.prepare("SELECT name FROM pragma_table_info('routers')").all();
  if (!cols.some((c) => c.name === 'company')) {
    db.exec("ALTER TABLE routers ADD COLUMN company TEXT NOT NULL DEFAULT ''");
  }
} catch {
  /* migration only for existing DBs */
}

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function seedAdmin() {
  if (!getSetting('admin_password_hash')) {
    setSetting('admin_password_hash', hashPassword('admin'));
    loggerInfo('WARN: admin password default = "admin". Ubah segera melalui Settings.');
  }
}

function loggerInfo(m) {
  // local convenience to avoid circular import
  console.log(m);
}

export function now() {
  return new Date().toISOString();
}