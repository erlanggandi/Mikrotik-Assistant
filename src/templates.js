import { logger } from './logger.js';

export function rosEsc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

const IP_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function opt(label, value) {
  return { value, label };
}

function validateValues(tpl, raw) {
  const values = {};
  for (const p of tpl.params) {
    const v = raw[p.id] === undefined ? p.default : raw[p.id];
    if (v === undefined || v === null || v === '') {
      if (p.required !== false) throw new Error(`Parameter "${p.label}" wajib diisi.`);
      continue;
    }
    const s = String(v).trim();
    if (p.type === 'ip' && !IP_RE.test(s)) throw new Error(`Parameter "${p.label}" bukan alamat IP yang valid.`);
    if (p.type === 'number' && !/^\d+(\.\d+)?$/.test(s)) throw new Error(`Parameter "${p.label}" harus angka.`);
    if (p.type === 'select' && !p.options.some((o) => o.value === s)) throw new Error(`Nilai tidak valid untuk "${p.label}".`);
    if (p.type === 'bool') {
      values[p.id] = s === 'true' || s === '1';
      continue;
    }
    values[p.id] = s;
  }
  return values;
}

function wanSection(v) {
  const l = [
    '# --- WAN ---',
  ];
  if (v.wan_type === 'static') {
    l.push(
      '/ip address',
      `:if ([:len [/ip address find where address="${rosEsc(v.wan_ip)}/${v.wan_prefix}"]] = 0) do={ add address="${rosEsc(v.wan_ip)}/${v.wan_prefix}" interface="${rosEsc(v.wan_if)}" comment="WAN" }`,
      '/ip route',
      `:if ([:len [/ip route find where dst-address=0.0.0.0/0 gateway="${rosEsc(v.wan_gw)}"]] = 0) do={ add dst-address=0.0.0.0/0 gateway="${rosEsc(v.wan_gw)}" comment="Default route (WAN)" }`,
      '/ip dns',
      `set servers="${rosEsc(v.wan_dns1)}${v.wan_dns2 ? ',' + rosEsc(v.wan_dns2) : ''}"`,
    );
  } else {
    l.push(
      '/ip dhcp-client',
      `:if ([:len [/ip dhcp-client find where interface="${rosEsc(v.wan_if)}"]] = 0) do={ add interface="${rosEsc(v.wan_if)}" disabled=no comment="WAN (DHCP dari ISP)" }`,
      '/ip dns',
      'set servers="1.1.1.1,8.8.8.8"',
    );
  }
  return l.join('\n');
}

function firewallBase(v) {
  return [
    '# --- FIREWALL DASAR ---',
    '/ip firewall filter',
    `:if ([:len [/ip firewall filter find where chain=input action=accept connection-state=established,related]] = 0) do={ add chain=input action=accept connection-state=established,related comment="Izinkan koneksi mapan" }`,
    `:if ([:len [/ip firewall filter find where chain=input action=accept in-interface="${rosEsc(v.lan_if)}"]] = 0) do={ add chain=input action=accept in-interface="${rosEsc(v.lan_if)}" comment="Izinkan akses LAN ke router" }`,
    `:if ([:len [/ip firewall filter find where chain=input action=accept protocol=icmp]] = 0) do={ add chain=input action=accept protocol=icmp comment="Izinkan ping ke router" }`,
    ...(v.wan_winbox
      ? [`:if ([:len [/ip firewall filter find where chain=input action=accept protocol=tcp dst-port=8291]] = 0) do={ add chain=input action=accept protocol=tcp dst-port=8291 comment="Winbox (dari WAN)" }`]
      : []),
    `:if ([:len [/ip firewall filter find where chain=input action=drop]] = 0) do={ add chain=input action=drop comment="Tolak akses lain ke router (WAN)" }`,
    `:if ([:len [/ip firewall filter find where chain=forward action=accept connection-state=established,related]] = 0) do={ add chain=forward action=accept connection-state=established,related comment="Izinkan koneksi mapan" }`,
    `:if ([:len [/ip firewall filter find where chain=forward action=accept in-interface="${rosEsc(v.lan_if)}" out-interface="${rosEsc(v.wan_if)}"]] = 0) do={ add chain=forward action=accept in-interface="${rosEsc(v.lan_if)}" out-interface="${rosEsc(v.wan_if)}" comment="Izinkan LAN ke internet" }`,
    `:if ([:len [/ip firewall filter find where chain=forward action=drop]] = 0) do={ add chain=forward action=drop comment="Tolak akses dari WAN ke LAN" }`,
  ].join('\n');
}

function lanBasics(v) {
  return [
    '# --- LAN ---',
    `/interface bridge`,
    `:if ([:len [/interface bridge find where name="${rosEsc(v.lan_if)}"]] = 0) do={ add name="${rosEsc(v.lan_if)}" }`,
    '# Catatan: pastikan port LAN di-set anggota bridge ini lewat menu Ports jika perlu.',
    '/ip address',
    `:if ([:len [/ip address find where address="${rosEsc(v.lan_ip)}/${v.lan_prefix}"]] = 0) do={ add address="${rosEsc(v.lan_ip)}/${v.lan_prefix}" interface="${rosEsc(v.lan_if)}" comment="LAN" }`,
  ].join('\n');
}

function dhcpSection(v, poolName, dhcpName, range, net) {
  return [
    '/ip dns',
    'set allow-remote-requests=yes',
    '/ip pool',
    `:if ([:len [/ip pool find where name="${poolName}"]] = 0) do={ add name="${poolName}" ranges="${rosEsc(range)}" }`,
    `/ip dhcp-server`,
    `:if ([:len [/ip dhcp-server find where name="${dhcpName}"]] = 0) do={ add name="${dhcpName}" interface="${rosEsc(v.lan_if)}" address-pool="${poolName}" lease-time=10m }`,
    `/ip dhcp-server network`,
    `:if ([:len [/ip dhcp-server network find where address="${rosEsc(net)}/${v.lan_prefix}"]] = 0) do={ add address="${rosEsc(net)}/${v.lan_prefix}" gateway="${rosEsc(v.lan_ip)}" dns-server="1.1.1.1,8.8.8.8" }`,
  ].join('\n');
}

const templates = [
  {
    id: 'office',
    label: 'Perusahaan / Kantor',
    desc: 'Koneksi internet stabil, DHCP, NAT, dan firewall dasar berlapis. Cocok untuk kantor dengan beberapa divisi.',
    params: [
      { id: 'wan_if', label: 'Interface WAN (port ke modem/ISP)', type: 'text', default: 'ether1' },
      { id: 'lan_if', label: 'Interface LAN (port/bridge ke jaringan internal)', type: 'text', default: 'bridge' },
      { id: 'wan_type', label: 'Koneksi WAN', type: 'select', default: 'dhcp', options: [opt('DHCP (otomatis dari ISP)', 'dhcp'), opt('IP Statis dari ISP', 'static')] },
      { id: 'wan_ip', label: 'IP WAN statis', type: 'ip', default: '', required: false },
      { id: 'wan_prefix', label: 'Prefix WAN (mask)', type: 'select', default: '24', options: ['22', '23', '24', '25', '26', '27', '28', '29', '30'].map((x) => ({ value: x, label: `/${x}` })) },
      { id: 'wan_gw', label: 'Gateway WAN (IP statis)', type: 'ip', default: '', required: false },
      { id: 'wan_dns1', label: 'DNS 1', type: 'ip', default: '1.1.1.1' },
      { id: 'wan_dns2', label: 'DNS 2 (opsional)', type: 'ip', default: '8.8.8.8', required: false },
      { id: 'lan_ip', label: 'IP router di LAN (gateway)', type: 'ip', default: '192.168.1.1' },
      { id: 'lan_prefix', label: 'Prefix LAN', type: 'select', default: '24', options: ['22', '23', '24', '25', '26', '27', '28', '29'].map((x) => ({ value: x, label: `/${x}` })) },
      { id: 'dhcp_net', label: 'Network DHCP (contoh: 192.168.1.0)', type: 'ip', default: '192.168.1.0' },
      { id: 'dhcp_start', label: 'Awal rentang IP klien', type: 'ip', default: '192.168.1.2' },
      { id: 'dhcp_end', label: 'Akhir rentang IP klien', type: 'ip', default: '192.168.1.254' },
      { id: 'wan_winbox', label: 'Izinkan akses Winbox dari WAN? (tidak disarankan)', type: 'bool', default: false },
    ],
    build(v) {
      const nat = [
        '# --- NAT ---',
        '/ip firewall nat',
        `:if ([:len [/ip firewall nat find where action=masquerade chain=srcnat out-interface="${rosEsc(v.wan_if)}"]] = 0) do={ add chain=srcnat action=masquerade out-interface="${rosEsc(v.wan_if)}" comment="Masquerade internet" }`,
      ];
      return [
        '# ====================================================================',
        '#  MIKROTIK ASSISTANT - KONFIGURASI AWAL: PERUSAHAAN / KANTOR',
        '#  PERIKSA DULU setiap baris sebelum dijalankan. Skrip aman dijalankan',
        '#  ulang (ada proteksi agar tidak duplikat). Jalankan dari Terminal/Winbox.',
        '# ====================================================================',
        lanBasics(v),
        wanSection(v),
        nat.join('\n'),
        dhcpSection(v, 'pool-lan', 'dhcp-lan', `${v.dhcp_start}-${v.dhcp_end}`, v.dhcp_net),
        firewallBase(v),
        '',
        '# Selesai. Cek: /ip address print | /ip dhcp-server print | /ip firewall filter print',
      ].join('\n');
    },
  },
  {
    id: 'kos',
    label: 'Kos-kosan',
    desc: 'Satu internet dibagi kamar dengan limit bandwidth per kamar (IP), DHCP, NAT, dan firewall dasar.',
    params: [
      { id: 'wan_if', label: 'Interface WAN (port ke modem/ISP)', type: 'text', default: 'ether1' },
      { id: 'lan_if', label: 'Interface LAN', type: 'text', default: 'bridge' },
      { id: 'wan_type', label: 'Koneksi WAN', type: 'select', default: 'dhcp', options: [opt('DHCP (otomatis dari ISP)', 'dhcp'), opt('IP Statis dari ISP', 'static')] },
      { id: 'wan_ip', label: 'IP WAN statis', type: 'ip', default: '', required: false },
      { id: 'wan_prefix', label: 'Prefix WAN (mask)', type: 'select', default: '24', options: ['22', '23', '24', '25', '26', '27', '28', '29', '30'].map((x) => ({ value: x, label: `/${x}` })) },
      { id: 'wan_gw', label: 'Gateway WAN (IP statis)', type: 'ip', default: '', required: false },
      { id: 'lan_ip', label: 'IP router di LAN (gateway)', type: 'ip', default: '192.168.1.1' },
      { id: 'lan_prefix', label: 'Prefix LAN (wajib /24 agar limit per kamar bekerja)', type: 'select', default: '24', options: ['24'].map((x) => ({ value: x, label: `/${x}` })) },
      { id: 'dhcp_net', label: 'Network DHCP', type: 'ip', default: '192.168.1.0' },
      { id: 'dhcp_start', label: 'IP kamar pertama (oktet terakhir)', type: 'ip', default: '192.168.1.2' },
      { id: 'dhcp_end', label: 'IP kamar terakhir (oktet terakhir)', type: 'ip', default: '192.168.1.254' },
      { id: 'owner_ip', label: 'IP bebas limit (pemilik kos)', type: 'ip', default: '192.168.1.2' },
      { id: 'limit_down', label: 'Limit download per kamar (Mbps)', type: 'number', default: '10' },
      { id: 'limit_up', label: 'Limit upload per kamar (Mbps)', type: 'number', default: '10' },
    ],
    build(v) {
      const poolStart = v.dhcp_start.split('.').slice(0, 3).join('.');
      const sOctet = Number(v.dhcp_start.split('.')[3]);
      const eOctet = Number(v.dhcp_end.split('.')[3]);
      if (poolStart !== v.dhcp_net.split('.').slice(0, 3).join('.') || !Number.isInteger(sOctet) || !Number.isInteger(eOctet) || sOctet < 2 || eOctet > 254 || sOctet > eOctet) {
        throw new Error('Kos-kosan: dhcp_start dan dhcp_end harus berada di subnet /24 yang sama dengan dhcp_net (oktet terakhir 2..254).');
      }
      const queues = [
        '# --- LIMIT BANDWIDTH PER KAMAR (Simple Queue) ---',
        '# Pemilik kos bebas limit (queues diproses urut dari atas):',
        `/queue simple`,
        `:if ([:len [/queue simple find where name="kos-owner"]] = 0) do={ add name="kos-owner" target="${rosEsc(v.owner_ip)}" max-limit=0/0 comment="Pemilik kos (tanpa limit)" }`,
        `:for i from=${sOctet} to=${eOctet} do={ :if ([:len [/queue simple find where name=("kos-" . "${rosEsc(poolStart)}" . "." . $i)]] = 0) do={ /queue simple add name=("kos-" . "${rosEsc(poolStart)}" . "." . $i) target=("${rosEsc(poolStart)}" . "." . $i) max-limit="${rosEsc(v.limit_up)}M/${rosEsc(v.limit_down)}M" comment="Limit kamar" } }`,
      ];
      return [
        '# ====================================================================',
        '#  MIKROTIK ASSISTANT - KONFIGURASI AWAL: KOS-KOSAN',
        '#  PERIKSA DULU setiap baris sebelum dijalankan. Skrip aman dijalankan',
        '#  ulang (ada proteksi agar tidak duplikat). Jalankan dari Terminal/Winbox.',
        '# ====================================================================',
        lanBasics(v),
        wanSection(v),
        '# --- NAT ---',
        '/ip firewall nat',
        `:if ([:len [/ip firewall nat find where action=masquerade chain=srcnat out-interface="${rosEsc(v.wan_if)}"]] = 0) do={ add chain=srcnat action=masquerade out-interface="${rosEsc(v.wan_if)}" comment="Masquerade internet" }`,
        dhcpSection(v, 'pool-lan', 'dhcp-lan', `${v.dhcp_start}-${v.dhcp_end}`, v.dhcp_net),
        queues.join('\n'),
        firewallBase(v),
        '',
        '# Selesai. Cek: /queue simple print | /ip firewall filter print',
      ].join('\n');
    },
  },
  {
    id: 'coffee',
    label: 'Warung Kopi / Coffee Shop',
    desc: 'Hotspot captive portal dengan login sekali pakai, DHCP, NAT, dan limit bandwidth per pengguna hotspot.',
    params: [
      { id: 'wan_if', label: 'Interface WAN (port ke modem/ISP)', type: 'text', default: 'ether1' },
      { id: 'lan_if', label: 'Interface LAN (menuju AP wifi)', type: 'text', default: 'bridge' },
      { id: 'wan_type', label: 'Koneksi WAN', type: 'select', default: 'dhcp', options: [opt('DHCP (otomatis dari ISP)', 'dhcp'), opt('IP Statis dari ISP', 'static')] },
      { id: 'wan_ip', label: 'IP WAN statis', type: 'ip', default: '', required: false },
      { id: 'wan_prefix', label: 'Prefix WAN (mask)', type: 'select', default: '24', options: ['22', '23', '24', '25', '26', '27', '28', '29', '30'].map((x) => ({ value: x, label: `/${x}` })) },
      { id: 'wan_gw', label: 'Gateway WAN (IP statis)', type: 'ip', default: '', required: false },
      { id: 'lan_ip', label: 'Gateway hotspot (IP router)', type: 'ip', default: '10.5.50.1' },
      { id: 'lan_prefix', label: 'Prefix LAN', type: 'select', default: '24', options: ['24'].map((x) => ({ value: x, label: `/${x}` })) },
      { id: 'dhcp_net', label: 'Network hotspot', type: 'ip', default: '10.5.50.0' },
      { id: 'dhcp_start', label: 'Awal rentang IP klien', type: 'ip', default: '10.5.50.2' },
      { id: 'dhcp_end', label: 'Akhir rentang IP klien', type: 'ip', default: '10.5.50.254' },
      { id: 'hs_user', label: 'Username login hotspot (ditulis di papan/poster)', type: 'text', default: 'wifi' },
      { id: 'hs_pass', label: 'Password login hotspot', type: 'text', default: 'kopi123' },
      { id: 'limit_down', label: 'Limit download per pengguna (Mbps)', type: 'number', default: '5' },
      { id: 'limit_up', label: 'Limit upload per pengguna (Mbps)', type: 'number', default: '5' },
    ],
    build(v) {
      return [
        '# ====================================================================',
        '#  MIKROTIK ASSISTANT - KONFIGURASI AWAL: WARUNG KOPI / COFFEE SHOP',
        '#  Membuat Hotspot captive portal. PERIKSA DULU sebelum dijalankan.',
        '# ====================================================================',
        lanBasics(v),
        wanSection(v),
        '# --- NAT ---',
        '/ip firewall nat',
        `:if ([:len [/ip firewall nat find where action=masquerade chain=srcnat out-interface="${rosEsc(v.wan_if)}"]] = 0) do={ add chain=srcnat action=masquerade out-interface="${rosEsc(v.wan_if)}" comment="Masquerade internet" }`,
        '# --- HOTSPOT ---',
        '/ip dns',
        'set allow-remote-requests=yes',
        '/ip pool',
        `:if ([:len [/ip pool find where name="pool-hotspot"]] = 0) do={ add name="pool-hotspot" ranges="${rosEsc(v.dhcp_start)}-${rosEsc(v.dhcp_end)}" }`,
        '/ip dhcp-server',
        `:if ([:len [/ip dhcp-server find where name="dhcp-hotspot"]] = 0) do={ add name="dhcp-hotspot" interface="${rosEsc(v.lan_if)}" address-pool="pool-hotspot" lease-time=1h }`,
        '/ip dhcp-server network',
        `:if ([:len [/ip dhcp-server network find where address="${rosEsc(v.dhcp_net)}/${v.lan_prefix}"]] = 0) do={ add address="${rosEsc(v.dhcp_net)}/${v.lan_prefix}" gateway="${rosEsc(v.lan_ip)}" dns-server="1.1.1.1,8.8.8.8" }`,
        '/ip hotspot user profile',
        `:if ([:len [/ip hotspot user profile find where name="profile-${rosEsc(v.hs_user)}"]] = 0) do={ add name="profile-${rosEsc(v.hs_user)}" shared-users=1 rate-limit="${rosEsc(v.limit_up)}M/${rosEsc(v.limit_down)}M" }`,
        '/ip hotspot',
        `:if ([:len [/ip hotspot find where name="hs-${rosEsc(v.lan_if)}"]] = 0) do={ add name="hs-${rosEsc(v.lan_if)}" interface="${rosEsc(v.lan_if)}" address-pool="pool-hotspot" profile=default }`,
        '/ip hotspot user',
        `:if ([:len [/ip hotspot user find where name="${rosEsc(v.hs_user)}"]] = 0) do={ add name="${rosEsc(v.hs_user)}" password="${rosEsc(v.hs_pass)}" profile="profile-${rosEsc(v.hs_user)}" comment="Login publik" }`,
        '',
        '# Selesai. SSID wifi diatur di interface wireless/AP anda.',
        '# Cek: /ip hotspot print | /ip hotspot user print | /ip dhcp-server print',
      ].join('\n');
    },
  },
];

export function listTemplates() {
  return templates.map(({ id, label, desc }) => ({ id, label, desc }));
}

export function getTemplate(id) {
  return templates.find((t) => t.id === id) || null;
}

export function renderScript(templateId, rawValues = {}) {
  const tpl = getTemplate(templateId);
  if (!tpl) throw new Error(`Template "${templateId}" tidak ditemukan.`);
  const v = validateValues(tpl, rawValues);
  return tpl.build(v);
}

export function selfTest() {
  const checks = [
    ['office', { wan_type: 'dhcp' }, ['/ip firewall nat', 'action=masquerade', '/ip dhcp-server']],
    ['office', { wan_type: 'static', wan_ip: '203.0.113.10', wan_gw: '203.0.113.1', wan_dns1: '1.1.1.1' }, ['dst-address=0.0.0.0/0', 'add address="203.0.113.10/24"']],
    ['kos', {}, ['/queue simple', 'kos-owner', 'max-limit="10M/10M"']],
    ['coffee', {}, ['/ip hotspot', 'pool-hotspot', 'profile-wifi', 'rate-limit="5M/5M"']],
  ];
  for (const [id, values, needles] of checks) {
    const out = renderScript(id, values);
    for (const n of needles) {
      if (!out.includes(n)) throw new Error(`selfTest ${id}: hilang "${n}"`);
    }
    if (out.length < 500) throw new Error(`selfTest ${id}: skrip terlalu pendek (${out.length})`);
  }
  let threw = false;
  try {
    renderScript('kos', { dhcp_start: '192.168.2.50' });
  } catch {
    threw = true;
  }
  if (!threw) throw new Error('selfTest kos: subnet tidak valid harus ditolak');
  logger.info('templates selfTest: OK (%d templates)', templates.length);
}
