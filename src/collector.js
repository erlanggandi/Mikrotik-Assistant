import { RouterOSConnection, wordsToAttrs, trapMessage } from './routeros.js';

const REDACT_KEYS = /(password|secret|private[-_]?key|authorized[-_]?keys|\bkey\b)/i;

const RESOURCES = [
  { name: 'system/identity', command: '/system/identity/print' },
  { name: 'system/resource', command: '/system/resource/print' },
  { name: 'system/clock', command: '/system/clock/print' },
  { name: 'system/health', command: '/system/health/print' },
  { name: 'system/packages', command: '/system/package/print' },
  { name: 'system/update', command: '/system/package/update/print' },
  { name: 'system/users', command: '/user/print' },
  { name: 'interfaces', command: '/interface/print' },
  { name: 'bridges', command: '/interface/bridge/print' },
  { name: 'bridge/ports', command: '/interface/bridge/port/print' },
  { name: 'vlans', command: '/interface/vlan/print' },
  { name: 'wireless', command: '/interface/wireless/print' },
  { name: 'wireless/reg-table', command: '/interface/wireless/registration-table/print' },
  { name: 'capsman/reg-table', command: '/caps-man/registration-table/print' },
  { name: 'ip/addresses', command: '/ip/address/print' },
  { name: 'ip/routes', command: '/ip/route/print' },
  { name: 'ip/firewall/filter', command: '/ip/firewall/filter/print' },
  { name: 'ip/firewall/nat', command: '/ip/firewall/nat/print' },
  { name: 'ip/firewall/mangle', command: '/ip/firewall/mangle/print' },
  { name: 'ip/firewall/raw', command: '/ip/firewall/raw/print' },
  { name: 'ip/firewall/address-lists', command: '/ip/firewall/address-list/print' },
  { name: 'ip/dhcp-server', command: '/ip/dhcp-server/print' },
  { name: 'ip/dhcp-leases', command: '/ip/dhcp-server/lease/print' },
  { name: 'ip/dhcp-client', command: '/ip/dhcp-client/print' },
  { name: 'ip/pools', command: '/ip/pool/print' },
  { name: 'ip/dns', command: '/ip/dns/print' },
  { name: 'ip/dns/static', command: '/ip/dns/static/print' },
  { name: 'ip/arp', command: '/ip/arp/print' },
  { name: 'ip/neighbors', command: '/ip/neighbor/print' },
  { name: 'ip/cloud', command: '/ip/cloud/print' },
  { name: 'queues/simple', command: '/queue/simple/print' },
  { name: 'queues/interface', command: '/queue/interface/print' },
  { name: 'ppp/secrets', command: '/ppp/secret/print' },
  { name: 'ppp/profiles', command: '/ppp/profile/print' },
  { name: 'ppp/active', command: '/ppp/active/print' },
  { name: 'ip/hotspot', command: '/ip/hotspot/print' },
];

function isUnsupportedError(msg) {
  return /(no such command prefix|no such command or directory|bad command name|no such item|unknown command|invalid item number|unsupported)/i.test(
    msg || ''
  );
}

export function normalizeRows(sentences) {
  return sentences
    .filter((s) => s.words[0] === '!re')
    .map((s) => {
      const row = wordsToAttrs(s);
      const out = {};
      for (const [k, v] of Object.entries(row)) {
        if (REDACT_KEYS.test(k)) out[k] = '***';
        else out[k] = v;
      }
      return out;
    });
}

export async function collectRouter(router) {
  const rc = new RouterOSConnection(router);
  const results = {};
  const summary = [];
  let connected = true;
  let loginError = null;
  try {
    await rc.connect();
    rc._startReader();
    await rc.login();
    for (const res of RESOURCES) {
      try {
        const replies = await rc.command([res.command]);
        const traps = replies.filter((s) => s.words[0] === '!trap');
        if (traps.length > 0) {
          const msg = traps.map(trapMessage).find((m) => m) || 'unsupported';
          const status = isUnsupportedError(msg) ? 'unsupported' : 'failed';
          summary.push({ resource: res.name, status, count: 0, error: status === 'failed' ? msg.slice(0, 300) : undefined });
          results[res.name] = status === 'failed' ? null : [];
          if (status === 'failed' && /login|auth/i.test(msg)) throw new Error('authentication failed: ' + msg);
          continue;
        }
        const rows = normalizeRows(replies);
        results[res.name] = rows;
        summary.push({ resource: res.name, status: 'success', count: rows.length });
      } catch (e) {
        const msg = e?.message || String(e);
        const status = isUnsupportedError(msg) ? 'unsupported' : 'failed';
        summary.push({ resource: res.name, status, count: 0, error: status === 'failed' ? msg.slice(0, 300) : undefined });
        if (status === 'failed') {
          results[res.name] = null;
        } else {
          results[res.name] = [];
        }
        if (status === 'failed' && /login|auth/i.test(msg)) throw new Error('authentication failed: ' + msg);
      }
    }
  } catch (e) {
    connected = false;
    loginError = e?.message || String(e);
  } finally {
    rc.close();
  }
  const okCount = summary.filter((s) => s.status === 'success').length;
  const failed = summary.filter((s) => s.status === 'failed').length;
  const unsupported = summary.filter((s) => s.status === 'unsupported').length;
  return {
    connected,
    error: loginError || null,
    results,
    summary,
    totalResources: summary.length,
    okCount,
    failedCount: failed,
    unsupportedCount: unsupported,
  };
}