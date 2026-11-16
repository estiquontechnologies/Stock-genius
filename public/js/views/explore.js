import { api } from '../api.js';
import { html, raw, fmt, tone, viewBadge, emptyState, toast } from '../ui.js';
import { sparkline } from '../charts.js';
import { adSlot, hydrateAds } from '../ads.js';
import { horizonLabel } from './overview.js';

export async function render(el, _p, query) {
  const f = { q: query.get('q') || '', exchange: query.get('exchange') || '', sector: query.get('sector') || '', view: query.get('view') || '', horizon: query.get('horizon') || 'medium' };
  const d = await api(`/api/stocks?horizon=${f.horizon}`);
  const wls = await api('/api/watchlists');
  let sort = { key: 'name', dir: 1 };
  const selected = new Set();

  el.innerHTML = String(html`
    <div class="page-head"><div><div class="kicker">Explore</div><h1>Search and filter stocks</h1>
      <p>Filter by exchange, sector or model view. Select up to four stocks to compare side by side.</p></div></div>
    <form class="card row" id="filters" role="search" style="gap:12px;align-items:end">
      <label class="field" style="flex:2;min-width:200px">Company or ticker<input type="search" name="q" value="${f.q}" placeholder="e.g. bank, steel, ticker…"></label>
      <label class="field">Exchange<select name="exchange"><option value="">All</option>${['NSE', 'BSE'].map((x) => html`<option ${f.exchange === x ? 'selected' : ''}>${x}</option>`)}</select></label>
      <label class="field">Sector<select name="sector"><option value="">All sectors</option>${d.sectors.map((s) => html`<option ${f.sector === s ? 'selected' : ''}>${s}</option>`)}</select></label>
      <label class="field">View<select name="view"><option value="">Any</option>${['Buy', 'Hold', 'Sell'].map((x) => html`<option ${f.view === x ? 'selected' : ''}>${x}</option>`)}</select></label>
      <label class="field">Horizon<select name="horizon">${['short', 'medium', 'long'].map((x) => html`<option value="${x}" ${f.horizon === x ? 'selected' : ''}>${horizonLabel(x)}</option>`)}</select></label>
    </form>
    <div class="row between" style="margin:14px 0 8px"><span class="small muted" id="count"></span>
      <div class="row"><button class="btn sm" id="cmp" disabled>Compare selected</button>
        <select id="wl-pick" aria-label="Watchlist">${wls.map((w) => html`<option value="${w.id}">${w.name}</option>`)}</select>
        <button class="btn sm" id="add-wl" disabled>Add selected to watchlist</button></div></div>
    <div class="card pad-0" id="results"></div>
    <div style="margin-top:16px">${adSlot('inline')}</div>`);

  const results = el.querySelector('#results');
  const draw = () => {
    const q = f.q.toLowerCase();
    let rows = d.results.filter((r) => (!q || r.ticker.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)) && (!f.exchange || r.exchanges.includes(f.exchange)) && (!f.sector || r.sector === f.sector) && (!f.view || r.view === f.view));
    const k = sort.key;
    rows = rows.sort((a, b) => (typeof a[k] === 'string' ? a[k].localeCompare(b[k]) : (a[k] ?? -1e9) - (b[k] ?? -1e9)) * sort.dir);
    el.querySelector('#count').textContent = `${rows.length} stock${rows.length === 1 ? '' : 's'} · views for ${horizonLabel(f.horizon)}`;
    if (!rows.length) { results.innerHTML = String(emptyState('No stocks match these filters', 'Try clearing a filter or searching a shorter name.')); return; }
    const th = (key, label, cls = '') => html`<th class="${cls}" aria-sort="${sort.key === key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button class="sort" data-sort="${key}">${label}${sort.key === key ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>`;
    results.innerHTML = String(html`<div class="table-wrap"><table>
      <thead><tr><th><span class="sr-only">Select</span></th>${th('name', 'Company')}${th('price', 'Price', 'r')}${th('changePct', 'Day', 'r')}${th('ret1m', '1M', 'r hide-sm')}<th class="hide-sm">60 sessions</th>${th('score', 'View')}${th('confidence', 'Confidence', 'hide-sm')}${th('riskLevel', 'Risk', 'hide-sm')}</tr></thead>
      <tbody>${rows.map((r) => html`<tr>
        <td><input type="checkbox" data-sel="${r.ticker}" ${selected.has(r.ticker) ? 'checked' : ''} aria-label="Select ${r.name}"></td>
        <td><a class="name-cell" href="#/stock/${encodeURIComponent(r.ticker)}?horizon=${f.horizon}"><b>${r.name}</b><span>${r.ticker} · ${r.exchanges.join('/')} · ${r.sector}</span></a></td>
        <td class="r num">${fmt.inr(r.price)}</td><td class="r num ${tone(r.changePct)}">${fmt.pct(r.changePct / 100, 2)}</td>
        <td class="r num hide-sm ${tone(r.ret1m)}">${fmt.pct(r.ret1m)}</td>
        <td class="hide-sm">${raw(sparkline(r.spark, { w: 100, h: 28 }))}</td>
        <td>${viewBadge(r.view)}</td><td class="hide-sm small">${r.confidenceBand} (${r.confidence})</td><td class="hide-sm"><span class="risk ${r.riskLevel}">${r.riskLevel}</span></td>
      </tr>`)}</tbody></table></div>`);
  };
  draw();

  const form = el.querySelector('#filters');
  form.addEventListener('input', (e) => {
    const name = e.target.name;
    f[name] = e.target.value;
    if (name === 'horizon') { location.hash = `#/explore?${new URLSearchParams(f)}`; return; }
    history.replaceState(null, '', `#/explore?${new URLSearchParams(f)}`);
    draw();
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  results.addEventListener('click', (e) => {
    const s = e.target.closest('[data-sort]');
    if (s) { sort = { key: s.dataset.sort, dir: sort.key === s.dataset.sort ? -sort.dir : 1 }; draw(); }
  });
  results.addEventListener('change', (e) => {
    const t = e.target.dataset.sel;
    if (!t) return;
    if (e.target.checked) {
      if (selected.size >= 4) { e.target.checked = false; toast('You can compare up to four stocks.'); return; }
      selected.add(t);
    } else selected.delete(t);
    el.querySelector('#cmp').disabled = selected.size < 2;
    el.querySelector('#add-wl').disabled = selected.size < 1;
  });
  el.querySelector('#cmp').addEventListener('click', () => { location.hash = `#/desk/compare/${[...selected].join(',')}`; });
  el.querySelector('#add-wl').addEventListener('click', async () => {
    const id = el.querySelector('#wl-pick').value;
    const w = wls.find((x) => x.id === id);
    await api(`/api/watchlists/${id}`, { method: 'PUT', body: { tickers: [...w.tickers, ...selected] } });
    toast(`Added ${selected.size} to “${w.name}”`);
  });
  hydrateAds();
}
