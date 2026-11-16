// App shell: routing, global search, status bar, explainer popovers.
import { api } from './api.js';
import { html, esc, $, $$, fmt, errorState, pageSkeleton, viewBadge } from './ui.js';
import { initAds, hydrateAds } from './ads.js';
import * as overview from './views/overview.js';
import * as explore from './views/explore.js';
import * as stock from './views/stock.js';
import * as calendar from './views/calendar.js';
import * as radar from './views/radar.js';
import * as breadth from './views/breadth.js';
import * as alerts from './views/alerts.js';
import * as desk from './views/desk.js';
import * as methodology from './views/methodology.js';
import * as source from './views/source.js';
import * as options from './views/options.js';

export const state = { meta: null, glossary: null, level: 'beginner' };
try { state.level = localStorage.getItem('sg-level') || 'beginner'; } catch { /* ignore */ }

const ROUTES = [
  [/^\/?$/, overview, 'overview'],
  [/^\/explore$/, explore, 'explore'],
  [/^\/stock\/([^/]+)$/, stock, 'explore'],
  [/^\/options(?:\/([^/]+))?$/, options, 'options'],
  [/^\/calendar$/, calendar, 'calendar'],
  [/^\/radar$/, radar, 'radar'],
  [/^\/breadth$/, breadth, 'breadth'],
  [/^\/alerts$/, alerts, 'alerts'],
  [/^\/desk(?:\/(\w+))?(?:\/([^/]+))?$/, desk, 'desk'],
  [/^\/methodology(?:\/(\w+))?$/, methodology, 'methodology'],
  [/^\/source\/(.+)$/, source, null],
];

let cleanup = null;
let navToken = 0;

async function route() {
  const hash = location.hash.slice(1) || '/';
  const [path, qs] = hash.split('?');
  const query = new URLSearchParams(qs || '');
  const app = $('#app');
  for (const [re, view, nav] of ROUTES) {
    const m = path.match(re);
    if (!m) continue;
    $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));
    $('#nav').classList.remove('open');
    $('#menu-btn').setAttribute('aria-expanded', 'false');
    if (typeof cleanup === 'function') cleanup();
    cleanup = null;
    const token = ++navToken;
    app.innerHTML = String(pageSkeleton());
    window.scrollTo(0, 0);
    try {
      const c = await view.render(app, m.slice(1).map((x) => (x ? decodeURIComponent(x) : x)), query, () => token === navToken);
      if (token === navToken) { cleanup = c; hydrateAds(); }
    } catch (err) {
      if (token !== navToken) return;
      app.innerHTML = String(errorState(err));
      app.querySelector('[data-action="retry"]')?.addEventListener('click', route);
    }
    updateSubnav(nav, path);
    return;
  }
  app.innerHTML = String(html`<div class="card"><div class="empty"><h3>Page not found</h3><a class="btn" href="#/">Go to markets</a></div></div>`);
}

function updateSubnav(nav, path) {
  const el = $('#subnav');
  if (nav !== 'desk') { el.hidden = true; return; }
  const items = [['watchlists', 'Watchlists'], ['compare', 'Compare'], ['portfolio', 'Portfolio lens'], ['theses', 'Thesis tracker'], ['journal', 'Research journal']];
  const cur = path.split('/')[2] || 'watchlists';
  el.innerHTML = String(html`${items.map(([k, l]) => html`<a href="#/desk/${k}" class="${cur === k ? 'active' : ''}">${l}</a>`)}<span class="badge user" style="align-self:center">Your input</span>`);
  el.hidden = false;
}

export function renderStatus(meta) {
  const d = meta?.data;
  const el = $('#statusbar');
  if (!d) { el.innerHTML = ''; return; }
  const parts = [];
  if (d.simulated) {
    parts.push(html`<div class="status sample"><span class="icon" aria-hidden="true">◆</span><div><b>Sample data mode.</b> Every company, price, headline, event and estimate shown is fictional and generated for demonstration. Nothing here describes a real security. <a href="#/methodology/data">How to connect real data</a></div></div>`);
  } else {
    const mode = { eod: 'End-of-day prices', live: 'Live prices', delayed: 'Delayed prices' }[d.dataMode] || d.dataMode;
    parts.push(html`<div class="status"><span class="icon" aria-hidden="true">●</span><div><b>${mode}</b> · latest session ${fmt.date(d.asOf)} · ${d.name}${d.liveQuotes ? ' · live last-traded prices via your Upstox account where available' : ''}. <a href="#/methodology/data">Data sources & coverage</a></div></div>`);
  }
  if (d.stale) parts.push(html`<div class="status stale" style="margin-top:8px"><span class="icon" aria-hidden="true">!</span><div><b>Data may be stale.</b> ${d.staleReason} Views below are based on the latest available data.</div></div>`);
  el.innerHTML = String(html`${parts}`);
}

// ----------------------------------------------------------------- search
let searchList = null;
async function setupSearch() {
  const input = $('#global-search');
  const box = $('#search-results');
  let active = -1;
  const close = () => { box.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
  const show = async () => {
    const q = input.value.trim().toLowerCase();
    if (!q) return close();
    try {
      if (!searchList) searchList = (await api('/api/stocks')).results;
    } catch { box.innerHTML = '<div class="empty small">Search unavailable while data loads.</div>'; box.hidden = false; return; }
    const hits = searchList.filter((s) => s.ticker.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)).slice(0, 8);
    box.innerHTML = hits.length
      ? String(html`${hits.map((s, i) => html`<a href="#/stock/${encodeURIComponent(s.ticker)}" role="option" id="sr-${i}"><span><b>${s.name}</b> <span class="muted small">${s.ticker} · ${s.exchanges.join('/')} · ${s.sector}</span></span><span>${viewBadge(s.view)}</span></a>`)}`)
      : String(html`<div class="empty small">No matches for “${q}”.</div>`);
    box.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };
  input.addEventListener('input', show);
  input.addEventListener('focus', show);
  input.addEventListener('keydown', (e) => {
    const items = $$('a', box);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((a, i) => a.classList.toggle('active', i === active));
      input.setAttribute('aria-activedescendant', items[active]?.id || '');
    } else if (e.key === 'Enter') {
      const a = items[active] || items[0];
      if (a) { location.hash = a.getAttribute('href'); input.value = ''; close(); input.blur(); }
    } else if (e.key === 'Escape') close();
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) close(); else if (e.target.closest('.search-results a')) { input.value = ''; close(); } });
}

// ------------------------------------------------------------- explainers
async function openExplainer(btn) {
  const term = btn.dataset.term;
  if (!state.glossary) state.glossary = await api('/api/glossary');
  const g = state.glossary[term];
  $('.popover')?.remove();
  if (!g) return;
  const pop = document.createElement('div');
  pop.className = 'popover';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', `Explain: ${g.term}`);
  const render = () => {
    pop.innerHTML = `<div class="row between"><h3>${esc(g.term)}</h3><button class="btn sm ghost" data-close aria-label="Close">✕</button></div>
      <div class="seg" role="group" aria-label="Explanation level">${['beginner', 'intermediate', 'advanced'].map((l) => `<button type="button" data-level="${l}" aria-pressed="${state.level === l}">${l[0].toUpperCase() + l.slice(1)}</button>`).join('')}</div>
      <p style="margin-top:12px">${esc(g[state.level])}</p>`;
  };
  render();
  document.body.appendChild(pop);
  const r = btn.getBoundingClientRect();
  const top = Math.min(window.innerHeight - pop.offsetHeight - 12, r.bottom + 8);
  pop.style.top = `${Math.max(12, top)}px`;
  pop.style.left = `${Math.max(12, Math.min(window.innerWidth - pop.offsetWidth - 12, r.left - 20))}px`;
  pop.addEventListener('click', (e) => {
    const l = e.target.closest('[data-level]')?.dataset.level;
    if (l) { state.level = l; try { localStorage.setItem('sg-level', l); } catch { /* ignore */ } render(); }
    if (e.target.closest('[data-close]')) { pop.remove(); btn.focus(); }
  });
  pop.querySelector('[data-level]')?.focus();
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-term]');
  if (b) { e.preventDefault(); openExplainer(b); return; }
  if (!e.target.closest('.popover')) $('.popover')?.remove();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('.popover')?.remove(); });

// ------------------------------------------------------------- theme etc.
function setupTheme() {
  let t = null;
  try { t = localStorage.getItem('sg-theme'); } catch { /* ignore */ }
  if (t) document.documentElement.dataset.theme = t;
  $('#theme-toggle').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('sg-theme', document.documentElement.dataset.theme); } catch { /* ignore */ }
    route();
  });
  $('#menu-btn').addEventListener('click', () => {
    const open = $('#nav').classList.toggle('open');
    $('#menu-btn').setAttribute('aria-expanded', String(open));
  });
}

export async function refreshAlertCount() {
  try {
    const a = await api('/api/alerts', { fresh: true });
    const unread = a.alerts.filter((x) => !x.read).length;
    const el = $('#alert-count');
    el.hidden = !unread;
    el.textContent = unread > 99 ? '99+' : String(unread);
  } catch { /* ignore */ }
}

async function boot() {
  setupTheme();
  setupSearch();
  try {
    state.meta = await api('/api/meta');
    renderStatus(state.meta);
    initAds(state.meta.ads);
  } catch { /* status bar stays empty; views show errors */ }
  window.addEventListener('hashchange', route);
  await route();
  refreshAlertCount();
}

boot();
