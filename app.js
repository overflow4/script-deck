'use strict';

const DATA_URL = 'scripts.json';
const els = {
  tabs: document.getElementById('tabs'),
  deck: document.getElementById('deck'),
  search: document.getElementById('search'),
  synced: document.getElementById('synced'),
  refresh: document.getElementById('refresh'),
  toast: document.getElementById('toast'),
  foot: document.getElementById('foot-meta'),
};

let data = null;
let activeId = null;

/* ---------- helpers ---------- */

function shortLabel(title) {
  let t = title
    .replace(/\(TT,FB,IG\)/i, '')
    .replace(/PHONE SCRIPT/i, '')
    .replace(/SCRIPT/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  t = t
    .toLowerCase()
    .replace(/\bdm\b/g, 'DM')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  t = t.replace(/Dominics/i, "Dominic's");
  if (/^DM/i.test(t) && !/Script/i.test(t)) t = t.trim() + ' Script';
  return t.trim() || title;
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  );
}

// Highlight fill-in placeholders like [Name], (name), firstname.
function withPlaceholders(text) {
  let html = escapeHtml(text);
  html = html.replace(/\[[^\]\n]{1,30}\]/g, (m) => `<span class="ph">${m}</span>`);
  html = html.replace(
    /\((?:[A-Za-z][A-Za-z #/0-9'-]{0,24})\)/g,
    (m) => (/[A-Za-z]/.test(m) ? `<span class="ph">${m}</span>` : m)
  );
  html = html.replace(/\bfirstname\b/gi, (m) => `<span class="ph">${m}</span>`);
  return html;
}

function timeAgo(iso) {
  const then = new Date(iso).getTime();
  if (!then) return '';
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.round(h / 24)} d ago`;
}

function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => els.toast.classList.remove('show'), 1100);
}

async function copyText(text, cardEl) {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
      document.body.removeChild(ta);
    } catch { ok = false; }
  }
  if (ok) {
    showToast('Copied ✓');
    if (cardEl) {
      cardEl.classList.add('copied');
      clearTimeout(cardEl._t);
      cardEl._t = setTimeout(() => cardEl.classList.remove('copied'), 900);
    }
  } else {
    showToast("Couldn't copy");
  }
}

/* ---------- rendering ---------- */

function renderTabs() {
  els.tabs.innerHTML = '';
  data.sections.forEach((s) => {
    const b = document.createElement('button');
    b.className = 'tab';
    b.type = 'button';
    b.textContent = shortLabel(s.title);
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(s.id === activeId));
    b.addEventListener('click', () => {
      activeId = s.id;
      els.search.value = '';
      renderTabs();
      renderDeck();
      window.scrollTo({ top: 0 });
    });
    els.tabs.appendChild(b);
  });
}

const ICON_COPY =
  '<svg class="copy-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';

function makeBox(block) {
  if (block.role === 'label') {
    const d = document.createElement('div');
    d.className = 'divider';
    d.textContent = block.text.replace(/:\s*$/, '');
    return d;
  }
  const card = document.createElement('button');
  card.type = 'button';
  card.className = `box ${block.role}`;
  const badge = block.badge || (block.role === 'them' ? 'They say' : block.role === 'note' ? 'Note' : '');
  card.innerHTML =
    (badge ? `<span class="label">${escapeHtml(badge)}</span>` : '') +
    `<div class="body">${withPlaceholders(block.text)}</div>` +
    ICON_COPY;
  card.addEventListener('click', () => copyText(block.copy ?? block.text, card));
  return card;
}

function renderDeck() {
  const section = data.sections.find((s) => s.id === activeId) || data.sections[0];
  if (!section) {
    els.deck.innerHTML = '<p class="empty">No scripts found.</p>';
    return;
  }
  const q = els.search.value.trim().toLowerCase();
  els.deck.innerHTML = '';

  const head = document.createElement('p');
  head.className = 'deck-title';
  head.textContent = section.title;
  els.deck.appendChild(head);

  let shown = 0;
  section.blocks.forEach((block) => {
    if (q) {
      if (block.role === 'label') return; // hide dividers while searching
      if (!block.text.toLowerCase().includes(q)) return;
    }
    els.deck.appendChild(makeBox(block));
    if (block.role !== 'label') shown++;
  });

  if (shown === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = q ? 'No lines match your search.' : 'This script is empty.';
    els.deck.appendChild(p);
  }
}

function renderMeta() {
  const ago = data.updated ? timeAgo(data.updated) : '';
  els.synced.textContent = ago ? `Synced ${ago}` : 'Synced';
  const total = data.sections.reduce((n, s) => n + s.blocks.filter((b) => b.role !== 'label').length, 0);
  els.foot.textContent = `${data.sections.length} scripts · ${total} copy-ready lines · auto-synced from the team doc`;
}

/* ---------- data ---------- */

async function load(showSpin) {
  if (showSpin) els.refresh.classList.add('spin');
  try {
    const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const fresh = await res.json();
    data = fresh;
    if (!activeId || !data.sections.some((s) => s.id === activeId)) {
      const dm = data.sections.find((s) => /dm/i.test(s.id));
      activeId = (dm || data.sections[0]).id;
    }
    renderTabs();
    renderDeck();
    renderMeta();
  } catch (err) {
    if (!data) {
      els.deck.innerHTML =
        '<p class="empty error">Couldn\'t load the scripts. Pull to refresh or try again shortly.</p>';
    } else {
      showToast("Couldn't refresh");
    }
  } finally {
    els.refresh.classList.remove('spin');
  }
}

/* ---------- events ---------- */

els.search.addEventListener('input', renderDeck);
els.refresh.addEventListener('click', () => load(true));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') load(false);
});

load(false);
