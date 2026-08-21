import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';

fs.mkdirSync(config.logDir, { recursive: true });
const file = path.join(config.logDir, 'app.log');

const SENSITIVE = /(=password=|password|api[_-]?key|secret|credential|token|private[_-]?key|response=)/i;

function redact(o) {
  if (Array.isArray(o)) return o.map(redact);
  if (o && typeof o === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      if (SENSITIVE.test(k)) out[k] = '***';
      else out[k] = redact(v);
    }
    return out;
  }
  if (typeof o === 'string' && SENSITIVE.test(o)) return '***';
  return o;
}

export function log(level, fields) {
  const entry = {
    ts: new Date().toISOString(),
    correlationId: fields.correlationId || randomUUID(),
    level,
    ...redact(fields),
  };
  try {
    fs.appendFileSync(file, JSON.stringify(entry) + '\n');
  } catch {
    /* never crash on logging */
  }
  if (level === 'error') console.error(JSON.stringify(entry));
}

export const logger = {
  info: (f) => log('info', f),
  warn: (f) => log('warn', f),
  error: (f) => log('error', f),
};

export function audit(app, operation, result, extra = {}, durationMs) {
  logger.info({ event: 'audit', app, operation, result, ...extra, durationMs });
}