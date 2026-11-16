// "My desk": user-entered data — watchlists, compare, portfolio lens,
// thesis tracker and research journal. Kept separate from model output.
import { api } from '../api.js';
import { html, fmt, tone, viewBadge, emptyState, toast, kindBadge, explain, $ } from '../ui.js';
import { lineChart, SERIES_COLORS } from '../charts.js';

export async function render(el, [section = 'watchlists', arg], query) {
  const fn = { watchlists, compare, portfolio, theses, journal }[section];
  if (!fn) { location.hash = '#/desk/watchlists'; return null; }
  return fn(el, arg, query);
}

const head = (kicker, title, desc, extra = '') => html`<div class="page-head"><div><div class="kicker">${kicker} · ${kindBadge('user')}</div><h1>${title}</h1><p>${desc}</p></div>${extra}</div>`;

// ------------------------------------------------------------ watchlists
async function watchlists(el) {
  const [wls, stocks] = await Promise.all([api('/api/watchlists', { fresh: true }), api('/api/stocks')]);
  const by = new Map(stocks.results.map((s) => [s.ticker, s]));
  el.innerHTML = String(html`
    ${head('My desk', 'Watchlists', 'Stocks you are researching. Adding a stock here does not change any view and is not a signal to act.', html`<form id="new-wl" class="row"><input type="text" name="name" placeholder="New watchlist name" aria-label="New watchlist name" maxlength="60" required><button class="btn primary">Create</button></form>`)}
    <div class="stack">${wls.map((w) => html`
      <section class="card pad-0" data-wl="${w.id}">
        <div class="card-head" style="padding:16px 18px 0"><div><h2>${w.name}</h2><p>${w.tickers.length} stock${w.tickers.length === 1 ? '' : 's'}</p></div>
          <div class="row">${w.tickers.length >= 2 ? html`<a class="btn sm" href="#/desk/compare/${w.tickers.slice(0, 4).join(',')}">Compare</a>` : ''}<button class="btn sm" data-rename>Rename</button>${w.id !== 'default' ? html`<button class="btn sm danger" data-del>Delete</button>` : ''}</div></div>
        ${w.tickers.length ? html`<div class="table-wrap"><table><thead><tr><th>Company</th><th class="r">Price</th><th class="r">Day</th><th>View (6–12 mo)</th><th class="hide-sm">Confidence</th><th class="hide-sm">Risk</th><th></th></tr></thead><tbody>
          ${w.tickers.map((t) => { const s = by.get(t); return s ? html`<tr><td><a class="name-cell" href="#/stock/${t}"><b>${s.name}</b><span>${t} · ${s.sector}</span></a></td><td class="r num">${fmt.inr(s.price)}</td><td class="r num ${tone(s.changePct)}">${fmt.pct(s.changePct / 100, 2)}</td><td>${viewBadge(s.view)}</td><td class="hide-sm small">${s.confidenceBand}</td><td class="hide-sm"><span class="risk ${s.riskLevel}">${s.riskLevel}</span></td><td class="r"><button class="btn sm ghost" data-remove="${t}" aria-label="Remove ${t}">Remove</button></td></tr>` : html`<tr><td colspan="7" class="muted">${t} — no longer covered</td></tr>`; })}
        </tbody></table></div>` : html`<div style="padding:0 18px 18px">${emptyState('Empty watchlist', 'Use search or Explore to add stocks.', html`<a class="btn" href="#/explore">Explore stocks</a>`)}</div>`}
      </section>`)}</div>`);
  $('#new-wl', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    await api('/api/watchlists', { method: 'POST', body: { name: e.target.name.value } });
    watchlists(el);
  });
  if (el._wlHandler) el.removeEventListener('click', el._wlHandler);
  el._wlHandler = async (e) => {
    const sec = e.target.closest('[data-wl]');
    if (!sec) return;
    const w = wls.find((x) => x.id === sec.dataset.wl);
    if (e.target.dataset.remove) { await api(`/api/watchlists/${w.id}`, { method: 'PUT', body: { tickers: w.tickers.filter((t) => t !== e.target.dataset.remove) } }); watchlists(el); }
    if (e.target.hasAttribute('data-del') && confirm(`Delete “${w.name}”?`)) { await api(`/api/watchlists/${w.id}`, { method: 'DELETE' }); watchlists(el); }
    if (e.target.hasAttribute('data-rename')) { const n = prompt('New name', w.name); if (n) { await api(`/api/watchlists/${w.id}`, { method: 'PUT', body: { name: n } }); watchlists(el); } }
  };
  el.addEventListener('click', el._wlHandler);
  return () => { el.removeEventListener('click', el._wlHandler); el._wlHandler = null; };
}

// --------------------------------------------------------------- compare
async function compare(el, arg, query) {
  const horizon = query.get('horizon') || 'medium';
  const tickers = (arg || '').split(',').filter(Boolean);
  const stocks = await api('/api/stocks');
  const picker = html`<form id="cmp-add" class="row"><select name="t" aria-label="Add stock to compare">${stocks.results.filter((s) => !tickers.includes(s.ticker)).map((s) => html`<option value="${s.ticker}">${s.name} (${s.ticker})</option>`)}</select><button class="btn" ${tickers.length >= 4 ? 'disabled' : ''}>Add</button></form>`;
  if (tickers.length < 1) {
    el.innerHTML = String(html`${head('My desk', 'Compare stocks', 'Put up to four stocks side by side: views, evidence, valuation, growth and risk.')}<div class="card">${emptyState('Pick stocks to compare', 'Add up to four stocks.', picker)}</div>`);
  } else {
    const d = await api(`/api/compare?tickers=${tickers.join(',')}&horizon=${horizon}`);
    const it = d.items;
    const row = (label, fn, term) => html`<tr><th scope="row" style="text-transform:none;letter-spacing:0;font-size:0.85rem">${label} ${term ? explain(term) : ''}</th>${it.map((x) => html`<td class="num">${fn(x)}</td>`)}</tr>`;
    el.innerHTML = String(html`${head('My desk', 'Compare stocks', 'Side-by-side evidence. Model views are research signals; comparing them is not a ranking.', picker)}
      <section class="card"><div class="card-head"><div><h2>Relative price performance</h2><p>Rebased to 100, last 250 sessions.</p></div></div><div class="chart" id="cmp-chart"></div>
        <div class="legend">${it.map((x, i) => html`<span><i style="background:${SERIES_COLORS[i]}"></i>${x.ticker}</span>`)}</div></section>
      <section class="card pad-0" style="margin-top:16px"><div class="table-wrap"><table>
        <thead><tr><th></th>${it.map((x) => html`<th><a href="#/stock/${x.ticker}">${x.name}</a><div class="small muted" style="text-transform:none">${x.ticker} · ${x.sector}</div><button class="btn sm ghost" data-drop="${x.ticker}">Remove</button></th>`)}</tr></thead>
        <tbody>
          ${row(`View (${({ short: '1–3 mo', medium: '6–12 mo', long: '1–3 yr' })[horizon]})`, (x) => viewBadge(x.view), 'buy-hold-sell')}
          ${row('Confidence', (x) => `${x.confidenceBand} (${x.confidence})`, 'confidence')}
          ${row('Risk level', (x) => html`<span class="risk ${x.riskLevel}">${x.riskLevel}</span>`)}
          ${row('Composite score', (x) => fmt.num(x.score, 3))}
          ${row('Price', (x) => fmt.inr(x.price))}
          ${row('1M / 3M / 1Y', (x) => html`<span class="${tone(x.ret1m)}">${fmt.pct(x.ret1m)}</span> / <span class="${tone(x.ret3m)}">${fmt.pct(x.ret3m)}</span> / <span class="${tone(x.ret1y)}">${fmt.pct(x.ret1y)}</span>`)}
          ${row('Volatility (60d, ann.)', (x) => fmt.pctAbs(x.vol), 'volatility')}
          ${row('P/E', (x) => (x.pe ? `${fmt.num(x.pe, 1)}×` : '—'), 'pe-ratio')}
          ${row('Revenue growth', (x) => fmt.pct(x.revGrowth), 'revenue-growth')}
          ${row('Profit growth', (x) => fmt.pct(x.npGrowth), 'eps')}
          ${row('ROE', (x) => (x.roe != null ? `${fmt.num(x.roe, 1)}%` : '—'), 'roe')}
          ${row('Debt / equity', (x) => (x.de != null ? fmt.num(x.de, 2) : '—'), 'debt-to-equity')}
          ${row('Top positives', (x) => html`<ul class="bullet small" style="text-align:left">${x.topPositive.map((s) => html`<li>${s.label}</li>`)}</ul>`)}
          ${row('Top negatives', (x) => html`<ul class="bullet small" style="text-align:left">${x.topNegative.map((s) => html`<li>${s.label}</li>`)}</ul>`)}
        </tbody></table></div></section>`);
    const c = lineChart($('#cmp-chart', el), { dates: it[0]?.dates || [], series: it.map((x, i) => ({ name: x.ticker, values: x.series, color: SERIES_COLORS[i] })), baseline: 100 });
    el.querySelectorAll('[data-drop]').forEach((b) => b.addEventListener('click', () => { location.hash = `#/desk/compare/${tickers.filter((t) => t !== b.dataset.drop).join(',')}`; }));
    $('#cmp-add', el)?.addEventListener('submit', (e) => { e.preventDefault(); location.hash = `#/desk/compare/${[...tickers, e.target.t.value].join(',')}`; });
    return c;
  }
  $('#cmp-add', el)?.addEventListener('submit', (e) => { e.preventDefault(); location.hash = `#/desk/compare/${[...tickers, e.target.t.value].join(',')}`; });
  return null;
}

// ------------------------------------------------------------- portfolio
async function portfolio(el) {
  const d = await api('/api/portfolio', { fresh: true });
  const a = d.analysis;
  el.innerHTML = String(html`
    ${head('My desk', 'Portfolio exposure lens', 'Optionally enter holdings to see concentration, sector exposure and sensitivity to broad risks. This is a description of what you entered — not advice, not optimisation, and kept separate from stock views.')}
    <div class="callout warn" style="margin-bottom:14px">Stock Genius never connects to your broker and never asks for brokerage credentials. Holdings are stored only on this server and never shared with advertisers.</div>
    <div class="layout-main">
      <div class="stack">${!a ? html`<div class="card">${emptyState('No holdings entered', 'Add ticker and quantity on the right, or paste CSV lines like “TICKER,QUANTITY”.')}</div>` : a.empty ? html`<div class="card">${emptyState('No recognised holdings', `Unknown tickers: ${a.unknown.join(', ') || 'none'}`)}</div>` : html`
        <div class="grid cols-4">
          ${stat('Total value', fmt.inr(a.totalValue, 0), 'at latest prices')}
          ${stat('Largest holding', fmt.pctAbs(a.concentration.top1, 0), a.holdings[0].ticker)}
          ${stat('Effective holdings', fmt.num(a.concentration.effectiveN, 1), 'diversification equivalent', 'concentration')}
          ${stat('Portfolio beta', fmt.num(a.beta, 2), 'vs tracked market', 'beta')}
        </div>
        ${a.flags.length ? html`<div class="callout info"><b>Observations</b><ul class="bullet small">${a.flags.map((f) => html`<li>${f}</li>`)}</ul></div>` : ''}
        <div class="grid cols-2">
          <div class="card"><h3>Sector exposure</h3><div class="stack" style="gap:8px;margin-top:10px">${a.sectors.map((s) => html`<div class="row"><span class="small" style="width:150px">${s.sector}</span><div class="meter" style="flex:1"><span style="width:${s.weight * 100}%"></span></div><span class="num small" style="width:44px;text-align:right">${fmt.pctAbs(s.weight, 0)}</span></div>`)}</div></div>
          <div class="card"><h3>Sensitivity to broad risks ${explain('macro-sensitivity')}</h3><p class="small muted">Weighted sector assumptions — directional, not precise.</p>
            <ul class="list-plain small" style="margin-top:8px">${a.factors.map((f) => html`<li class="row between"><span>${f.label}</span><b style="color:${f.sensitivity <= -0.25 ? 'var(--sell)' : f.sensitivity >= 0.25 ? 'var(--buy)' : 'inherit'}">${f.reading} (${f.sensitivity > 0 ? '+' : ''}${f.sensitivity})</b></li>`)}</ul></div>
        </div>
        <div class="card"><h3>How these weights behaved historically</h3><p class="small muted">Applies today’s weights to the past ${a.history.sessions} sessions. Not a record of your returns.</p>
          <div class="grid cols-3" style="margin-top:10px">${stat('Volatility (ann.)', fmt.pctAbs(a.history.volatility), `market ${fmt.pctAbs(a.history.marketVolatility)}`)}${stat('Max drawdown', fmt.pctAbs(-a.history.maxDrawdown), 'peak to trough')}${stat('If the market fell 10%', fmt.pct(a.roughMarketShock.estimate), 'beta approximation')}</div>
          <p class="small muted">${a.roughMarketShock.note}</p></div>
        <div class="card pad-0"><div class="table-wrap"><table><thead><tr><th>Holding</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Value</th><th class="r">Weight</th><th class="r">Beta</th></tr></thead><tbody>
          ${a.holdings.map((h) => html`<tr><td><a href="#/stock/${h.ticker}">${h.ticker}</a> <span class="small muted">${h.sector}</span></td><td class="r num">${fmt.num(h.quantity, 0)}</td><td class="r num">${fmt.inr(h.price)}</td><td class="r num">${fmt.inr(h.value, 0)}</td><td class="r num">${fmt.pctAbs(h.weight, 1)}</td><td class="r num">${fmt.num(h.beta, 2)}</td></tr>`)}</tbody></table></div></div>
        <p class="small muted">${a.disclaimer}</p>`}
      </div>
      <aside class="card"><h3>Your holdings</h3>
        <form id="pf" class="form-grid" style="margin-top:10px">
          <label class="field">One per line: TICKER,QUANTITY<textarea name="csv" rows="10" placeholder="ABCD,10&#10;WXYZ,25">${(d.holdings || []).map((h) => `${h.ticker},${h.quantity}`).join('\n')}</textarea></label>
          <div class="row"><button class="btn primary">Save & analyse</button><button class="btn" type="button" id="pf-clear">Clear</button></div>
        </form></aside>
    </div>`);
  $('#pf', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await api('/api/portfolio/import', { method: 'POST', body: { csv: e.target.csv.value } });
    if (r.skipped) toast(`${r.skipped} line(s) skipped (invalid ticker or quantity)`);
    portfolio(el);
  });
  $('#pf-clear', el).addEventListener('click', async () => { await api('/api/portfolio', { method: 'PUT', body: { holdings: [] } }); portfolio(el); });
}
const stat = (l, v, s, term) => html`<div class="card"><div class="stat"><span class="label">${l} ${term ? explain(term) : ''}</span><span class="value num">${v}</span><span class="sub muted">${s}</span></div></div>`;

// ---------------------------------------------------------------- theses
const STATUS = { holds: ['Holds', 'var(--buy)'], 'at-risk': ['At risk', 'var(--hold)'], broken: ['Broken', 'var(--sell)'], 'no-data': ['No data', 'var(--muted)'], unreviewed: ['Not reviewed', 'var(--muted)'], unclear: ['Unclear', 'var(--muted)'] };

async function theses(el, arg, query) {
  if (arg === 'new') return thesisForm(el, query.get('ticker'));
  if (arg) return thesisReview(el, arg);
  const list = await api('/api/theses', { fresh: true });
  el.innerHTML = String(html`${head('My desk', 'Thesis tracker', 'Write down why you are interested in a stock and which assumptions must hold. Review it later against new results, news and price action.', html`<a class="btn primary" href="#/desk/theses/new">New thesis</a>`)}
    ${list.length ? html`<div class="grid cols-2">${list.map((t) => html`<a class="card" href="#/desk/theses/${t.id}" style="color:inherit;text-decoration:none">
      <div class="row between"><h3>${t.title}</h3><span class="pill">${t.ticker}</span></div>
      <p class="small muted">${t.text.slice(0, 180)}${t.text.length > 180 ? '…' : ''}</p>
      <div class="small">Written ${fmt.date(t.createdAt)} · ${t.assumptions.length} assumption${t.assumptions.length === 1 ? '' : 's'} · model view then: ${t.atCreation?.view || '—'}</div></a>`)}</div>`
    : html`<div class="card">${emptyState('No theses yet', 'A thesis is your own reasoning. Stock Genius checks measurable assumptions automatically and lets you mark the rest yourself.', html`<a class="btn primary" href="#/desk/theses/new">Write your first thesis</a>`)}</div>`}`);
  return null;
}

async function thesisForm(el, presetTicker) {
  const [stocks, metrics] = await Promise.all([api('/api/stocks'), api('/api/thesis-metrics')]);
  const metricOpts = html`<option value="">Manual (I’ll judge it)</option>${Object.entries(metrics).map(([k, m]) => html`<option value="${k}">${m.label}</option>`)}`;
  const assumptionRow = () => html`<div class="row assumption" style="align-items:end">
    <label class="field" style="flex:2;min-width:200px">Assumption<input type="text" name="a-text" maxlength="300" placeholder="e.g. Profit keeps growing above 15%"></label>
    <label class="field">Check with<select name="a-metric">${metricOpts}</select></label>
    <label class="field" style="width:80px">Rule<select name="a-op"><option value=">=">≥</option><option value="<=">≤</option></select></label>
    <label class="field" style="width:110px">Threshold<input type="number" step="any" name="a-th"></label></div>`;
  el.innerHTML = String(html`${head('Thesis tracker', 'New thesis', 'Your own reasoning, stored as your input and never mixed with model output.')}
    <form class="card form-grid" id="tf">
      <div class="row"><label class="field" style="flex:1">Stock<select name="ticker" required>${stocks.results.map((s) => html`<option value="${s.ticker}" ${s.ticker === presetTicker ? 'selected' : ''}>${s.name} (${s.ticker})</option>`)}</select></label>
        <label class="field">Horizon<select name="horizon"><option value="short">1–3 months</option><option value="medium" selected>6–12 months</option><option value="long">1–3 years</option></select></label></div>
      <label class="field">Title<input type="text" name="title" maxlength="120" placeholder="e.g. Margin recovery story"></label>
      <label class="field">Thesis<textarea name="text" maxlength="4000" placeholder="Why are you interested? What has to go right? What would make you change your mind?"></textarea></label>
      <div><h3>Assumptions to track</h3><p class="small muted">Link an assumption to a metric to have it checked automatically against the latest data.</p><div id="as" class="stack" style="gap:8px;margin-top:8px">${assumptionRow()}${assumptionRow()}</div>
        <button type="button" class="btn sm" id="add-a" style="margin-top:8px">+ Add assumption</button></div>
      <div class="row"><button class="btn primary">Save thesis</button><a class="btn ghost" href="#/desk/theses">Cancel</a></div>
    </form>`);
  $('#add-a', el).addEventListener('click', () => $('#as', el).insertAdjacentHTML('beforeend', String(assumptionRow())));
  $('#tf', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const assumptions = [...el.querySelectorAll('.assumption')].map((r) => ({ text: r.querySelector('[name=a-text]').value, metric: r.querySelector('[name=a-metric]').value || null, op: r.querySelector('[name=a-op]').value, threshold: Number(r.querySelector('[name=a-th]').value) })).filter((a) => a.text.trim());
    const t = await api('/api/theses', { method: 'POST', body: { ticker: f.ticker.value, horizon: f.horizon.value, title: f.title.value, text: f.text.value, assumptions } });
    location.hash = `#/desk/theses/${t.id}`;
  });
  return null;
}

async function thesisReview(el, id) {
  const d = await api(`/api/theses/${id}/review`, { fresh: true });
  const t = d.thesis;
  el.innerHTML = String(html`${head('Thesis tracker', t.title, `${t.ticker} · written ${fmt.date(t.createdAt)} · horizon ${({ short: '1–3 months', medium: '6–12 months', long: '1–3 years' })[t.horizon]}`, html`<button class="btn danger" id="del">Delete</button>`)}
    <div class="grid cols-4">
      ${stat('Assumptions holding', `${d.counts.holds} / ${d.assumptions.length}`, `${d.counts['at-risk']} at risk · ${d.counts.broken} broken`)}
      ${stat('Price since written', fmt.pct(d.priceChange), `${fmt.inr(t.atCreation?.price)} → ${fmt.inr(d.now.price)}`)}
      ${stat('Model view then → now', `${t.atCreation?.view || '—'} → ${d.now.view}`, `${d.viewChanges.length} change(s) since`)}
      ${stat('Current risk level', d.now.riskLevel, `data as of ${fmt.date(d.now.date)}`)}
    </div>
    <div class="layout-main" style="margin-top:16px">
      <div class="stack">
        <div class="card"><div class="row between"><h3>Your thesis</h3>${kindBadge('user')}</div><p style="white-space:pre-wrap">${t.text || '—'}</p></div>
        <div class="card"><h3>Assumptions</h3><ul class="list-plain" style="margin-top:10px">${d.assumptions.map((a) => html`<li class="row between" style="border-top:1px solid var(--line);padding-top:8px" data-aid="${a.id}">
          <div><b>${a.text}</b>${a.auto ? html`<div class="small muted">${a.metricLabel} ${a.op} ${a.threshold} · now <b>${a.current ?? 'n/a'}</b></div>` : html`<div class="small muted">Manual — mark it yourself</div>`}</div>
          <div class="row"><span class="badge" style="background:color-mix(in srgb, ${STATUS[a.status]?.[1] || 'var(--muted)'} 15%, transparent);color:${STATUS[a.status]?.[1] || 'var(--muted)'}">${STATUS[a.status]?.[0] || a.status}</span>
            ${a.auto ? '' : html`<select data-manual aria-label="Mark assumption"><option value="">Mark…</option><option value="holds">Holds</option><option value="at-risk">At risk</option><option value="broken">Broken</option><option value="unclear">Unclear</option></select>`}</div></li>`)}</ul></div>
      </div>
      <aside class="stack">
        <div class="card"><h3>Since you wrote it</h3>
          <div class="kicker" style="margin-top:10px">Results reported</div>${d.resultsSince.length ? html`<ul class="list-plain small">${d.resultsSince.map((r) => html`<li>${r.label} (${fmt.date(r.reportDate)}) · net profit ${fmt.cr(r.netProfit)}</li>`)}</ul>` : html`<p class="small muted">None yet</p>`}
          <div class="kicker" style="margin-top:10px">Model view changes</div>${d.viewChanges.length ? html`<ul class="list-plain small">${d.viewChanges.map((v) => html`<li>${fmt.date(v.date)} → ${viewBadge(v.view)}</li>`)}</ul>` : html`<p class="small muted">None</p>`}
          <div class="kicker" style="margin-top:10px">Company news</div>${d.newsSince.length ? html`<ul class="list-plain small">${d.newsSince.map((n) => html`<li><a href="${n.url}">${n.headline}</a> <span class="muted">${fmt.date(n.publishedAt)}</span></li>`)}</ul>` : html`<p class="small muted">None</p>`}
        </div>
        <a class="btn" href="#/stock/${t.ticker}?horizon=${t.horizon}">Open current research</a>
      </aside>
    </div>`);
  $('#del', el).addEventListener('click', async () => { if (confirm('Delete this thesis?')) { await api(`/api/theses/${id}`, { method: 'DELETE' }); location.hash = '#/desk/theses'; } });
  el.querySelectorAll('[data-manual]').forEach((s) => s.addEventListener('change', async () => {
    const aid = s.closest('[data-aid]').dataset.aid;
    const assumptions = t.assumptions.map((a) => (a.id === aid ? { ...a, manualStatus: s.value || null } : a));
    await api(`/api/theses/${id}`, { method: 'PUT', body: { assumptions } });
    thesisReview(el, id);
  }));
  return null;
}

// --------------------------------------------------------------- journal
async function journal(el) {
  const [list, stocks] = await Promise.all([api('/api/journal', { fresh: true }), api('/api/stocks')]);
  el.innerHTML = String(html`${head('My desk', 'Research journal', 'Dated snapshots of what the site said and your own notes, so you can compare earlier analysis with what happened later.')}
    <form class="card form-grid" id="jf" style="margin-bottom:16px">
      <div class="row"><label class="field" style="flex:1">Stock (optional — attaches a snapshot of the current view)<select name="ticker"><option value="">No stock — note only</option>${stocks.results.map((s) => html`<option value="${s.ticker}">${s.name} (${s.ticker})</option>`)}</select></label>
        <label class="field">Horizon<select name="horizon"><option value="short">1–3 months</option><option value="medium" selected>6–12 months</option><option value="long">1–3 years</option></select></label></div>
      <label class="field">Note<textarea name="note" maxlength="4000" placeholder="What are you seeing? What would you check next?"></textarea></label>
      <div><button class="btn primary">Save entry</button></div>
    </form>
    ${list.length ? html`<div class="stack">${list.map((j) => html`<article class="card">
      <div class="row between"><div class="row"><b>${fmt.datetime(j.createdAt)}</b>${j.ticker ? html`<a class="pill" href="#/stock/${j.ticker}">${j.ticker}</a>` : ''}</div><button class="btn sm ghost danger" data-del="${j.id}">Delete</button></div>
      ${j.note ? html`<p style="white-space:pre-wrap"><span class="badge user">Your note</span> ${j.note}</p>` : ''}
      ${j.snapshot ? html`<div class="grid cols-2" style="margin-top:8px">
        <div class="callout"><div class="kicker">Then · ${fmt.date(j.snapshot.asOfDate)}</div><div class="row" style="margin-top:4px">${viewBadge(j.snapshot.view)}<span class="small">${j.snapshot.confidenceBand} (${j.snapshot.confidence}) · risk ${j.snapshot.riskLevel} · ${fmt.inr(j.snapshot.price)}</span></div><p class="small muted">${j.snapshot.summary}</p></div>
        <div class="callout"><div class="kicker">Now${j.now ? ` · ${fmt.date(j.now.date)}` : ''}</div>${j.now ? html`<div class="row" style="margin-top:4px">${viewBadge(j.now.view)}<span class="small">confidence ${j.now.confidence} · risk ${j.now.riskLevel} · ${fmt.inr(j.now.price)}</span></div><p class="small">Price since snapshot: <b class="${tone(j.priceChange)}">${fmt.pct(j.priceChange)}</b></p>` : html`<p class="small muted">Current data unavailable.</p>`}</div>
      </div>` : ''}</article>`)}</div>` : html`<div class="card">${emptyState('Your journal is empty', 'Save a note, or a snapshot from any stock page, to build a record you can review later.')}</div>`}`);
  $('#jf', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (!f.ticker.value && !f.note.value.trim()) { toast('Add a note or choose a stock'); return; }
    await api('/api/journal', { method: 'POST', body: { ticker: f.ticker.value || null, horizon: f.horizon.value, note: f.note.value } });
    journal(el);
  });
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { await api(`/api/journal/${b.dataset.del}`, { method: 'DELETE' }); journal(el); }));
  return null;
}
