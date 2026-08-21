import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const config = {
  root: ROOT,
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  dataDir: process.env.DATA_DIR || path.join(ROOT, 'data'),
  logDir: process.env.LOG_DIR || path.join(ROOT, 'logs'),
  staleAfterHours: Number(process.env.STALE_AFTER_HOURS || 24),
  llmTimeoutMs: 120000,
  routerConnectTimeoutMs: 15000,
  routerCommandTimeoutMs: 90000,
};