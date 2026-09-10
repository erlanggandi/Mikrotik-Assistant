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
  cliToApiSentence,
  isDestructiveCommand,
  normalizeCliCommand,
  hasCliSyntax,
  containsDestructiveCommand,
} from '../src/routeros.js';
import { createHash } from 'node:crypto';
import { containsWriteCommands, guardOutput } from '../src/guard.js';
import { normalizeChatUrl } from '../src/llm.js';
import { buildDigest, buildMessages, isStale } from '../src/orchestrator.js';
import { normalizeRows } from '../src/collector.js';
import { splitTelegramMessage, isChatAllowed, normalizeTelegramCommand, extractScriptFromText } from '../src/telegram.js';

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
  assert.equal(containsWriteCommands('/ip firewall filter add chain=input action=drop'), true);
  assert.equal(containsWriteCommands('/interface ethernet set ether1 name=WAN'), true);
  assert.equal(containsWriteCommands('/ip address print'), false);
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

test('buildDigest reads all snapshot resources even if summary is empty or partial', () => {
  const snapshot = {
    'system/identity': [{ name: 'Core-Router' }],
    'ip/services': [{ name: 'telnet', disabled: 'true' }, { name: 'ssh', port: '22' }],
    'files': [{ name: 'backup-2026.backup' }, { name: 'config.rsc' }],
  };
  const digest = buildDigest(snapshot, [], '2026-01-01T00:00:00Z');
  assert.ok(digest.includes('system/identity'));
  assert.ok(digest.includes('ip/services'));
  assert.ok(digest.includes('files'));
  assert.ok(digest.includes('backup-2026.backup'));
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

test('cliToApiSentence converts RouterOS CLI to API words', () => {
  const words = cliToApiSentence('/ip firewall filter add chain=input protocol=tcp dst-port=80 action=accept comment="Allow HTTP"');
  assert.deepEqual(words, [
    '/ip/firewall/filter/add',
    '=chain=input',
    '=protocol=tcp',
    '=dst-port=80',
    '=action=accept',
    '=comment=Allow HTTP',
  ]);

  assert.equal(cliToApiSentence('   # komentar '), null);
  assert.equal(cliToApiSentence(''), null);
});

test('isDestructiveCommand blocks dangerous commands', () => {
  assert.equal(isDestructiveCommand(['/system/reset-configuration']), true);
  assert.equal(isDestructiveCommand(['/system/reboot']), true);
  assert.equal(isDestructiveCommand(['/disk/format']), true);
  assert.equal(isDestructiveCommand(['/ip/firewall/filter/add', '=chain=input']), false);
});

test('splitTelegramMessage splits text exceeding max length', () => {
  const shortText = 'Halo dunia';
  assert.deepEqual(splitTelegramMessage(shortText, 50), ['Halo dunia']);

  const longText = 'Baris satu\n\nBaris dua\n\nBaris tiga';
  const parts = splitTelegramMessage(longText, 15);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 15));
});

test('isChatAllowed checks whitelist including negative group chat IDs', () => {
  const allowed = ['12345678', '999888', '-1001234567890', '-987654'];
  assert.equal(isChatAllowed(12345678, 0, allowed), true);
  assert.equal(isChatAllowed(0, 999888, allowed), true);
  assert.equal(isChatAllowed(-1001234567890, 111, allowed), true);
  assert.equal(isChatAllowed('-1001234567890', 111, allowed), true);
  assert.equal(isChatAllowed(-987654, 0, allowed), true);
  assert.equal(isChatAllowed(-1009999999999, 333444, allowed), false);
  assert.equal(isChatAllowed(111222, 333444, allowed), false);
  assert.equal(isChatAllowed(12345678, 0, []), false);
});

test('normalizeTelegramCommand strips @botusername from commands', () => {
  assert.equal(normalizeTelegramCommand('/status@MyMikrotikBot'), '/status');
  assert.equal(normalizeTelegramCommand('/routers@My_Bot'), '/routers');
  assert.equal(normalizeTelegramCommand('/use@MyBot CCR-Kantor'), '/use CCR-Kantor');
  assert.equal(normalizeTelegramCommand('/help'), '/help');
  assert.equal(normalizeTelegramCommand('halo bot'), 'halo bot');
  assert.equal(normalizeTelegramCommand(''), '');
});

test('cliToApiSentence maps positional arguments after action verbs', () => {
  const disableWords = cliToApiSentence('/ip service disable telnet');
  assert.deepEqual(disableWords, ['/ip/service/disable', '=numbers=telnet']);

  const etherWords = cliToApiSentence('/interface ethernet disable ether5');
  assert.deepEqual(etherWords, ['/interface/ethernet/disable', '=numbers=ether5']);

  const setWords = cliToApiSentence('/interface set ether1 name=LAN');
  assert.deepEqual(setWords, ['/interface/set', '=numbers=ether1', '=name=LAN']);
});

test('extractScriptFromText extracts RouterOS commands from various markdown blocks', () => {
  const text1 = 'Berikut perbaikan:\n```routeros\n/ip service disable telnet\n```\nSelesai.';
  assert.deepEqual(extractScriptFromText(text1), ['/ip service disable telnet']);

  const text2 = 'Jalankan perintah ini:\n```mikrotik\n/ip firewall filter add chain=input action=drop\n```';
  assert.deepEqual(extractScriptFromText(text2), ['/ip firewall filter add chain=input action=drop']);

  const text3 = 'Berikut skripnya:\n```\n/queue simple add name=Limit-User max-limit=10M/10M\n```';
  assert.deepEqual(extractScriptFromText(text3), ['/queue simple add name=Limit-User max-limit=10M/10M']);

  const text4 = 'Teks biasa tanpa blok kode:\n/ip dns set allow-remote-requests=no\nBisa dijalankan.';
  assert.deepEqual(extractScriptFromText(text4), ['/ip dns set allow-remote-requests=no']);

  // Unslashed commands in code blocks
  const textUnslashed = '```routeros\ninterface ethernet set ether1 comment="WAN"\nip service disable telnet\nqueue simple add name=Q1 target=1.1.1.1/32 max-limit=1M/1M\n```';
  assert.deepEqual(extractScriptFromText(textUnslashed), [
    '/interface ethernet set ether1 comment="WAN"',
    '/ip service disable telnet',
    '/queue simple add name=Q1 target=1.1.1.1/32 max-limit=1M/1M',
  ]);
});

test('normalizeCliCommand normalizes [find name=...] and [find default-name=...]', () => {
  assert.equal(
    normalizeCliCommand('/ip service set [find name=telnet] disabled=yes'),
    '/ip service set telnet disabled=yes'
  );
  assert.equal(
    normalizeCliCommand('/ip service disable [find name=telnet]'),
    '/ip service disable telnet'
  );
  assert.equal(
    normalizeCliCommand('/interface ethernet set [find name="ether1"] comment="WAN"'),
    '/interface ethernet set ether1 comment="WAN"'
  );
  assert.equal(
    normalizeCliCommand('/interface ethernet disable [find default-name=ether5]'),
    '/interface ethernet disable ether5'
  );
  assert.equal(
    normalizeCliCommand('/queue simple set [find name="Client-1"] target=20.20.30.251/32'),
    '/queue simple set Client-1 target=20.20.30.251/32'
  );
  assert.equal(
    normalizeCliCommand('/queue simple set [find where name=Global-Limit] target=20.20.30.0/24'),
    '/queue simple set Global-Limit target=20.20.30.0/24'
  );
  // Preserves commands without [find name=...]
  assert.equal(
    normalizeCliCommand('/ip firewall filter enable [find comment="Drop input"]'),
    '/ip firewall filter enable [find comment="Drop input"]'
  );
});

test('hasCliSyntax detects RouterOS CLI constructs', () => {
  assert.equal(hasCliSyntax('/ip service set telnet disabled=yes'), false);
  assert.equal(hasCliSyntax('/ip firewall filter add chain=input action=drop'), false);
  assert.equal(hasCliSyntax('/ip firewall filter enable [find comment="Drop input"]'), true);
  assert.equal(hasCliSyntax(':foreach i in=[/interface find] do={ :put $i }'), true);
  assert.equal(hasCliSyntax('/system script run s1; /system script run s2'), true);
});

test('containsDestructiveCommand detects dangerous operations in strings and words', () => {
  assert.equal(containsDestructiveCommand('/system reboot'), true);
  assert.equal(containsDestructiveCommand('/system reset-configuration'), true);
  assert.equal(containsDestructiveCommand('/disk format drive1'), true);
  assert.equal(containsDestructiveCommand('/user remove admin'), true);
  assert.equal(containsDestructiveCommand('/ip service disable telnet'), false);
  assert.equal(containsDestructiveCommand('/ip address add address=1.1.1.1/24 interface=ether1'), false);
});

test('executeScript executes commands via hybrid direct API and native script runner', async () => {
  const c = new RouterOSConnection({ host: 'x', username: 'admin', password: 'pw' });
  c.socket = { destroyed: false, write: () => {} };
  c.authenticated = true;

  const sentCommands = [];
  c.command = async (words) => {
    sentCommands.push(words);
    const cmd = words[0];
    if (cmd === '/system/script/add') {
      return [{ words: ['!done', '=ret=*99'] }];
    }
    return [{ words: ['!done'] }];
  };

  const script = [
    '/system identity set name=Core-HQ',
    '/queue simple set [find name="Client-1"] target=10.0.0.1/32',
    '/ip firewall filter enable [find comment="Drop input"]',
  ];

  const res = await c.executeScript(script);
  assert.equal(res.ok, true);
  assert.equal(res.results.length, 3);
  assert.equal(res.results.every((r) => r.ok), true);

  // First command was direct API
  assert.deepEqual(sentCommands[0], ['/system/identity/set', '=name=Core-HQ']);
  // Second command was normalized to direct API
  assert.deepEqual(sentCommands[1], ['/queue/simple/set', '=numbers=Client-1', '=target=10.0.0.1/32']);
  // Third command had [find comment=...] so it ran via native /system/script runner
  assert.equal(sentCommands[2][0], '/system/script/add');
  assert.equal(sentCommands[3][0], '/system/script/run');
  assert.equal(sentCommands[4][0], '/system/script/remove');
});