import { config } from './config.js';

const NETWORK_KNOWLEDGE = `Pedoman membaca data RouterOS dan interpretasi jaringan (untuk akurasi, bukan pengganti data):

INTERFACE:
- running=true artinya operasional; disabled=true artinya dimatikan manual. type ether/vlan/bridge/wireless.
- rx-error/tx-error tinggi mengindikasikan masalah kabel/driver; total-rx/tx-byte untuk estimasi lalu lintas.

FIREWALL FILTER (chain input/forward/output): rule diproses URUT DARI ATAS; rule pertama yang cocok berlaku.
- connection-state=established,related harus diizinkan dekat awal agar koneksi mapan tidak di-drop.
- input chain: jika tidak ada rule drop/reject di akhir, akses WAN ke router (winbox/ssh/api/dns) terbuka.
- forward chain: tanpa drop default + hanya accept in-interface LAN→WAN, maka WAN→LAN/antar-segmen terbuka.
- address-list: kumpulan IP bernama (biasanya untuk brute-force / ipsec / trust). Rule dengan src-address-list memfilter berdasar daftar itu.

NAT: juga urut dari atas; rule pertama yang cocok. chain srcnat = pengubahan sumber (keluar), chain dstnat = port-forward (masuk).
- action=masquerade dipakai jika IP sumber dinamis (DHCP WAN); menutup seluruh range keluar dari out-interface.
- action=src-nat dengan to-addresses dipakai saat IP statis. srcnat non-masquerade SEBELUM masquerade bisa menutup (shadowing) rule masquerade.
- dstnat = port forwarding: expose service internal ke internet; periksa apakah dibatasi src-address dan dibatasi port.

ROUTING: dst-address=0.0.0.0/0 adalah default route. distance memilih preferensi; beberapa gateway ke dst-address sama memerlukan mangle routing-mark untuk load-balance (tidak melakukan apa-apa tanpa itu). active=false = route tidak dipakai.

DHCP: ip pool (ranges) → dhcp-server (interface + address-pool) → dhcp-server network (gateway/dns per subnet).
- lease bound vs free; dynamic dhcp-client di interface WAN menunjukkan IP dari ISP. Dua DHCP server pada subnet sama = konflik.

DNS: allow-remote-requests=yes membuka resolver ke seluruh LAN (dan potensi ke WAN bila firewall terbuka — abuse/amplification).
- servers kosong + dynamic-servers berarti meminjam dari DHCP WAN.

QUEUE SIMPLE: target bisa satu IP atau rentang; max-limit=upload/download (Mbps). Urutan queue menentukan; convenience owner-first bila ingin bebas limit.
- max-limit 0/0 atau tanpa max-limit = tanpa batas. name dengan awalan dinamis (dynamic=true) biasanya dibuat sistem (mis. hotspot) bukan admin.

PPP: ppp/secret = kredensial; ppp/profile = penawaran alamat+rate-limit; ppp/active = sesi saat ini. Layanan: pptp, l2tp, ovpn, pppoe.
HOTSPOT: server (interface+pool) → user profile → hotspot user; rate-limit di user profile.

WIRELESS: RouterOS 6 memakai /interface/wireless; RouterOS 7 memakai paket wifi (/interface/wifi). Jika wireless dilaporkan unsupported/error, itu wajar bila router ROS7 tanpa /interface/wireless.

TANDA KONFIGURASI BERMASALAH (periksa bila cocok dengan data):
- Address list 'LocalNet'/trusted memuat subnet publik (WAN) → ruang BMP meluas, bisa membocorkan.
- Tidak ada default drop di input dan forward → router/LAN terbuka.
- dstnat (port-forward) tanpa pembatasan source → service terpapar internet.
- Hubungan jumlah: ppp active jauh lebih sedikit dari secrets = layanan mati/down; arp 1-2 entri = LAN hampir kosong saat harusnya ramai.
- interface up tapi tanpa address tetap di atasnya → segmen tidak lengkap.

Saat menjawab: kuantifikasi angka dari data (mis. "38 rule firewall, 134 queue"), beri label bukti, dan bila perlu command perbaikan sebagai teks untuk review manual (read-only).`;

function isPrivateIp(addr) {
  const p = String(addr || '').split('/')[0].split('.');
  if (p.length !== 4) return false;
  const a = Number(p[0]);
  const b = Number(p[1]);
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function buildFacts(snap) {
  const S = snap || {};
  const f = [];
  const add = (line) => f.push(line);

  const res = S['system/resource']?.[0];
  const ident = S['system/identity']?.[0];
  const health = S['system/health']?.[0];
  const dev = [];
  if (ident?.name) dev.push(`nama: ${ident.name}`);
  if (res) {
    if (res['board-name']) dev.push(`board: ${res['board-name']}`);
    if (res.version) dev.push(`RouterOS ${res.version}`);
    if (res.uptime) dev.push(`uptime: ${res.uptime}`);
    if (res['cpu-load'] != null) dev.push(`CPU: ${res['cpu-load']}%`);
  }
  if (health && health.temperature != null) dev.push(`suhu: ${health.temperature}`);
  if (dev.length) add(`Perangkat: ${dev.join('; ')}`);

  const ifaces = S.interfaces || [];
  if (ifaces.length) {
    const up = ifaces.filter((i) => i.running === 'true');
    const dis = ifaces.filter((i) => i.disabled === 'true');
    const err = ifaces.filter((i) => (Number(i['rx-error']) || 0) > 0 || (Number(i['tx-error']) || 0) > 0);
    add(`Interfaces: ${ifaces.length} (running ${up.length}, disabled ${dis.length})`);
    if (err.length) add(`Interface dengan error: ${err.map((i) => `${i.name} rx=${i['rx-error']} tx=${i['tx-error']}`).join(', ')}`);
  }

  const addrs = S['ip/addresses'] || [];
  if (addrs.length) {
    const nonPriv = addrs.filter((a) => a.address && !isPrivateIp(a.address));
    const dynCount = addrs.filter((a) => a.dynamic === 'true').length;
    add(`Addresses: ${addrs.length}${dynCount ? ` (${dynCount} dinamis)` : ''}`);
    if (nonPriv.length) add(`Address non-privat (kemungkinan publik/WAN): ${nonPriv.map((a) => `${a.address}@${a.interface}`).join(', ')}`);
  }

  const routes = S['ip/routes'] || [];
  if (routes.length) {
    const def = routes.filter((r) => r['dst-address'] === '0.0.0.0/0' && !r.disabled);
    if (def.length) add(`Default route: ${def.map((r) => `gw ${r.gateway} dist=${r.distance || '?'} ${r.active === 'true' ? 'aktif' : 'tidak aktif'}`).join('; ')}`);
    else if (!routes.some((r) => r['dst-address'] === '0.0.0.0/0')) add('TIDAK ada default route (0.0.0.0/0) aktif');
  }

  const flt = S['ip/firewall/filter'] || [];
  if (flt.length) {
    const input = flt.filter((r) => r.chain === 'input' && r.disabled !== 'true');
    const fwd = flt.filter((r) => r.chain === 'forward' && r.disabled !== 'true');
    const est = flt.filter((r) => (r['connection-state'] || '').includes('established') && r.action === 'accept');
    const inputDrop = input.filter((r) => r.action === 'drop' || r.action === 'reject');
    const fwdDrop = fwd.filter((r) => r.action === 'drop' || r.action === 'reject');
    add(`Firewall filter: ${flt.length} rule (input ${input.length}, forward ${fwd.length}, accept established/related ${est.length})`);
    if (input.length && !inputDrop.length) add('Kurang: chain input TIDAK punya rule drop/reject final — akses WAN ke router berisiko terbuka');
    if (fwd.length && !fwdDrop.length) add('Kurang: chain forward TIDAK ada drop/reject — lalu lintas antar/WAN-ke-LAN tidak ditutup default');
    if (input.length && inputDrop.length) {
      const idx = flt.findIndex((r) => r === input[input.length - 1]);
      const last = input[input.length - 1];
      add(`Rule input terakhir: #${idx} ${last.action}${last.comment ? ` (comment "${last.comment}")` : ''}`);
    }
  }

  const nat = S['ip/firewall/nat'] || [];
  if (nat.length) {
    const masq = nat.filter((r) => r.chain === 'srcnat' && r.action === 'masquerade');
    const dst = nat.filter((r) => r.chain === 'dstnat' && r.disabled !== 'true');
    const srcOther = nat.filter((r) => r.chain === 'srcnat' && r.action !== 'masquerade' && r.disabled !== 'true');
    add(`NAT: ${nat.length} rule (masquerade ${masq.length}, dstnat/port-forward ${dst.length}, srcnat lain ${srcOther.length})`);
    const fiM = nat.findIndex((r) => r.chain === 'srcnat' && r.action === 'masquerade');
    const fiS = nat.findIndex((r) => r.chain === 'srcnat' && r.action !== 'masquerade' && r.disabled !== 'true');
    if (fiS !== -1 && fiM !== -1 && fiS < fiM) add('Perhatikan: rule srcnat non-masquerade berada SEBELUM masquerade — berpotensi menutupi (shadowing) koneksi lain.');
    if (dst.length) {
      add(`Port-forward (dstnat): ${dst.map((r) => `${r.protocol || '*'}/${r['dst-port'] || 'any'} -> ${r['to-addresses'] || '?'}:${r['to-ports'] || ''}${r['src-address'] ? ' (src ' + r['src-address'] + ')' : ' TANPA batas source'}`).join('; ') || '—'}`);
    }
  }

  const addrLists = S['ip/firewall/address-lists'] || [];
  if (addrLists.length) {
    const lists = [...new Set(addrLists.map((r) => r.list))];
    add(`Address-list: ${lists.length} daftar (${lists.join(', ')}), ${addrLists.length} entri`);
  }

  const dhcpSrv = S['ip/dhcp-server'] || [];
  const pools = S['ip/pools'] || [];
  const leases = S['ip/dhcp-leases'] || [];
  if (dhcpSrv.length || pools.length || leases.length) {
    add(`DHCP: server ${dhcpSrv.length}, pool ${pools.length}${pools.length ? ` [${pools.map((p) => p.ranges).join('; ')}]` : ''}, lease ${leases.length}`);
    const bound = leases.filter((l) => l.status === 'bound');
    if (bound.length) add(`Lease DHCP aktif (bound): ${bound.length}`);
  }

  const dhcpCli = S['ip/dhcp-client'] || [];
  if (dhcpCli.length) {
    add(`DHCP client: ${dhcpCli.map((c) => `${c.interface}=${c.status}${c.address ? ' ' + c.address : ''}`).join(', ')}`);
  }

  const dnsRow = S['ip/dns']?.[0];
  if (dnsRow) {
    add(`DNS: servers ${dnsRow.servers || '(kosong)'}${dnsRow['allow-remote-requests'] === 'true' ? '; allow-remote-requests=yes (resolver terbuka ke LAN)' : ''}`);
  }

  add(`ARP: ${(S['ip/arp'] || []).length} entri; Neighbors: ${(S['ip/neighbors'] || []).length}`);

  const q = S['queues/simple'] || [];
  if (q.length) {
    const dyn = q.filter((r) => r.dynamic === 'true');
    add(`Simple queue: ${q.length} (dinamis ${dyn.length}, statis ${q.length - dyn.length})`);
  }

  const secr = S['ppp/secrets'] || [];
  const act = S['ppp/active'] || [];
  if (secr.length || act.length) {
    add(`PPP: secret ${secr.length}, sesi aktif ${act.length}${act.length ? ` — ${act.map((a) => `${a.name}@${a.service}`).join(', ')}` : ''}`);
  }

  const hot = S['ip/hotspot'] || [];
  if (hot.length) add(`Hotspot server: ${hot.map((h) => h.name).join(', ')}`);

  const users = S['system/users'] || [];
  if (users.length) {
    const groups = [...new Set(users.map((u) => u.group))];
    add(`System users: ${users.length} (group: ${groups.join(', ')})`);
  }

  const upd = S['system/update']?.[0];
  if (upd && upd['new-version']) add(`Update RouterOS tersedia: ${upd['new-version']}`);
  else if (upd && upd.status) add(`Status update: ${upd.status}`);

  return f.join('\n');
}

const MAX_ROWS = {
  'interfaces': 1000,
  'ip/addresses': 1000,
  'ip/routes': 500,
  'ip/firewall/filter': 500,
  'ip/firewall/nat': 500,
  'ip/firewall/mangle': 300,
  'ip/firewall/raw': 300,
  'ip/firewall/address-lists': 500,
  'ip/dhcp-leases': 500,
  'ip/arp': 1000,
  'ip/neighbors': 500,
  'queues/simple': 1000,
  'ppp/profiles': 500,
  'ppp/secrets': 500,
  'ppp/active': 500,
  'ip/dhcp-server': 500,
  'ip/dhcp-client': 500,
  'system/users': 500,
};

export function buildDigest(snapshot, summary, syncedAt, meta = {}, maxChars = 80000) {
  const lines = [`CATATAN SYNC: ${syncedAt}`];
  if (meta.routerName || meta.company || meta.host) {
    lines.push('=== IDENTITAS ROUTER ===');
    if (meta.company) lines.push(`- Perusahaan: ${meta.company}`);
    lines.push(`- Router: ${meta.routerName || ''}`);
    if (meta.host) lines.push(`- Host: ${meta.host}${meta.apiPort ? `:${meta.apiPort}` : ''}`);
  }
  const statusByName = {};
  for (const s of summary || []) statusByName[s.resource] = s;
  const facts = buildFacts(snapshot);
  if (facts) {
    lines.push('=== TEMUAN OTOMATIS (dihitung oleh KODE, bukan AI) ===');
    lines.push('Fakta ini dihitung dari data di bawah; AI boleh mengutipnya dan menambahkan analisis, tetapi harus tetap merujuk baris DATA ROUTER sebagai bukti.');
    lines.push(...facts.split('\n'));
  }
  lines.push('=== DATA ROUTER ===');
  let used = 0;
  outer: for (const name of Object.keys(snapshot || {})) {
    const rows = snapshot[name];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    if (statusByName[name]?.status !== 'success') continue;
    const max = MAX_ROWS[name] ?? 400;
    let section = `## ${name} ${rows.length > 1 ? `— ${rows.length} record` : ''}`;
    const entries = [];
    for (const row of rows.slice(0, max)) {
      const parts = Object.entries(row)
        .filter(([k]) => k !== '.id')
        .map(([k, v]) => `${k}=${v}`);
      entries.push(`- ${parts.join(' ')}`);
    }
    if (rows.length > max) entries.push(`- ... masih ${rows.length - max} record (diwakili) — total ${rows.length}`);
    if (used + section.length + entries.join('\n').length > maxChars) {
      lines.push('... konteks terpotong karena ukuran; resource berikutnya tidak disertakan.');
      break outer;
    }
    used += section.length + entries.join('\n').length;
    lines.push(section, ...entries);
  }
  const gaps = summary?.filter((s) => s.status !== 'success') || [];
  if (gaps.length > 0) {
    lines.push('=== DATA TIDAK TERSEDIA / KURANG ===');
    for (const g of gaps) {
      lines.push(`- ${g.resource}: ${g.status}${g.error ? ` (${g.error})` : ''}`);
    }
    lines.push('Catatan: resource di atas tidak boleh diklaim AI sebagai data nyata.');
  }
  return lines.join('\n');
}

export function isStale(syncedAt, staleAfterHours = config.staleAfterHours) {
  if (!syncedAt) return true;
  return Date.now() - new Date(syncedAt).getTime() > staleAfterHours * 3600 * 1000;
}

export const SYSTEM_PROMPT = `Kamu adalah AI MikroTik Assistant, engine analisis berbasis data yang TERTANAH (grounded).

ATURAN KETAT:
1. Hanya gunakan "DATA ROUTER" yang diberikan. JANGAN pernah mengarang data yang tidak ada di konteks.
2. Jika data resource tidak tersedia, tercantum "unsupported", atau stale, NYATAKAN keterbatasan itu secara eksplisit.
3. Bedakan tiga level bukti dalam analisis:
   - CONFIRMED: terbukti dari data router yang tersedia.
   - PROBABLE: kemungkinan besar berdasarkan bukti yang ada.
   - INSUFFICIENT: data kurang untuk menyimpulkan.
4. Kamu READ-ONLY. Kamu TIDAK memiliki kemampuan mengeksekusi atau mengubah apa pun di router. Jangan pernah menyatakan sudah mengubah/menjalankan apa pun.
5. Jika user meminta perubahan konfigurasi (firewall, routing, DHCP, VPN, NAT, bandwidth, dll), HASILKAN script/command RouterOS sebagai TEXT di dalam blok kode untuk review manual saja. Jangan pernah mengklaim script akan otomatis dieksekusi.
6. Untuk setiap konfigurasi yang dihasilkan, jelaskan: efek, dependensi, potensi konflik dengan konfigurasi existing, dan risiko.
7. Jangan pernah menampilkan password, kredensial, atau material rahasia dalam jawaban.
8. Target kompatibilitas RouterOS 5+. Jika syntax bergantung versi, sebutkan versi yang dibutuhkan.
9. Jawab dalam bahasa yang digunakan user.
10. Konteks di bawah berisi data LENGKAP router yang sudah ditarik. Untuk informasi yang SUDAH ADA di konteks, JANGAN menyuruh user memeriksa manual — berikan langsung penjelasan detail, analisis, dan rekomendasi berdasarkan data tersebut. Hanya sarankan pengecekan manual untuk hal yang memang TIDAK tersedia di konteks (resource gagal/unsupported/stale).
11. SETIAP jawaban chat wajib diakhiri dengan bagian saran:
    - Jika ada temuan, kekurangan, atau potensi masalah → akhiri dengan bagian "## Rekomendasi" yang berisi:
      a) Temuan singkat dengan level prioritas (HIGH / MEDIUM / LOW) dan bukti dari data router,
      b) Langkah perbaikan atau troubleshooting bertahap (langkah konkret, urut),
      c) Command RouterOS sebagai teks dalam blok kode untuk review manual (read-only, tidak dieksekusi), bila relevan,
      d) Dampak/risiko dari perbaikan tersebut bila ada.
    - Jika tidak ada temuan dan konfigurasi terlihat aman/sehat → nyatakan secara singkat bahwa kondisi router baik/aman, lalu berikan 1-2 rekomendasi pencegahan opsional tanpa memaksakan bagian panjang.
    - Gunakan tabel bila membandingkan beberapa temuan/opsi agar mudah dibaca.

Prinsip engineering: LLM response harus selalu memiliki sumber data router yang jelas.

=== PENGETAHUAN JARINGAN & ROUTEROS ===
${NETWORK_KNOWLEDGE}`;

export function auditPrompt() {
  return `${SYSTEM_PROMPT}

Sekarang lakukan AUDIT KONFIGURASI terhadap router berikut.
Hasilkan laporan audit terstruktur dengan bagian:
## Ringkasan
## Temuan (list dengan severity: HIGH / MEDIUM / LOW, masing-masing disertai bukti dari konfigurasi yang ada)
## Kategori risiko (exposure, routing, firewall, auth, DHCP/DNS, resources, keamanan kata sandi/login)
## Rekomendasi prioritas
## Keterbatasan data (resource yang gagal/unsupported/stale)
Semua temuan wajib merujuk pada data yang benar-benar ada di konteks.`;
}

export function securityAuditPrompt() {
  return `${SYSTEM_PROMPT}

Sekarang lakukan AUDIT KEAMANAN KONFIGURASI terhadap router berikut. Fokus pada postur keamanan konfigurasi (bukan topologi jaringan):
- Akun & autentikasi: user group, kebijakan, indikasi password lemah/default, user yang tidak perlu.
- Eksposur service RouterOS: winbox, telnet, ftp, www, www-ssl, ssh, api, api-ssl, dns, dhcp — apakah dibiarkan terbuka / tidak ter-interface-kan, allow-remote-requests tidak aman, api tanpa ssl, ftp aktif tanpa sambungan terproteksi.
- Firewall pertahanan: chain input rule base (drop default?), connection-state handling, proteksi brute force (mis. detect-remote-interface dari address-list), limitation, reject tak dikenal.
- Keamanan API/remote management & kebijakan login (kunci brute force, expired, use radius).
- Logging/monitoring yang minim.
- Status update/package & indikasi versi ketinggalan bila terlihat.
Hasilkan laporan dengan bagian:
## Ringkasan
## Temuan (severity HIGH / MEDIUM / LOW + bukti dari data yang ada)
## Rekomendasi perbaikan (command RouterOS sebagai teks untuk review manual)
## Keterbatasan data
Semua temuan wajib merujuk data yang benar-benar ada di konteks; beri label CONFIRMED / PROBABLE / INSUFFICIENT per temuan.`;
}

export function networkSecurityAuditPrompt() {
  return `${SYSTEM_PROMPT}

Sekarang lakukan AUDIT KEAMANAN JARINGAN terhadap router berikut. Fokus pada postur keamanan di level jaringan/topologi:
- Eksposur WAN/public: interface & address publik, service yang terikat ke interface publik (winbox/telnet/ssh/www/api/dns), NAT port-forward yang mengekspos service ke internet.
- NAT & forward: rule dstnat/srcnat yang berlebihan, port forwarding tanpa pembatasan source, exposure service internal.
- Segmentasi: subnet/VLAN yang ada, apakah ada rules firewall forward yang membatasi antar segmen, traffic lintas segment yang tidak terkontrol.
- Keamanan DHCP: server DHCP tanpa keamanan, rogue lease, DHCP client yang menggantung pada satu gateway, IP pool publik.
- ARP/neighbor discovery: exposure, kemungkinan spoofing di segmen lokal.
- DNS security: DNS public vs internal, rezolusi, kemungkinan poisoning/exposure resolver.
- Routing: default route tunggal, router announcement tak dibatasi, orphan routes.
- DoS/resource: queue/limiting yang minim, control-plane exposure.
Hasilkan laporan dengan bagian:
## Ringkasan
## Temuan (severity HIGH / MEDIUM / LOW + bukti dari data yang ada)
## Rekomendasi perbaikan (command RouterOS sebagai teks untuk review manual)
## Keterbatasan data
Semua temuan wajib merujuk data yang benar-benar ada di konteks; beri label CONFIRMED / PROBABLE / INSUFFICIENT per temuan.`;
}

const AUDIT_PROMPTS = {
  'audit-config': auditPrompt,
  'audit-security': securityAuditPrompt,
  'audit-network': networkSecurityAuditPrompt,
  'audit': auditPrompt,
};

export function buildMessages(kind, digest, history, question) {
  const sys = (AUDIT_PROMPTS[kind] || (() => SYSTEM_PROMPT))();
  const messages = [
    { role: 'system', content: `${sys}\n\n---RICH CONTENT---\n${digest}` },
  ];
  for (const h of history) messages.push({ role: h.role, content: h.content });
  if (question) messages.push({ role: 'user', content: question });
  return messages;
}