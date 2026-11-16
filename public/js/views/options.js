// Options research: overview of F&O underlyings and a per-underlying chain
// page with analytics, charts and an educational payoff simulator.
import { api } from '../api.js';
import { html, raw, esc, fmt, tone, kindBadge, explain, emptyState, freshnessBadge, $ } from '../ui.js';
import { lineChart } from '../charts.js';

export async function render(el, [symbol], query) {
  return symbol ? detail(el, symbol, query.get('expiry')) : overview(el);
}

const riskBanner = (r) => html`<div class="callout warn" role="note" style="margin-bottom:16px"><b>⚠ ${r.headline}</b> ${r.body}<div class="source-line">Source: ${r.source}</div></div>`;
const pctv = (x, d = 1) => (x == null ? '—' : `${(x * 100).toFixed(d)}%`);

// --------------------------------------------------------------- overview
async function overview(el) {
  const d = await api('/api/options');
  if (!d.available || !d.underlyings.length) {
    el.innerHTML = String(html`<div class="page-head"><div><div class="kicker">Options research</div><h1>Options</h1></div></div>
      <div class="card">${emptyState('No option data yet', d.data?.simulated ? 'Option chains are not available.' : 'The collector downloads the NSE F&O bhavcopy after each session. Option data appears after the next successful run.')}</div>`);
    return;
  }
  el.innerHTML = String(html`
    <div class="page-head"><div><div class="kicker">Options research ${explain('option')}</div><h1>What the options market is pricing</h1>
      <p>Implied volatility, expected moves and positioning for indices and stocks with listed options, from end-of-day data. Research and education only — no trade suggestions.</p></div>
      ${d.data.simulated ? kindBadge('sample') : freshnessBadge('eod')}</div>
    ${riskBanner(d.risk)}
    <div class="card pad-0"><div class="table-wrap"><table>
      <thead><tr><th>Underlying</th><th class="r">Spot</th><th>Nearest expiry</th><th class="r">ATM IV ${explain('implied-volatility', '')}</th><th class="r hide-sm">Realised (20d)</th><th class="r hide-sm">IV percentile ${explain('iv-rank', '')}</th><th class="r">Expected move ${explain('expected-move', '')}</th><th class="r hide-sm">PCR ${explain('pcr', '')}</th><th class="r hide-sm">Max pain ${explain('max-pain', '')}</th><th class="hide-sm">Results</th></tr></thead>
      <tbody>${d.underlyings.map((u) => html`<tr>
        <td><a class="name-cell" href="#/options/${encodeURIComponent(u.symbol)}"><b>${u.name}</b><span>${u.symbol} · ${u.kind} · lot ${u.lotSize ?? '—'}</span></a></td>
        <td class="r num">${fmt.num(u.spot, 2)}</td>
        <td class="small">${fmt.date(u.expiry)} <span class="muted">(${u.daysToExpiry}d)</span></td>
        <td class="r num"><b>${pctv(u.atmIv)}</b></td>
        <td class="r num hide-sm">${pctv(u.realisedVol)}</td>
        <td class="r num hide-sm">${u.ivPercentile == null ? '—' : Math.round(u.ivPercentile * 100)}</td>
        <td class="r num">±${pctv(u.expectedMovePct)}</td>
        <td class="r num hide-sm">${u.pcr == null ? '—' : u.pcr.toFixed(2)}</td>
        <td class="r num hide-sm">${fmt.num(u.maxPain, 0)}</td>
        <td class="small hide-sm">${u.nextEarnings ? `in ${u.nextEarnings.daysAway}d` : '—'}</td></tr>`)}</tbody></table></div></div>
    <p class="small muted" style="margin-top:10px">IV and Greeks are computed by Stock Genius from end-of-day prices (Black-Scholes). Expected move = at-the-money straddle cost ÷ spot. ${d.data.simulated ? 'All option data on this page is simulated.' : ''}</p>`);
}

// ----------------------------------------------------------------- detail
async function detail(el, symbol, expiry) {
  const d = await api(`/api/options/${encodeURIComponent(symbol)}${expiry ? `?expiry=${expiry}` : ''}`);
  const a = d.selected;
  const cleanups = [];
  const em = a.expectedMove.straddlePct;
  el.innerHTML = String(html`
    <nav class="small muted" aria-label="Breadcrumb"><a href="#/options">Options</a> / ${d.symbol}</nav>
    <div class="page-head" style="margin-top:8px"><div>
      <div class="row">${d.simulated ? kindBadge('sample') : freshnessBadge(d.freshness)}<span class="badge neutral">${d.kind}</span><span class="badge neutral">Lot size ${d.lotSize ?? '—'}</span></div>
      <h1 style="margin-top:8px">${d.name} options</h1>
      <p>Spot ${fmt.num(d.spot, 2)} · end-of-day data for ${fmt.date(d.asOf)} · ${d.sourceUrl ? html`<a href="${d.sourceUrl}" target="_blank" rel="noopener nofollow">${d.source}</a>` : d.source}${d.ticker ? html` · <a href="#/stock/${d.ticker}" style="white-space:nowrap">Stock research →</a>` : ''}</p></div>
      <label class="field">Expiry<select id="exp">${d.expiries.map((e) => html`<option value="${e}" ${e === a.expiry ? 'selected' : ''}>${fmt.date(e)}</option>`)}</select></label></div>
    ${riskBanner(d.risk)}

    <div class="grid cols-4">
      ${card('ATM implied volatility', pctv(a.atmIv), d.realisedVol ? `20-day realised ${pctv(d.realisedVol)}` : '', 'implied-volatility')}
      ${card('Expected move by expiry', em ? `±${pctv(em)}` : '—', em ? `≈ ${fmt.num(d.spot * (1 - em), 0)} – ${fmt.num(d.spot * (1 + em), 0)} · ${a.daysToExpiry} days` : '', 'expected-move')}
      ${card('Put-call ratio (OI)', a.pcrOi?.toFixed(2) ?? '—', `by volume ${a.pcrVolume?.toFixed(2) ?? '—'}`, 'pcr')}
      ${card('Max pain', fmt.num(a.maxPain, 0), `IV percentile ${d.ivPercentile == null ? 'n/a (short history)' : Math.round(d.ivPercentile * 100)}`, 'max-pain')}
    </div>

    <section class="card" style="margin-top:16px"><div class="card-head"><div><h2>Reading the chain</h2><p>Facts from the data, with the model’s interpretation. None of this predicts where the price will go.</p></div></div>
      <div class="stack" style="gap:10px">${d.notes.map((n) => html`<div class="signal"><div class="fact-line"><span class="badge fact">Fact</span><span>${n.fact}</span></div><div class="analysis-line"><span class="badge analysis">Analysis</span><span>${n.analysis}</span></div></div>`)}</div></section>

    <section class="grid cols-2" style="margin-top:16px">
      <div class="card"><div class="card-head"><div><h2>Open interest by strike ${explain('open-interest')}</h2><p>Outstanding contracts. Heavy strikes are often watched as levels, but OI does not show who bought or sold.</p></div>
        <div class="seg" role="group" aria-label="OI view"><button type="button" data-oi="oi" aria-pressed="true">Total</button><button type="button" data-oi="chgOi" aria-pressed="false">Change</button></div></div>
        <div class="chart" id="oi-chart"></div>
        <div class="legend"><span><i style="background:var(--chart-2)"></i>Calls</span><span><i style="background:var(--chart-1)"></i>Puts</span><span><i style="background:var(--ink)"></i>Spot</span></div></div>
      <div class="card"><div class="card-head"><div><h2>Volatility smile ${explain('implied-volatility')}</h2><p>Implied volatility across strikes (out-of-the-money side). Higher put IV = demand for downside protection.</p></div></div>
        <div class="chart" id="smile-chart"></div>
        <div class="legend"><span><i style="background:var(--chart-1)"></i>Put IV (below spot)</span><span><i style="background:var(--chart-2)"></i>Call IV (above spot)</span></div></div>
    </section>

    <section class="grid cols-2" style="margin-top:16px">
      <div class="card"><div class="card-head"><div><h2>ATM IV history</h2><p>${d.history.length < 20 ? 'History builds up as data is collected each day.' : 'At-the-money IV of the nearest expiry, with 20-day realised volatility for comparison where available.'}</p></div></div><div class="chart" id="iv-hist"></div></div>
      <div class="card pad-0"><div class="card-head" style="padding:16px 18px 0"><div><h2>Term structure</h2><p>How implied volatility and the priced move change by expiry.</p></div></div>
        <div class="table-wrap"><table><thead><tr><th>Expiry</th><th class="r">Days</th><th class="r">ATM IV</th><th class="r">Expected move</th><th class="r">PCR</th></tr></thead>
        <tbody>${d.term.map((t) => html`<tr ${t.expiry === a.expiry ? raw('style="font-weight:700"') : ''}><td><a href="#/options/${d.symbol}?expiry=${t.expiry}">${fmt.date(t.expiry)}</a></td><td class="r num">${t.daysToExpiry}</td><td class="r num">${pctv(t.atmIv)}</td><td class="r num">±${pctv(t.straddlePct)}</td><td class="r num">${t.pcr?.toFixed(2) ?? '—'}</td></tr>`)}</tbody></table></div>
        ${d.nextEarnings ? html`<p class="small muted" style="padding:0 18px 14px">Results expected ${fmt.date(d.nextEarnings.date)} — expiries after that date usually carry an event premium.</p>` : ''}</div>
    </section>

    <section class="card pad-0" style="margin-top:16px">
      <div class="card-head" style="padding:16px 18px 0"><div><h2>Option chain · ${fmt.date(a.expiry)}</h2><p>Click a price to add that contract to the payoff simulator. Shaded cells are in the money. IV, delta and theta are computed estimates.</p></div>
        <label class="row small"><input type="checkbox" id="near" checked> Strikes near spot only</label></div>
      <div class="table-wrap" id="chain"></div>
    </section>

    <section class="card" style="margin-top:16px" id="sim">
      <div class="card-head"><div><h2>Payoff simulator ${explain('payoff')}</h2><p>An educational what-if tool using end-of-day prices. It is not a trade suggestion, ignores costs, taxes and margin, and real fills differ.</p></div><span class="badge user">Your input</span></div>
      <div class="row" style="margin-bottom:10px"><span class="small muted">Examples:</span>${PRESETS.map((p, i) => html`<button class="btn sm" type="button" data-preset="${i}">${p.name}</button>`)}<button class="btn sm ghost" type="button" id="clear-legs">Clear</button></div>
      <div id="legs"></div>
      <div class="chart" id="payoff-chart" style="margin-top:12px"></div>
      <div class="legend"><span><i style="background:var(--chart-1)"></i>At expiry</span><span><i style="background:var(--chart-2)"></i>Today (model estimate)</span></div>
      <div id="payoff-stats" class="grid cols-4" style="margin-top:12px"></div>
    </section>
    <p class="small muted" style="margin-top:12px">${d.method} Risk-free rate assumed ${pctv(d.riskFree)}.</p>`);

  // ---- OI chart
  const near = (c) => Math.abs(c.strike / d.spot - 1) <= (d.kind === 'index' ? 0.06 : 0.15);
  const chainNear = a.chain.filter(near);
  let oiKey = 'oi';
  const drawOi = () => { cleanups.push(oiChart($('#oi-chart', el), chainNear, d.spot, oiKey)); };
  drawOi();
  el.querySelectorAll('[data-oi]').forEach((b) => b.addEventListener('click', () => {
    oiKey = b.dataset.oi;
    el.querySelectorAll('[data-oi]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    drawOi();
  }));
  cleanups.push(smileChart($('#smile-chart', el), a.chain, d.spot));
  if (d.history.length > 1) {
    cleanups.push(lineChart($('#iv-hist', el), { dates: d.history.map((h) => h.date), series: [{ name: 'ATM IV', values: d.history.map((h) => (h.atmIv == null ? NaN : h.atmIv * 100)), color: 'var(--chart-1)' }], height: 200, yFormat: (v) => `${v.toFixed(0)}%` }));
  } else $('#iv-hist', el).innerHTML = '<p class="small muted">Not enough history yet.</p>';

  // ---- chain table
  const legs = [];
  const drawChain = () => {
    const rows = $('#near', el).checked ? chainNear : a.chain;
    const cell = (o, type, k) => (o ? html`<button class="btn sm ghost num" data-add="${type}:${k}" title="Add ${type === 'CE' ? 'call' : 'put'} ${k} to simulator">${fmt.num(o.price, 2)}</button>` : '—');
    $('#chain', el).innerHTML = String(html`<table class="num" style="font-size:0.82rem">
      <thead><tr><th class="r">OI</th><th class="r hide-sm">Chg OI</th><th class="r hide-sm">Volume</th><th class="r">IV</th><th class="r hide-sm">Delta</th><th class="r">Call</th><th style="text-align:center">Strike</th><th>Put</th><th class="hide-sm">Delta</th><th>IV</th><th class="hide-sm">Volume</th><th class="hide-sm">Chg OI</th><th>OI</th></tr></thead>
      <tbody>${rows.map((c) => {
        const itmC = c.strike < d.spot ? 'background:var(--surface-2)' : '';
        const itmP = c.strike > d.spot ? 'background:var(--surface-2)' : '';
        const atm = c.strike === a.atmStrike;
        return html`<tr ${atm ? raw('style="outline:2px solid var(--brand);outline-offset:-2px"') : ''}>
          <td class="r" style="${itmC}">${fmt.num(c.call?.oi, 0)}</td><td class="r hide-sm ${tone(c.call?.chgOi)}" style="${itmC}">${fmt.num(c.call?.chgOi, 0)}</td><td class="r hide-sm" style="${itmC}">${fmt.num(c.call?.volume, 0)}</td>
          <td class="r" style="${itmC}">${pctv(c.call?.iv)}</td><td class="r hide-sm" style="${itmC}">${c.call?.greeks ? c.call.greeks.delta.toFixed(2) : '—'}</td><td class="r" style="${itmC}">${cell(c.call, 'CE', c.strike)}</td>
          <td style="text-align:center;font-weight:700">${fmt.num(c.strike, c.strike % 1 ? 1 : 0)}${atm ? html` <span class="badge eod">ATM</span>` : ''}</td>
          <td style="${itmP}">${cell(c.put, 'PE', c.strike)}</td><td class="hide-sm" style="${itmP}">${c.put?.greeks ? c.put.greeks.delta.toFixed(2) : '—'}</td><td style="${itmP}">${pctv(c.put?.iv)}</td>
          <td class="hide-sm" style="${itmP}">${fmt.num(c.put?.volume, 0)}</td><td class="hide-sm ${tone(c.put?.chgOi)}" style="${itmP}">${fmt.num(c.put?.chgOi, 0)}</td><td style="${itmP}">${fmt.num(c.put?.oi, 0)}</td></tr>`;
      })}</tbody></table>`);
  };
  drawChain();
  $('#near', el).addEventListener('change', drawChain);

  // ---- payoff simulator
  const find = (type, k) => a.chain.find((c) => c.strike === k)?.[type === 'CE' ? 'call' : 'put'];
  const strikes = a.chain.map((c) => c.strike);
  const nearestStrike = (x) => strikes.reduce((p, k) => (Math.abs(k - x) < Math.abs(p - x) ? k : p), strikes[0]);
  const addLeg = (type, k, side = 'buy', lots = 1) => {
    const o = find(type, k);
    if (!o) return;
    legs.push({ type, strike: k, side, lots, premium: o.price, iv: o.iv || a.atmIv || 0.2 });
  };
  const drawSim = () => {
    $('#legs', el).innerHTML = legs.length ? String(html`<div class="table-wrap"><table style="font-size:0.85rem"><thead><tr><th>Side</th><th>Contract</th><th class="r">Premium</th><th class="r">Lots</th><th></th></tr></thead><tbody>${legs.map((l, i) => html`<tr>
      <td><select data-side="${i}" aria-label="Buy or sell"><option value="buy" ${l.side === 'buy' ? 'selected' : ''}>Buy</option><option value="sell" ${l.side === 'sell' ? 'selected' : ''}>Sell</option></select></td>
      <td>${fmt.num(l.strike, 0)} ${l.type === 'CE' ? 'Call' : 'Put'}</td><td class="r num">${fmt.num(l.premium, 2)}</td>
      <td class="r"><input type="number" min="1" max="100" value="${l.lots}" data-lots="${i}" style="width:70px" aria-label="Lots"></td>
      <td class="r"><button class="btn sm ghost" data-rm="${i}" aria-label="Remove leg">✕</button></td></tr>`)}</tbody></table></div>`)
      : String(html`<p class="small muted">No contracts yet — choose an example or click a price in the chain.</p>`);
    cleanups.push(payoffChart($('#payoff-chart', el), legs, d, a));
    $('#payoff-stats', el).innerHTML = String(payoffStats(legs, d, a));
  };
  drawSim();
  el.querySelector('#sim').addEventListener('click', (e) => {
    const p = e.target.closest('[data-preset]');
    if (p) { legs.length = 0; PRESETS[+p.dataset.preset].build(d.spot, nearestStrike, addLeg, a.atmStrike, strikes); drawSim(); }
    const rm = e.target.closest('[data-rm]');
    if (rm) { legs.splice(+rm.dataset.rm, 1); drawSim(); }
    if (e.target.id === 'clear-legs') { legs.length = 0; drawSim(); }
  });
  el.querySelector('#sim').addEventListener('change', (e) => {
    if (e.target.dataset.side) { legs[+e.target.dataset.side].side = e.target.value; drawSim(); }
    if (e.target.dataset.lots) { legs[+e.target.dataset.lots].lots = Math.max(1, Math.min(100, +e.target.value || 1)); drawSim(); }
  });
  $('#chain', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-add]');
    if (!b) return;
    const [type, k] = b.dataset.add.split(':');
    if (legs.length >= 6) return;
    addLeg(type, +k);
    drawSim();
    $('#sim', el).scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#exp', el).addEventListener('change', (e) => { location.hash = `#/options/${encodeURIComponent(d.symbol)}?expiry=${e.target.value}`; });
  return () => cleanups.forEach((c) => c && c());
}

const card = (l, v, s, term) => html`<div class="card"><div class="stat"><span class="label">${l} ${term ? explain(term) : ''}</span><span class="value num">${v}</span><span class="sub muted">${s}</span></div></div>`;

// Example strategies for learning how payoffs work. Not suggestions.
const PRESETS = [
  { name: 'Long call', build: (S, n, add, atm) => add('CE', atm, 'buy') },
  { name: 'Long put', build: (S, n, add, atm) => add('PE', atm, 'buy') },
  { name: 'Bull call spread', build: (S, n, add, atm) => { add('CE', atm, 'buy'); add('CE', n(S * 1.05), 'sell'); } },
  { name: 'Bear put spread', build: (S, n, add, atm) => { add('PE', atm, 'buy'); add('PE', n(S * 0.95), 'sell'); } },
  { name: 'Long straddle', build: (S, n, add, atm) => { add('CE', atm, 'buy'); add('PE', atm, 'buy'); } },
  { name: 'Iron condor', build: (S, n, add) => { add('PE', n(S * 0.92), 'buy'); add('PE', n(S * 0.96), 'sell'); add('CE', n(S * 1.04), 'sell'); add('CE', n(S * 1.08), 'buy'); } },
];

// ---------------------------------------------------------- client maths
function normCdf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
function bs(type, S, K, T, s, r) {
  if (T <= 0 || !(s > 0)) return Math.max(0, type === 'CE' ? S - K : K - S);
  const sq = s * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + s * s / 2) * T) / sq;
  const d2 = d1 - sq;
  return type === 'CE' ? S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2) : K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
}
const units = (l, d) => l.lots * (d.lotSize || 1);
const pnlExpiry = (legs, S, d) => legs.reduce((acc, l) => acc + (l.side === 'buy' ? 1 : -1) * (Math.max(0, l.type === 'CE' ? S - l.strike : l.strike - S) - l.premium) * units(l, d), 0);
const pnlNow = (legs, S, d, a) => legs.reduce((acc, l) => acc + (l.side === 'buy' ? 1 : -1) * (bs(l.type, S, l.strike, a.T, l.iv, d.riskFree) - l.premium) * units(l, d), 0);

function priceGrid(d, a) {
  const w = Math.max(0.12, (a.expectedMove.straddlePct || 0.05) * 3);
  const lo = d.spot * (1 - w);
  const hi = d.spot * (1 + w);
  return Array.from({ length: 121 }, (_, i) => lo + ((hi - lo) * i) / 120);
}

function payoffStats(legs, d, a) {
  if (!legs.length) return '';
  const grid = priceGrid(d, a);
  const vals = grid.map((S) => pnlExpiry(legs, S, d));
  const net = legs.reduce((acc, l) => acc + (l.side === 'buy' ? -1 : 1) * l.premium * units(l, d), 0);
  const be = [];
  for (let i = 1; i < grid.length; i++) if (Math.sign(vals[i]) !== Math.sign(vals[i - 1]) && vals[i] !== 0) be.push(grid[i - 1] + (grid[i] - grid[i - 1]) * (-vals[i - 1] / (vals[i] - vals[i - 1])));
  const ends = [pnlExpiry(legs, d.spot * 5, d) - pnlExpiry(legs, d.spot * 4, d), pnlExpiry(legs, 0.0001, d) - pnlExpiry(legs, d.spot * 0.05, d)];
  const unlimitedUp = ends[0] > 1e-6;
  const unlimitedDown = ends[0] < -1e-6;
  const worst = Math.min(...vals, pnlExpiry(legs, 0.0001, d));
  const maxP = unlimitedUp ? 'Unlimited (in theory)' : fmt.inr(Math.max(...vals), 0);
  const maxL = unlimitedDown ? 'Unlimited' : worst >= 0 ? '₹0' : fmt.inr(-worst, 0);
  const lossNote = unlimitedDown ? 'Uncovered short calls can lose without limit' : worst < Math.min(...vals) - 1 ? 'Reached if the price falls below the charted range' : 'Limited to this amount at expiry';
  return html`
    ${card(net >= 0 ? 'Net premium received' : 'Net premium paid', fmt.inr(Math.abs(net), 0), `${legs.length} leg${legs.length === 1 ? '' : 's'} · lot ${d.lotSize}`)}
    ${card('Max profit at expiry', maxP, 'within modelled range')}
    ${card('Max loss at expiry', maxL, lossNote)}
    ${card('Breakeven(s)', be.length ? be.map((x) => fmt.num(x, 0)).join(' · ') : '—', 'underlying price at expiry')}`;
}

// ------------------------------------------------------------- charts
const W = (el) => Math.max(300, el.clientWidth);
function withResize(el, draw) {
  draw();
  const ro = new ResizeObserver(draw);
  ro.observe(el);
  return () => ro.disconnect();
}

function oiChart(el, chain, spot, key) {
  return withResize(el, () => {
    const w = W(el); const h = 230; const pad = { l: 46, r: 8, t: 10, b: 28 };
    const vals = chain.flatMap((c) => [c.call?.[key] || 0, c.put?.[key] || 0]);
    const max = Math.max(1, ...vals.map(Math.abs));
    const min = key === 'chgOi' ? -max : 0;
    const n = chain.length;
    const bw = (w - pad.l - pad.r) / n;
    const y = (v) => pad.t + (h - pad.t - pad.b) * (1 - (v - min) / (max - min));
    const x = (i) => pad.l + i * bw;
    const spotX = pad.l + ((spot - chain[0].strike) / ((chain.at(-1).strike - chain[0].strike) || 1)) * (bw * (n - 1)) + bw / 2;
    const every = Math.ceil(n / Math.floor(w / 60));
    el.innerHTML = `<svg width="${w}" height="${h}" role="img" aria-label="Open interest by strike">
      <line x1="${pad.l}" x2="${w - pad.r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line-2)"/>
      ${[max, max / 2].map((v) => `<text x="${pad.l - 6}" y="${y(v) + 4}" font-size="10" fill="var(--muted)" text-anchor="end">${esc(compact(v))}</text>`).join('')}
      ${chain.map((c, i) => {
        const cv = c.call?.[key] || 0; const pv = c.put?.[key] || 0;
        const r = (v, off, col) => `<rect x="${x(i) + off}" y="${Math.min(y(v), y(0))}" width="${Math.max(1, bw / 2 - 1)}" height="${Math.abs(y(v) - y(0))}" fill="${col}"><title>${esc(`${c.strike}: ${off ? 'put' : 'call'} ${compact(v)}`)}</title></rect>`;
        return r(cv, 0, 'var(--chart-2)') + r(pv, bw / 2, 'var(--chart-1)') + (i % every === 0 ? `<text x="${x(i) + bw / 2}" y="${h - 10}" font-size="10" fill="var(--muted)" text-anchor="middle">${esc(c.strike)}</text>` : '');
      }).join('')}
      <line x1="${spotX}" x2="${spotX}" y1="${pad.t}" y2="${h - pad.b}" stroke="var(--ink)" stroke-dasharray="3 3"/><text x="${spotX + 4}" y="${pad.t + 10}" font-size="10" fill="var(--ink)">Spot</text>
    </svg>`;
  });
}

function smileChart(el, chain, spot) {
  return withResize(el, () => {
    const pts = chain.map((c) => ({ k: c.strike, iv: c.strike < spot ? c.put?.iv : c.call?.iv, side: c.strike < spot ? 'put' : 'call' })).filter((p) => p.iv && Math.abs(p.k / spot - 1) < 0.2);
    if (pts.length < 3) { el.innerHTML = '<p class="small muted">Not enough priced strikes.</p>'; return; }
    const w = W(el); const h = 230; const pad = { l: 40, r: 10, t: 10, b: 28 };
    const ks = pts.map((p) => p.k); const ivs = pts.map((p) => p.iv);
    const x = (k) => pad.l + ((k - Math.min(...ks)) / ((Math.max(...ks) - Math.min(...ks)) || 1)) * (w - pad.l - pad.r);
    const lo = Math.min(...ivs) * 0.95; const hi = Math.max(...ivs) * 1.05;
    const y = (v) => pad.t + (h - pad.t - pad.b) * (1 - (v - lo) / (hi - lo || 1));
    const line = (side, col) => `<polyline fill="none" stroke="${col}" stroke-width="2" points="${pts.filter((p) => p.side === side).map((p) => `${x(p.k).toFixed(1)},${y(p.iv).toFixed(1)}`).join(' ')}"/>`;
    el.innerHTML = `<svg width="${w}" height="${h}" role="img" aria-label="Implied volatility smile">
      ${[lo, (lo + hi) / 2, hi].map((v) => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/><text x="${pad.l - 6}" y="${y(v) + 4}" font-size="10" fill="var(--muted)" text-anchor="end">${(v * 100).toFixed(0)}%</text>`).join('')}
      ${line('put', 'var(--chart-1)')}${line('call', 'var(--chart-2)')}
      <line x1="${x(spot)}" x2="${x(spot)}" y1="${pad.t}" y2="${h - pad.b}" stroke="var(--ink)" stroke-dasharray="3 3"/>
      ${[Math.min(...ks), spot, Math.max(...ks)].map((k) => `<text x="${x(k)}" y="${h - 10}" font-size="10" fill="var(--muted)" text-anchor="middle">${esc(Math.round(k))}</text>`).join('')}
    </svg>`;
  });
}

function payoffChart(el, legs, d, a) {
  return withResize(el, () => {
    if (!legs.length) { el.innerHTML = ''; return; }
    const grid = priceGrid(d, a);
    const exp = grid.map((S) => pnlExpiry(legs, S, d));
    const now = grid.map((S) => pnlNow(legs, S, d, a));
    const w = W(el); const h = 260; const pad = { l: 64, r: 10, t: 12, b: 28 };
    const lo = Math.min(...exp, ...now, 0); const hi = Math.max(...exp, ...now, 0);
    const x = (S) => pad.l + ((S - grid[0]) / (grid.at(-1) - grid[0])) * (w - pad.l - pad.r);
    const y = (v) => pad.t + (h - pad.t - pad.b) * (1 - (v - lo) / ((hi - lo) || 1));
    const poly = (vals, col, dash) => `<polyline fill="none" stroke="${col}" stroke-width="2" ${dash ? 'stroke-dasharray="5 4"' : ''} points="${vals.map((v, i) => `${x(grid[i]).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>`;
    const area = `<polygon fill="color-mix(in srgb, var(--up) 12%, transparent)" points="${x(grid[0])},${y(0)} ${exp.map((v, i) => `${x(grid[i]).toFixed(1)},${y(Math.max(0, v)).toFixed(1)}`).join(' ')} ${x(grid.at(-1))},${y(0)}"/><polygon fill="color-mix(in srgb, var(--down) 12%, transparent)" points="${x(grid[0])},${y(0)} ${exp.map((v, i) => `${x(grid[i]).toFixed(1)},${y(Math.min(0, v)).toFixed(1)}`).join(' ')} ${x(grid.at(-1))},${y(0)}"/>`;
    el.innerHTML = `<svg width="${w}" height="${h}" role="img" aria-label="Profit and loss at expiry across underlying prices">
      ${area}
      ${[lo, 0, hi].map((v) => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? 'var(--line-2)' : 'var(--grid)'}"/><text x="${pad.l - 6}" y="${y(v) + 4}" font-size="10" fill="var(--muted)" text-anchor="end">${esc(fmt.inr(v, 0))}</text>`).join('')}
      ${poly(now, 'var(--chart-2)', true)}${poly(exp, 'var(--chart-1)')}
      <line x1="${x(d.spot)}" x2="${x(d.spot)}" y1="${pad.t}" y2="${h - pad.b}" stroke="var(--ink)" stroke-dasharray="3 3"/><text x="${x(d.spot) + 4}" y="${pad.t + 10}" font-size="10" fill="var(--ink)">Spot</text>
      ${[grid[0], d.spot, grid.at(-1)].map((S) => `<text x="${x(S)}" y="${h - 10}" font-size="10" fill="var(--muted)" text-anchor="middle">${esc(Math.round(S))}</text>`).join('')}
    </svg>`;
  });
}

function compact(v) {
  const a = Math.abs(v);
  const s = a >= 1e7 ? `${(a / 1e7).toFixed(1)}cr` : a >= 1e5 ? `${(a / 1e5).toFixed(1)}L` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}k` : `${Math.round(a)}`;
  return v < 0 ? `−${s}` : s;
}
