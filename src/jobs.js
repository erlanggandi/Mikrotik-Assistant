import { randomUUID } from 'node:crypto';
import { db, getSetting, now } from './db.js';
import { RouterOSConnection } from './routeros.js';
import { decryptSecret } from './security.js';
import { collectRouter } from './collector.js';
import { logger } from './logger.js';

export function isExecutionEnabled() {
  return getSetting('execution_enabled', '1') === '1';
}

export function createExecutionJob({ routerId, source, commands, requestedBy }) {
  const id = randomUUID();
  const cmdList = Array.isArray(commands)
    ? commands
    : String(commands).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

  if (!cmdList.length) throw new Error('Daftar perintah kosong.');

  db.prepare(`
    INSERT INTO execution_jobs (id, router_id, source, commands, status, requested_by, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)
  `).run(id, routerId, source || 'web', JSON.stringify(cmdList), requestedBy || 'admin', now());

  logger.info({
    event: 'job_created',
    operation: 'execution_jobs',
    result: 'pending',
    jobId: id,
    routerId,
    commandCount: cmdList.length,
    source,
  });

  return getExecutionJob(id);
}

export function getExecutionJob(id) {
  const row = db.prepare('SELECT * FROM execution_jobs WHERE id = ?').get(id);
  if (!row) return null;
  return {
    ...row,
    commands: JSON.parse(row.commands || '[]'),
  };
}

export function listExecutionJobs(routerId, { limit = 20, offset = 0 } = {}) {
  const q = routerId
    ? db.prepare('SELECT * FROM execution_jobs WHERE router_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
    : db.prepare('SELECT * FROM execution_jobs ORDER BY created_at DESC LIMIT ? OFFSET ?');
  const rows = routerId ? q.all(routerId, limit, offset) : q.all(limit, offset);
  return rows.map((r) => ({
    ...r,
    commands: JSON.parse(r.commands || '[]'),
  }));
}

export function rejectExecutionJob(id, { rejectedBy = 'admin' } = {}) {
  const job = getExecutionJob(id);
  if (!job) throw new Error('Job tidak ditemukan.');
  if (job.status !== 'pending') throw new Error(`Job tidak dapat dibatalkan karena statusnya "${job.status}".`);

  db.prepare(`
    UPDATE execution_jobs
    SET status = 'rejected', approved_by = ?, approved_at = ?
    WHERE id = ?
  `).run(rejectedBy, now(), id);

  logger.info({
    event: 'job_rejected',
    operation: 'execution_jobs',
    result: 'rejected',
    jobId: id,
    routerId: job.router_id,
    rejectedBy,
  });

  return getExecutionJob(id);
}

export async function approveAndExecuteJob(id, { approvedBy = 'admin' } = {}) {
  if (!isExecutionEnabled()) {
    throw new Error('Eksekusi dinonaktifkan dalam pengaturan sistem.');
  }

  const job = getExecutionJob(id);
  if (!job) throw new Error('Job tidak ditemukan.');
  if (job.status !== 'pending') {
    throw new Error(`Job tidak dapat dieksekusi karena berstatus "${job.status}".`);
  }

  const router = db.prepare('SELECT * FROM routers WHERE id = ?').get(job.router_id);
  if (!router) throw new Error('Router target tidak ditemukan.');

  // Mark as executing
  db.prepare(`UPDATE execution_jobs SET status = 'executing', approved_by = ?, approved_at = ? WHERE id = ?`)
    .run(approvedBy, now(), id);

  const password = router.password_enc ? decryptSecret(router.password_enc, router.password_iv) : '';
  const rc = new RouterOSConnection({
    host: router.host,
    port: router.api_port,
    secure: !!router.secure,
    username: router.username,
    password,
  });

  let execResult;
  try {
    await rc.connect();
    rc._startReader();
    await rc.login();

    execResult = await rc.executeScript(job.commands);
  } catch (err) {
    execResult = { ok: false, error: err.message || String(err), results: [] };
  } finally {
    rc.close();
  }

  const outStr = JSON.stringify(execResult.results || []);
  const finalStatus = execResult.ok ? 'completed' : 'failed';
  const errStr = execResult.ok ? null : execResult.error;

  db.prepare(`
    UPDATE execution_jobs
    SET status = ?, output = ?, error = ?
    WHERE id = ?
  `).run(finalStatus, outStr, errStr, id);

  logger.info({
    event: 'job_executed',
    operation: 'execution_jobs',
    result: finalStatus,
    jobId: id,
    routerId: router.id,
    approvedBy,
    error: errStr,
  });

  // Automatically trigger sync in background if execution succeeded
  if (execResult.ok) {
    collectRouter(router)
      .then((out) => {
        if (!out || !out.connected) {
          logger.warn({ event: 'post_exec_sync_failed', error: out?.error || 'not connected', routerId: router.id });
          return;
        }
        db.prepare(
          'INSERT INTO contexts (router_id, snapshot, summary, synced_at) VALUES (?,?,?,?) ON CONFLICT(router_id) DO UPDATE SET snapshot=excluded.snapshot, summary=excluded.summary, synced_at=excluded.synced_at'
        ).run(router.id, JSON.stringify(out.results), JSON.stringify(out.summary), now());
        db.prepare(`UPDATE routers SET connection_status='ok', last_sync=?, last_error=NULL WHERE id=?`).run(now(), router.id);
      })
      .catch((e) => {
        logger.warn({ event: 'post_exec_sync', error: e.message, routerId: router.id });
      });
  }

  return {
    ok: execResult.ok,
    status: finalStatus,
    output: execResult.results,
    error: errStr,
    job: getExecutionJob(id),
  };
}
