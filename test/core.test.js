import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeLength,
  decodeLength,
  encodeWord,
  encodeSentence,
  decodeWords,
  isReadCommand,
  RouterOSConnection,
  wordsToAttrs,
} from '../src/routeros.js';
import { createHash } from 'node:crypto';
import { containsWriteCommands, guardOutput } from '../src/guard.js';
import { normalizeChatUrl } from '../src/llm.js';
import { buildDigest, buildMessages, isStale } from '../src/orchestrator.js';
import { normalizeRows } from '../src/collector.js';

test('frame length roundtrip at boundaries', () => {
  for (const len of [0, 1, 0x7f, 0x80, 0x3fff, 0x4000, 0x1fffff, 0x200000]) {
    const buf = encodeLength(len);
    const { len: got, bytes } = decodeLength(buf, 0);
    assert.equal(got, len);
    assert.equal(bytes, buf.length);
  }
});

test('5-byte length encoding', () => {
  const buf = encodeLength(0x10000000);
  assert.equal(buf.length, 5);
  assert.equal(buf[0], 0xf0);
  const { len } = decodeLength(buf, 0);
  assert.equal(len, 0x10000000);
});

test('sentence roundtrip with unicode', () => {
  const words = ['/ip/firewall/print', '=comment=VPN¢rád', '?type=ether', ''];
  const buf = encodeSentence(words.slice(0, 3));
  assert.equal(decodeWords(buf).join('|'), words.slice(0, 3).join('|'));
});

test('read-only boundary', () => {
  assert.equal(isReadCommand(['/ip/firewall/nat/print']), true);
  assert.equal(isReadCommand(['/interface/getall']), true);
  assert.equal(isReadCommand(['/ip/firewall/nat/add', '=chain=dstnat']), false);
  assert.equal(isReadCommand(['/interface/set', '=disabled=yes']), false);
  assert.equal(isReadCommand(['/ip/route/remove']), false);
  assert.equal(isReadCommand(['/system/reboot']), false);
  assert.equal(isReadCommand(['/cancel']), false);
});

test('legacy login builds md5 response', async () => {
  const c = new RouterOSConnection({ host: 'x', username: 'admin', password: 'pw' });
  c.socket = { destroyed: false, write: () => {} };
  const calls = [];
  c.command = async (words) => {
    calls.push(words);
    if (calls.length === 1) return [{ words: ['!done', '=ret=856780b7411eefd3abadee2058c149a3'] }];
    return [{ words: ['!done'] }];
  };
  await c.login();
  assert.equal(calls.length, 2);
  const challenge = Buffer.from('856780b7411eefd3abadee2058c149a3', 'hex');
  const md = createHash('md5');
  md.update(Buffer.from([0]));
  md.update(Buffer.from('pw', 'utf8'));
  md.update(challenge);
  assert.equal(calls[1][2], '=response=00' + md.digest('hex'));
});

test('wordsToAttrs parses attribute words', () => {
  const a = wordsToAttrs({ words: ['!re', '=name=ether1', '=mtu=1500', '.tag=3', '!foo'] });
  assert.equal(a['name'], 'ether1');
  assert.equal(a['mtu'], '1500');
  assert.equal(a['foo'], undefined);
});

test('sentence plumbing resolves words objects without starving loop', async () => {
  const c = new RouterOSConnection({ host: 'x' });
  const p1 = c._nextSentence();
  const p2 = c._nextSentence();
  c._onSentence({ words: ['!re', '=x=1'] });
  c._onSentence({ words: ['!done'] });
  assert.deepEqual(await p1, { words: ['!re', '=x=1'] });
  assert.deepEqual(await p2, { words: ['!done'] });
  const p3 = c._nextSentence();
  c._failWaiters(new Error('timeout'));
  await assert.rejects(p3, /timeout/);
});

test('guard detects and annotates write commands', () => {
  const text = '/ip/firewall/nat/add chain=dstnat ...';
  const out = guardOutput(text);
  assert.equal(containsWriteCommands(text), true);
  assert.deepEqual(JSON.parse(out.flags), { containsWriteCommands: true, readOnly: true });
  assert.ok(out.content.endsWith('manual di router.'));
});

test('guard clean passthrough', () => {
  assert.equal(containsWriteCommands('analisa routing normal'), false);
});

test('llm url normalization', () => {
  assert.equal(normalizeChatUrl('https://api.openai.com/v1'), 'https://api.openai.com/v1/chat/completions');
  assert.equal(normalizeChatUrl('http://localhost:11434/v1'), 'http://localhost:11434/v1/chat/completions');
  assert.equal(normalizeChatUrl('http://l/chat/completions'), 'http://l/chat/completions');
});

test('orchestrator digest lists all resources and gaps', () => {
  const snapshot = {
    'system/identity': [{ '.id': '*1', name: 'MT-1' }],
    'ip/routes': Array.from({ length: 50 }, (_, i) => ({ dst: `10.0.${i}.0/24` })),
    'ppp/secrets': [{ name: 'user1' }],
  };
  const summary = [
    { resource: 'system/identity', status: 'success', count: 1 },
    { resource: 'ip/routes', status: 'success', count: 50 },
    { resource: 'ppp/secrets', status: 'success', count: 1 },
    { resource: 'wireless', status: 'unsupported', count: 0 },
    { resource: 'system/health', status: 'failed', count: 0, error: 'no such command' },
  ];
  const digest = buildDigest(snapshot, summary, '2026-01-01T00:00:00Z');
  assert.ok(digest.includes('wireless: unsupported'));
  assert.ok(digest.includes('system/health: failed'));
  assert.ok(digest.includes('system/identity'));
  assert.ok(digest.includes('ppp/secrets'));
  assert.ok(digest.includes('50 record'));
  assert.equal(isStale('1999-01-01T00:00:00Z'), true);
  assert.equal(isStale(new Date().toISOString()), false);
});

test('digest includes router identity (company/router/host)', () => {
  const digest = buildDigest({}, [], '2026-01-01T00:00:00Z', {
    routerName: 'Lab-MT',
    company: 'PT. Contoh Nusantara',
    host: '10.0.0.1',
    apiPort: 8728,
  });
  assert.ok(digest.includes('=== IDENTITAS ROUTER ==='));
  assert.ok(digest.includes('Perusahaan: PT. Contoh Nusantara'));
  assert.ok(digest.includes('Router: Lab-MT'));
  assert.ok(digest.includes('Host: 10.0.0.1:8728'));
});

test('audit prompt kinds map to focused prompts', () => {
  const security = buildMessages('audit-security', 'digest', [], null)[0].content;
  const network = buildMessages('audit-network', 'digest', [], null)[0].content;
  const generic = buildMessages('chat', 'digest', [], 'hello')[0].content;
  assert.ok(security.includes('AUDIT KEAMANAN KONFIGURASI'));
  assert.ok(network.includes('AUDIT KEAMANAN JARINGAN'));
  assert.ok(!generic.includes('AUDIT'));
});

test('normalizer redacts secrets', () => {
  const rows = normalizeRows([{ words: ['!re', '=name=user1', '=password=supersecret', '=local-address=10.0.0.1'] }]);
  assert.equal(rows[0]['password'], '***');
  assert.equal(rows[0]['name'], 'user1');
});