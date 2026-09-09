/**
 * AI MikroTik Assistant - Modern Cyber-Console Frontend
 * High-performance, read-only network management and AI copilot SPA.
 */

const app = document.getElementById('app');

// Global Application State
const state = {
  routers: [],
  view: 'routers',
  router: null,
  overview: null,
  overviewError: null,
  chats: null,
  chat: null,
  messages: [],
  provider: null,
  provEditId: null,
  provTest: { id: null, models: [] },
  config: { tpl: null, values: {}, script: null },
  // Dashboard & UX Filters
  dashSearch: '',
  dashFilter: 'all', // 'all' | 'online' | 'offline' | 'stale'
  dashView: 'grid',  // 'grid' | 'table'
  resourceSearch: '',
};

/* ==========================================================================
   Inline SVG Vector Icon System (100% Offline Compatible)
   ========================================================================== */
const SVG_ICONS = {
  router: `<rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 18h.01"/><path d="M10 18h.01"/><path d="M15 10v4"/><path d="M17.8 8A6 6 0 0 0 6.2 8"/><path d="m15 2-3 3-3-3"/>`,
  cpu: `<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M9 2v2"/><path d="M15 2v2"/><path d="M9 20v2"/><path d="M15 20v2"/><path d="M20 9h2"/><path d="M20 14h2"/><path d="M2 9h2"/><path d="M2 14h2"/>`,
  memory: `<path d="M6 19v-3"/><path d="M10 19v-3"/><path d="M14 19v-3"/><path d="M18 19v-3"/><path d="M4 11V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6"/><path d="M20 15H4a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2z"/>`,
  thermometer: `<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>`,
  clock: `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`,
  terminal: `<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>`,
  shield: `<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>`,
  'shield-check': `<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>`,
  'shield-alert': `<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 8v4"/><path d="M12 16h.01"/>`,
  'message-square': `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`,
  'file-text': `<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>`,
  database: `<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>`,
  settings: `<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>`,
  activity: `<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>`,
  'log-out': `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>`,
  sun: `<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>`,
  moon: `<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>`,
  'refresh-cw': `<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>`,
  plus: `<path d="M5 12h14"/><path d="M12 5v14"/>`,
  search: `<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>`,
  filter: `<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>`,
  grid: `<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>`,
  list: `<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>`,
  copy: `<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>`,
  check: `<polyline points="20 6 9 17 4 12"/>`,
  download: `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>`,
  trash: `<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>`,
  edit: `<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>`,
  'more-vertical': `<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>`,
  'arrow-right': `<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>`,
  'external-link': `<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>`,
  wifi: `<path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.86a10 10 0 0 1 14 0"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/>`,
  zap: `<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>`,
  lock: `<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`,
  'chevron-right': `<polyline points="9 18 15 12 9 6"/>`,
  'chevron-down': `<polyline points="6 9 12 15 18 9"/>`,
  close: `<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`,
  info: `<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>`,
  menu: `<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>`,
};

function icon(name, extraClass = '', size = 16) {
  const inner = SVG_ICONS[name] || SVG_ICONS.info;
  return `<span class="app-icon ${extraClass}" style="width:${size}px;height:${size}px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0"><svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:100%;height:100%;display:block">${inner}</svg></span>`;
}

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
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ==========================================================================
   Enhanced Markdown Renderer with 1-Click Code Copy & Download
   ========================================================================== */
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
  let html = '<div class="table-wrap"><table class="data-table md-table">';
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
    const blockId = 'cb-' + Math.random().toString(36).slice(2, 9);
    const langLabel = lang || 'routeros';
    const escapedCode = esc(code.trim());
    blocks.push(`
      <div class="code-block-wrap" id="${blockId}">
        <div class="code-block-head">
          <span class="code-lang-tag">${icon('terminal', '', 13)} ${esc(langLabel)}</span>
          <div class="code-actions">
            <button class="code-btn" onclick="copyCodeBlock('${blockId}')">${icon('copy', '', 12)} Salin Skrip</button>
            <button class="code-btn" onclick="downloadRscScript('${blockId}', 'mikrotik_script.rsc')">${icon('download', '', 12)} Unduh .rsc</button>
          </div>
        </div>
        <pre><code class="lang-${esc(langLabel)}">${escapedCode}</code></pre>
        <div class="code-safety-tag">
          ${icon('shield-alert', '', 13)}
          <span>Mode Read-Only: AI tidak dapat mengeksekusi skrip. Review baris di atas secara manual sebelum menjalankan di RouterOS.</span>
        </div>
      </div>
    `);
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
    if (/^\*\*[^*\n]+\*\*$/.test(line)) {
      out.push(`<div class="md-sub">${inlineFmt(line.slice(2, -2))}</div>`);
      i++;
      continue;
    }
    if (/^\u0000B\d+\u0000$/.test(line)) { out.push(line); i++; continue; }
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

window.copyCodeBlock = async function(blockId) {
  const wrap = document.getElementById(blockId);
  if (!wrap) return;
  const code = wrap.querySelector('code')?.innerText || '';
  try {
    await navigator.clipboard.writeText(code);
    showToast('Skrip berhasil disalin ke clipboard', 'ok');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = code;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast('Skrip disalin ke clipboard', 'ok');
  }
};

window.downloadRscScript = function(blockId, filename = 'script.rsc') {
  const wrap = document.getElementById(blockId);
  if (!wrap) return;
  const code = wrap.querySelector('code')?.innerText || '';
  const blob = new Blob([code], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast(`File ${filename} berhasil diunduh`, 'ok');
};

/* ==========================================================================
   Theme & Notifications
   ========================================================================== */
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

function applyTheme() {
  const saved = localStorage.getItem('mt_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
}

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('mt_theme', next);
  const tBtn = document.getElementById('theme-toggle');
  if (tBtn) {
    tBtn.innerHTML = next === 'dark' ? `${icon('sun', '', 14)} <span>Mode Terang</span>` : `${icon('moon', '', 14)} <span>Mode Gelap</span>`;
  }
}

function showMsg(id, text, kind) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!text) { el.innerHTML = ''; el.className = ''; return; }
  el.className = 'msg ' + (kind || '');
  el.innerHTML = esc(text);
}

function showToast(text, opts = {}) {
  if (typeof opts === 'string') opts = { kind: opts };
  const { kind = 'ok', title, action } = opts;
  let wrap = document.getElementById('toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const item = document.createElement('div');
  item.className = 'toast-item ' + kind;
  const close = () => {
    item.classList.add('hide');
    setTimeout(() => item.remove(), 200);
  };
  item.innerHTML = `
    <div class="toast-main">
      ${title ? `<div class="toast-title">${esc(title)}</div>` : ''}
      <div class="toast-text">${esc(text)}</div>
    </div>
    ${action ? `<button class="toast-action" data-act>${esc(action.label)}</button>` : ''}
    <button class="toast-close" data-close title="Tutup">${icon('close', '', 14)}</button>`;
  wrap.appendChild(item);
  if (action) item.querySelector('[data-act]').onclick = () => { close(); action.onClick(); };
  item.querySelector('[data-close]').onclick = close;
  setTimeout(() => { close(); }, 4000);
}

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
          <button class="${opts.kind === 'danger' ? 'danger' : 'primary'}" data-dlg-ok>${esc(opts.okText || 'OK')}</button>
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

/* ==========================================================================
   Authentication
   ========================================================================== */
function renderLogin() {
  document.cookie = 'mt_auth=; Max-Age=0; path=/';
  app.innerHTML = `
  <div class="login-wrap">
    <div class="login-card">
      <div class="login-brand">
        <div class="login-brand-icon">${icon('router', '', 24)}</div>
        <div>
          <h1>AI MikroTik Assistant</h1>
          <p>Read-only Network Management Console</p>
        </div>
      </div>
      <form id="login-form" onsubmit="return false;">
        <label>Username</label>
        <input id="u" type="text" autocomplete="username" value="admin" required />
        <label>Password</label>
        <input id="p" type="password" autocomplete="current-password" placeholder="••••••••" required />
        <div id="login-msg"></div>
        <button class="primary" id="login-btn" type="submit">Masuk ke Konsol</button>
      </form>
    </div>
  </div>`;

  document.getElementById('login-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    btn.disabled = true;
    btn.innerHTML = `${icon('refresh-cw', '', 14)} Memverifikasi...`;
    showMsg('login-msg', '', '');
    try {
      await api('/api/auth/login', {
        method: 'POST',
        body: {
          username: document.getElementById('u').value.trim(),
          password: document.getElementById('p').value,
        },
      });
      await enterApp();
    } catch (err) {
      showMsg('login-msg', err.message || 'Login gagal', 'err');
      btn.disabled = false;
      btn.textContent = 'Masuk ke Konsol';
    }
  };
}

/* ==========================================================================
   Application Lifecycle & Shell
   ========================================================================== */
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
  const r = state.router;
  const isRouterView = state.view === 'routers' && !!r;

  // Breadcrumbs builder
  let breadcrumbHtml = `<span class="breadcrumb-item" onclick="navigate('routers')">Konsol</span>`;
  if (state.view === 'routers' && !r) {
    breadcrumbHtml += ` <span class="breadcrumb-sep">/</span> <span class="breadcrumb-item active">Dashboard Routers</span>`;
  } else if (isRouterView) {
    breadcrumbHtml += ` <span class="breadcrumb-sep">/</span> <span class="breadcrumb-item" onclick="navigate('routers')">Routers</span>`;
    if (r.company) breadcrumbHtml += ` <span class="breadcrumb-sep">/</span> <span class="breadcrumb-item">${esc(r.company)}</span>`;
    breadcrumbHtml += ` <span class="breadcrumb-sep">/</span> <span class="breadcrumb-item active">${esc(r.name)}</span>`;
  } else if (state.view === 'discover') {
    breadcrumbHtml += ` <span class="breadcrumb-sep">/</span> <span class="breadcrumb-item active">Network Discovery (MNDP)</span>`;
  } else if (state.view === 'config') {
    breadcrumbHtml += ` <span class="breadcrumb-sep">/</span> <span class="breadcrumb-item active">Konfigurasi Awal</span>`;
  } else if (state.view === 'provider') {
    breadcrumbHtml += ` <span class="breadcrumb-sep">/</span> <span class="breadcrumb-item active">AI Provider</span>`;
  } else if (state.view === 'settings') {
    breadcrumbHtml += ` <span class="breadcrumb-sep">/</span> <span class="breadcrumb-item active">Pengaturan Admin</span>`;
  } else if (state.view === 'logs') {
    breadcrumbHtml += ` <span class="breadcrumb-sep">/</span> <span class="breadcrumb-item active">Activity Log</span>`;
  }

  app.innerHTML = `
  <div class="shell">
    <div class="sidebar-backdrop" id="sidebar-backdrop"></div>
    <aside class="sidebar" id="app-sidebar">
      <div class="brand">
        <div class="brand-icon">${icon('router', '', 20)}</div>
        <div class="brand-info">
          <h2>MikroTik Assistant</h2>
          <span class="brand-badge">v0.1 · Read-Only</span>
        </div>
      </div>
      <nav class="nav">
        <div class="nav-sec">Utama</div>
        <button class="nav-item" data-view="routers">
          ${icon('grid', '', 15)} <span>Routers</span>
          <span class="nav-count">${state.routers.length}</span>
        </button>

        <div class="nav-sec">Peralatan Jaringan</div>
        <button class="nav-item" data-view="discover">
          ${icon('wifi', '', 15)} <span>Discovery (MNDP)</span>
        </button>
        <button class="nav-item" data-view="config">
          ${icon('terminal', '', 15)} <span>Generator Skrip</span>
        </button>

        <div class="nav-sec">AI &amp; Preferensi</div>
        <button class="nav-item" data-view="provider">
          ${icon('zap', '', 15)} <span>AI Provider</span>
        </button>
        <button class="nav-item" data-view="settings">
          ${icon('lock', '', 15)} <span>Keamanan &amp; Akun</span>
        </button>

        <div class="nav-sec">Sistem</div>
        <button class="nav-item" data-view="logs">
          ${icon('activity', '', 15)} <span>Activity Log</span>
        </button>
      </nav>

      <div class="sidebar-foot">
        <div class="user-status-chip">
          <div class="user-avatar">A</div>
          <div class="user-info">
            <div class="user-name">Administrator</div>
            <div class="user-role">Sesi Lokal Aktif</div>
          </div>
        </div>
        <div class="sidebar-actions">
          <button id="theme-toggle" class="sidebar-foot-btn">
            ${currentTheme() === 'dark' ? icon('sun', '', 14) + ' <span>Mode Terang</span>' : icon('moon', '', 14) + ' <span>Mode Gelap</span>'}
          </button>
          <button id="logout-btn" class="sidebar-foot-btn danger-btn">
            ${icon('log-out', '', 14)} <span>Keluar</span>
          </button>
        </div>
      </div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div class="topbar-left">
          <button id="sidebar-toggle" class="sidebar-toggle-btn" title="Menu Navigasi">${icon('menu', '', 18)}</button>
          <div class="breadcrumbs">${breadcrumbHtml}</div>
        </div>
        <div class="topbar-actions">
          ${isRouterView ? `
            <button class="btn-sm" onclick="routerAction('${esc(r.id)}', 'sync')">${icon('refresh-cw', '', 13)} Sync</button>
            <button class="btn-sm" onclick="openRouterForm(state.router)">${icon('edit', '', 13)} Edit</button>
            <button class="btn-sm ghost" onclick="navigate('routers')">${icon('grid', '', 13)} Dashboard</button>
          ` : `
            <button class="primary btn-sm" onclick="openRouterForm()">${icon('plus', '', 14)} Tambah Router</button>
          `}
        </div>
      </header>

      <section class="content" id="content"></section>
    </main>
  </div>`;

  const sidebar = document.getElementById('app-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const sidebarToggle = document.getElementById('sidebar-toggle');

  const closeSidebar = () => {
    sidebar?.classList.remove('open');
    backdrop?.classList.remove('active');
  };

  if (sidebarToggle) {
    sidebarToggle.onclick = () => {
      const isOpen = sidebar?.classList.toggle('open');
      backdrop?.classList.toggle('active', !!isOpen);
    };
  }
  if (backdrop) {
    backdrop.onclick = closeSidebar;
  }

  // Bind Sidebar Nav
  document.querySelectorAll('.nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === state.view && (!r || b.dataset.view !== 'routers'));
    b.onclick = () => {
      closeSidebar();
      navigate(b.dataset.view);
    };
  });

  const tBtn = document.getElementById('theme-toggle');
  if (tBtn) tBtn.onclick = toggleTheme;

  const outBtn = document.getElementById('logout-btn');
  if (outBtn) {
    outBtn.onclick = async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      renderLogin();
    };
  }

  // Render Target View
  if (state.view === 'routers' && state.router) renderRouter();
  else if (state.view === 'routers') renderDashboard();
  else if (state.view === 'discover') renderDiscover();
  else if (state.view === 'config') renderConfig();
  else if (state.view === 'provider') renderProvider();
  else if (state.view === 'settings') renderSettings();
  else if (state.view === 'logs') renderLogs();
}

function navigate(viewName) {
  state.view = viewName;
  if (viewName === 'routers') { state.router = null; state.overview = null; }
  if (viewName === 'config') { state.config = { tpl: null, values: {}, script: null }; }
  renderShell();
}

/* ==========================================================================
   Dashboard View (Metrics, Live Filter, Grid & List View)
   ========================================================================== */
async function renderDashboard() {
  const content = document.getElementById('content');
  let cards = [];
  try {
    cards = await api('/api/dashboard');
  } catch (e) {
    content.innerHTML = `<div class="card"><div class="msg err">${esc(e.message || 'Gagal memuat ringkasan dashboard')}</div></div>`;
    return;
  }

  // Calculate Metrics
  const totalRouters = cards.length;
  const onlineCount = cards.filter((c) => c.connectionStatus === 'ok').length;
  const staleCount = cards.filter((c) => c.stale || !c.hasContext).length;
  let totalAlerts = 0;
  cards.forEach((c) => {
    if (c.audit?.sev) totalAlerts += (c.audit.sev.critical || 0) + (c.audit.sev.high || 0);
  });

  // Filter cards by search & status
  const query = state.dashSearch.toLowerCase().trim();
  const filtered = cards.filter((c) => {
    const matchQuery = !query ||
      c.name.toLowerCase().includes(query) ||
      (c.company && c.company.toLowerCase().includes(query)) ||
      c.host.toLowerCase().includes(query);
    if (!matchQuery) return false;

    if (state.dashFilter === 'online') return c.connectionStatus === 'ok';
    if (state.dashFilter === 'offline') return c.connectionStatus !== 'ok';
    if (state.dashFilter === 'stale') return c.stale || !c.hasContext;
    return true;
  });

  content.innerHTML = `
    <!-- Metrics Bar -->
    <div class="metrics-row">
      <div class="metric-card">
        <div class="metric-icon-wrap blue">${icon('router', '', 22)}</div>
        <div class="metric-data">
          <div class="metric-val">${totalRouters}</div>
          <div class="metric-label">Total Router Terdaftar</div>
        </div>
      </div>
      <div class="metric-card">
        <div class="metric-icon-wrap green">${icon('shield-check', '', 22)}</div>
        <div class="metric-data">
          <div class="metric-val">${onlineCount}</div>
          <div class="metric-label">Router Terkoneksi (Online)</div>
        </div>
      </div>
      <div class="metric-card">
        <div class="metric-icon-wrap amber">${icon('clock', '', 22)}</div>
        <div class="metric-data">
          <div class="metric-val">${staleCount}</div>
          <div class="metric-label">Perlu Sinkronisasi (Stale)</div>
        </div>
      </div>
      <div class="metric-card">
        <div class="metric-icon-wrap rose">${icon('shield-alert', '', 22)}</div>
        <div class="metric-data">
          <div class="metric-val">${totalAlerts}</div>
          <div class="metric-label">Temuan Keamanan Kritis</div>
        </div>
      </div>
    </div>

    <!-- Toolbar & Filter -->
    <div class="dash-toolbar">
      <div class="dash-search-wrap">
        <span class="dash-search-icon">${icon('search', '', 16)}</span>
        <input class="dash-search-input" id="dash-search" type="search" placeholder="Cari router, perusahaan, IP..." value="${esc(state.dashSearch)}" />
      </div>

      <div class="dash-filters">
        <button class="filter-chip ${state.dashFilter === 'all' ? 'active' : ''}" data-filter="all">Semua (${totalRouters})</button>
        <button class="filter-chip ${state.dashFilter === 'online' ? 'active' : ''}" data-filter="online">Online (${onlineCount})</button>
        <button class="filter-chip ${state.dashFilter === 'stale' ? 'active' : ''}" data-filter="stale">Stale (${staleCount})</button>
        <button class="filter-chip ${state.dashFilter === 'offline' ? 'active' : ''}" data-filter="offline">Offline (${totalRouters - onlineCount})</button>
      </div>

      <div class="view-toggle">
        <button class="view-btn ${state.dashView === 'grid' ? 'active' : ''}" id="view-grid" title="Tampilan Grid">${icon('grid', '', 14)}</button>
        <button class="view-btn ${state.dashView === 'table' ? 'active' : ''}" id="view-table" title="Tampilan Tabel">${icon('list', '', 14)}</button>
      </div>
    </div>

    <!-- Cards Container -->
    ${filtered.length === 0 ? `
      <div class="card empty">
        <p>Tidak ada router yang sesuai dengan pencarian atau filter saat ini.</p>
        <button class="primary" onclick="openRouterForm()">${icon('plus', '', 14)} Tambah Router</button>
      </div>
    ` : state.dashView === 'grid' ? `
      <div class="dash-grid">
        ${filtered.map(dashCardHtml).join('')}
        <div class="dash-card dash-add" onclick="openRouterForm()" role="button" title="Tambah Router Baru">
          <div class="dash-add-icon">${icon('plus', '', 22)}</div>
          <b>Tambah Router MikroTik</b>
        </div>
      </div>
    ` : `
      <div class="card table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Nama Router</th>
              <th>Perusahaan</th>
              <th>Host / IP</th>
              <th>RouterOS</th>
              <th>CPU Load</th>
              <th>RAM</th>
              <th>Sinkronisasi</th>
              <th style="text-align:right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map((c) => {
              const h = c.health;
              const memUsed = h && h.freeMem != null && h.totalMem != null && h.totalMem > 0
                ? Math.round((1 - h.freeMem / h.totalMem) * 100) : null;
              return `
              <tr style="cursor:pointer" onclick="openRouter(state.routers.find(r => r.id === '${c.id}'))">
                <td><span class="pulse-dot ${c.connectionStatus === 'ok' ? 'online' : 'offline'}"></span></td>
                <td><b>${esc(c.name)}</b></td>
                <td>${esc(c.company || '—')}</td>
                <td><code>${esc(c.host)}:${c.apiPort || 8728}</code>${c.secure ? ' <span class="badge lvl-info">SSL</span>' : ''}</td>
                <td>${h && h.version ? `RouterOS ${esc(h.version)}` : '—'}</td>
                <td>${h && h.cpu != null ? `${h.cpu}%` : '—'}</td>
                <td>${memUsed != null ? `${memUsed}%` : '—'}</td>
                <td><span class="badge ${c.stale || !c.hasContext ? 'stale' : 'ok'}">${!c.hasContext ? 'BELUM' : c.stale ? 'STALE' : 'SEGAR'}</span></td>
                <td style="text-align:right" onclick="event.stopPropagation()">
                  <button class="btn-sm" onclick="routerAction('${c.id}', 'sync')">${icon('refresh-cw', '', 12)}</button>
                  <button class="btn-sm" onclick="routerAction('${c.id}', 'test')">${icon('zap', '', 12)}</button>
                  <button class="btn-sm" onclick="openRouter(state.routers.find(r => r.id === '${c.id}'))">Buka</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `}
  `;

  // Bind Search Input
  const sInput = document.getElementById('dash-search');
  if (sInput) {
    sInput.oninput = (e) => {
      state.dashSearch = e.target.value;
      renderDashboard();
    };
  }

  // Bind Filter Chips
  content.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.onclick = () => {
      state.dashFilter = btn.dataset.filter;
      renderDashboard();
    };
  });

  // Bind View Toggles
  const vg = document.getElementById('view-grid');
  const vt = document.getElementById('view-table');
  if (vg) vg.onclick = () => { state.dashView = 'grid'; renderDashboard(); };
  if (vt) vt.onclick = () => { state.dashView = 'table'; renderDashboard(); };

  // Bind Card Click Events
  content.querySelectorAll('[data-dash-open]').forEach((card) => {
    card.onclick = (e) => {
      if (e.target.closest('.r-menu-btn') || e.target.closest('.r-menu')) return;
      openRouter(state.routers.find((r) => r.id === card.dataset.dashOpen));
    };
  });

  // Bind Kebab Menus
  content.querySelectorAll('.r-menu-btn').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const menu = document.getElementById('rmenu-' + btn.dataset.menu);
      const isOpen = menu.classList.contains('open');
      closeAllMenus();
      if (!isOpen) menu.classList.add('open');
    };
  });

  content.querySelectorAll('.r-menu-item').forEach((item) => {
    item.onclick = (e) => {
      e.stopPropagation();
      closeAllMenus();
      routerAction(item.dataset.id, item.dataset.act);
    };
  });
}

function dashCardHtml(c) {
  const h = c.health;
  const memUsed = h && h.freeMem != null && h.totalMem != null && h.totalMem > 0
    ? Math.round((1 - h.freeMem / h.totalMem) * 100) : null;
  const cpuVal = h && h.cpu != null ? Number(h.cpu) : null;
  const cpuClass = cpuVal == null ? 'ok' : cpuVal >= 80 ? 'bad' : cpuVal >= 50 ? 'warn' : 'ok';
  const memClass = memUsed == null ? 'ok' : memUsed >= 85 ? 'bad' : memUsed >= 65 ? 'warn' : 'ok';

  let tempShow = '—';
  if (h && h.temp != null) {
    const t = String(h.temp).trim();
    if (t) tempShow = t.includes('°') ? t : (t.toUpperCase().endsWith('C') ? t.slice(0, -1) + '°C' : t + '°C');
  }

  const audit = c.audit;
  const critical = audit ? (audit.sev.critical || 0) + (audit.sev.high || 0) : 0;
  const syncBadge = !c.hasContext ? 'BELUM SYNC' : (c.stale ? 'STALE' : 'SEGAR');

  return `
  <div class="dash-card ${c.connectionStatus !== 'ok' ? 'dash-alert' : ''}" data-dash-open="${c.id}" role="button">
    <div class="dash-head">
      <div class="dash-title">
        <b>${esc(c.name)}</b>
        ${c.company ? `<div class="dash-company">${icon('shield', '', 12)} ${esc(c.company)}</div>` : ''}
      </div>
      <div class="dash-actions">
        <span class="pulse-dot ${c.connectionStatus === 'ok' ? 'online' : 'offline'}" title="${c.connectionStatus}"></span>
        <button class="r-menu-btn" data-menu="${c.id}" title="Opsi">${icon('more-vertical', '', 15)}</button>
      </div>
    </div>

    <div class="r-menu" id="rmenu-${c.id}">
      <button class="r-menu-item" data-act="test" data-id="${c.id}">${icon('zap', '', 13)} Test Koneksi</button>
      <button class="r-menu-item" data-act="sync" data-id="${c.id}">${icon('refresh-cw', '', 13)} Sync Data</button>
      <button class="r-menu-item" data-act="edit" data-id="${c.id}">${icon('edit', '', 13)} Edit</button>
      <button class="r-menu-item danger" data-act="del" data-id="${c.id}">${icon('trash', '', 13)} Hapus</button>
    </div>

    <div class="dash-meta">
      <code>${esc(c.host)}${c.apiPort ? ':' + c.apiPort : ''}</code>
      <span class="badge ${c.stale || !c.hasContext ? 'stale' : 'ok'}">${syncBadge}</span>
    </div>

    <!-- Telemetry Mini Meters -->
    <div class="dash-health">
      <div class="dh-item">
        <div class="dh-label-row"><span>CPU</span><b class="dh-val">${cpuVal != null ? cpuVal + '%' : '—'}</b></div>
        <div class="dh-meter"><div class="dh-meter-fill ${cpuClass}" style="width:${cpuVal ?? 0}%"></div></div>
      </div>
      <div class="dh-item">
        <div class="dh-label-row"><span>RAM</span><b class="dh-val">${memUsed != null ? memUsed + '%' : '—'}</b></div>
        <div class="dh-meter"><div class="dh-meter-fill ${memClass}" style="width:${memUsed ?? 0}%"></div></div>
      </div>
      <div class="dh-item">
        <div class="dh-label-row"><span>SUHU</span><b class="dh-val">${esc(tempShow)}</b></div>
        <div class="dh-meter"><div class="dh-meter-fill ok" style="width:50%"></div></div>
      </div>
      <div class="dh-item">
        <div class="dh-label-row"><span>UPTIME</span><b class="dh-val" style="font-size:11px">${esc(h?.uptime || '—')}</b></div>
        <div class="dh-meter"><div class="dh-meter-fill ok" style="width:100%"></div></div>
      </div>
    </div>

    ${h && h.version ? `
      <div class="dash-ver">
        ${icon('terminal', '', 12)}
        <span>RouterOS ${esc(h.version)}${h.board ? ` · ${esc(h.board)}` : ''}</span>
      </div>` : ''}

    <div class="dash-audit">
      ${audit ? `
        <span class="badge ${critical > 0 ? 'failed' : 'ok'}">
          ${critical > 0 ? `${critical} Isu Kritis` : 'Audit Aman'}
        </span>
        ${audit.sev.medium ? `<span class="badge lvl-warn">${audit.sev.medium} Sedang</span>` : ''}
      ` : '<span class="cell-muted" style="font-size:11px">Belum diaudit</span>'}
    </div>

    <div class="dash-foot">
      <span>Sync: ${c.lastSync ? fmtTs(c.lastSync) : '—'}</span>
      <span class="dash-go">Buka Detail ${icon('arrow-right', '', 13)}</span>
    </div>
  </div>`;
}

/* ==========================================================================
   Router Form Modal (Add / Edit) & Preflight Test
   ========================================================================== */
function openRouterForm(existing) {
  const r = existing || {};
  const mask = document.createElement('div');
  mask.className = 'modal-overlay';
  mask.innerHTML = `
  <div class="modal dialog">
    <div class="modal-head">
      <h4>${r.id ? 'Edit Parameter Router' : 'Tambah Router MikroTik Baru'}</h4>
      <button class="ghost btn-sm" id="f-close">${icon('close', '', 14)}</button>
    </div>
    <div class="modal-body">
      <label>Nama Pengenal Router</label>
      <input id="f-name" value="${esc(r.name || '')}" placeholder="misal: Core-Gateway-HQ" required />

      <label>Nama Perusahaan / Organisasi</label>
      <input id="f-company" value="${esc(r.company || '')}" placeholder="misal: PT. Mitra Network Solusi" />

      <label>Host / Alamat IP Router</label>
      <input id="f-host" value="${esc(r.host || '')}" placeholder="192.168.88.1" required />

      <div class="row" style="margin-top:8px">
        <div style="flex:1">
          <label>Port API</label>
          <input id="f-port" type="number" value="${r.api_port || 8728}" />
        </div>
        <div style="flex:1;padding-top:22px">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="checkbox" id="f-secure" ${r.secure ? 'checked' : ''} />
            <span>Gunakan API-SSL (8729)</span>
          </label>
        </div>
      </div>

      <label>Username API</label>
      <input id="f-user" value="${esc(r.username || '')}" placeholder="admin" autocomplete="off" required />

      <label>Password API ${r.id ? '<small class="cell-muted">(kosongkan jika tidak diubah)</small>' : ''}</label>
      <input id="f-pass" type="password" autocomplete="new-password" placeholder="••••••••" />

      <div id="router-form-msg"></div>
    </div>
    <div class="dialog-actions">
      <button class="ghost" id="f-cancel">Batal</button>
      <button class="primary" id="f-test">${icon('zap', '', 13)} Tes Koneksi</button>
      <button class="primary" id="f-save" ${r.id ? '' : 'disabled'}>${icon('check', '', 13)} Simpan</button>
    </div>
  </div>`;

  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.querySelector('#f-close').onclick = close;
  mask.querySelector('#f-cancel').onclick = close;

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
    testBtn.innerHTML = `${icon('refresh-cw', '', 13)} Menguji...`;
    showMsg('router-form-msg', 'Menghubungkan ke MikroTik API...', '');
    try {
      const res = await api('/api/routers/test-preflight', { method: 'POST', body: formData() });
      showMsg('router-form-msg', `Koneksi Berhasil! Terdeteksi RouterOS ${esc(res.version)} · Board ${esc(res.boardName || '-')}`, 'ok');
      saveBtn.disabled = false;
    } catch (e) {
      showMsg('router-form-msg', `Koneksi Gagal: ${esc(e.message)}`, 'err');
      saveBtn.disabled = true;
    }
    testBtn.disabled = false;
    testBtn.innerHTML = `${icon('zap', '', 13)} Tes Koneksi`;
  };

  saveBtn.onclick = async () => {
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
      if (!body.name || !body.host || !body.username) {
        showMsg('router-form-msg', 'Nama, Host, dan Username wajib diisi.', 'err');
        return;
      }
      if (r.id) await api(`/api/routers/${r.id}`, { method: 'PUT', body });
      else await api('/api/routers', { method: 'POST', body });
      close();
      await refreshRouters();
      if (state.router && state.router.id === r.id) {
        state.router = state.routers.find((x) => x.id === r.id);
      }
      renderShell();
      showToast('Data router berhasil disimpan', 'ok');
    } catch (e) {
      showMsg('router-form-msg', e.message, 'err');
    }
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
    state.overviewError = e.message || 'Router tidak dapat dihubungi';
  }
}

async function routerAction(id, action) {
  const r = state.routers.find((x) => x.id === id);
  try {
    if (action === 'test') {
      const res = await api(`/api/routers/${id}/test`, { method: 'POST' });
      showToast(`Terhubung: ROS v${res.version} · ${res.boardName} · Uptime ${res.uptime}`, {
        kind: 'ok', title: 'Tes Koneksi Berhasil',
        action: { label: 'Buka Router', onClick: () => openRouter(r) },
      });
    } else if (action === 'sync') {
      showToast('Memulai sinkronisasi ~37 resource...', 'ok');
      const res = await api(`/api/routers/${id}/sync`, { method: 'POST' });
      showToast(`Sync Selesai: ${res.okCount} sukses · ${res.failedCount} gagal · ${res.unsupportedCount} tak didukung`, {
        kind: 'ok', title: 'Sinkronisasi Selesai',
        action: { label: 'Lihat Data', onClick: () => openRouter(r) },
      });
    } else if (action === 'edit') {
      openRouterForm(r);
      return;
    } else if (action === 'del') {
      if (!await confirmDialog(`Hapus router <b>${esc(r?.name || id)}</b> beserta semua data riwayat sync, percakapan AI, dan laporan audit?`, { title: 'Konfirmasi Hapus Router', okText: 'Hapus Permanen', kind: 'danger' })) return;
      await api(`/api/routers/${id}`, { method: 'DELETE' });
      if (state.router?.id === id) { state.router = null; state.chat = null; state.messages = []; }
      await refreshRouters();
      renderShell();
      showToast('Router berhasil dihapus', 'ok');
      return;
    }
    await refreshRouters();
    if (state.view === 'routers' && state.router && state.router.id === id) {
      await loadOverview();
      renderRouter();
    } else {
      renderShell();
    }
  } catch (e) {
    showToast(e.message || 'Gagal menjalankan aksi', { kind: 'err', title: 'Kesalahan' });
  }
}

/* ==========================================================================
   Router Detail View (Status Hub, AI Copilot, Security Audit)
   ========================================================================== */
let routerTab = 'status';

function renderRouter() {
  const r = state.router;
  const content = document.getElementById('content');

  content.innerHTML = `
    <!-- Router Header Bar -->
    <div class="router-header-bar">
      <div class="rh-info">
        <span class="pulse-dot ${r.connection_status === 'ok' ? 'online' : 'offline'}"></span>
        <div class="rh-title-wrap">
          <div class="rh-name">${esc(r.name)}</div>
          ${r.company ? `<div class="rh-company">${icon('shield', '', 12)} ${esc(r.company)}</div>` : ''}
        </div>
        <div class="rh-host-pill">
          ${icon('terminal', '', 12)}
          <code>${esc(r.host)}:${r.api_port}</code>
          ${r.secure ? '<span class="badge lvl-info">SSL</span>' : ''}
        </div>
      </div>

      <div class="rh-actions">
        <button class="primary btn-sm" id="rt-sync-btn">${icon('refresh-cw', '', 13)} Sync Data</button>
        <button class="btn-sm" id="rt-test-btn">${icon('zap', '', 13)} Test Ping</button>
        <button class="btn-sm" id="rt-edit-btn">${icon('edit', '', 13)} Edit</button>
        <button class="danger btn-sm" id="rt-del-btn">${icon('trash', '', 13)}</button>
      </div>
    </div>

    <!-- Navigation Tabs -->
    <div class="router-tabs">
      <button class="rt-tab-btn ${routerTab === 'status' ? 'active' : ''}" data-tab="status">
        ${icon('activity', '', 15)} <span>Status &amp; Telemetri</span>
      </button>
      <button class="rt-tab-btn ${routerTab === 'chat' ? 'active' : ''}" data-tab="chat">
        ${icon('message-square', '', 15)} <span>AI Copilot</span>
      </button>
      <button class="rt-tab-btn ${routerTab === 'audit' ? 'active' : ''}" data-tab="audit">
        ${icon('shield', '', 15)} <span>Audit Keamanan</span>
      </button>
    </div>

    <div id="tab-body"></div>`;

  // Bind Router Actions
  document.getElementById('rt-sync-btn').onclick = () => routerAction(r.id, 'sync');
  document.getElementById('rt-test-btn').onclick = () => routerAction(r.id, 'test');
  document.getElementById('rt-edit-btn').onclick = () => openRouterForm(r);
  document.getElementById('rt-del-btn').onclick = () => routerAction(r.id, 'del');

  // Bind Tabs
  document.querySelectorAll('[data-tab]').forEach((b) => {
    b.onclick = () => { routerTab = b.dataset.tab; renderRouter(); };
  });

  renderTab();
}

async function renderTab() {
  const body = document.getElementById('tab-body');
  if (routerTab === 'status') await renderStatusTab(body);
  else if (routerTab === 'chat') await renderChatTab(body);
  else if (routerTab === 'audit') await renderAuditTab(body);
}

/* ==========================================================================
   Tab 1: Status & Telemetry Hub + 37+ Resource Explorer
   ========================================================================== */
async function renderStatusTab(body) {
  if (!state.overview) await loadOverview();
  const ov = state.overview;

  if (!ov || state.overviewError) {
    body.innerHTML = `
    <div class="card">
      <div class="card-title">
        <h4>Status Perangkat</h4>
        <span class="badge failed">OFFLINE / TIDAK TERHUBUNG</span>
      </div>
      <p style="color:var(--text-secondary)">Router tidak dapat dihubungi melalui RouterOS API. Pastikan host, kredensial, dan port API sudah benar.</p>
      <div class="row" style="margin-top:14px">
        <button class="primary" onclick="routerAction('${esc(state.router?.id)}','test')">${icon('zap', '', 13)} Uji Koneksi</button>
        <button onclick="routerAction('${esc(state.router?.id)}','sync')">${icon('refresh-cw', '', 13)} Coba Sync Lagi</button>
      </div>
    </div>`;
    return;
  }

  const sum = ov.context.summary || [];
  const okCount = sum.filter((s) => s.status === 'ok' || s.status === 'success').length;
  const pct = sum.length ? Math.round((okCount / sum.length) * 100) : 0;
  const fresh = ov.context.available && !ov.context.stale;

  // Filtered resources
  const q = state.resourceSearch.toLowerCase().trim();
  const filteredSum = sum.filter((s) => !q || s.resource.toLowerCase().includes(q));

  body.innerHTML = `
  <!-- Telemetry Overview Cards -->
  <div class="telemetry-grid">
    <div class="telemetry-card">
      <div class="tc-head"><span>Kondisi Data</span> ${icon('database', '', 14)}</div>
      <div class="tc-value">
        <span class="badge ${ov.context.available ? (fresh ? 'ok' : 'stale') : 'failed'}">
          ${ov.context.available ? (fresh ? 'DATA SEGAR' : 'DATA STALE') : 'BELUM SYNC'}
        </span>
      </div>
      <small class="cell-muted">Sinkron: ${ov.context.syncedAt ? fmtTs(ov.context.syncedAt) : 'Belum pernah'}</small>
    </div>

    <div class="telemetry-card">
      <div class="tc-head"><span>Resource Tersinkron</span> ${icon('terminal', '', 14)}</div>
      <div class="tc-value">${okCount} <span style="font-size:14px;color:var(--text-muted)">/ ${sum.length}</span></div>
      <small class="cell-muted">${sum.length - okCount} resource gagal / tak didukung</small>
    </div>

    <div class="telemetry-card">
      <div class="tc-head"><span>Host &amp; Port</span> ${icon('wifi', '', 14)}</div>
      <div class="tc-value" style="font-size:16px;font-family:var(--font-mono)">${esc(ov.router.host)}</div>
      <small class="cell-muted">Port ${ov.router.api_port} ${ov.router.secure ? '(SSL Aktif)' : ''}</small>
    </div>

    <div class="telemetry-card">
      <div class="tc-head"><span>Entitas Perusahaan</span> ${icon('shield', '', 14)}</div>
      <div class="tc-value" style="font-size:16px">${esc(ov.router.company || '—')}</div>
      <small class="cell-muted">Identitas terdaftar</small>
    </div>
  </div>

  <!-- Data Health Progress Bar -->
  <div class="card">
    <div class="card-title">
      <h4>Kesehatan Koleksi Data</h4>
      <span class="sync-bar-num ${pct >= 70 ? 'ok' : pct >= 40 ? 'warn' : 'bad'}">${pct}% Siap</span>
    </div>
    <div class="sync-bar">
      <div class="sync-bar-fill ${pct >= 70 ? 'ok' : pct >= 40 ? 'warn' : 'bad'}" style="width:${pct}%"></div>
    </div>
    ${ov.router.last_error ? `<div class="msg err">${icon('shield-alert', '', 14)} <b>Error Koneksi:</b> ${esc(ov.router.last_error)}</div>` : ''}
    ${!ov.context.available ? `<div class="msg warn">Belum ada snapshot konfigurasi. Klik <b>Sync Data</b> di atas untuk menarik data via RouterOS API.</div>` : ''}
  </div>

  <!-- 37+ Collected Resource Explorer -->
  <div class="card">
    <div class="card-title">
      <div>
        <h4>Penjelajah Resource Konfigurasi</h4>
        <p class="card-sub">Daftar resource RouterOS yang dikumpulkan secara read-only untuk analisis AI</p>
      </div>
      <div class="row">
        <input style="max-width:240px;margin:0" id="res-search" type="search" placeholder="Filter resource (misal: firewall)..." value="${esc(state.resourceSearch)}" />
      </div>
    </div>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Resource Path</th>
            <th>Status Pengumpulan</th>
            <th>Jumlah Record</th>
            <th>Keterangan / Pesan</th>
          </tr>
        </thead>
        <tbody>
          ${filteredSum.length === 0 ? `
            <tr><td colspan="4" class="empty">Tidak ada resource yang cocok.</td></tr>
          ` : filteredSum.map((s) => `
            <tr>
              <td><code>${esc(s.resource)}</code></td>
              <td>
                <span class="badge ${s.status === 'ok' || s.status === 'success' ? 'ok' : s.status === 'unsupported' ? 'unknown' : 'failed'}">
                  ${esc(s.status)}
                </span>
              </td>
              <td><b>${s.count}</b> record</td>
              <td class="cell-muted">${s.error ? esc(s.error.slice(0, 120)) : 'Normal'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  </div>`;

  const rsInput = document.getElementById('res-search');
  if (rsInput) {
    rsInput.oninput = (e) => {
      state.resourceSearch = e.target.value;
      renderStatusTab(body);
    };
  }
}

/* ==========================================================================
   Tab 2: AI Copilot & Chat (Single-Thread, SSE Streaming, @ Autocomplete)
   ========================================================================== */
let resList = [];
let mentionMatches = [];
let mentionIndex = -1;

async function renderChatTab(body) {
  let chatList = [];
  try {
    chatList = await api(`/api/routers/${state.router.id}/chats`);
  } catch { chatList = []; }

  // Load resources for mention
  try {
    const ov = await api(`/api/routers/${state.router.id}/overview`);
    resList = (ov.context?.summary || []).map((s) => s.resource).filter(Boolean);
  } catch { resList = []; }

  body.innerHTML = `
    <div class="chat-panel">
      <div class="chat-header">
        <div class="chat-header-title">
          ${icon('zap', '', 16)}
          <span>AI Copilot: ${esc(state.router.name)}</span>
          <span class="badge lvl-info" style="margin-left:6px">Read-Only</span>
        </div>
        <div class="chat-header-actions">
          <button class="btn-sm" id="chat-new-btn">${icon('plus', '', 12)} Percakapan Baru</button>
          <button class="btn-sm" id="chat-export-btn">${icon('download', '', 12)} Ekspor</button>
          <button class="btn-sm danger" id="chat-del-all-btn">${icon('trash', '', 12)} Hapus</button>
        </div>
      </div>

      <div class="msgs" id="msgs"></div>

      <div class="chat-input-wrap">
        <div class="mention-pop" id="mention-pop"></div>
        <div class="chat-input-row">
          <textarea id="chat-text" placeholder="Tanya tentang router ini... (Ketik @ untuk memanggil resource router, misal @ip/firewall)"></textarea>
          <button class="primary" id="send-btn">${icon('arrow-right', '', 15)} Kirim</button>
        </div>
      </div>
    </div>`;

  // Bind Header Controls
  document.getElementById('chat-new-btn').onclick = async () => {
    if (!state.chat) return;
    try {
      await api(`/api/chats/${state.chat.id}/messages`, { method: 'DELETE' });
    } catch {}
    state.messages = [];
    renderMessages([]);
    renderWelcome(document.getElementById('msgs'));
    document.getElementById('chat-text')?.focus();
  };

  document.getElementById('chat-export-btn').onclick = () => {
    if (!state.messages.length) {
      showToast('Belum ada pesan untuk diekspor', 'warn');
      return;
    }
    const mdContent = `# Percakapan AI MikroTik Assistant\nRouter: ${state.router.name} (${state.router.company || '-'})\nTanggal: ${new Date().toLocaleString()}\n\n` +
      state.messages.map((m) => `### ${m.role === 'user' ? '👤 Pengguna' : '🤖 AI Assistant'}\n${m.content}\n\n`).join('---\n\n');
    const blob = new Blob([mdContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat_${state.router.name.replace(/\s+/g, '_')}_${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast('Percakapan diekspor ke file Markdown', 'ok');
  };

  document.getElementById('chat-del-all-btn').onclick = async () => {
    if (!await confirmDialog('Hapus SEMUA riwayat percakapan untuk router ini?', { title: 'Konfirmasi Hapus Chat', okText: 'Hapus Semua', kind: 'danger' })) return;
    try {
      await api(`/api/routers/${state.router.id}/chats`, { method: 'DELETE' });
      state.chat = null;
      state.messages = [];
      renderMessages([]);
      renderWelcome(document.getElementById('msgs'));
      showToast('Semua riwayat percakapan dihapus', 'ok');
    } catch (e) {
      alertDialog('Gagal menghapus: ' + e.message);
    }
  };

  // Resolve Active Chat
  let chat = chatList.find((c) => c.id === state.chat?.id) || chatList[0] || null;
  if (!chat) {
    try {
      chat = await api(`/api/routers/${state.router.id}/chats`, { method: 'POST', body: { title: 'Konsultasi Router' } });
    } catch { chat = null; }
  }
  state.chat = chat;

  if (chat) {
    const data = await api(`/api/chats/${chat.id}`);
    state.messages = data.messages || [];
    renderMessages(state.messages);
  } else {
    renderMessages([]);
  }

  if (!state.messages || state.messages.length === 0) {
    renderWelcome(document.getElementById('msgs'));
  }

  // Send Logic & Streaming
  const ta = document.getElementById('chat-text');
  const sendBtn = document.getElementById('send-btn');

  const send = async () => {
    if (send.busy) return;
    const msg = ta.value.trim();
    if (!msg) return;
    ta.value = '';
    send.busy = true;

    const msgsBox = document.getElementById('msgs');
    if (msgsBox?.querySelector('.chat-welcome')) msgsBox.innerHTML = '';

    if (!state.chat) {
      state.chat = await api(`/api/routers/${state.router.id}/chats`, { method: 'POST', body: { title: msg.slice(0, 60) } });
      state.messages = [];
    }

    appendBubble('user', msg);
    const sb = appendBubble('assistant', '', true);
    sb.msgEl.innerHTML = '<span class="chat-typing"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>';

    try {
      await postStream(`/api/routers/${state.router.id}/chat`, { message: msg, chatId: state.chat.id }, (delta) => {
        sb.received = true;
        sb.msgEl.innerHTML = renderMd(sb.buffer += delta);
        msgsBox.scrollTop = msgsBox.scrollHeight;
      });
      sb.msgEl.innerHTML = renderMd(sb.buffer);
      const data = await api(`/api/chats/${state.chat.id}`);
      state.messages = data.messages;
    } catch (e) {
      sb.msgEl.innerHTML = `<span style="color:var(--color-danger)">${esc(e.message || 'Gagal menghubungi AI')}</span>`;
    } finally {
      send.busy = false;
      msgsBox.scrollTop = msgsBox.scrollHeight;
    }
  };

  sendBtn.onclick = send;
  ta.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  setupMention(ta);
}

function renderWelcome(msgs) {
  if (!msgs) return;
  msgs.innerHTML = `
    <div class="chat-welcome">
      <div class="chat-welcome-icon">${icon('message-square', '', 26)}</div>
      <h3>Konsultasi AI MikroTik</h3>
      <p>Ajukan pertanyaan teknis seputar router ini. AI menganalisis konfigurasi yang tersinkronisasi dan memberikan rekomendasi serta skrip yang aman.</p>
      <div class="chat-welcome-chips">
        <button class="chip" data-prompt="Analisa konfigurasi router ini secara menyeluruh, jelaskan kondisinya, dan beri rekomendasi.">${icon('activity', '', 12)} Analisa Konfigurasi</button>
        <button class="chip" data-prompt="Lakukan audit keamanan pada router ini dan beri rekomendasi perbaikannya.">${icon('shield', '', 12)} Audit Keamanan</button>
        <button class="chip" data-prompt="Cek kesehatan router ini (resource, interface, firewall) dan laporkan kendala yang ada.">${icon('zap', '', 12)} Cek Kesehatan Jaringan</button>
        <button class="chip" data-prompt="Buatkan skrip RouterOS untuk mengamankan Winbox dan SSH dari serangan brute-force.">${icon('terminal', '', 12)} Skrip Pengaman Brute-Force</button>
      </div>
    </div>`;

  msgs.querySelectorAll('[data-prompt]').forEach((c) => {
    c.onclick = () => {
      const ta = document.getElementById('chat-text');
      if (ta) {
        ta.value = c.dataset.prompt;
        ta.focus();
      }
    };
  });
}

function appendBubble(role, content, isStream = false) {
  const msgs = document.getElementById('msgs');
  const row = document.createElement('div');
  row.className = `chat-row ${role}`;
  row.innerHTML = `
    <div class="chat-avatar ${role}">
      ${role === 'user' ? 'U' : icon('zap', '', 15)}
    </div>
    <div class="chat-bubble markdown">${isStream ? '' : renderMd(content)}</div>`;
  msgs.appendChild(row);
  msgs.scrollTop = msgs.scrollHeight;

  if (isStream) {
    return {
      msgEl: row.querySelector('.chat-bubble'),
      buffer: '',
      received: false,
    };
  }
}

function renderMessages(list) {
  const msgs = document.getElementById('msgs');
  if (!msgs) return;
  msgs.innerHTML = '';
  list.forEach((m) => appendBubble(m.role, m.content));
  msgs.scrollTop = msgs.scrollHeight;
}

function setupMention(ta) {
  const pop = document.getElementById('mention-pop');
  if (!ta || !pop) return;

  ta.addEventListener('input', () => {
    const text = ta.value;
    const caret = ta.selectionStart;
    const match = text.slice(0, caret).match(/@([\w/-]*)$/);
    if (!match) {
      pop.classList.remove('open');
      return;
    }
    const q = match[1].toLowerCase();
    mentionMatches = resList.filter((r) => r.toLowerCase().includes(q)).slice(0, 8);
    if (!mentionMatches.length) {
      pop.classList.remove('open');
      return;
    }
    mentionIndex = 0;
    pop.innerHTML = mentionMatches.map((m, idx) => `
      <div class="mention-item ${idx === 0 ? 'active' : ''}" data-idx="${idx}">
        ${icon('database', '', 12)} <span>${esc(m)}</span>
      </div>
    `).join('');
    pop.classList.add('open');

    pop.querySelectorAll('.mention-item').forEach((it) => {
      it.onclick = () => {
        selectMention(ta, mentionMatches[Number(it.dataset.idx)]);
      };
    });
  });

  ta.addEventListener('keydown', (e) => {
    if (!pop.classList.contains('open')) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      mentionIndex = (mentionIndex + 1) % mentionMatches.length;
      highlightMention(pop);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      mentionIndex = (mentionIndex - 1 + mentionMatches.length) % mentionMatches.length;
      highlightMention(pop);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (mentionMatches[mentionIndex]) {
        e.preventDefault();
        selectMention(ta, mentionMatches[mentionIndex]);
      }
    } else if (e.key === 'Escape') {
      pop.classList.remove('open');
    }
  });
}

function highlightMention(pop) {
  pop.querySelectorAll('.mention-item').forEach((el, idx) => {
    el.classList.toggle('active', idx === mentionIndex);
  });
}

function selectMention(ta, selected) {
  const text = ta.value;
  const caret = ta.selectionStart;
  const before = text.slice(0, caret).replace(/@[\w/-]*$/, `@${selected} `);
  const after = text.slice(caret);
  ta.value = before + after;
  ta.focus();
  ta.selectionStart = ta.selectionEnd = before.length;
  document.getElementById('mention-pop')?.classList.remove('open');
}

/* ==========================================================================
   Tab 3: Security & Config Audit + Live Progress + jsPDF Export
   ========================================================================== */
const AUDIT_KINDS = [
  { kind: 'audit-config', label: 'Audit Konfigurasi', icon: 'shield-check', desc: 'Analisis postur konfigurasi umum: firewall hygiene, routing, DHCP/DNS, service exposure, dan resource.' },
  { kind: 'audit-security', label: 'Audit Keamanan', icon: 'lock', desc: 'Pemeriksaan pengamanan kredensial, proteksi brute-force, open services (WinBox, SSH, Telnet, API), dan default users.' },
  { kind: 'audit-network', label: 'Audit Keamanan Jaringan', icon: 'wifi', desc: 'Evaluasi eksposur boundary WAN, port forwarding NAT, segmentasi VLAN, dan proteksi DNS amplification.' },
];
const AUDIT_KIND_LABEL = { 'audit-config': 'Konfigurasi', 'audit-security': 'Keamanan', 'audit-network': 'Keamanan Jaringan' };

let auditPage = 0;
const AUDIT_PAGE_SIZE = 10;

async function renderAuditTab(body) {
  const data = await api(`/api/routers/${state.router.id}/audits?limit=${AUDIT_PAGE_SIZE}&offset=${auditPage * AUDIT_PAGE_SIZE}`);
  const audits = data.rows || [];
  const total = data.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));

  body.innerHTML = `
  <div class="card">
    <div class="card-title">
      <div>
        <h4>Jalankan Audit Terfokus</h4>
        <p class="card-sub">Pilih modul audit untuk mengevaluasi parameter konfigurasi router menggunakan AI</p>
      </div>
      <span class="badge lvl-info">Sistem Read-Only</span>
    </div>

    <div class="audit-type-row">
      ${AUDIT_KINDS.map((a) => `
        <button class="audit-type-card" data-audit="${a.kind}">
          <div class="audit-ico">${icon(a.icon, '', 20)}</div>
          <div class="audit-txt">
            <b>${a.label}</b>
            <small>${a.desc}</small>
          </div>
          <span class="dash-go">${icon('arrow-right', '', 14)}</span>
        </button>`).join('')}
    </div>

    <!-- Live Streaming Audit Box -->
    <div id="audit-run-box" style="display:none" class="audit-progress-box">
      <div class="flex items-center justify-between">
        <span id="audit-status-text" style="font-weight:600;font-size:13px">Menyiapkan audit...</span>
        <span id="audit-percent-text" class="mono" style="font-size:12px;color:var(--primary)">15%</span>
      </div>
      <div class="progress-bar-track">
        <div class="progress-bar-fill" id="audit-progress-bar" style="width:15%"></div>
      </div>
    </div>
  </div>

  <!-- Audit History Table -->
  <div class="card">
    <div class="card-title">
      <h4>Riwayat Laporan Audit</h4>
      <span class="badge neutral">${total} Laporan Tersimpan</span>
    </div>

    ${audits.length ? `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Waktu Audit</th>
              <th>Jenis Audit</th>
              <th>Status Hasil</th>
              <th style="text-align:right">Aksi Laporan</th>
            </tr>
          </thead>
          <tbody>
            ${audits.map((a) => `
              <tr>
                <td class="cell-muted">${fmtTs(a.created_at)}</td>
                <td><b>${esc(AUDIT_KIND_LABEL[a.audit_type] || a.audit_type)}</b></td>
                <td><span class="badge ${a.ok ? 'ok' : 'failed'}">${a.ok ? 'Sukses' : 'Gagal'}</span></td>
                <td style="text-align:right">
                  <button class="btn-sm" data-audit-view="${a.id}" ${a.ok ? '' : 'disabled'}>${icon('file-text', '', 12)} Lihat</button>
                  <button class="btn-sm" data-audit-pdf="${a.id}" ${a.ok ? '' : 'disabled'}>${icon('download', '', 12)} PDF</button>
                  <button class="btn-sm danger" data-audit-del="${a.id}">${icon('trash', '', 12)}</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="pager">
        <span class="cell-muted">Halaman ${auditPage + 1} dari ${totalPages}</span>
        <div class="pager-btns">
          <button class="btn-sm" id="audit-prev" ${auditPage === 0 ? 'disabled' : ''}>‹ Sebelumnya</button>
          <button class="btn-sm" id="audit-next" ${auditPage >= totalPages - 1 ? 'disabled' : ''}>Berikutnya ›</button>
        </div>
      </div>
    ` : '<div class="empty">Belum ada riwayat audit. Pilih salah satu jenis audit di atas untuk memulai.</div>'}
  </div>`;

  // Bind Run Audit
  body.querySelectorAll('[data-audit]').forEach((b) => {
    b.onclick = () => runAudit(b.dataset.audit);
  });
  body.querySelectorAll('[data-audit-view]').forEach((b) => {
    b.onclick = () => openAuditView(b.dataset.auditView);
  });
  body.querySelectorAll('[data-audit-pdf]').forEach((b) => {
    b.onclick = () => previewAuditPdf(b.dataset.auditPdf);
  });
  body.querySelectorAll('[data-audit-del]').forEach((b) => {
    b.onclick = async () => {
      if (!await confirmDialog('Hapus laporan audit ini?', { title: 'Konfirmasi Hapus', kind: 'danger' })) return;
      await api(`/api/audits/${b.dataset.auditDel}`, { method: 'DELETE' });
      if (auditPage > 0 && (total - 1) <= auditPage * AUDIT_PAGE_SIZE) auditPage--;
      renderAuditTab(body);
      showToast('Laporan audit dihapus', 'ok');
    };
  });

  const pBtn = document.getElementById('audit-prev');
  const nBtn = document.getElementById('audit-next');
  if (pBtn) pBtn.onclick = () => { auditPage--; renderAuditTab(body); };
  if (nBtn) nBtn.onclick = () => { auditPage++; renderAuditTab(body); };
}

async function runAudit(kind) {
  const box = document.getElementById('audit-run-box');
  const txt = document.getElementById('audit-status-text');
  const pct = document.getElementById('audit-percent-text');
  const bar = document.getElementById('audit-progress-bar');
  const label = AUDIT_KINDS.find((a) => a.kind === kind)?.label || 'Audit';

  box.style.display = 'block';
  const updateProgress = (labelMsg, p) => {
    if (txt) txt.textContent = labelMsg;
    if (pct) pct.textContent = Math.round(p) + '%';
    if (bar) bar.style.width = Math.min(100, Math.max(0, p)) + '%';
  };

  updateProgress(`Memulai ${label} — mengumpulkan konteks router...`, 20);

  try {
    await postStream(`/api/routers/${state.router.id}/audit`, { kind }, (delta) => {
      updateProgress(`Menganalisis konfigurasi & menyusun rekomendasi...`, 65);
    }, (step, stepLabel) => {
      const stepMap = {
        fetch_context: { p: 25, t: 'Mengambil konfigurasi router...' },
        build_prompt: { p: 45, t: 'Mengevaluasi parameter keamanan...' },
        llm_request: { p: 70, t: 'AI menghasilkan laporan komprehensif...' },
      };
      const info = stepMap[step];
      if (info) updateProgress(info.t, info.p);
    });

    updateProgress('Audit Selesai!', 100);
    showToast(`${label} selesai dan tersimpan!`, 'ok');
    setTimeout(() => {
      renderAuditTab(document.getElementById('tab-body'));
    }, 1200);
  } catch (e) {
    updateProgress(`Gagal: ${e.message}`, 100);
    showToast(`Audit gagal: ${e.message}`, 'err');
  }
}

/* ==========================================================================
   jsPDF Professional Report Generation Logic (100% Preserved & Cleaned)
   ========================================================================== */
function cleanInline(s) {
  return String(s || '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/[#*_~`]/g, '')
    .trim();
}

function markdownToPdf(doc, text, { routerName, routerCompany, auditTypeLabel }) {
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const M = 18;
  const WM = PW - M * 2;
  const footerY = PH - 14;
  const lineH = 5.2;

  const INK = [15, 23, 42];
  const LIGHT = [248, 250, 252];
  const BORDER = [203, 213, 225];
  const SEV_LABEL = { CRITICAL: 'Kritis', HIGH: 'Tinggi', MEDIUM: 'Sedang', LOW: 'Rendah', INFO: 'Info' };

  let y = M;
  const ink = () => doc.setTextColor(INK[0], INK[1], INK[2]);
  const gray = () => doc.setTextColor(100, 116, 139);

  // Cover / Header Banner
  doc.setFillColor(14, 165, 233);
  doc.roundedRect(M, y, WM, 26, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(`LAPORAN AUDIT ${String(auditTypeLabel || 'MIKROTIK').toUpperCase()}`, M + 6, y + 11);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(`Router: ${routerName || 'MikroTik'} · Perusahaan: ${routerCompany || '-'} · Tanggal: ${fmtTs(new Date())}`, M + 6, y + 19);
  y += 34;

  const ensure = (need) => {
    if (y + need > footerY - 4) {
      doc.addPage();
      y = M;
    }
  };

  const lines = String(text).split('\n');
  let inCode = false;
  let codeLines = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('```')) {
      if (inCode) {
        if (codeLines.length) {
          const h = codeLines.length * 4.4 + 6;
          ensure(h + 6);
          doc.setFillColor(241, 245, 249);
          doc.roundedRect(M, y, WM, h, 1, 1, 'F');
          doc.setFont('courier', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(30, 41, 59);
          codeLines.forEach((cl, k) => doc.text(cl || ' ', M + 4, y + 5 + k * 4.4));
          y += h + 6;
          codeLines = [];
        }
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      codeLines.push(...doc.splitTextToSize(cleanInline(rawLine) || ' ', WM - 8));
      continue;
    }

    if (!line) { y += 2; continue; }

    if (/^#{1,3} /.test(line)) {
      ensure(12);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      ink();
      doc.text(cleanInline(line.replace(/^#{1,3} /, '')), M, y);
      y += 7;
      continue;
    }

    // Bullet points
    if (/^[-*] /.test(line)) {
      const bText = cleanInline(line.replace(/^[-*] /, ''));
      const wrapped = doc.splitTextToSize(bText, WM - 8);
      ensure(wrapped.length * lineH + 2);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      ink();
      doc.text('•', M + 2, y);
      doc.text(wrapped, M + 7, y);
      y += wrapped.length * lineH + 2;
      continue;
    }

    // Paragraph
    const wrapped = doc.splitTextToSize(cleanInline(line), WM);
    ensure(wrapped.length * lineH + 2);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    ink();
    doc.text(wrapped, M, y);
    y += wrapped.length * lineH + 3;
  }

  // Add Page Numbers in Footer
  const pages = doc.getNumberOfPages();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  gray();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
    doc.setLineWidth(0.3);
    doc.line(M, footerY, PW - M, footerY);
    doc.text(`${routerCompany ? routerCompany + ' · ' : ''}${routerName} — Laporan Audit Read-Only`, M, footerY + 5);
    doc.text(`Halaman ${p} dari ${pages}`, PW - M, footerY + 5, { align: 'right' });
  }
}

async function previewAuditPdf(id) {
  try {
    const a = await api(`/api/audits/${id}`);
    if (!a.ok) throw new Error('Laporan audit gagal / tidak tersedia.');
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
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    showToast('Laporan PDF siap diunduh', 'ok');
  } catch (e) {
    alertDialog('Gagal membuat PDF: ' + e.message);
  }
}

async function openAuditView(id) {
  try {
    const a = await api(`/api/audits/${id}`);
    const ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.innerHTML = `
      <div class="modal" style="max-width:820px">
        <div class="modal-head">
          <div>
            <h4>${esc(AUDIT_KIND_LABEL[a.audit_type] || a.audit_type)}</h4>
            <p class="card-sub">${esc(a.router_company || '—')} · ${esc(a.router_name || '—')} · ${fmtTs(a.created_at)}</p>
          </div>
          <div class="modal-actions">
            <button class="btn-sm" id="m-pdf">${icon('download', '', 12)} PDF</button>
            <button class="btn-sm ghost" id="m-close">${icon('close', '', 14)}</button>
          </div>
        </div>
        <div class="modal-body markdown">${a.ok ? renderMd(a.result || '') : '<div class="empty">Audit gagal — laporan tidak tersedia.</div>'}</div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#m-close').onclick = () => ov.remove();
    ov.querySelector('#m-pdf').onclick = () => previewAuditPdf(id);
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
  } catch (e) {
    alertDialog('Gagal membuka laporan: ' + e.message);
  }
}

/* ==========================================================================
   Tools: Network Discovery (MNDP Scanner)
   ========================================================================== */
async function renderDiscover() {
  const content = document.getElementById('content');
  content.innerHTML = `
  <div class="radar-box">
    <div class="radar-ring" id="radar-ring">${icon('wifi', '', 28)}</div>
    <h3>Pemindai Jaringan MNDP (MikroTik Neighbor Discovery)</h3>
    <p style="color:var(--text-secondary);max-width:540px;margin:0 auto 16px">
      Mendeteksi router MikroTik di domain broadcast Layer-2 lokal yang sama (serupa menu Neighbors di Winbox).
    </p>
    <div class="row" style="justify-content:center">
      <button class="primary" id="dis-scan">${icon('wifi', '', 14)} Pindai Jaringan Sekarang</button>
      <button id="dis-cancel" style="display:none" class="danger">Batal</button>
      <button id="dis-reset" style="display:none" class="ghost">Bersihkan</button>
    </div>
    <div id="dis-status" style="margin-top:10px;font-size:13px;color:var(--text-muted)"></div>
  </div>

  <div class="card">
    <div class="card-title">
      <h4>Perangkat MikroTik Terdeteksi</h4>
    </div>
    <div id="dis-result">
      <p class="empty">Belum ada pemindaian. Klik tombol di atas untuk mencari router di jaringan lokal.</p>
    </div>
  </div>`;

  let controller = null;
  const scanBtn = document.getElementById('dis-scan');
  const cancelBtn = document.getElementById('dis-cancel');
  const resetBtn = document.getElementById('dis-reset');
  const statusEl = document.getElementById('dis-status');
  const resultEl = document.getElementById('dis-result');
  const ring = document.getElementById('radar-ring');

  scanBtn.onclick = async () => {
    controller = new AbortController();
    scanBtn.disabled = true;
    cancelBtn.style.display = 'inline-flex';
    resetBtn.style.display = 'none';
    ring.classList.add('scanning');
    statusEl.textContent = 'Memindai paket broadcast MNDP (3.5 detik)...';
    resultEl.innerHTML = '<p class="empty">Mendengarkan broadcast MNDP di jaringan...</p>';

    try {
      const r = await api('/api/discover', { method: 'POST', body: { duration: 3500 }, signal: controller.signal });
      const devs = r.devices || [];
      statusEl.textContent = `${devs.length} perangkat terdeteksi`;
      if (!devs.length) {
        resultEl.innerHTML = `<p class="empty">Tidak ada perangkat MikroTik yang ditemukan. Pastikan PC Anda berada dalam satu subnet LAN yang sama.</p>`;
      } else {
        resultEl.innerHTML = `
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Identity Name</th>
                <th>Alamat IP</th>
                <th>Versi ROS</th>
                <th>Model Hardware</th>
                <th>Status Port API</th>
                <th style="text-align:right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              ${devs.map((d) => `
                <tr>
                  <td><b>${esc(d.identity || '—')}</b></td>
                  <td><code>${esc(d.ip || '—')}</code> ${d.mac ? `<small class="cell-muted">(${esc(d.mac)})</small>` : ''}</td>
                  <td>RouterOS ${esc(d.version || '—')}</td>
                  <td>${esc(d.platform || '')}${d.hardware ? ` / ${esc(d.hardware)}` : ''}</td>
                  <td>
                    ${d.apiPort ? `<span class="badge ok">Port ${d.apiPort}</span>` : d.apiSsl ? '<span class="badge lvl-warn">SSL Only</span>' : '<span class="cell-muted">Tertutup</span>'}
                  </td>
                  <td style="text-align:right">
                    <button class="primary btn-sm" data-add-ip="${esc(d.ip)}" data-add-name="${esc(d.identity || '')}">
                      ${icon('plus', '', 12)} Tambah ke Routers
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>`;

        resultEl.querySelectorAll('[data-add-ip]').forEach((b) => {
          b.onclick = () => openRouterForm({
            name: b.dataset.addName || b.dataset.addIp,
            host: b.dataset.addIp,
            api_port: 8728,
            secure: false,
          });
        });
        resetBtn.style.display = 'inline-flex';
      }
    } catch (e) {
      if (e.name === 'AbortError') statusEl.textContent = 'Pemindaian dibatalkan.';
      else statusEl.textContent = 'Pemindaian gagal: ' + e.message;
    } finally {
      scanBtn.disabled = false;
      cancelBtn.style.display = 'none';
      ring.classList.remove('scanning');
    }
  };

  cancelBtn.onclick = () => { if (controller) controller.abort(); };
  resetBtn.onclick = () => {
    resultEl.innerHTML = '<p class="empty">Belum ada pemindaian.</p>';
    statusEl.textContent = '';
    resetBtn.style.display = 'none';
  };
}

/* ==========================================================================
   Tools: Configuration Generator (Scenario Templates)
   ========================================================================== */
async function renderConfig() {
  const content = document.getElementById('content');

  if (!state.config.tpl) {
    let list = [];
    try { list = await api('/api/templates'); } catch {}

    content.innerHTML = `
      <div class="card">
        <div class="card-title">
          <div>
            <h4>Generator Skrip RouterOS Berbasis Skenario</h4>
            <p class="card-sub">Pilih skenario jaringan untuk menghasilkan skrip konfigurasi MikroTik siap pakai.</p>
          </div>
          <span class="badge lvl-info">Idempotent Scripts</span>
        </div>
      </div>

      <div class="tpl-grid">
        ${list.map((t) => `
          <div class="tpl-card" data-tpl="${esc(t.id)}">
            <div class="flex items-center gap-3">
              <div class="metric-icon-wrap blue">${icon('terminal', '', 20)}</div>
              <div>
                <b>${esc(t.label)}</b>
              </div>
            </div>
            <p class="cell-muted" style="font-size:12.5px;margin:4px 0 10px">${esc(t.desc)}</p>
            <div class="dash-foot" style="margin-top:auto;border:none;padding:0">
              <span class="cell-muted">Pilih skenario</span>
              <span class="dash-go">Konfigurasi ${icon('arrow-right', '', 13)}</span>
            </div>
          </div>
        `).join('')}
      </div>`;

    content.querySelectorAll('[data-tpl]').forEach((card) => {
      card.onclick = () => {
        state.config = { tpl: card.dataset.tpl, values: {}, script: null };
        renderConfig();
      };
    });
    return;
  }

  // Template Detail Form / Result
  const t = await api('/api/templates/' + state.config.tpl).catch(() => null);
  if (!t) { state.config.tpl = null; return renderConfig(); }

  if (state.config.script !== null) {
    content.innerHTML = `
    <div class="card" style="max-width:880px">
      <div class="card-title">
        <div>
          <h4>${esc(t.label)} — Hasil Skrip RouterOS</h4>
          <p class="card-sub">Review skrip sebelum diaplikasikan ke router. Skrip aman dijalankan ulang (anti-duplikat).</p>
        </div>
        <span class="badge ok">Skrip Siap</span>
      </div>

      <pre class="script-box">${esc(state.config.script)}</pre>

      <div class="row" style="margin-top:14px">
        <button class="primary" id="cfg-copy">${icon('copy', '', 14)} Salin Skrip</button>
        <button id="cfg-download">${icon('download', '', 14)} Unduh .rsc</button>
        <button id="cfg-back" class="ghost">${icon('edit', '', 14)} Ubah Parameter</button>
        <button id="cfg-new" class="ghost">Pilih Template Lain</button>
      </div>
      <div id="cfg-msg"></div>
    </div>`;

    document.getElementById('cfg-copy').onclick = async () => {
      await navigator.clipboard.writeText(state.config.script);
      showToast('Skrip disalin ke clipboard', 'ok');
    };
    document.getElementById('cfg-download').onclick = () => {
      const blob = new Blob([state.config.script], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${t.id}_config.rsc`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast('File skrip diunduh', 'ok');
    };
    document.getElementById('cfg-back').onclick = () => { state.config.script = null; renderConfig(); };
    document.getElementById('cfg-new').onclick = () => { state.config = { tpl: null, values: {}, script: null }; renderConfig(); };
    return;
  }

  // Parameter Form
  const val = (id, dft) => (state.config.values[id] !== undefined ? state.config.values[id] : dft);
  content.innerHTML = `
  <div class="card" style="max-width:680px">
    <div class="card-title">
      <h4>${esc(t.label)}</h4>
      <button class="ghost btn-sm" id="cfg-tpl-back">← Ganti Template</button>
    </div>
    <p style="color:var(--text-secondary);margin-bottom:16px">${esc(t.desc)}</p>

    <div id="cfg-form">
      ${t.params.map((p) => `
        ${p.type === 'bool' ? `
          <div style="margin:12px 0">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" data-p="${p.id}" ${val(p.id, p.default) ? 'checked' : ''} />
              <span><b>${esc(p.label)}</b></span>
            </label>
          </div>
        ` : `
          <label><b>${esc(p.label)}</b></label>
          ${p.type === 'select' ? `
            <select data-p="${p.id}">
              ${p.options.map((o) => `<option value="${esc(o.value)}" ${String(val(p.id, p.default)) === String(o.value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
            </select>
          ` : `
            <input data-p="${p.id}" type="${p.type === 'number' ? 'number' : 'text'}" value="${esc(val(p.id, p.default) ?? '')}" placeholder="contoh parameter..." />
          `}
        `}
      `).join('')}
    </div>

    <div class="row" style="margin-top:16px">
      <button class="primary" id="cfg-gen">${icon('terminal', '', 14)} Generate Skrip RouterOS</button>
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
      showToast('Skrip berhasil di-generate', 'ok');
    } catch (e) {
      showMsg('cfg-msg', e.message, 'err');
    }
  };
}

/* ==========================================================================
   AI Provider Management
   ========================================================================== */
async function renderProvider() {
  const content = document.getElementById('content');
  let data;
  try {
    data = await api('/api/providers');
  } catch (e) {
    content.innerHTML = `<div class="card"><div class="msg err">${esc(e.message)}</div></div>`;
    return;
  }
  const provs = data.providers || [];
  const presets = data.presets || [];
  const editing = state.provEditId ? provs.find((p) => p.id === state.provEditId) : null;

  content.innerHTML = `
  <div class="pv-cols">
    <div class="pv-col">
      <div class="card">
        <div class="card-title">
          <h4>Daftar AI Provider</h4>
          <span class="badge neutral">${provs.length} Provider</span>
        </div>
        <p class="card-sub">Pilih salah satu provider sebagai engine AI aktif untuk fitur Chat Copilot dan Audit Keamanan.</p>
        <div id="pv-msg"></div>

        <div style="margin-top:14px">
          ${provs.map((p) => `
            <div class="pv-row ${p.active ? 'pv-active' : ''}">
              <div class="pv-head">
                ${p.active ? '<span class="badge ok">AKTIF</span>' : ''}
                <b>${esc(p.label)}</b>
              </div>
              <div class="mono cell-muted" style="font-size:12px">${esc(p.baseUrl)} · model: <b>${esc(p.model)}</b></div>
              <small class="cell-muted">${p.hasKey ? '✓ API key tersimpan (' + esc(p.keyPreview) + ')' : '✕ API key belum diisi'}</small>

              <div class="pv-actions">
                ${p.active ? '' : `<button class="primary btn-sm" data-act="activate" data-id="${esc(p.id)}">Aktifkan</button>`}
                <button class="btn-sm" data-act="test" data-id="${esc(p.id)}">${icon('zap', '', 12)} Tes</button>
                <button class="btn-sm" data-act="edit" data-id="${esc(p.id)}">${icon('edit', '', 12)} Edit</button>
                <button class="btn-sm danger" data-act="del" data-id="${esc(p.id)}">${icon('trash', '', 12)}</button>
              </div>

              ${state.provTest && state.provTest.id === p.id && state.provTest.models.length ? `
                <div class="pv-models">
                  <select id="pv-modelsel-${esc(p.id)}">
                    <option value="">— Pilih Model Tersedia —</option>
                    ${state.provTest.models.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}
                  </select>
                  <button class="primary btn-sm" data-act="use-model" data-id="${esc(p.id)}">Terapkan Model</button>
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    </div>

    <div class="pv-col">
      <div class="card">
        <h4>${editing ? 'Edit AI Provider' : 'Tambah AI Provider Baru'}</h4>
        <label>Preset Provider Populer</label>
        <select id="cf-preset">
          ${presets.map((pr) => `<option value="${esc(pr.key)}">${esc(pr.label)}</option>`).join('')}
        </select>

        <label>Nama Label</label>
        <input id="cf-label" value="${editing ? esc(editing.label) : ''}" placeholder="misal: OpenAI GPT-4o" />

        <label>Base URL Endpoint</label>
        <input id="cf-url" value="${editing ? esc(editing.baseUrl) : ''}" placeholder="https://api.openai.com/v1" />

        <label>Nama Model</label>
        <input id="cf-model" value="${editing ? esc(editing.model) : ''}" placeholder="gpt-4o-mini" />

        <label>API Key</label>
        <input id="cf-key" type="password" placeholder="${editing && editing.hasKey ? '•••• (biarkan kosong untuk mempertahankan)' : 'sk-...'}" />

        <div id="cf-msg"></div>

        <div class="row" style="margin-top:14px">
          <button class="primary" id="cf-save">${icon('check', '', 13)} ${editing ? 'Simpan Perubahan' : 'Tambah Provider'}</button>
          ${editing ? '<button id="cf-cancel" class="ghost">Batal</button>' : ''}
        </div>
      </div>

      <div class="card">
        <h4>Pengaturan Konteks Global</h4>
        <div class="row" style="margin:10px 0">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:0">
            <input type="checkbox" id="p-stream" ${data.streaming ? 'checked' : ''} />
            <span>Aktifkan Real-Time Streaming (SSE)</span>
          </label>
        </div>
        <label>Batas Maksimum Karakter Konteks Router</label>
        <input id="p-ctx" type="number" value="${data.maxContext || 80000}" min="10000" step="5000" />
        <div id="p-msg"></div>
        <button class="primary btn-sm" id="p-save-global" style="margin-top:10px">${icon('check', '', 12)} Simpan Preferensi</button>
      </div>
    </div>
  </div>`;

  // Bind Actions
  content.querySelectorAll('#pv-cols button, .pv-actions button').forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.id;
      const act = b.dataset.act;
      if (act === 'activate') {
        await api('/api/providers/' + id + '/activate', { method: 'POST' });
        showToast('Provider diaktifkan', 'ok');
        renderProvider();
      } else if (act === 'test') {
        b.disabled = true;
        b.innerHTML = `${icon('refresh-cw', '', 12)} Menguji...`;
        try {
          const r = await api('/api/providers/' + id + '/test', { method: 'POST' });
          state.provTest = { id, models: r.models || [] };
          showToast(`Terhubung! ${r.models?.length || 0} model tersedia`, 'ok');
        } catch (e) {
          showToast('Tes gagal: ' + e.message, 'err');
        }
        renderProvider();
      } else if (act === 'use-model') {
        const sel = document.getElementById('pv-modelsel-' + id);
        if (!sel?.value) return;
        await api('/api/providers/' + id, { method: 'PUT', body: { model: sel.value } });
        showToast('Model diterapkan: ' + sel.value, 'ok');
        state.provTest = { id: null, models: [] };
        renderProvider();
      } else if (act === 'edit') {
        state.provEditId = id;
        renderProvider();
      } else if (act === 'del') {
        if (!await confirmDialog('Hapus provider ini?', { kind: 'danger' })) return;
        await api('/api/providers/' + id, { method: 'DELETE' });
        showToast('Provider dihapus', 'ok');
        renderProvider();
      }
    };
  });

  const pSel = document.getElementById('cf-preset');
  pSel.onchange = () => {
    const pr = presets.find((x) => x.key === pSel.value);
    if (!pr || pr.key === 'custom') return;
    document.getElementById('cf-label').value = pr.label;
    document.getElementById('cf-url').value = pr.url;
    if (pr.model) document.getElementById('cf-model').value = pr.model;
  };

  document.getElementById('cf-save').onclick = async () => {
    const body = {
      baseUrl: document.getElementById('cf-url').value.trim(),
      model: document.getElementById('cf-model').value.trim(),
      label: document.getElementById('cf-label').value.trim(),
      presetKey: pSel.value,
    };
    const key = document.getElementById('cf-key').value.trim();
    if (key) body.apiKey = key;
    try {
      if (editing) await api('/api/providers/' + editing.id, { method: 'PUT', body });
      else await api('/api/providers', { method: 'POST', body });
      state.provEditId = null;
      renderProvider();
      showToast('Provider berhasil disimpan', 'ok');
    } catch (e) { showMsg('cf-msg', e.message, 'err'); }
  };

  const cCancel = document.getElementById('cf-cancel');
  if (cCancel) cCancel.onclick = () => { state.provEditId = null; renderProvider(); };

  document.getElementById('p-save-global').onclick = async () => {
    try {
      await api('/api/providers/settings', {
        method: 'PUT',
        body: {
          streaming: document.getElementById('p-stream').checked,
          maxContext: Number(document.getElementById('p-ctx').value || 80000),
        },
      });
      showToast('Pengaturan global tersimpan', 'ok');
    } catch (e) { showMsg('p-msg', e.message, 'err'); }
  };
}

/* ==========================================================================
   Settings View (Password & System Info)
   ========================================================================== */
function renderSettings() {
  const content = document.getElementById('content');
  content.innerHTML = `
  <div class="card" style="max-width:460px">
    <div class="card-title">
      <h4>Ganti Password Administrator</h4>
      ${icon('lock', '', 16)}
    </div>
    <p class="card-sub">Perbarui kredensial login akun admin lokal aplikasi.</p>

    <label>Password Saat Ini</label>
    <input id="s-cur" type="password" required />

    <label>Password Baru (Minimal 4 Karakter)</label>
    <input id="s-new" type="password" required />

    <div id="settings-msg"></div>
    <button class="primary" id="s-save" style="margin-top:14px">${icon('check', '', 13)} Simpan Password Baru</button>
  </div>

  <div class="card" style="max-width:460px">
    <h4>Informasi Sistem</h4>
    <div class="cell-muted" style="font-size:12.5px;line-height:1.8">
      <div>Aplikasi: <b>AI MikroTik Assistant v0.1</b></div>
      <div>Arsitektur Keamanan: <b>Read-Only Guard Boundary Active</b></div>
      <div>Enkripsi Kredensial: <b>AES-256-GCM</b></div>
    </div>
  </div>`;

  document.getElementById('s-save').onclick = async () => {
    try {
      await api('/api/settings/password', {
        method: 'PUT',
        body: {
          currentPassword: document.getElementById('s-cur').value,
          password: document.getElementById('s-new').value,
        },
      });
      document.getElementById('s-cur').value = '';
      document.getElementById('s-new').value = '';
      showToast('Password admin berhasil diubah', 'ok');
      showMsg('settings-msg', 'Password berhasil diubah.', 'ok');
    } catch (e) {
      showMsg('settings-msg', e.message, 'err');
    }
  };
}

/* ==========================================================================
   Activity Log View
   ========================================================================== */
let logPageSize = 50;
let logPage = 0;

async function renderLogs() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="card"><div class="empty">Memuat activity log...</div></div>';
  const data = await api(`/api/logs?limit=${logPageSize}&offset=${logPage * logPageSize}`);
  const logs = data.rows || [];
  const total = data.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / logPageSize));

  content.innerHTML = `
  <div class="card">
    <div class="card-title">
      <div>
        <h4>Activity &amp; Audit Log</h4>
        <p class="card-sub">${total} peristiwa tercatat · Seluruh kredensial dan rahasia otomatis diredaksi</p>
      </div>
      <div class="row">
        <select id="log-filter" style="width:auto;margin:0">
          <option value="">Semua Level</option>
          <option value="info">Info</option>
          <option value="warn">Warning</option>
          <option value="error">Error</option>
        </select>
        <select id="log-size" style="width:auto;margin:0">
          ${[25, 50, 100].map((n) => `<option value="${n}" ${n === logPageSize ? 'selected' : ''}>${n} baris</option>`).join('')}
        </select>
      </div>
    </div>

    ${logs.length ? `
      <div class="table-wrap">
        <table class="data-table" id="log-table">
          <thead>
            <tr>
              <th>Waktu</th>
              <th>Level</th>
              <th>Event</th>
              <th>Operasi</th>
              <th>Hasil</th>
              <th>Router ID</th>
              <th>Durasi</th>
              <th>Keterangan</th>
            </tr>
          </thead>
          <tbody>
            ${logs.map((l) => `
              <tr class="log-row" data-level="${l.level}">
                <td style="white-space:nowrap">${esc(fmtTs(l.ts))}</td>
                <td><span class="badge lvl-${l.level}">${l.level}</span></td>
                <td><b>${esc(l.event)}</b></td>
                <td>${esc(l.operation)}</td>
                <td><span class="badge ${l.result === 'success' || l.result === 'ok' ? 'ok' : l.result === 'failed' ? 'failed' : 'unknown'}">${esc(l.result)}</span></td>
                <td><code>${l.routerId ? esc(l.routerId.slice(0, 8)) : '—'}</code></td>
                <td>${l.durationMs != null ? `${l.durationMs}ms` : '—'}</td>
                <td class="cell-muted">${esc(l.message || l.error || '')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="pager">
        <span class="cell-muted">Halaman ${logPage + 1} dari ${totalPages}</span>
        <div class="pager-btns">
          <button class="btn-sm" id="log-prev" ${logPage === 0 ? 'disabled' : ''}>‹ Sebelumnya</button>
          <button class="btn-sm" id="log-next" ${logPage >= totalPages - 1 ? 'disabled' : ''}>Berikutnya ›</button>
        </div>
      </div>
    ` : '<div class="empty">Belum ada catatan aktivitas.</div>'}
  </div>`;

  const fil = document.getElementById('log-filter');
  fil.onchange = () => {
    const val = fil.value;
    document.querySelectorAll('.log-row').forEach((tr) => {
      tr.style.display = !val || tr.dataset.level === val ? '' : 'none';
    });
  };

  const sz = document.getElementById('log-size');
  sz.onchange = () => {
    logPageSize = Number(sz.value);
    logPage = 0;
    renderLogs();
  };

  const lp = document.getElementById('log-prev');
  const ln = document.getElementById('log-next');
  if (lp) lp.onclick = () => { logPage--; renderLogs(); };
  if (ln) ln.onclick = () => { logPage++; renderLogs(); };
}

/* ==========================================================================
   SSE Streaming Post Helper
   ========================================================================== */
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
  if (!res.body) throw new Error('Response stream tidak tersedia.');

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = null;
      let data = null;
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data = line.slice(5).trim();
      }
      if (!data) continue;
      const obj = JSON.parse(data);
      if (event === 'delta') onDelta(obj.delta || '');
      else if (event === 'error') throw new Error(obj.error || 'LLM streaming gagal');
      else if (event === 'status' && onStatus) onStatus(obj.step, obj.label);
    }
  }
}

// Start application
boot();