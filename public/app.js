const app = document.getElementById('app');

const state = {
  routers: [],
  view: 'routers',
  router: null,
  overview: null,
  chats: null,
  chat: null,
  messages: [],
  provider: null,
  provEditId: null,
  provTest: { id: null, models: [] },
  config: { tpl: null, values: {}, script: null },
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status === 401) {
    renderLogin();
    throw new Error(data.error || 'unauthorized');
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function fmtTs(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d)) return String(s);
  const p = (n) => String(n).padStart(2, '0');
  const tz =
    (() => {
      try {
        const off = -d.getTimezoneOffset() / 60;
        const s = off >= 0 ? '+' : '-';
        return `GMT${s}${off ? String(Math.abs(off)) : ''}`;
      } catch { return ''; }
    })();
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function inlineFmt(s) {
  let t = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return t;
}

function renderTable(rows) {
  const cells = (r) => r.replace(/^\s*\||\|\s*$/g, '').split('|').map((c) => c.trim());
  let header = null;
  let start = 0;
  if (rows.length > 1 && cells(rows[1]).every((c) => /^:?-+:?$/.test(c))) {
    header = cells(rows[0]);
    start = 2;
  }
  let html = '<div class="table-wrap"><table class="md-table">';
  if (header) html += `<thead><tr>${header.map((c) => `<th>${inlineFmt(c)}</th>`).join('')}</tr></thead>`;
  html += '<tbody>';
  for (let k = start; k < rows.length; k++) {
    html += `<tr>${cells(rows[k]).map((c) => `<td>${inlineFmt(c)}</td>`).join('')}</tr>`;
  }
  return html + '</tbody></table></div>';
}

function renderMd(text) {
  const blocks = [];
  let t = String(text).replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push(`<pre><code class="lang-${esc(lang || '')}">${esc(code)}</code></pre>`);
    return `\u0000B${blocks.length - 1}\u0000`;
  });
  t = esc(t);
  const lines = t.split('\n');
  const out = [];
  let i = 0;
  const isTableLine = (l) => /^\s*\|.*\|\s*$/.test(l);
  const isListLine = (l) => /^\s*[-*] /.test(l) || /^\s*\d+[.)] /.test(l);
  const isHeaderLine = (l) => /^#{1,3} /.test(l);
  const isRuleLine = (l) => /^(-{3,}|\*{3,}|_{3,})$/.test(l);
  const isQuoteLine = (l) => l.startsWith('&gt; ') || l.startsWith('>');
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) { i++; continue; }
    if (isRuleLine(line)) { out.push('<hr>'); i++; continue; }
    if (isTableLine(line)) {
      const rows = [];
      while (i < lines.length && isTableLine(lines[i])) rows.push(lines[i++]);
      out.push(renderTable(rows));
      continue;
    }
    if (/^### /.test(line)) { out.push(`<h5>${inlineFmt(line.slice(4))}</h5>`); i++; continue; }
    if (/^## /.test(line)) { out.push(`<h4>${inlineFmt(line.slice(3))}</h4>`); i++; continue; }
    if (/^# /.test(line)) { out.push(`<h3>${inlineFmt(line.slice(2))}</h3>`); i++; continue; }
    if (isQuoteLine(raw)) {
      const q = [];
      while (i < lines.length && (lines[i].startsWith('&gt;') || lines[i].startsWith('>'))) {
        q.push(inlineFmt(lines[i].replace(/^\s*&gt;\s*/, '').replace(/^\s*>\s*/, '')));
        i++;
      }
      out.push(`<blockquote>${q.join('<br>')}</blockquote>`);
      continue;
    }
    if (/^\s*[-*] /.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*] /.test(lines[i])) {
        items.push(`<li>${inlineFmt(lines[i].replace(/^\s*[-*] /, ''))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    if (/^\s*\d+[.)] /.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)] /.test(lines[i])) {
        items.push(`<li>${inlineFmt(lines[i].replace(/^\s*\d+[.)] /, ''))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }
    // baris tebal penuh -> sub-judul beraksen agar struktur terlihat jelas
    if (/^\*\*[^*\n]+\*\*$/.test(line)) {
      out.push(`<div class="md-sub">${inlineFmt(line.slice(2, -2))}</div>`);
      i++;
      continue;
    }
    // placeholder blok kode -> blok berdiri sendiri
    if (/^\u0000B\d+\u0000$/.test(line)) { out.push(line); i++; continue; }
    // paragraph
    const para = [inlineFmt(line)];
    i++;
    while (i < lines.length) {
      const nl = lines[i].trim();
      if (!nl || isTableLine(lines[i]) || isListLine(lines[i]) || isHeaderLine(lines[i]) ||
          isRuleLine(lines[i]) || isQuoteLine(lines[i]) || /^\u0000B\d+\u0000$/.test(nl)) break;
      para.push(inlineFmt(lines[i]));
      i++;
    }
    out.push(`<p>${para.join('<br>')}</p>`);
  }
  return out.join('').replace(/\u0000B(\d+)\u0000/g, (_, n) => blocks[n]);
}

/* ============ AUTH ============ */
function renderLogin() {
  document.cookie = 'mt_auth=; Max-Age=0; path=/';
  app.innerHTML = `
  <div class="login-wrap"><div class="login-card">
    <h1>AI MikroTik Assistant</h1>
    <p>Masuk untuk mengelola router dan AI analyzer.</p>
    <label>Password admin</label>
    <input type="password" id="login-pass" autofocus />
    <div id="login-msg"></div>
    <button class="primary" id="login-btn" style="width:100%;margin-top:8px">Masuk</button>
    <div class="login-foot">Dibuat oleh <b>Erlanggandi</b></div>
  </div></div>`;
  const doLogin = async () => {
    try {
      await api('/api/auth/login', { method: 'POST', body: { password: document.getElementById('login-pass').value } });
      enterApp();
    } catch (e) {
      showMsg('login-msg', e.message, 'err');
    }
  };
  document.getElementById('login-btn').onclick = doLogin;
  document.getElementById('login-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
}

function showMsg(id, text, kind) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<div class="msg ${kind}">${esc(text)}</div>`;
  else if (kind === 'err') alertDialog(esc(text), { title: 'Terjadi Kesalahan' });
}

/* ============ BOOT / SHELL ============ */
function currentTheme() {
  return document.documentElement.dataset.theme || 'light';
}
function applyTheme() {
  const saved = localStorage.getItem('mt_theme');
  document.documentElement.dataset.theme = saved === 'light' ? 'light' : 'dark';
}
function toggleTheme() {
  document.documentElement.dataset.theme = currentTheme() === 'dark' ? 'light' : 'dark';
  localStorage.setItem('mt_theme', document.documentElement.dataset.theme);
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = currentTheme() === 'dark' ? '☀ Tema Terang' : '🌙 Tema Gelap';
}

async function boot() {
  applyTheme();
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.r-menu') && !e.target.closest('.r-menu-btn')) closeAllMenus();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllMenus(); });
  try {
    const me = await api('/api/auth/me');
    if (!me.authenticated) return renderLogin();
    await enterApp();
  } catch {
    renderLogin();
  }
}

async function enterApp() {
  try {
    await refreshRouters();
    renderShell();
  } catch {
    renderLogin();
  }
}

async function refreshRouters() {
  state.routers = await api('/api/routers');
}

function renderShell() {
  app.innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><h2>MikroTik Assistant</h2><small>v0.1 · read-only</small></div>
      <nav class="nav">
        <div class="nav-sec">Utama</div>
        <button class="nav-item" data-view="routers"><b>&#9776;</b> <span>Routers</span><span class="nav-count">${state.routers.length}</span></button>
        <div class="nav-sec">Tools</div>
        <button class="nav-item" data-view="discover"><b>&#128269;</b> <span>Discovery</span></button>
        <button class="nav-item" data-view="config"><b>&#128736;</b> <span>Konfigurasi</span></button>
        <div class="nav-sec">Pengaturan</div>
        <button class="nav-item" data-view="provider"><b>&#9881;</b> <span>AI Provider</span></button>
        <button class="nav-item" data-view="settings"><b>&#128274;</b> <span>Settings</span></button>
        <div class="nav-sec">Sistem</div>
        <button class="nav-item" data-view="logs"><b>&#128220;</b> <span>Activity Log</span></button>
      </nav>
      <div class="sidebar-foot">
        <button class="sidebar-action" id="theme-toggle"></button>
        <button class="sidebar-action" id="logout-btn">Keluar</button>
        <div class="credit">Dibuat oleh <b>Erlanggandi</b></div>
      </div>
    </aside>
    <main class="main">
      ${state.view !== 'routers' || !state.router ? '<div class="topbar" id="topbar"></div>' : ''}
      <div class="content" id="content"></div>
    </main>
  </div>`;

  document.querySelectorAll('.nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === state.view);
    b.onclick = () => {
      state.view = b.dataset.view;
      if (b.dataset.view === 'routers') { state.router = null; state.overview = null; }
      if (b.dataset.view === 'config') { state.config = { tpl: null, values: {}, script: null }; }
      renderShell();
    };
  });
  const tBtn = document.getElementById('theme-toggle');
  if (tBtn) { tBtn.onclick = toggleTheme; tBtn.textContent = currentTheme() === 'dark' ? '☀ Tema Terang' : '🌙 Tema Gelap'; }
  document.getElementById('logout-btn').onclick = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    renderLogin();
  };

  if (state.view === 'routers' && state.router) renderRouter();
  else if (state.view === 'routers') renderDashboard();
  else if (state.view === 'discover') renderDiscover();
  else if (state.view === 'config') renderConfig();
  else if (state.view === 'provider') renderProvider();
  else if (state.view === 'settings') renderSettings();
  else if (state.view === 'logs') renderLogs();
}

async function renderDashboard() {
  const topbar = document.getElementById('topbar');
  const content = document.getElementById('content');
  topbar.innerHTML = '<h3>Dashboard</h3>';
  let cards;
  try {
    cards = await api('/api/dashboard');
  } catch (e) {
    content.innerHTML = `<div class="card"><div class="msg err">${esc(e.message || 'gagal memuat dashboard')}</div></div>`;
    return;
  }
  if (!cards.length) {
    content.innerHTML = `
    <div class="card"><h4>Selamat datang</h4>
      <p class="empty" style="text-align:left;padding:0">Tambahkan MikroTik pertama untuk mulai.<br/>
      Alur: <b>Add Router &rarr; Test Connection &rarr; Sync Data &rarr; Chat/Audit</b></p>
      <button class="primary" onclick="openRouterForm()">+ Tambah Router</button>
    </div>`;
    return;
  }
  content.innerHTML = `
    <div class="dash-grid">
      ${cards.map(dashCardHtml).join('')}
      <div class="dash-card dash-add" role="button" title="Tambah router"><span>+</span><b>Tambah Router</b></div>
    </div>`;
  content.querySelectorAll('[data-dash-open]').forEach((b) => {
    b.onclick = () => openRouter(state.routers.find((r) => r.id === b.dataset.dashOpen));
  });
  content.querySelectorAll('.r-menu-btn').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      const menu = document.getElementById('rmenu-' + b.dataset.menu);
      const isOpen = menu.classList.contains('open');
      closeAllMenus();
      if (!isOpen) menu.classList.add('open');
    };
  });
  content.querySelectorAll('.r-menu-item').forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); routerAction(b.dataset.id, b.dataset.act); };
  });
  const addBtn = content.querySelector('.dash-add');
  if (addBtn) addBtn.onclick = () => openRouterForm();
}

/* ============ NETWORK DISCOVERY (MNDP) ============ */
async function renderDiscover() {
  const topbar = document.getElementById('topbar');
  const content = document.getElementById('content');
  topbar.innerHTML = '<h3>Discovery</h3>';
  content.innerHTML = `
  <div class="card">
    <h4>Pemindaian Jaringan (MNDP)</h4>
    <p style="color:var(--muted);margin-top:-6px">Temukan router MikroTik di jaringan yang sama (prootol MNDP — sama seperti Winbox &rarr; Neighbors). Hanya menemukan device <b>di broadcast domain ini</b>; kredensial tetap diisi manual.</p>
    <div class="row">
      <button class="primary" id="dis-scan">Pindai Jaringan</button>
      <button id="dis-cancel" style="display:none">Batal</button>
      <button id="dis-reset" style="display:none">Bersihkan Hasil</button>
      <span id="dis-status" style="color:var(--muted);font-size:13px"></span>
    </div>
    <div id="dis-msg"></div>
    <div id="dis-result">
      <p class="empty">Belum ada hasil. Klik "Pindai Jaringan" untuk memulai.</p>
    </div>
  </div>`;

  let controller = null;
  const resetResult = (msg) => {
    document.getElementById('dis-result').innerHTML = `<p class="empty">${msg}</p>`;
    document.getElementById('dis-reset').style.display = 'none';
  };
  document.getElementById('dis-scan').onclick = async () => {
    const scanBtn = document.getElementById('dis-scan');
    const statusEl = document.getElementById('dis-status');
    const resultEl = document.getElementById('dis-result');
    controller = new AbortController();
    scanBtn.disabled = true;
    document.getElementById('dis-cancel').style.display = 'inline-block';
    document.getElementById('dis-reset').style.display = 'none';
    showMsg('dis-msg', '', '');
    statusEl.textContent = 'Memindai jaringan...';
    resultEl.innerHTML = '<p class="empty">Sedang memindai, silakan tunggu.</p>';
    try {
      const r = await api('/api/discover', {
        method: 'POST', body: { duration: 3500 }, signal: controller.signal,
      });
      const devs = r.devices || [];
      statusEl.textContent = `${devs.length} device ditemukan`;
      if (!devs.length) {
        resetResult('Tidak ada MikroTik ditemukan di jaringan saat ini. Periksa PC dan router berada satu jaringan (LAN langsung).');
      } else {
        resultEl.innerHTML = `
        <table class="data-table">
          <thead><tr><th>Nama (identity)</th><th>IP</th><th>Versi</th><th>Perangkat</th><th>API</th><th></th></tr></thead>
          <tbody>${devs.map((d) => `
            <tr>
              <td>${esc(d.identity || '—')}</td>
              <td>${esc(d.ip || '—')} ${d.mac ? `<small class="cell-muted">${esc(d.mac)}</small>` : ''}</td>
              <td>${esc(d.version || '—')}${d.uptime ? `<small class="cell-muted"> ${esc(d.uptime)}</small>` : ''}</td>
              <td>${esc(d.platform || '')}${d.hardware ? ` / ${esc(d.hardware)}` : ''}</td>
              <td>${d.apiPort ? `<span class="badge ok">${d.apiSsl ? 'api-ssl' : 'api'} ${d.apiPort}</span>` : (d.apiSsl ? `<span class="badge lvl-warn">api-ssl-only</span>` : `<span class="cell-muted">tidak terbuka</span>`)}</td>
              <td><button data-tambah="${esc(d.ip)}" data-identity="${esc(d.identity || '')}" ${d.apiPort ? '' : !d.ip ? 'disabled' : ''} class="primary">Tambah</button></td>
            </tr>`).join('')}
        </tbody>
        </table>`;
        resultEl.querySelectorAll('[data-tambah]').forEach((b) => {
          b.onclick = () => openRouterForm({
            name: b.dataset.identity || (b.dataset.tambah),
            host: b.dataset.tambah,
            api_port: 8728,
            secure: false,
          });
        });
        document.getElementById('dis-reset').style.display = 'inline-block';
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        statusEl.textContent = 'Pemindaian dibatalkan.';
        resetResult('Belum ada hasil. Klik "Pindai Jaringan" untuk memulai.');
      } else {
        showMsg('dis-msg', e.message, 'err');
        statusEl.textContent = 'Pemindaian gagal.';
      }
    }
    scanBtn.disabled = false;
    document.getElementById('dis-cancel').style.display = 'none';
  };
  document.getElementById('dis-cancel').onclick = () => {
    if (controller) controller.abort();
  };
  document.getElementById('dis-reset').onclick = () => {
    resetResult('Belum ada hasil. Klik "Pindai Jaringan" untuk memulai.');
    document.getElementById('dis-status').textContent = '';
  };
}

/* ============ KONFIGURASI AWAL ============ */
const CFG_PARAM_LABELS = {
  text: 'Input teks',
  ip: 'Alamat IP',
  number: 'Angka',
  select: 'Pilihan',
  bool: 'Centang di bawah',
};

async function renderConfig() {
  const topbar = document.getElementById('topbar');
  const content = document.getElementById('content');
  topbar.innerHTML = '<h3>Konfigurasi Awal</h3>';
  if (!state.config.tpl) {
    let list;
    try {
      list = await api('/api/templates');
    } catch (e) {
      content.innerHTML = `<div class="card"><div class="msg err">${esc(e.message || 'gagal memuat template')}</div></div>`;
      return;
    }
    if (!list.length) {
      content.innerHTML = `<div class="card"><p class="empty">Belum ada template.</p></div>`;
      return;
    }
    content.innerHTML = `
      <p style="color:var(--muted);margin-bottom:12px">Pilih skenario pemakaian untuk menghasilkan skrip konfigurasi awal MikroTik. Skrip selalu <b>perlu di-review</b> sebelum dijalankan.</p>
      <div class="dash-grid">${list.map((t) => `
        <div class="dash-card" role="button" data-tpl="${esc(t.id)}">
          <div class="dash-title"><b>${esc(t.label)}</b><small>${esc(t.desc)}</small></div>
          <div class="dash-foot"><span class="cell-muted">Template</span><span class="dash-go">Pilih &rarr;</span></div>
        </div>`).join('')}
      </div>`;
    content.querySelectorAll('[data-tpl]').forEach((b) => {
      b.onclick = () => { state.config = { tpl: b.dataset.tpl, values: {}, script: null }; renderConfig(); };
    });
    return;
  }
  const t = await api('/api/templates/' + state.config.tpl).catch((e) => null);
  if (!t) {
    state.config = { tpl: null, values: {}, script: null };
    return renderConfig();
  }
  if (state.config.script !== null) {
    content.innerHTML = `
    <div class="card" style="max-width:820px">
      <div class="card-title"><b>${esc(t.label)}</b> &middot; Skrip RouterOS <span class="badge ok" style="margin-left:8px">siap di-review</span></div>
      <div class="msg" style="color:var(--muted)">Periksa setiap baris sebelum menjalankan. Skrip dibuat agar aman dijalankan ulang (ada pengecekan anti-duplikat).</div>
      <pre class="script-box">${esc(state.config.script)}</pre>
      <div class="row" style="margin-top:10px">
        <button class="primary" id="cfg-copy">Salin Skrip</button>
        <button id="cfg-back">Ubah Parameter</button>
        <button id="cfg-new">Pilih Template Lain</button>
      </div>
      <div id="cfg-msg"></div>
    </div>`;
    document.getElementById('cfg-copy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(state.config.script);
        showMsg('cfg-msg', 'Skrip disalin ke clipboard.', 'ok');
      } catch {
        const ta = document.createElement('textarea');
        ta.value = state.config.script;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        showMsg('cfg-msg', 'Skrip disalin ke clipboard.', 'ok');
      }
    };
    document.getElementById('cfg-back').onclick = () => { state.config.script = null; renderConfig(); };
    document.getElementById('cfg-new').onclick = () => { state.config = { tpl: null, values: {}, script: null }; renderConfig(); };
    return;
  }
  const val = (id, dft) => (state.config.values[id] !== undefined ? state.config.values[id] : dft);
  content.innerHTML = `
  <div class="card" style="max-width:620px">
    <div class="card-title"><b>${esc(t.label)}</b> <button id="cfg-tpl-back" class="ghost" style="margin-left:8px">&larr; ganti template</button></div>
    <p style="color:var(--muted);margin:4px 0 12px">${esc(t.desc)}</p>
    <div id="cfg-form">${t.params.map((p) => `
      ${p.type === 'bool'
        ? `<div class="cfg-row"><label style="display:flex;align-items:center;gap:8px;margin:0"><input type="checkbox" data-p="${p.id}" ${val(p.id, p.default) ? 'checked' : ''} /> <span>${esc(p.label)}</span></label></div>`
        : `<label>${esc(p.label)}${p.type !== 'select' && p.required !== false ? ' <em style="color:var(--muted);font-size:11px">(' + CFG_PARAM_LABELS[p.type] + ')</em>' : ''}</label>
           ${p.type === 'select'
             ? `<select data-p="${p.id}">${p.options.map((o) => `<option value="${esc(o.value)}" ${String(val(p.id, p.default)) === String(o.value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
             : `<input data-p="${p.id}" type="${p.type === 'number' ? 'number' : 'text'}" value="${esc(val(p.id, p.default) ?? '')}" placeholder="${p.type === 'ip' ? 'contoh: 192.168.1.1' : ''}" />`}
           ${p.id === 'wan_winbox' ? '<small style="color:var(--amber)">Pengaman ekstra: sebaiknya biarkan mati.</small>' : ''}`}
    `).join('')}</div>
    <div class="row" style="margin-top:12px">
      <button class="primary" id="cfg-gen">Generate Skrip</button>
    </div>
    <div id="cfg-msg"></div>
  </div>`;
  document.getElementById('cfg-tpl-back').onclick = () => { state.config = { tpl: null, values: {}, script: null }; renderConfig(); };
  document.getElementById('cfg-gen').onclick = async () => {
    const values = {};
    content.querySelectorAll('[data-p]').forEach((el) => {
      values[el.dataset.p] = el.type === 'checkbox' ? el.checked : el.value.trim();
    });
    try {
      const r = await api('/api/templates/' + state.config.tpl + '/script', { method: 'POST', body: { values } });
      state.config.values = values;
      state.config.script = r.script;
      renderConfig();
    } catch (e) {
      showMsg('cfg-msg', e.message, 'err');
    }
  };
}

function dashCardHtml(c) {
  const h = c.health;
  const memUsed = h && h.freeMem != null && h.totalMem != null && h.totalMem > 0
    ? Math.round((1 - h.freeMem / h.totalMem) * 100) : null;
  let tempShow = '—';
  if (h && h.temp != null) {
    const t = String(h.temp).trim();
    if (t) tempShow = t.includes('°') ? t : (t.toUpperCase().endsWith('C') ? t.slice(0, -1) + '°C' : t + '°C');
  }
  const audit = c.audit;
  const critical = audit ? audit.sev.critical + audit.sev.high : 0;
  const syncBadge = !c.hasContext ? 'BELUM SYNC' : (c.stale ? 'STALE' : 'SEGAR');
  return `
  <div class="dash-card ${c.connectionStatus !== 'ok' ? 'dash-alert' : ''}" data-dash-open="${c.id}" role="button">
    <div class="dash-head">
      <div class="dash-title">
        <b>${esc(c.name)}</b>
        ${c.company ? `<small>${esc(c.company)}</small>` : ''}
      </div>
      <span class="dash-actions">
        <span class="badge ${c.connectionStatus}">${c.connectionStatus}</span>
        <button class="r-menu-btn" data-menu="${c.id}" title="Menu router">&hellip;</button>
      </span>
    </div>
    <div class="r-menu" id="rmenu-${c.id}">
      <button class="r-menu-item" data-act="test" data-id="${c.id}">Test Connection</button>
      <button class="r-menu-item" data-act="sync" data-id="${c.id}">Sync Data</button>
      <button class="r-menu-item" data-act="edit" data-id="${c.id}">Edit</button>
      <button class="r-menu-item danger" data-act="del" data-id="${c.id}">Hapus</button>
    </div>
    <div class="dash-meta">
      <span class="cell-muted">${esc(c.host)}${c.apiPort ? ':' + c.apiPort : ''}${c.secure ? ' <span class="badge lvl-info">SSL</span>' : ''}</span>
      <span class="badge ${c.stale || !c.hasContext ? 'stale' : 'ok'}">${syncBadge}</span>
    </div>
    <div class="dash-health">
      ${h ? `
        <div class="dh-item"><span class="dh-lbl">CPU</span><b>${h.cpu != null ? esc(h.cpu) + '%' : '—'}</b></div>
        <div class="dh-item"><span class="dh-lbl">Mem</span><b>${memUsed != null ? memUsed + '%' : '—'}</b></div>
        <div class="dh-item"><span class="dh-lbl">Temp</span><b>${esc(tempShow)}</b></div>
        <div class="dh-item"><span class="dh-lbl">Uptime</span><b>${esc(h.uptime || '—')}</b></div>
      ` : '<div class="msg" style="margin:0">Belum ada data. Klik untuk buka lalu sync.</div>'}
    </div>
    ${h && h.version ? `<div class="dash-ver cell-muted">RouterOS ${esc(h.version)}${h.board ? ' &middot; ' + esc(h.board) : ''}</div>` : ''}
    <div class="dash-audit">
      ${audit ? `
        <span class="badge lvl-info">Audit ${esc(AUDIT_KIND_LABEL[audit.type] || audit.type)} &middot; ${fmtTs(audit.at)}</span>
        <span class="badge ${critical > 0 ? 'failed' : 'ok'}">${critical} kritik/tinggi</span>
        ${audit.sev.medium ? `<span class="badge lvl-warn">${audit.sev.medium} sedang</span>` : ''}
        ${audit.sev.low ? `<span class="badge lvl-info">${audit.sev.low} rendah</span>` : ''}
      ` : '<span class="cell-muted">Belum ada audit</span>'}
    </div>
    <div class="dash-foot">
      <span class="cell-muted">Sync: ${c.lastSync ? fmtTs(c.lastSync) : '—'}</span>
      <span class="dash-go">Buka &rarr;</span>
    </div>
  </div>`;
}

/* ============ ROUTER CRUD ============ */
function openRouterForm(existing) {
  const r = existing || {};
  const mask = document.createElement('div');
  mask.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:10';
  mask.innerHTML = `
  <div class="card" style="width:420px;max-width:92vw">
    <h4>${r.id ? 'Edit Router' : 'Tambah Router'}</h4>
    <label>Nama router</label><input id="f-name" value="${esc(r.name || '')}" />
    <label>Nama perusahaan</label><input id="f-company" value="${esc(r.company || '')}" placeholder="PT. Contoh Perusahaan" />
    <label>Host / IP</label><input id="f-host" value="${esc(r.host || '')}" />
    <div class="row">
      <div style="flex:1"><label>API Port</label><input id="f-port" type="number" value="${r.api_port || 8728}" /></div>
      <div style="padding-top:22px"><label style="display:inline">&nbsp;</label> <input type="checkbox" id="f-secure" ${r.secure ? 'checked' : ''} /> <span>API-SSL (8729)</span></div>
    </div>
    <label>Username</label><input id="f-user" value="${esc(r.username || '')}" autocomplete="off" />
    <label>Password${r.id ? ' (kosongkan = tidak diubah)' : ''}</label><input id="f-pass" type="password" autocomplete="new-password" />
    <div id="router-form-msg"></div>
    <div class="row" style="margin-top:10px">
      <button class="primary" id="f-test">Tes Koneksi</button>
      <button id="f-save" disabled>Simpan</button>
      <button id="f-cancel">Batal</button>
      ${r.id ? `<button class="danger" id="f-del" style="margin-left:auto">Hapus</button>` : ''}
    </div>
  </div>`;
  document.body.appendChild(mask);
  mask.querySelector('#f-cancel').onclick = () => mask.remove();
  const secBox = mask.querySelector('#f-secure');
  const portIn = mask.querySelector('#f-port');
  secBox.onchange = () => {
    const cur = Number(portIn.value || 8728);
    if (secBox.checked && (cur === 8728 || !cur)) portIn.value = 8729;
    else if (!secBox.checked && (cur === 8729 || !cur)) portIn.value = 8728;
  };
  const testBtn = mask.querySelector('#f-test');
  const saveBtn = mask.querySelector('#f-save');
  const formData = () => ({
    host: mask.querySelector('#f-host').value.trim(),
    api_port: Number(mask.querySelector('#f-port').value || 8728),
    secure: mask.querySelector('#f-secure').checked,
    username: mask.querySelector('#f-user').value.trim(),
    password: mask.querySelector('#f-pass').value,
  });
  testBtn.onclick = async () => {
    testBtn.disabled = true;
    testBtn.textContent = 'Menguji...';
    showMsg('router-form-msg', 'Menghubungkan ke router...', '');
    try {
      const res = await api('/api/routers/test-preflight', { method: 'POST', body: formData() });
      showMsg('router-form-msg', `Koneksi OK — RouterOS ${esc(res.version)} · board ${esc(res.boardName || '-')}`, 'ok');
      saveBtn.disabled = false;
    } catch (e) {
      showMsg('router-form-msg', `Koneksi gagal: ${esc(e.message)}`, 'err');
      saveBtn.disabled = true;
    }
    testBtn.disabled = false;
    testBtn.textContent = 'Tes Koneksi';
  };
  mask.querySelector('#f-save').onclick = async () => {
    try {
      const body = {
        name: mask.querySelector('#f-name').value.trim(),
        company: mask.querySelector('#f-company').value.trim(),
        host: mask.querySelector('#f-host').value.trim(),
        api_port: Number(mask.querySelector('#f-port').value || 8728),
        secure: mask.querySelector('#f-secure').checked,
        username: mask.querySelector('#f-user').value.trim(),
        password: mask.querySelector('#f-pass').value,
      };
      if (r.id) await api(`/api/routers/${r.id}`, { method: 'PUT', body });
      else await api('/api/routers', { method: 'POST', body });
      mask.remove();
      await refreshRouters();
      if (state.view === 'routers') renderShell();
      else { state.view = 'routers'; renderShell(); }
    } catch (e) { showMsg('router-form-msg', e.message, 'err'); }
  };
  if (r.id) mask.querySelector('#f-del').onclick = async () => {
    if (!await confirmDialog(`Hapus router <b>${esc(r.name)}</b> dan semua data sync/chat?`, { title: 'Hapus Router', okText: 'Hapus', kind: 'danger' })) return;
    await api(`/api/routers/${r.id}`, { method: 'DELETE' });
    mask.remove();
    if (state.router?.id === r.id) state.router = null;
    await refreshRouters();
    renderShell();
  };
}

function openRouter(router) {
  state.view = 'routers';
  state.router = router;
  state.overview = null;
  state.chat = null;
  state.messages = [];
  state.chats = null;
  renderShell();
}

async function loadOverview() {
  state.overviewError = null;
  try {
    state.overview = await api(`/api/routers/${state.router.id}/overview`);
    state.chats = state.overview.chats;
  } catch (e) {
    state.overview = null;
    state.overviewError = e.message || 'router offline';
  }
}

/* ============ ROUTER SIDEBAR ACTIONS ============ */
function showToast(text, opts = {}) {
  if (typeof opts === 'string') opts = { kind: opts };
  const { kind = 'ok', title, action } = opts;
  let wrap = document.getElementById('toast-wrap');
  if (!wrap) { wrap = document.createElement('div'); wrap.id = 'toast-wrap'; document.body.appendChild(wrap); }
  const item = document.createElement('div');
  item.className = 'toast-item ' + kind;
  const close = () => {
    item.classList.add('hide');
    setTimeout(() => item.remove(), 220);
  };
  item.innerHTML = `
    <div class="toast-main">
      ${title ? `<div class="toast-title">${esc(title)}</div>` : ''}
      <div class="toast-text">${esc(text)}</div>
    </div>
    ${action ? `<button class="toast-action" data-act>${esc(action.label)}</button>` : ''}
    <button class="toast-close" data-close title="Tutup">&times;</button>`;
  wrap.appendChild(item);
  if (action) item.querySelector('[data-act]').onclick = () => { close(); action.onClick(); };
  item.querySelector('[data-close]').onclick = close;
  setTimeout(() => { close(); }, 4500);
  requestAnimationFrame(() => item.classList.add('show'));
}

/* in-app dialog (pengganti alert/confirm native) */
function dialog(message, opts = {}) {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.id = 'app-dialog';
    ov.innerHTML = `
      <div class="modal dialog ${opts.kind === 'danger' ? 'dialog-danger' : ''}">
        ${opts.title ? `<div class="modal-head"><h4>${esc(opts.title)}</h4></div>` : ''}
        <div class="modal-body">${message}</div>
        <div class="dialog-actions">
          ${opts.cancel ? `<button data-dlg-cancel>${esc(opts.cancelText || 'Batal')}</button>` : ''}
          <button class="primary" data-dlg-ok>${esc(opts.okText || 'OK')}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    let done = false;
    const onKey = (e) => {
      if (done) return;
      if (e.key === 'Escape') close(opts.cancel ? false : true);
      if (e.key === 'Enter') close(true);
    };
    const close = (val) => {
      if (done) return;
      done = true;
      ov.remove();
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    document.addEventListener('keydown', onKey);
    ov.querySelector('[data-dlg-ok]').onclick = () => close(true);
    const cancelBtn = ov.querySelector('[data-dlg-cancel]');
    if (cancelBtn) cancelBtn.onclick = () => close(false);
    ov.addEventListener('click', (e) => { if (e.target === ov && opts.cancel) close(false); });
  });
}
function confirmDialog(message, opts = {}) {
  return dialog(message, { ...opts, cancel: true, okText: opts.okText || 'OK', cancelText: opts.cancelText || 'Batal' });
}
function alertDialog(message, opts = {}) {
  return dialog(message, { ...opts, cancel: false, okText: opts.okText || 'OK' });
}
function closeAllMenus() {
  document.querySelectorAll('.r-menu.open').forEach((m) => m.classList.remove('open'));
}
async function routerAction(id, action) {
  const r = state.routers.find((x) => x.id === id);
  try {
    if (action === 'test') {
      const res = await api(`/api/routers/${id}/test`, { method: 'POST' });
      showToast(`Terhubung: versi ${res.version} · board ${res.boardName} · uptime ${res.uptime}`, {
        kind: 'ok', title: 'Koneksi Berhasil',
        action: { label: 'Buka Router', onClick: () => openRouter(r) },
      });
    } else if (action === 'sync') {
      const res = await api(`/api/routers/${id}/sync`, { method: 'POST' });
      showToast(`Sync selesai: ${res.okCount} sukses · ${res.failedCount} gagal · ${res.unsupportedCount} tidak didukung`, {
        kind: 'ok', title: 'Sinkronisasi Selesai',
        action: { label: 'Buka Router', onClick: () => openRouter(r) },
      });
    } else if (action === 'edit') {
      openRouterForm(r);
      return;
    } else if (action === 'del') {
      if (!await confirmDialog(`Hapus router <b>${esc(r?.name || id)}</b> beserta semua data sync, chat, dan riwayat audit?`, { title: 'Hapus Router', okText: 'Hapus', kind: 'danger' })) return;
      await api(`/api/routers/${id}`, { method: 'DELETE' });
      if (state.router?.id === id) { state.router = null; state.chat = null; state.messages = []; auditPage = 0; }
      await refreshRouters();
      renderShell();
      return;
    }
    await refreshRouters();
    if (state.view === 'routers' && state.router && state.router.id === id) await reloadAfterSync();
    else renderShell();
  } catch (e) {
    showToast(e.message || 'Gagal menjalankan aksi', { kind: 'err', title: 'Terjadi Kesalahan' });
  }
}

/* ============ ROUTER DETAIL ============ */
let routerTab = 'status';
function renderRouter() {
  const r = state.router;
  document.getElementById('content').innerHTML = `
    <div class="router-toolbar">
      <div class="rt-info">
        ${r.company ? `<span class="rt-company">${esc(r.company)}</span>` : ''}
        <span class="rt-name">${esc(r.name)}</span>
        <span class="badge ${r.connection_status}">${r.connection_status}</span>
      </div>
      <div class="tabbar">
        ${[['status', '📊', 'Status & Data'], ['chat', '💬', 'Chat'], ['audit', '📋', 'Audit']]
          .map(([tab, icon, label]) => `<button class="tab-item ${routerTab === tab ? 'active' : ''}" data-tab="${tab}" title="${label}"><span class="tab-ico">${icon}</span></button>`).join('')}
      </div>
    </div>
    <div id="tab-body"></div>`;

  document.querySelectorAll('[data-tab]').forEach((b) => {
    b.onclick = () => { routerTab = b.dataset.tab; renderRouter(); };
  });
  renderTab();
}

async function reloadAfterSync() {
  if (routerTab === 'status') await loadOverview();
  renderRouter();
}

async function renderTab() {
  const body = document.getElementById('tab-body');
  if (routerTab === 'status') await renderStatusTab(body);
  else if (routerTab === 'chat') await renderChatTab(body);
  else if (routerTab === 'audit') await renderAuditTab(body);
}

function setupCollapse(scope) {
  scope.querySelectorAll('.collapse-head').forEach((h) => {
    h.onclick = () => {
      const body = h.nextElementSibling;
      const chev = h.querySelector('.collapse-chevron');
      if (body) body.classList.toggle('collapsed');
      if (chev) chev.textContent = body && body.classList.contains('collapsed') ? '▸' : '▾';
    };
  });
}

async function renderStatusTab(body) {
  if (!state.overview) await loadOverview();
  if (!state.overview || state.overviewError) {
    body.innerHTML = `
    <div class="card">
      <div class="card-title">
        <h4>Status &amp; Data Router</h4>
        <span class="status-pill unknown"><span class="dot"></span>OFFLINE</span>
      </div>
      <p style="color:var(--muted)">Router <b>tidak dapat dihubungi</b>. Data di atas mungkin usang atau belum ada. Silakan <b>Tes Koneksi</b> atau <b>Sync</b> dari menu router untuk memperbarui.</p>
      <div class="row" style="margin-top:10px">
        <button class="primary" onclick="routerAction('${esc(state.router?.id)}','test')">Tes Koneksi</button>
        <button onclick="routerAction('${esc(state.router?.id)}','sync')">Sync Sekarang</button>
      </div>
    </div>`;
    return;
  }
  const ov = state.overview;
  const fresh = ov.context.available && !ov.context.stale;
  const sum = ov.context.summary || [];
  const okCount = sum.filter((s) => s.status === 'ok' || s.status === 'success').length;
  const pct = sum.length ? Math.round((okCount / sum.length) * 100) : 0;
  body.innerHTML = `
  <div class="card">
    <div class="card-title">
      <h4>Status &amp; Data Router</h4>
      <span class="status-pill ${ov.context.available ? (fresh ? 'ok' : 'stale') : 'unknown'}"><span class="dot"></span>${ov.context.available ? (fresh ? 'DATA SEGAR' : 'DATA STALE') : 'BELUM ADA DATA'}</span>
    </div>
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-ico ico-company">🏢</div>
        <div class="stat-meta">
          <span class="stat-label">Perusahaan</span>
          <span class="stat-value">${esc(ov.router.company || '-')}</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-ico ico-host">🌐</div>
        <div class="stat-meta">
          <span class="stat-label">Host</span>
          <span class="stat-value">${esc(ov.router.host)}:${ov.router.api_port}${ov.router.secure ? ' <span class="badge lvl-info">SSL</span>' : ''}</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-ico ico-sync">🕒</div>
        <div class="stat-meta">
          <span class="stat-label">Terakhir Sinkron</span>
          <span class="stat-value">${ov.context.syncedAt ? esc(fmtTs(ov.context.syncedAt)) : 'belum pernah'} ${ov.context.stale ? '<span class="badge stale">STALE</span>' : ''}</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-ico ico-data">📦</div>
        <div class="stat-meta">
          <span class="stat-label">Resource Tersinkron</span>
          <span class="stat-value">${sum.length ? `<span class="ok-count">${okCount}</span><span class="muted-count"> / ${sum.length}</span>` : '—'}</span>
        </div>
      </div>
    </div>
    ${sum.length ? `<div class="sync-bar-row">
      <span class="sync-bar-label">Kesehatan data</span>
      <div class="sync-bar"><div class="sync-bar-fill ${pct >= 70 ? 'ok' : pct >= 40 ? 'warn' : 'bad'}" style="width:${pct}%"></div></div>
      <span class="sync-bar-num ${pct >= 70 ? 'ok' : pct >= 40 ? 'warn' : 'bad'}">${pct}%</span>
    </div>` : ''}
    ${ov.router.last_error ? `<div class="msg err"><b>Error koneksi terakhir:</b> ${esc(ov.router.last_error)}</div>` : ''}
    ${!ov.router.hasPassword ? `<div class="msg err"><b>Password router belum tersimpan.</b> Klik <b>Edit</b> lalu isi ulang password API router, dan periksa konfigurasi <b>Port/SSL</b>.</div>` : ''}
    ${ov.router.secure && ov.router.api_port === 8728 ? `<div class="msg err"><b>Konfigurasi Port/SSL tidak cocok.</b> Centang "API-SSL" berarti port harus <b>8729</b>, bukan 8728. Edit router untuk memperbaiki.</div>` : ''}
    ${!ov.context.available ? `<div class="msg err">Belum ada data tersync. Klik <b>Sync Data</b> untuk mengumpulkan konfigurasi via RouterOS API (read-only).</div>` : ''}
  </div>
  <div class="card">
    <button class="collapse-head">
      <div class="card-title" style="margin:0">
        <h4>Koleksi data per resource</h4>
        ${sum.length ? `<span class="badge lvl-info">${sum.length} resource</span>` : ''}
      </div>
      <span class="collapse-chevron">▸</span>
    </button>
    <div class="collapse-body collapsed">
      ${sum.length ? `<div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Resource</th><th>Status</th><th>Records</th><th>Keterangan</th></tr></thead>
        <tbody>
        ${sum.map((s) => `
          <tr>
            <td><code>${esc(s.resource)}</code></td>
            <td><span class="badge ${s.status}">${s.status}</span></td>
            <td>${s.count}</td>
            <td class="cell-muted">${s.error ? esc(s.error.slice(0, 120)) : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : '<div class="empty">Belum ada resource yang dikumpulkan</div>'}
    </div>
  </div>`;
  setupCollapse(body);
}

/* ============ CHAT (single-thread, tanpa panel) ============ */
let resList = [];
let mentionMatches = [];
let mentionIndex = -1;

function updateMentionMenu() {
  const pop = document.getElementById('mention-pop');
  const ta = document.getElementById('chat-text');
  if (!pop || !ta) return;
  const before = ta.value.slice(0, ta.selectionStart);
  const m = /(?:^|\s)@([\w\/.\-]*)$/.exec(before);
  if (!m) { hideMention(); return; }
  const q = m[1].toLowerCase();
  const matches = resList.filter((r) => r.toLowerCase().includes(q));
  if (!matches.length) { hideMention(); return; }
  mentionMatches = matches;
  mentionIndex = 0;
  pop.style.display = 'block';
  pop.innerHTML = mentionMatches.map((r) => `<div class="mention-item" data-res="${esc(r)}">@${esc(r)}</div>`).join('');
  pop.querySelectorAll('.mention-item').forEach((el, i) => {
    el.onmousedown = (e) => { e.preventDefault(); selectMention(mentionMatches[i]); };
    el.onmouseover = () => { mentionIndex = i; highlightMention(); };
  });
  highlightMention();
}

function highlightMention() {
  const pop = document.getElementById('mention-pop');
  if (!pop) return;
  pop.querySelectorAll('.mention-item').forEach((el, i) => el.classList.toggle('sel', i === mentionIndex));
  const sel = pop.querySelector('.mention-item.sel');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function selectMention(res) {
  const ta = document.getElementById('chat-text');
  if (!ta) return;
  const before = ta.value.slice(0, ta.selectionStart);
  const after = ta.value.slice(ta.selectionEnd);
  const idx = before.lastIndexOf('@');
  const prefix = before.slice(0, idx);
  ta.value = prefix + '@' + res + ' ' + after;
  hideMention();
  ta.focus();
  const pos = (prefix + '@' + res).length + 1;
  ta.setSelectionRange(pos, pos);
}

function hideMention() {
  const pop = document.getElementById('mention-pop');
  if (pop) pop.style.display = 'none';
  mentionMatches = [];
  mentionIndex = -1;
}

function renderWelcome(body) {
  const msgs = document.getElementById('msgs');
  if (!msgs) return;
  msgs.innerHTML = `
    <div class="chat-welcome">
      <div class="chat-welcome-icon">💬</div>
      <h3>Mulai percakapan</h3>
      <p>Ajukan pertanyaan tentang router ini. AI menganalisis data yang sudah disinkronkan dan menjawab secara konsultatif.</p>
      <ul>
        <li>Analisa konfigurasi &amp; kondisi router secara keseluruhan</li>
        <li>Audit keamanan &amp; rekomendasi perbaikan</li>
        <li>Cek kesehatan (resource, interface, firewall, dhcp, dll)</li>
        <li>Troubleshoot masalah jaringan</li>
        <li>Minta contoh script RouterOS (read-only, tidak dieksekusi)</li>
      </ul>
      <div class="chat-welcome-actions">
        <button class="chip" data-prompt="Analisa konfigurasi router ini secara keseluruhan, jelaskan kondisinya, dan berikan rekomendasi.">Analisa konfigurasi</button>
        <button class="chip" data-prompt="Lakukan audit keamanan router ini dan berikan rekomendasi perbaikannya.">Audit keamanan</button>
        <button class="chip" data-prompt="Cek kesehatan router ini berdasarkan data tersinkronisasi dan beri tahu masalah yang ditemukan.">Cek kesehatan</button>
        <button class="chip" data-prompt="Identifikasi potensi masalah pada router ini dan berikan langkah troubleshooting.">Troubleshoot</button>
      </div>
    </div>`;
  msgs.querySelectorAll('[data-prompt]').forEach((c) => {
    c.onclick = () => {
      const ta = document.getElementById('chat-text');
      if (ta) { ta.value = c.dataset.prompt; ta.focus(); }
    };
  });
}

async function renderChatTab(body) {
  // Load chat list (persistent from DB).
  let chatList = [];
  try {
    chatList = await api(`/api/routers/${state.router.id}/chats`);
  } catch { chatList = []; }

  body.innerHTML = `
    <div class="chat-panel card">
      <div class="chat-header">
        <span class="chat-header-title">Chat Router</span>
        <div class="chat-header-actions">
          <button class="chat-new-btn" id="chat-new-btn">Chat baru</button>
          <button class="chat-del-all-btn" id="chat-del-all-btn" title="Hapus semua chat">Hapus semua</button>
        </div>
      </div>
      <div class="msgs" id="msgs"></div>
      <div class="chat-input">
        <textarea id="chat-text" placeholder="Tanya tentang router ini... (analisa, audit, troubleshoot, atau minta script RouterOS)"></textarea>
        <button class="primary" id="send-btn">Kirim</button>
        <div class="mention-pop" id="mention-pop"></div>
      </div>
    </div>`;

  (async () => {
    try {
      const ov = await api(`/api/routers/${state.router.id}/overview`);
      const sum = (ov.context && ov.context.summary) || [];
      resList = sum.map((s) => s.resource).filter(Boolean);
    } catch { resList = []; }
  })();

  const newBtn = document.getElementById('chat-new-btn');
  if (newBtn) {
    newBtn.onclick = async () => {
      if (!state.chat) return;
      try {
        await api(`/api/chats/${state.chat.id}/messages`, { method: 'DELETE' });
      } catch {}
      state.messages = [];
      renderMessages([]);
      renderWelcome(body);
      const ta = document.getElementById('chat-text');
      if (ta) ta.focus();
    };
  }

  const delAllBtn = document.getElementById('chat-del-all-btn');
  if (delAllBtn) {
    delAllBtn.onclick = async () => {
      if (!await confirmDialog('Hapus SEMUA chat untuk router ini? Riwayat percakapan akan dihapus permanen dan tidak dapat dikembalikan.', { title: 'Hapus Semua Chat', okText: 'Hapus Semua', kind: 'danger' })) return;
      try {
        await api(`/api/routers/${state.router.id}/chats`, { method: 'DELETE' });
      } catch (e) {
        await alertDialog('Gagal menghapus chat: ' + esc(e.message || ''), { title: 'Terjadi Kesalahan' });
        return;
      }
      state.chat = null;
      state.messages = [];
      renderMessages([]);
      renderWelcome(body);
      const ta = document.getElementById('chat-text');
      if (ta) ta.focus();
    };
  }

  // Single-thread: paksa ambil/muat satu chat milik router dari DB, tiap render ulang.
  let chat;
  try {
    chat = chatList.find((c) => c.id === state.chat?.id) || chatList[0] || null;
    if (!chat) {
      chat = await api(`/api/routers/${state.router.id}/chats`, { method: 'POST', body: { title: 'Chat router' } } );
    }
  } catch {
    chat = null;
  }
  state.chat = chat;
  if (chat) {
    await loadChatMessages(chat.id);
  } else {
    renderMessages([]);
  }
  if (!state.messages || state.messages.length === 0) {
    renderWelcome(body);
  }

  const send = async () => {
    if (send.busy) return;
    const ta = document.getElementById('chat-text');
    const msg = ta.value.trim();
    if (!msg) return;
    ta.value = '';
    send.busy = true;
    const msgsBox = document.getElementById('msgs');
    if (msgsBox && msgsBox.querySelector('.chat-welcome')) msgsBox.innerHTML = '';
    if (!state.chat) {
      state.chat = await api(`/api/routers/${state.router.id}/chats`, { method: 'POST', body: { title: msg.slice(0, 60) } });
      state.messages = [];
    }
    appendBubble('user', msg);
    const sb = appendBubble('assistant', '', true);
    sb.msgEl.innerHTML = '<span class="chat-typing"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>';
    const url = `/api/routers/${state.router.id}/chat`;
    const payload = { message: msg, chatId: state.chat ? state.chat.id : null };
    try {
      await postStream(url, payload, (delta) => {
        sb.received = true;
        sb.msgEl.innerHTML = renderMd(sb.buffer += delta);
      });
      sb.msgEl.innerHTML = renderMd(sb.buffer);
      try {
        const data = await api(`/api/chats/${state.chat.id}`);
        state.messages = data.messages;
        const last = [...data.messages].reverse().find((m) => m.role === 'assistant');
        if (last) {
          sb.buffer = last.content;
          sb.msgEl.innerHTML = renderMd(last.content);
        }
      } catch {}
    } catch (e) {
      sb.msgEl.innerHTML = `<span style="color:var(--red)">${esc(e.message || 'gagal')}</span>`;
    } finally {
      send.busy = false;
      ta.focus();
    }
  };
  document.getElementById('send-btn').onclick = send;
  const ta = document.getElementById('chat-text');
  ta.addEventListener('input', updateMentionMenu);
  ta.addEventListener('keydown', (e) => {
    if (mentionMatches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); mentionIndex = (mentionIndex + 1) % mentionMatches.length; highlightMention(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); mentionIndex = (mentionIndex - 1 + mentionMatches.length) % mentionMatches.length; highlightMention(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectMention(mentionMatches[mentionIndex]); return; }
      if (e.key === 'Escape') { e.preventDefault(); hideMention(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
}

function appendBubble(role, content, streamRef) {
  const wrap = document.createElement('div');
  wrap.className = `bubble ${role}`;
  const msgEl = document.createElement('div');
  msgEl.className = 'md';
  msgEl.innerHTML = renderMd(content);
  wrap.appendChild(msgEl);
  document.getElementById('msgs').appendChild(wrap);
  document.getElementById('msgs').scrollTop = document.getElementById('msgs').scrollHeight;
  if (streamRef) return { msgEl, buffer: '', wrap };
}

function renderMessages(list) {
  const msgs = document.getElementById('msgs');
  if (!msgs) return;
  msgs.innerHTML = '';
  for (const m of list) {
    appendBubble(m.role === 'user' ? 'user' : 'assistant', m.content);
  }
  msgs.scrollTop = msgs.scrollHeight;
}

async function loadChatMessages(id, scroll = true) {
  const data = await api(`/api/chats/${id}`);
  state.chat = { ...state.chat, ...data }; // keep ids in sync
  state.messages = data.messages;
  const msgs = document.getElementById('msgs');
  if (msgs) { renderMessages(state.messages); if (scroll) msgs.scrollTop = msgs.scrollHeight; }
}

async function postStream(url, body, onDelta, onStatus) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `HTTP ${res.status}`);
  }
  if (!res.body) throw new Error('response tanpa body');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let event = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      event = null;
      let data = null;
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data = line.slice(5).trim();
      }
      if (!data) continue;
      const obj = JSON.parse(data);
      if (event === 'delta') onDelta(obj.delta || '');
      else if (event === 'error') throw new Error(obj.error || 'LLM request gagal');
      else if (event === 'status' && onStatus) onStatus(obj.step, obj.label);
    }
  }
}

/* ============ AUDIT ============ */
const AUDIT_KINDS = [
  { kind: 'audit-config', label: 'Audit Konfigurasi', icon: '🛡️', desc: 'Postur konfigurasi umum: firewall, routing, DHCP/DNS, auth, resources' },
  { kind: 'audit-security', label: 'Audit Keamanan', icon: '🔐', desc: 'Keamanan konfigurasi: akun, service exposure (winbox/telnet/ssh/api), brute-force, default creds' },
  { kind: 'audit-network', label: 'Audit Keamanan Jaringan', icon: '🌍', desc: 'Keamanan jaringan: eksposur WAN, NAT forwarding, segmentasi/VLAN, exposure service ke publik' },
];
const AUDIT_KIND_LABEL = { 'audit-config': 'Konfigurasi', 'audit-security': 'Keamanan', 'audit-network': 'Keamanan Jaringan' };

let auditPage = 0;
const AUDIT_PAGE_SIZE = 10;

async function renderAuditTab(body) {
  const data = await api(`/api/routers/${state.router.id}/audits?limit=${AUDIT_PAGE_SIZE}&offset=${auditPage * AUDIT_PAGE_SIZE}`);
  const audits = data.rows;
  const total = data.total;
  const totalPages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  body.innerHTML = `
  <div class="card">
    <div class="card-title">
      <div>
        <h4 style="margin:0">Audit Konfigurasi &amp; Keamanan</h4>
        <p class="card-sub">Pilih jenis audit. AI menganalisis data tersinkronisasi dan menghasilkan laporan dengan rekomendasi.</p>
      </div>
      <span class="badge lvl-info">read-only</span>
    </div>
    <div class="audit-type-row">
      ${AUDIT_KINDS.map((a) => `
        <button class="audit-type-btn" data-audit="${a.kind}">
          <span class="audit-ico">${a.icon}</span>
          <span class="audit-txt">
            <b>${a.label}</b>
            <small>${a.desc}</small>
          </span>
          <span class="audit-go">→</span>
        </button>`).join('')}
    </div>
    <div class="msg" id="audit-suggest" style="color:var(--muted)">Pilih jenis audit di atas. Pastikan data sudah disync dan segar.</div>
    <div id="audit-run" style="display:none;margin-bottom:14px">
      <div class="msg" id="audit-status">Menyiapkan audit...</div>
      <div class="progress"><div class="progress-bar" id="audit-progress"></div></div>
      <div id="audit-pdf-preview"></div>
    </div>
  </div>
  <div class="card">
    <div class="card-title">
      <h4>Riwayat Audit</h4>
      <span class="badge lvl-info">${total} hasil</span>
    </div>
    ${audits.length ? `<div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Waktu</th><th>Jenis</th><th>Status</th><th class="col-actions">Aksi</th></tr></thead>
        <tbody>
        ${audits.map((a) => `<tr>
          <td class="cell-muted">${fmtTs(a.created_at)}</td>
          <td>${esc(AUDIT_KIND_LABEL[a.audit_type] || a.audit_type)}</td>
          <td><span class="badge ${a.ok ? 'ok' : 'failed'}">${a.ok ? 'Berhasil' : 'Gagal'}</span></td>
          <td class="col-actions">
            <button class="btn-sm" data-audit-view="${a.id}" ${a.ok ? '' : 'disabled'}>Lihat</button>
            <button class="btn-sm" data-audit-pdf="${a.id}" ${a.ok ? '' : 'disabled'}>PDF</button>
            <button class="btn-sm danger" data-audit-del="${a.id}">Hapus</button>
          </td>
        </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="pager">
      <span class="cell-muted">Hal ${auditPage + 1} dari ${totalPages}</span>
      <div class="pager-btns">
        <button class="btn-sm" id="audit-prev" ${auditPage === 0 ? 'disabled' : ''}>‹ Sebelumnya</button>
        <button class="btn-sm" id="audit-next" ${auditPage >= totalPages - 1 ? 'disabled' : ''}>Berikutnya ›</button>
      </div>
    </div>`
    : '<div class="empty">Belum ada audit. Pilih jenis audit di atas untuk memulai.</div>'}
  </div>`;
  body.querySelectorAll('[data-audit]').forEach((b) => {
    b.onclick = () => runAudit(b.dataset.audit);
  });
  body.querySelectorAll('[data-audit-pdf]').forEach((b) => {
    b.onclick = () => previewAuditPdf(b.dataset.auditPdf);
  });
  body.querySelectorAll('[data-audit-view]').forEach((b) => {
    b.onclick = () => openAuditView(b.dataset.auditView);
  });
  body.querySelectorAll('[data-audit-del]').forEach((b) => {
    b.onclick = async () => {
      if (!await confirmDialog('Hapus hasil audit ini?', { title: 'Hapus Audit', okText: 'Hapus', kind: 'danger' })) return;
      await api(`/api/audits/${b.dataset.auditDel}`, { method: 'DELETE' });
      if (auditPage > 0 && (total - 1) <= auditPage * AUDIT_PAGE_SIZE) auditPage--;
      renderAuditTab(document.getElementById('tab-body'));
    };
  });
  const prevBtn = document.getElementById('audit-prev');
  const nextBtn = document.getElementById('audit-next');
  if (prevBtn) prevBtn.onclick = () => { auditPage--; renderAuditTab(document.getElementById('tab-body')); };
  if (nextBtn) nextBtn.onclick = () => { auditPage++; renderAuditTab(document.getElementById('tab-body')); };
}

async function runAudit(kind) {
  const runEl = document.getElementById('audit-run');
  const statusEl = document.getElementById('audit-status');
  const barEl = document.getElementById('audit-progress');
  const prevEl = document.getElementById('audit-pdf-preview');
  const label = AUDIT_KINDS.find((a) => a.kind === kind)?.label;
  const setStatus = (t, p) => {
    if (statusEl) statusEl.innerHTML = t;
    if (barEl) barEl.style.width = Math.max(0, Math.min(100, p)) + '%';
  };
  runEl.style.display = '';
  if (prevEl) prevEl.innerHTML = '';
  setStatus(`Menjalankan <b>${esc(label)}</b> — mengumpulkan konteks router...`, 15);
  let deltas = 0;
  try {
    await postStream(
      `/api/routers/${state.router.id}/audit`,
      { kind },
      () => {
        deltas++;
        setStatus('AI sedang menganalisis data dan menulis laporan...', Math.min(50 + deltas / 8, 90));
      },
      (step) => {
        if (step === 'context') setStatus('Mengumpulkan konteks router...', 20);
        else if (step === 'streaming') setStatus('AI sedang menganalisis data & menulis laporan...', 50);
        else if (step === 'saved') setStatus('Laporan tersimpan — menyiapkan pratinjau PDF...', 95);
      }
    );
    setStatus('Audit selesai.', 100);
    auditPage = 0;
    await renderAuditTab(document.getElementById('tab-body'));
    const statusEl2 = document.getElementById('audit-status');
    const prevEl2 = document.getElementById('audit-pdf-preview');
    const barEl2 = document.getElementById('audit-progress');
    const runEl2 = document.getElementById('audit-run');
    if (runEl2) runEl2.style.display = '';
    if (statusEl2) statusEl2.innerHTML = 'Audit selesai.';
    if (barEl2) barEl2.style.width = '100%';
    const data = await api(`/api/routers/${state.router.id}/audits?limit=1&offset=0`);
    const newest = data.rows.find((r) => r.ok);
    if (newest && prevEl2) {
      await showAuditPdfPreview(prevEl2, newest.id);
    } else if (statusEl2) {
      statusEl2.innerHTML = '<span style="color:var(--red)">Audit selesai tetapi laporan kosong/gagal.</span>';
    }
  } catch (e) {
    setStatus(`<span style="color:var(--red)">${esc(e.message || 'audit gagal')}</span>`, 100);
  }
}

async function showAuditPdfPreview(container, id) {
  try {
    const a = await api(`/api/audits/${id}`);
    if (!a.ok) throw new Error('Audit gagal — laporan tidak tersedia.');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    markdownToPdf(doc, a.result || '', {
      routerName: a.router_name,
      routerCompany: a.router_company,
      auditTypeLabel: AUDIT_KIND_LABEL[a.audit_type] || a.audit_type,
    });
    const url = URL.createObjectURL(doc.output('blob'));
    container.innerHTML = `
      <div class="audit-preview-head">
        <b>Pratinjau Laporan PDF</b>
        <button class="btn-sm" data-preview-open>Buka di Tab</button>
      </div>
      <iframe class="audit-pdf-frame" src="${url}" title="Pratinjau laporan audit"></iframe>`;
    container.querySelector('[data-preview-open]').onclick = () => window.open(url, '_blank');
  } catch (e) {
    container.innerHTML = `<div class="msg" style="color:var(--red)">Gagal menyiapkan PDF: ${esc(e.message || '')}</div>`;
  }
}

function cleanInline(s) {
  return s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
}

const SEV_LABEL = { HIGH: 'TINGGI', MEDIUM: 'SEDANG', LOW: 'RENDAH', CRITICAL: 'KRITIS', INFO: 'INFO' };

function markdownToPdf(doc, text, { routerName, routerCompany, auditTypeLabel }) {
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const M = 15;
  const WM = PW - M * 2;
  const INK = [25, 25, 25];
  const GRAY = [105, 105, 105];
  const LIGHT = [242, 242, 242];
  const BORDER = [150, 150, 150];
  const lineH = 5.2;
  const footerY = PH - 9;
  let y = 0;

  const addPage = () => { doc.addPage(); y = M; };
  const ensure = (h) => { if (y + h > footerY - 4) addPage(); };
  const ink = () => doc.setTextColor(INK[0], INK[1], INK[2]);
  const gray = () => doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]);
  const rule = (x1, y1, x2, w) => { doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]); doc.setLineWidth(w); doc.line(x1, y1, x2, y1); };

  const CORE = String(text).replace(/\n*---\nCatatan:[\s\S]*$/g, '').trim();

  // ---------- header ----------
  y = M;
  ink();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('LAPORAN AUDIT', M, M);
  doc.setFontSize(13);
  doc.text(auditTypeLabel.toUpperCase(), M, M + 8);
  rule(M, M + 12.5, PW - M, 0.6);
  y = M + 19;

  // ---------- metadata ----------
  doc.setFontSize(9.5);
  const meta = [
    ['Perusahaan', routerCompany || '-'],
    ['Router', routerName || '-'],
    ['Jenis Audit', auditTypeLabel],
    ['Tanggal Laporan', fmtTs(Date.now())],
    ['Status', 'Read-only · konsultatif'],
  ];
  for (const [label, value] of meta) {
    doc.setFont('helvetica', 'bold'); ink();
    doc.text(label.toUpperCase(), M + 2, y);
    doc.setFont('helvetica', 'normal');
    const vw = doc.splitTextToSize(String(value), WM - 66);
    doc.text(vw, M + 46, y);
    y += vw.length * lineH + 1.5;
  }
  y += 3;
  rule(M, y, PW - M, 0.3);
  y += 9;

  // ---------- body ----------
  if (!CORE) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    gray();
    doc.text('Tidak ada isi laporan yang dihasilkan untuk audit ini.', M, y);
    doc.text('Jalankan ulang audit dari aplikasi untuk mendapatkan hasil.', M, y + 6);
    finishFooter();
    return;
  }

  const section = (title) => {
    ensure(16);
    ink();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.text(title.toUpperCase(), M, y);
    y += 5.5;
    rule(M, y - 2, M + 26, 0.3);
    y += 5.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
  };

  const paragraph = (line) => {
    const w = doc.splitTextToSize(line, WM);
    ensure(w.length * lineH + 2);
    ink();
    doc.text(w, M, y);
    y += w.length * lineH + 2;
  };

  const bullet = (num, content) => {
    const w = doc.splitTextToSize(content, WM - 12);
    ensure(w.length * lineH + 2);
    ink();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(num ? `${num}.` : '–', M + 2, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(w, M + 9, y);
    y += w.length * lineH + 2;
  };

  const quote = (content) => {
    const w = doc.splitTextToSize(content, WM - 8);
    ensure(w.length * lineH + 2);
    gray();
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.text(w, M + 7, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    ink();
    y += w.length * lineH + 2;
  };

  const findingRows = [];
  const flushFindings = () => {
    if (!findingRows.length) return;
    ensure(8);
    doc.autoTable({
      startY: y,
      theme: 'grid',
      margin: { left: M, right: M },
      head: [['Temuan', 'Severity']],
      body: findingRows,
      styles: { fontSize: 9, cellPadding: 3.5, textColor: INK, valign: 'top', lineColor: BORDER, lineWidth: 0.3 },
      headStyles: { fillColor: LIGHT, textColor: INK, fontStyle: 'bold', lineColor: BORDER, lineWidth: 0.3 },
      columnStyles: { 0: { cellWidth: WM - 28 }, 1: { cellWidth: 22, halign: 'center', fontStyle: 'bold' } },
      didParseCell: (d) => {
        if (d.section === 'body' && d.column.index === 1) {
          const v = String(d.cell.raw);
          d.cell.text = [[SEV_LABEL[v] || v]];
        }
      },
    });
    y = doc.lastAutoTable.finalY + 8;
    findingRows.length = 0;
  };

  const tableLines = [];
  const flushTable = () => {
    if (!tableLines.length) return;
    const cells = (r) => r.replace(/^\s*\||\|\s*$/g, '').split('|').map((c) => c.trim());
    const head = cells(tableLines[0]);
    const body = tableLines.length > 1 && cells(tableLines[1]).every((c) => /^:?-+:?$/.test(c))
      ? tableLines.slice(2).map(cells)
      : tableLines.slice(1).map(cells);
    ensure(8);
    doc.autoTable({
      startY: y,
      theme: 'grid',
      margin: { left: M, right: M },
      head: [head],
      body,
      styles: { fontSize: 8.5, cellPadding: 3, textColor: INK, lineColor: BORDER, lineWidth: 0.3 },
      headStyles: { fillColor: LIGHT, textColor: INK, fontStyle: 'bold', lineColor: BORDER, lineWidth: 0.3 },
    });
    y = doc.lastAutoTable.finalY + 8;
    tableLines.length = 0;
  };

  const codeLines = [];
  const flushCode = () => {
    if (!codeLines.length) return;
    const h = codeLines.length * 4.4 + 8;
    ensure(h + 8);
    doc.setFillColor(LIGHT[0], LIGHT[1], LIGHT[2]);
    doc.roundedRect(M, y - 3.5, WM, h, 1, 1, 'F');
    doc.setFont('courier', 'normal');
    doc.setFontSize(8.2);
    ink();
    codeLines.forEach((cl, k) => doc.text(cl || ' ', M + 4, y + k * 4.4));
    y += h + 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    codeLines.length = 0;
  };

  const lines = String(text).split('\n');
  let inCode = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      flushFindings(); flushTable();
      if (inCode) flushCode();
      inCode = !inCode;
      i++;
      continue;
    }
    if (inCode) {
      codeLines.push(...doc.splitTextToSize(cleanInline(line) || ' ', WM - 8));
      i++;
      continue;
    }
    const sec = /^#{2,3} (.+)$/.exec(line);
    if (sec) {
      flushFindings(); flushTable();
      section(sec[1]);
      i++;
      continue;
    }
    const num = /^(\d+)[.)]\s+(.+)$/.exec(line);
    if (num && num[2].trim()) {
      flushFindings(); flushTable();
      bullet(num[1], cleanInline(num[2]));
      i++;
      continue;
    }
    const b = /^[-+•▪●]\s+(.+)$/.exec(line);
    if (b && b[1].trim()) {
      const content = b[1];
      const sev = /^(?:\*\*)?\[?(HIGH|MEDIUM|LOW|CRITICAL|INFO)\]?(?:\*\*)?\s*[:.\-–—]*\s*(.*)$/i.exec(content);
      if (sev && sev[2]) {
        flushTable();
        findingRows.push([cleanInline(sev[2]), sev[1].toUpperCase()]);
        i++;
        continue;
      }
      flushFindings(); flushTable();
      bullet(null, cleanInline(content));
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushFindings();
      tableLines.push(line);
      i++;
      continue;
    }
    if (line === '---' || /^\s*$/.test(line)) {
      flushFindings(); flushTable();
      y += line === '---' ? 6 : 3;
      i++;
      continue;
    }
    const q = /^>\s?(.+)$/.exec(line);
    if (q && q[1].trim()) {
      flushFindings(); flushTable();
      quote(cleanInline(q[1]));
      i++;
      continue;
    }
    flushFindings(); flushTable();
    paragraph(cleanInline(line));
    i++;
  }
  flushFindings(); flushTable(); flushCode();

  finishFooter();

  function finishFooter() {
    const pages = doc.getNumberOfPages();
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    gray();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      rule(M, footerY + 3, PW - M, 0.3);
      doc.text(routerCompany ? `${routerCompany} · ${routerName}` : (routerName || ''), M, footerY + 7.5, { align: 'left' });
      doc.text(`Halaman ${p} dari ${pages}`, PW - M, footerY + 7.5, { align: 'right' });
    }
  }
}

async function previewAuditPdf(id) {
  try {
    const a = await api(`/api/audits/${id}`);
    if (!a.ok) throw new Error('Audit gagal — laporan tidak tersedia.');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    markdownToPdf(doc, a.result || '', {
      routerName: a.router_name,
      routerCompany: a.router_company,
      auditTypeLabel: AUDIT_KIND_LABEL[a.audit_type] || a.audit_type,
    });
    const url = URL.createObjectURL(doc.output('blob'));
    const win = window.open(url, '_blank');
    if (!win) {
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
  } catch (e) {
    await alertDialog('Gagal generate PDF: ' + esc(e.message || ''), { title: 'Terjadi Kesalahan' });
  }
}

/* ============ AUDIT MODAL ============ */
let auditModalKey = null;

function closeAuditModal() {
  const m = document.getElementById('audit-modal');
  if (m) m.remove();
  if (auditModalKey) { document.removeEventListener('keydown', auditModalKey); auditModalKey = null; }
}

async function openAuditView(id) {
  try {
    const a = await api(`/api/audits/${id}`);
    closeAuditModal();
    const ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.id = 'audit-modal';
    ov.innerHTML = `
      <div class="modal">
        <div class="modal-head">
          <div>
            <h4>${esc(AUDIT_KIND_LABEL[a.audit_type] || a.audit_type)}</h4>
            <p class="card-sub">${esc(a.router_company || '—')} · ${esc(a.router_name || '—')} · ${fmtTs(a.created_at)}</p>
          </div>
          <div class="modal-actions">
            <button class="btn-sm" data-modal-pdf>PDF</button>
            <button class="btn-sm" data-modal-close>✕ Tutup</button>
          </div>
        </div>
        <div class="modal-body markdown md">${a.ok ? renderMd(a.result || '') : '<div class="empty">Audit gagal — laporan tidak tersedia.</div>'}</div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector('[data-modal-close]').onclick = closeAuditModal;
    ov.querySelector('[data-modal-pdf]').onclick = () => previewAuditPdf(id);
    ov.addEventListener('click', (e) => { if (e.target === ov) closeAuditModal(); });
    auditModalKey = (e) => { if (e.key === 'Escape') closeAuditModal(); };
    document.addEventListener('keydown', auditModalKey);
  } catch (e) {
    await alertDialog('Gagal membuka laporan: ' + esc(e.message || ''), { title: 'Terjadi Kesalahan' });
  }
}

/* ============ PROVIDER ============ */
async function renderProvider() {
  const topbar = document.getElementById('topbar');
  const content = document.getElementById('content');
  topbar.innerHTML = '<h3>AI Provider</h3>';
  let data;
  try {
    data = await api('/api/providers');
  } catch (e) {
    content.innerHTML = `<div class="card"><div class="msg err">${esc(e.message || 'gagal memuat provider')}</div></div>`;
    return;
  }
  const provs = data.providers || [];
  const presets = data.presets || [];
  const editing = state.provEditId ? provs.find((p) => p.id === state.provEditId) : null;
content.innerHTML = `
  <div class="pv-cols">
    <div class="pv-col">
      <div class="card">
        <h4>Daftar AI Provider</h4>
        <p style="color:var(--muted);margin-top:-6px">Isi API key untuk beberapa provider, lalu <b>Aktifkan</b> salah satu sebagai provider yang dipakai sistem untuk chat &amp; audit.</p>
        <div id="pv-msg"></div>
        <div id="pv-list">
      ${provs.map((p) => `
        <div class="pv-row ${p.active ? 'pv-active' : ''}">
          <div class="pv-main">
            <div class="pv-head">${p.active ? '<span class="badge ok">AKTIF</span>' : ''}<b>${esc(p.label)}</b></div>
            <small>${esc(p.baseUrl)} &middot; model: <code>${esc(p.model)}</code></small>
            <small class="cell-muted">${p.hasKey ? '&#9989; API key tersimpan (' + esc(p.keyPreview) + ')' : '&#10060; API key belum diisi'}</small>
          </div>
          <div class="pv-actions">
            ${p.active ? '' : `<button class="primary" data-act="activate" data-id="${esc(p.id)}">Aktifkan</button>`}
            <button data-act="test" data-id="${esc(p.id)}">Tes</button>
            <button data-act="edit" data-id="${esc(p.id)}">Edit</button>
            <button class="danger" data-act="del" data-id="${esc(p.id)}">Hapus</button>
          </div>
          ${state.provTest && state.provTest.id === p.id && state.provTest.models.length ? `
          <div class="pv-models">
            <label style="margin:0">Pilih model</label>
            <select id="pv-modelsel-${esc(p.id)}"><option value="">— pilih model —</option>${state.provTest.models.map((mm) => `<option value="${esc(mm)}">${esc(mm)}</option>`).join('')}</select>
            <button class="primary" data-act="use-model" data-id="${esc(p.id)}">Pakai Model Ini</button>
          </div>` : ''}
        </div>`).join('') || '<p class="empty">Belum ada provider. Tambahkan di sebelah kanan.</p>'}
        </div>
      </div>
    </div>
    <div class="pv-col">
      <div class="card">
        <h4>${editing ? 'Edit Provider' : 'Tambah Provider'}</h4>
        <label>Preset provider</label>
        <select id="cf-preset">
          ${presets.map((pr) => `<option value="${esc(pr.key)}">${esc(pr.label)}</option>`).join('')}
        </select>
        <div class="msg" id="cf-hint" style="color:var(--muted)"></div>
        <label>Label</label><input id="cf-label" value="${editing ? esc(editing.label) : ''}" />
        <label>Base URL</label><input id="cf-url" value="${editing ? esc(editing.baseUrl) : ''}" placeholder="https://api.openai.com/v1" />
        <label>Model Name</label><input id="cf-model" value="${editing ? esc(editing.model) : ''}" placeholder="contoh: gpt-4o-mini" />
        <label>API Key ${editing && editing.hasKey ? `<span style="color:var(--green)">&#9989; tersimpan (${esc(editing.keyPreview)}) — kosongkan kolom jika tidak diubah</span>` : ''}</label>
        <input id="cf-key" type="password" placeholder="${editing && editing.hasKey ? '•••• (biarkan kosong = pertahankan key tersimpan)' : 'sk-...'}" autocomplete="off" />
        <div id="cf-msg"></div>
        <div class="row" style="margin-top:8px">
          <button class="primary" id="cf-save">${editing ? 'Simpan Perubahan' : 'Simpan Provider'}</button>
          ${editing ? '<button id="cf-cancel">Batal</button>' : ''}
        </div>
      </div>
      <div class="card">
        <h4>Pengaturan Global</h4>
        <div class="row" style="margin-top:6px"><input type="checkbox" id="p-stream" ${data.streaming ? 'checked' : ''} /> <span>Streaming (SSE)</span></div>
        <label>Maks. konteks router (karakter) <small style="color:var(--muted)">min 10000</small></label>
        <input id="p-ctx" type="number" value="${data.maxContext || 80000}" min="10000" step="5000" />
        <div id="p-msg"></div>
        <button class="primary" id="p-save-global" style="margin-top:8px">Simpan Pengaturan</button>
      </div>
    </div>
  </div>`;

  content.querySelectorAll('#pv-list button').forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.id;
      const act = b.dataset.act;
      if (act === 'activate') {
        try {
          await api('/api/providers/' + id + '/activate', { method: 'POST' });
          state.provEditId = null;
          state.provTest = { id: null, models: [] };
          renderProvider();
        } catch (e) { showMsg('pv-msg', e.message, 'err'); }
      } else if (act === 'test') {
        b.disabled = true;
        const old = b.textContent;
        b.textContent = 'Menguji...';
        showMsg('pv-msg', 'Menghubungi provider...', '');
        try {
          const r = await api('/api/providers/' + id + '/test', { method: 'POST' });
          state.provTest = { id, models: r.models || [] };
          renderProvider();
          showMsg('pv-msg', state.provTest.models.length
            ? `Terjangkau (${state.provTest.models.length} model tersedia). Pilih model lalu klik "Pakai Model Ini".`
            : `Terjangkau. Model aktif: ${esc(r.model || '-')}`, 'ok');
        } catch (e) {
          state.provTest = { id: null, models: [] };
          showMsg('pv-msg', 'Tes gagal: ' + e.message, 'err');
        }
      } else if (act === 'use-model') {
        const sel = document.getElementById('pv-modelsel-' + id);
        if (!sel || !sel.value) { showMsg('pv-msg', 'Pilih model terlebih dahulu.', 'err'); return; }
        try {
          await api('/api/providers/' + id, { method: 'PUT', body: { model: sel.value } });
          state.provTest = { id: null, models: [] };
          renderProvider();
          showMsg('pv-msg', `Model diperbarui: ${esc(sel.value)}`, 'ok');
        } catch (e) { showMsg('pv-msg', e.message, 'err'); }
      } else if (act === 'edit') {
        state.provTest = { id: null, models: [] };
        state.provEditId = id;
        renderProvider();
      } else if (act === 'del') {
        if (!await confirmDialog('Hapus provider ini beserta API key-nya?', { title: 'Hapus Provider', okText: 'Hapus', kind: 'danger' })) return;
        try {
          await api('/api/providers/' + id, { method: 'DELETE' });
          if (state.provEditId === id) state.provEditId = null;
          state.provTest = { id: null, models: [] };
          renderProvider();
        } catch (e) { showMsg('pv-msg', e.message, 'err'); }
      }
    };
  });

  const presetSel = document.getElementById('cf-preset');
  const hintEl = document.getElementById('cf-hint');
  if (editing && presets.some((pr) => pr.key === editing.id)) presetSel.value = editing.id;
  const applyPreset = () => {
    if (editing) { hintEl.innerHTML = '<span style="color:var(--muted)">Ubah kolom lalu simpan. Kosongkan kolom API key untuk mempertahankan key yang tersimpan.</span>'; return; }
    const pr = presets.find((x) => x.key === presetSel.value);
    if (!pr) return;
    if (pr.key !== 'custom') {
      document.getElementById('cf-label').value = pr.label;
      document.getElementById('cf-url').value = pr.url;
      if (pr.model) document.getElementById('cf-model').value = pr.model;
      hintEl.innerHTML = '<span style="color:var(--muted)">Isi API key lalu simpan.</span>';
    } else {
      hintEl.innerHTML = '<span style="color:var(--muted)">Isi manual Base URL, model, dan API key.</span>';
    }
  };
  presetSel.onchange = applyPreset;
  applyPreset();

  document.getElementById('cf-save').onclick = async () => {
    const body = {
      baseUrl: document.getElementById('cf-url').value.trim(),
      model: document.getElementById('cf-model').value.trim(),
      label: document.getElementById('cf-label').value.trim(),
      presetKey: presetSel.value,
    };
    const key = document.getElementById('cf-key').value.trim();
    if (key) body.apiKey = key;
    try {
      if (editing) {
        await api('/api/providers/' + editing.id, { method: 'PUT', body });
        showMsg('cf-msg', 'Perubahan disimpan.', 'ok');
      } else {
        await api('/api/providers', { method: 'POST', body });
        showMsg('cf-msg', 'Provider ditambahkan. Klik Aktifkan bila ingin dipakai.', 'ok');
      }
      state.provEditId = null;
      renderProvider();
    } catch (e) { showMsg('cf-msg', e.message, 'err'); }
  };
  const cancelBtn = document.getElementById('cf-cancel');
  if (cancelBtn) cancelBtn.onclick = () => { state.provEditId = null; renderProvider(); };

  document.getElementById('p-save-global').onclick = async () => {
    try {
      await api('/api/providers/settings', {
        method: 'PUT',
        body: {
          streaming: document.getElementById('p-stream').checked,
          maxContext: Number(document.getElementById('p-ctx').value || 80000),
        },
      });
      showMsg('p-msg', 'Pengaturan global tersimpan.', 'ok');
    } catch (e) { showMsg('p-msg', e.message, 'err'); }
  };
}


/* ============ SETTINGS ============ */
function renderSettings() {
  document.getElementById('topbar').innerHTML = '<h3>Settings</h3>';
  document.getElementById('content').innerHTML = `
  <div class="card" style="max-width:440px">
    <h4>Ganti password admin</h4>
    <label>Password saat ini</label><input id="s-cur" type="password" />
    <label>Password baru (min 4)</label><input id="s-new" type="password" />
    <div id="settings-msg"></div>
    <button class="primary" id="s-save" style="margin-top:8px">Simpan Password</button>
  </div>`;
  document.getElementById('s-save').onclick = async () => {
    try {
      await api('/api/settings/password', {
        method: 'PUT',
        body: { currentPassword: document.getElementById('s-cur').value, password: document.getElementById('s-new').value },
      });
      document.getElementById('s-cur').value = '';
      document.getElementById('s-new').value = '';
      showMsg('settings-msg', 'Password diubah.', 'ok');
    } catch (e) { showMsg('settings-msg', e.message, 'err'); }
  };
}

/* ============ LOGS ============ */
let logPageSize = 50;
let logPage = 0;

async function renderLogs() {
  document.getElementById('topbar').innerHTML = '<h3>Activity Log</h3>';
  document.getElementById('content').innerHTML = '<div class="card"><div class="empty">Memuat...</div></div>';
  const data = await api(`/api/logs?limit=${logPageSize}&offset=${logPage * logPageSize}`);
  const logs = data.rows;
  const total = data.total;
  const totalPages = Math.max(1, Math.ceil(total / logPageSize));
  const content = document.getElementById('content');
  const t = (ms) => (ms === undefined || ms === null ? '' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);
  const fmt = (v) => esc(v ?? '');
  content.innerHTML = `
  <div class="card">
    <h4>Event log <small style="color:var(--muted);font-weight:400">(${total} event · kredensial/secret otomatis di-redaksi)</small></h4>
    <div class="row">
      <label style="margin:0">Filter: </label>
      <select id="log-filter" style="width:auto">
        <option value="">Semua level</option>
        <option value="info">info</option>
        <option value="warn">warn</option>
        <option value="error">error</option>
      </select>
      <label style="margin:0">Baris/halaman: </label>
      <select id="log-size" style="width:auto">
        ${[25, 50, 100].map((n) => `<option value="${n}" ${n === logPageSize ? 'selected' : ''}>${n}</option>`).join('')}
      </select>
    </div>
    ${logs.length ? `
    <div style="overflow-x:auto"><table id="log-table">
      <thead><tr><th>Waktu</th><th>Level</th><th>Event</th><th>Operasi</th><th>Hasil</th><th>Router</th><th>Durasi</th><th>Keterangan</th></tr></thead>
      <tbody>${logs.map((l) => `
        <tr class="log-row" data-level="${l.level}">
          <td style="white-space:nowrap">${fmt(fmtTs(l.ts))}</td>
          <td><span class="badge lvl-${l.level}">${l.level}</span></td>
          <td>${fmt(l.event)}</td>
          <td>${fmt(l.operation)}</td>
          <td><span class="badge ${l.result === 'success' || l.result === 'ok' ? 'ok' : l.result === 'failed' ? 'failed' : 'unknown'}">${fmt(l.result)}</span></td>
          <td style="white-space:nowrap">${l.routerId ? `<code style="font-size:11px">${esc(l.routerId.slice(0, 8))}</code>` : ''}</td>
          <td style="white-space:nowrap">${t(l.durationMs)}</td>
          <td style="color:var(--muted);max-width:340px;word-break:break-word">${fmt(l.errorCategory ? `[${l.errorCategory}] ` : '')}${fmt(l.message || l.error || '')}</td>
        </tr>`).join('')}</tbody>
    </table></div>
    <div class="row" style="justify-content:space-between;margin-top:12px">
      <span style="color:var(--muted)">Hal ${logPage + 1} dari ${totalPages}</span>
      <div>
        <button id="log-prev" ${logPage === 0 ? 'disabled' : ''}>‹ Sebelumnya</button>
        <button id="log-next" ${logPage >= totalPages - 1 ? 'disabled' : ''}>Berikutnya ›</button>
      </div>
    </div>`
    : '<div class="empty">Belum ada event</div>'}
  </div>`;
  const sel = document.getElementById('log-filter');
  sel.onchange = () => {
    const v = sel.value;
    document.querySelectorAll('.log-row').forEach((tr) => {
      tr.style.display = v && tr.dataset.level !== v ? 'none' : '';
    });
  };
  const sizeSel = document.getElementById('log-size');
  sizeSel.addEventListener('change', () => {
    logPageSize = Number(sizeSel.value);
    logPage = 0;
    renderLogs();
  });
  const prevBtn = document.getElementById('log-prev');
  const nextBtn = document.getElementById('log-next');
  if (prevBtn) prevBtn.onclick = () => { logPage--; renderLogs(); };
  if (nextBtn) nextBtn.onclick = () => { logPage++; renderLogs(); };
}

boot();