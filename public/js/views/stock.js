import { api } from '../api.js';
import { html, raw, fmt, tone, viewBadge, freshnessBadge, kindBadge, confMeter, explain, dirBar, sourceLine, newsLink, sectorLink, emptyState, toast, skeleton } from '../ui.js';
import { priceChart, lineChart } from '../charts.js';
import { adSlot } from '../ads.js';
import { refreshAlertCount } from '../app.js';

const CAT_LABEL = { technical: 'Price & technicals', fundamental: 'Fundamentals & results', valuation: 'Valuation', news: 'News flow', macro: 'Macro & market', estimates: 'Published analyst estimates' };
const TABS = [['evidence', 'Evidence'], ['moves', 'Why did this move?'], ['news', 'News'], ['fundamentals', 'Fundamentals'], ['scenarios', 'Bull / base / bear'], ['analysts', 'Analyst views'], ['risks', 'Risks & events'], ['history', 'View history'], ['reasoning', 'Inspect reasoning']];

export async function render(el, [ticker], query, alive) {
  const horizon = query.get('horizon') || 'medium';
  const tab = query.get('tab') || 'evidence';
  const [d, chart] = await Promise.all([api(`/api/stocks/${encodeURIComponent(ticker)}?horizon=${horizon}`), api(`/api/stocks/${encodeURIComponent(ticker)}/chart?sessions=250`)]);
  if (!alive()) return;
  const r = d.recommendation;
  const q = d.quote;
  const inst = d.instrument;
  const sample = d.data.simulated;
  const cleanups = [];

  el.innerHTML = String(html`
    <nav class="small muted" aria-label="Breadcrumb"><a href="#/explore">Explore</a> / ${sectorLink(inst.sector)} / ${inst.ticker}</nav>
    <div class="hero" style="margin-top:10px">
      <section class="card">
        <div class="row between">
          <div class="row">${inst.exchanges.map((x) => html`<span class="badge neutral">${x}</span>`)}<span class="badge neutral">${inst.sector}</span>${freshnessBadge(q.freshness, q.asOf)}</div>
          <div class="row">
            <button class="btn sm" id="follow">${d.following ? '✓ Following' : 'Follow changes'}</button>
            <button class="btn sm" id="watch">+ Watchlist</button>
          </div>
        </div>
        <h1 style="margin-top:12px">${inst.name}</h1>
        <div class="muted small">${inst.ticker}${inst.isin ? ` · ISIN ${inst.isin}` : ''}</div>
        <div class="row" style="margin-top:14px;align-items:baseline;gap:14px">
          <span class="quote-price num">${fmt.inr(q.price)}</span>
          <span class="num ${tone(q.change)}" style="font-weight:650">${q.change >= 0 ? '+' : ''}${fmt.num(q.change, 2)} (${fmt.pct(q.changePct / 100, 2)})</span>
          <span class="small muted">INR</span>
        </div>
        <div class="source-line">${q.freshness === 'live' ? 'Last traded price' : 'Closing price'} as of ${fmt.datetime(q.asOf)} · ${q.source}${q.sourceUrl ? html` · <a href="${q.sourceUrl}" target="_blank" rel="noopener nofollow">file</a>` : ''}</div>
        ${(() => {
          const yr = chart.bars;
          const hi = Math.max(...yr.map((b) => b.high));
          const lo = Math.min(...yr.map((b) => b.low));
          const pos = ((q.price - lo) / (hi - lo || 1)) * 100;
          const tv = yr.slice(-20).reduce((a, b) => a + b.close * b.volume, 0) / 20 / 1e7;
          return html`<div style="margin-top:16px"><div class="row between small"><span class="muted">52-week range ${explain('drawdown')}</span><span class="muted">Avg traded value (20d): <b class="num">₹${fmt.num(tv, 1)} cr</b> ${explain('liquidity')}</span></div>
            <div class="range" role="img" aria-label="Price is ${Math.round(pos)}% of the way from the 52-week low to the high"><i style="left:${Math.min(100, Math.max(0, pos))}%"></i></div>
            <div class="row between small num"><span>${fmt.inr(lo)}</span><span>${fmt.pct(q.price / hi - 1)} from high</span><span>${fmt.inr(hi)}</span></div></div>`;
        })()}
        <div class="grid cols-4" style="margin-top:16px">
          ${stat('Market cap', d.fundamentals.valuation.marketCapCr ? fmt.cr(d.fundamentals.valuation.marketCapCr) : '—')}
          ${stat('P/E (trailing)', d.fundamentals.valuation.pe ? `${fmt.num(d.fundamentals.valuation.pe, 1)}×` : '—', d.fundamentals.valuation.sectorMedianPe ? `Sector ${fmt.num(d.fundamentals.valuation.sectorMedianPe, 1)}×` : '')}
          ${stat('Support', d.levels?.support ? fmt.inr(d.levels.support.price, 0) : '—', 'nearest')}
          ${stat('Resistance', d.levels?.resistance ? fmt.inr(d.levels.resistance.price, 0) : '—', 'nearest')}
        </div>
      </section>

      <section class="verdict ${r.view}" aria-labelledby="verdict-h">
        <div class="row between">
          <span class="kicker" id="verdict-h">Research view ${explain('buy-hold-sell')}</span>
          <div class="seg" role="group" aria-label="Time horizon">${[['short', '1–3 mo'], ['medium', '6–12 mo'], ['long', '1–3 yr']].map(([k, l]) => html`<button type="button" data-h="${k}" aria-pressed="${k === horizon}">${l}</button>`)}</div>
        </div>
        <div class="row" style="margin-top:12px;gap:14px">${viewBadge(r.view, true)}<div><div style="font-weight:650">for ${r.horizonLabel}</div><div class="small muted">Model ${r.modelVersion} · data as of ${fmt.date(r.asOfDate)}</div></div></div>
        <div class="row" style="margin-top:12px;gap:18px">
          <div><div class="small muted">Confidence ${explain('confidence')}</div><div class="row">${confMeter(r.confidence)}<b>${r.confidenceBand}</b><span class="small muted">(${r.confidence}/100)</span></div></div>
          <div><div class="small muted">Risk level</div><b class="risk ${r.riskLevel}">${r.riskLevel}</b></div>
        </div>
        <p class="summary"><span class="badge analysis">Analysis</span> ${r.summary}</p>
        <div class="grid cols-2" style="margin-top:12px;gap:12px">
          <div><div class="kicker" style="color:var(--up)">Strongest positives</div><ul class="bullet small">${r.topPositive.length ? r.topPositive.map((s) => html`<li>${s.label}</li>`) : html`<li class="muted">None of note</li>`}</ul></div>
          <div><div class="kicker" style="color:var(--down)">Strongest negatives</div><ul class="bullet small">${r.topNegative.length ? r.topNegative.map((s) => html`<li>${s.label}</li>`) : html`<li class="muted">None of note</li>`}</ul></div>
        </div>
        <div class="row small" style="margin-top:8px">${Object.entries(d.horizons).map(([k, v]) => html`<span class="pill">${v.horizonLabel}: <b>${v.view}</b> · ${v.confidenceBand}</span>`)}</div>
        <p class="small muted" style="margin-top:10px">A research signal from transparent rules — not a recommendation to you personally. The decision is yours. <a href="#/stock/${inst.ticker}?horizon=${horizon}&tab=reasoning" data-tab-link="reasoning">See exactly how it was computed</a>.</p>
        <div class="row" style="margin-top:6px"><button class="btn sm" id="snap">Save snapshot to journal</button><a class="btn sm" href="#/desk/theses/new?ticker=${inst.ticker}">Write a thesis</a><a class="btn sm ghost" href="#/desk/compare/${inst.ticker}">Compare</a></div>
      </section>
    </div>

    <section class="card" style="margin-top:16px">
      <div class="card-head"><div><h2>Price, trend and unusual moves</h2><p>Daily closes over ${chart.bars.length} sessions. Circles mark unusual moves explained in “Why did this move?”.</p></div>${kindBadge(sample ? 'sample' : 'fact')}</div>
      <div class="chart" id="price-chart"></div>
      <div class="legend" style="margin-top:8px"><span><i style="background:var(--chart-1)"></i>Close</span><span><i style="background:var(--chart-2)"></i>50-day average</span><span><i style="background:var(--chart-4)"></i>200-day average (dashed)</span><span><i style="background:var(--up)"></i>Support</span><span><i style="background:var(--down)"></i>Resistance</span>${explain('moving-average', 'About averages')}</div>
      ${sourceLine({ name: chart.source })}
    </section>

    <div id="opt-card"></div>
    <div class="tabs" role="tablist" aria-label="Research sections">${TABS.map(([k, l]) => html`<button role="tab" id="tab-${k}" aria-controls="panel" aria-selected="${k === tab}" data-tab="${k}">${l}</button>`)}</div>
    <section id="panel" role="tabpanel" aria-labelledby="tab-${tab}"></section>
    <div style="margin-top:24px">${adSlot('banner')}</div>
  `);

  cleanups.push(priceChart(el.querySelector('#price-chart'), chart.bars, {
    levels: d.levels,
    markers: d.moves.map((m) => ({ date: m.date, dir: m.ret, label: `${m.direction === 'rose' ? 'Rose' : 'Fell'} ${fmt.pctAbs(Math.abs(m.ret))} — ${m.driver}` })),
  }));

  api(`/api/options/${encodeURIComponent(inst.ticker)}`).then((o) => {
    if (!alive()) return;
    const a = o.selected;
    const em = a.expectedMove.straddlePct;
    el.querySelector('#opt-card').innerHTML = String(html`<section class="card" style="margin-top:16px">
      <div class="card-head"><div><h2>Options market ${explain('option')}</h2><p>What end-of-day option prices imply for ${fmt.date(a.expiry)} (${a.daysToExpiry} days). Context only — not part of the view.</p></div>${o.simulated ? kindBadge('sample') : freshnessBadge('eod')}</div>
      <div class="grid cols-4">
        ${stat('Implied volatility', a.atmIv ? `${(a.atmIv * 100).toFixed(1)}%` : '—', o.realisedVol ? `realised ${(o.realisedVol * 100).toFixed(1)}%` : '')}
        ${stat('Expected move', em ? `±${(em * 100).toFixed(1)}%` : '—', 'by expiry')}
        ${stat('Put-call ratio', a.pcrOi?.toFixed(2) ?? '—', 'open interest')}
        ${stat('OI levels', `${a.putWall[0]?.strike ?? '—'} / ${a.callWall[0]?.strike ?? '—'}`, 'largest put / call OI')}
      </div>
      <div class="row between" style="margin-top:10px"><span class="small muted">${o.risk.headline} Options can expire worthless.</span><a class="btn sm" href="#/options/${encodeURIComponent(inst.ticker)}">Open option chain →</a></div></section>`);
  }).catch(() => { /* no listed options for this stock */ });

  const panel = el.querySelector('#panel');
  const showTab = (k) => {
    el.querySelectorAll('[role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === k)));
    panel.setAttribute('aria-labelledby', `tab-${k}`);
    panel.innerHTML = String(TAB_RENDER[k](d));
    if (k === 'history' && d.historySeries.length > 1) {
      cleanups.push(lineChart(panel.querySelector('#score-chart'), { dates: d.historySeries.map((h) => h.date), series: [{ name: 'Composite score', values: d.historySeries.map((h) => h.score), color: 'var(--chart-1)' }], baseline: 0, height: 200, yFormat: (v) => v.toFixed(2) }));
    }
    history.replaceState(null, '', `#/stock/${encodeURIComponent(inst.ticker)}?horizon=${horizon}&tab=${k}`);
  };
  showTab(TAB_RENDER[tab] ? tab : 'evidence');

  el.querySelector('.tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });
  el.querySelector('.tabs').addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
    const btns = [...el.querySelectorAll('[role=tab]')];
    const i = btns.findIndex((b) => b.getAttribute('aria-selected') === 'true');
    const n = btns[(i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length];
    n.focus(); showTab(n.dataset.tab);
  });
  el.querySelector('[data-tab-link]').addEventListener('click', (e) => { e.preventDefault(); showTab('reasoning'); panel.scrollIntoView({ behavior: 'smooth' }); });
  el.querySelectorAll('[data-h]').forEach((b) => b.addEventListener('click', () => { location.hash = `#/stock/${encodeURIComponent(inst.ticker)}?horizon=${b.dataset.h}&tab=${new URLSearchParams(location.hash.split('?')[1]).get('tab') || 'evidence'}`; }));

  el.querySelector('#follow').addEventListener('click', async (e) => {
    if (d.following) { await api(`/api/follows/${inst.ticker}`, { method: 'DELETE' }); d.following = null; e.target.textContent = 'Follow changes'; toast('Stopped following'); }
    else { d.following = await api('/api/follows', { method: 'POST', body: { ticker: inst.ticker, horizon } }); e.target.textContent = '✓ Following'; toast(`Following ${inst.name}: you’ll see view, confidence, risk and key-signal changes in Alerts`); }
    refreshAlertCount();
  });
  el.querySelector('#watch').addEventListener('click', async () => {
    const wls = await api('/api/watchlists');
    const w = wls[0];
    if (w.tickers.includes(inst.ticker)) { toast(`Already in “${w.name}”`); return; }
    await api(`/api/watchlists/${w.id}`, { method: 'PUT', body: { tickers: [...w.tickers, inst.ticker] } });
    toast(`Added to “${w.name}”`);
  });
  el.querySelector('#snap').addEventListener('click', async () => {
    const note = prompt('Add a note to this snapshot (optional):', '');
    if (note === null) return;
    await api('/api/journal', { method: 'POST', body: { ticker: inst.ticker, horizon, note } });
    toast('Snapshot saved to your research journal');
  });
  return () => cleanups.forEach((c) => c && c());
}

const stat = (label, value, sub) => html`<div class="stat"><span class="label">${label}</span><span class="value num" style="font-size:1.05rem">${value}</span>${sub ? html`<span class="sub muted">${sub}</span>` : ''}</div>`;

// --------------------------------------------------------------- panels
const TAB_RENDER = {
  evidence(d) {
    const r = d.recommendation;
    const byCat = {};
    for (const s of r.signals) (byCat[s.category] ||= []).push(s);
    return html`
      <div class="callout info" style="margin-bottom:14px">Each signal separates a <span class="badge fact">Fact</span> (data from a named source) from the model’s <span class="badge analysis">Analysis</span> (interpretation). Bars show direction and strength; “contribution” is its share of the final score for ${r.horizonLabel}.${r.missing.length ? html` <b>Missing evidence:</b> ${r.missing.map((m) => CAT_LABEL[m] || m).join(', ')} — not available from the connected sources, which lowers confidence.` : ''}</div>
      <div class="stack">${Object.entries(byCat).map(([cat, list]) => html`
        <div class="card">
          <div class="card-head"><div><h3>${CAT_LABEL[cat] || cat}</h3><p>Category score ${fmt.num(r.categories[cat]?.score, 2)} · weight ${fmt.pctAbs(r.categories[cat]?.weight, 0)} for this horizon</p></div></div>
          <div class="stack" style="gap:10px">${list.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).map(signalCard)}</div>
        </div>`)}</div>`;
  },

  moves(d) {
    if (!d.moves.length) return emptyState('No unusual moves detected', 'No daily move exceeded the detection threshold (2.4× typical volatility and at least 2.5%) in the past year.');
    return html`
      <div class="callout warn" style="margin-bottom:14px"><b>Possible explanations, not proven causes.</b> Each unusual move is lined up with news, filings, results and sector or market moves around the same time. Matching timing suggests a link but does not prove one.</div>
      <div class="timeline">${d.moves.map((m) => html`
        <div class="tl-item ${m.ret > 0 ? 'tl-up' : 'tl-down'}"><div class="card flat">
          <div class="row between"><div><b>${fmt.date(m.date)}</b> · <span class="${tone(m.ret)} num" style="font-weight:700">${fmt.pct(m.ret)}</span> <span class="small muted">(${fmt.num(Math.abs(m.z), 1)}× typical daily move${m.volumeRatio ? `, volume ${fmt.num(m.volumeRatio, 1)}× average` : ''})</span></div>
            <div class="row"><span class="pill">${m.driver}</span><span class="pill">Link: ${m.linkStrength === 'none' ? 'none found' : m.linkStrength}</span></div></div>
          <p class="small" style="margin-top:6px"><span class="badge fact">Fact</span> Market ${fmt.pct(m.marketRet)} · sector peers ${fmt.pct(m.sectorRet)} the same day.</p>
          <p class="small"><span class="badge analysis">Analysis</span> ${m.explanation}</p>
          ${m.candidates.length ? html`<details style="margin-top:6px"><summary class="small">Related items considered (${m.candidates.length})</summary><ul class="list-plain small" style="margin-top:8px">${m.candidates.map((c) => html`<li>${newsLink(c)} <span class="muted">· ${c.source} · ${fmt.datetime(c.publishedAt)} · ${c.timing} · tone ${c.toneAlignment}</span></li>`)}</ul></details>` : ''}
        </div></div>`)}</div>`;
  },

  news(d) {
    const block = (title, items, desc) => html`<div class="card"><div class="card-head"><div><h3>${title}</h3><p>${desc}</p></div></div>${items.length ? items.map(newsCard) : html`<p class="muted small">No items from the connected sources.</p>`}</div>`;
    return html`<div class="stack">
      ${block('Company', d.news.company, 'Filings and reports about this company.')}
      ${block(`${d.instrument.sector} sector`, d.news.sector, 'Developments affecting the sector broadly.')}
      ${block('Market & macro', d.news.market, 'Market-wide events and their possible channel to this sector.')}</div>`;
  },

  fundamentals(d) {
    const f = d.fundamentals;
    if (!f.quarters?.length) return emptyState('Fundamentals not available', 'Company results are not available from the connected free data sources. This is planned for version 2 with a licensed fundamentals feed. The view relies on price, macro and news signals and shows lower confidence as a result.');
    const fin = f.kind === 'financial';
    const t = f.ttm || {};
    const b = f.balance || {};
    return html`<div class="stack">
      <div class="grid cols-4">
        ${statCard(fin ? 'Income growth' : 'Revenue growth', fmt.pct(t.revGrowth), t.growthBasis, 'revenue-growth')}
        ${statCard('Net profit growth', fmt.pct(t.npGrowth), t.growthBasis, 'eps')}
        ${statCard('Return on equity', b.roe != null ? `${fmt.num(b.roe, 1)}%` : '—', 'latest reported', 'roe')}
        ${fin ? statCard('Gross NPA', `${fmt.num(t.latest?.gnpa, 2)}%`, `Capital adequacy ${fmt.num(b.capitalAdequacy, 1)}%`, 'npa') : statCard('Debt-to-equity', `${fmt.num(b.debtToEquity, 2)}×`, `Interest cover ${fmt.num(b.interestCoverage, 1)}×`, 'debt-to-equity')}
      </div>
      <div class="card pad-0"><div class="card-head" style="padding:16px 18px 0"><div><h3>Quarterly results</h3><p>₹ crore. Source: ${f.source}.</p></div>${kindBadge('fact')}</div>
        <div class="table-wrap"><table><thead><tr><th>Quarter</th><th>Reported</th><th class="r">${fin ? 'Total income' : 'Revenue'}</th><th class="r">${fin ? 'Pre-provision profit' : 'Operating profit'}</th><th class="r">${fin ? 'NIM %' : 'Margin %'}</th><th class="r">Net profit</th><th class="r">EPS ₹</th></tr></thead>
        <tbody>${[...f.quarters].reverse().map((x) => html`<tr><td>${x.label}</td><td class="small muted">${fmt.date(x.reportDate)}</td><td class="r num">${fmt.num(x.revenue, 0)}</td><td class="r num">${fmt.num(x.operatingProfit, 0)}</td><td class="r num">${fin ? fmt.num(x.nim, 2) : fmt.num(x.operatingMargin, 1)}</td><td class="r num">${fmt.num(x.netProfit, 0)}</td><td class="r num">${fmt.num(x.eps, 2)}</td></tr>`)}</tbody></table></div></div>
      ${f.cashFlow ? html`<div class="card"><h3>Cash flow (${f.cashFlow.period.toLowerCase()}) ${explain('free-cash-flow')}</h3><div class="grid cols-3" style="margin-top:10px">${statMini('Operating cash flow', fmt.cr(f.cashFlow.operatingCashFlow))}${statMini('Capital expenditure', fmt.cr(f.cashFlow.capex))}${statMini('Free cash flow', fmt.cr(f.cashFlow.freeCashFlow))}</div></div>` : ''}
      <div class="card pad-0"><div class="card-head" style="padding:16px 18px 0"><div><h3>Sector peers</h3><p>Valuation and growth as of the latest data.</p></div></div>
        <div class="table-wrap"><table><thead><tr><th>Ticker</th><th class="r">P/E</th>${fin ? html`<th class="r">P/B</th>` : ''}<th class="r">Profit growth</th></tr></thead>
        <tbody>${f.valuation.peers.map((p) => html`<tr ${p.ticker === d.instrument.ticker ? raw('style="font-weight:700"') : ''}><td><a href="#/stock/${p.ticker}">${p.ticker}</a></td><td class="r num">${fmt.num(p.pe, 1)}</td>${fin ? html`<td class="r num">${fmt.num(p.pb, 2)}</td>` : ''}<td class="r num ${tone(p.npGrowth)}">${fmt.pct(p.npGrowth)}</td></tr>`)}</tbody></table></div></div>
    </div>`;
  },

  scenarios(d) {
    const s = d.scenarios;
    return html`
      <div class="callout warn" style="margin-bottom:14px"><b>${s.disclaimer}</b> ${s.method}</div>
      <div class="grid cols-3">${s.cases.map((c) => html`
        <div class="card" style="border-top:4px solid ${c.id === 'bull' ? 'var(--up)' : c.id === 'bear' ? 'var(--down)' : 'var(--line-2)'}">
          <div class="row between"><h3>${c.label}</h3><span class="badge analysis">Analysis</span></div>
          <div class="small muted" style="margin-top:6px">Illustrative range over ${s.horizonLabel}</div>
          <div style="font-weight:700;font-size:1.1rem" class="num">${fmt.inr(c.band.low, 0)} – ${fmt.inr(c.band.high, 0)}</div>
          <div class="kicker" style="margin-top:12px">Assumptions</div><ul class="bullet small">${c.assumptions.map((a) => html`<li>${a}</li>`)}</ul>
          <div class="kicker" style="margin-top:8px">Would support it</div><ul class="bullet small">${c.supports.map((a) => html`<li>${a}</li>`)}</ul>
          <div class="kicker" style="margin-top:8px">Would weaken it</div><ul class="bullet small">${c.weakens.map((a) => html`<li>${a}</li>`)}</ul>
        </div>`)}</div>
      ${s.valuationNote ? html`<p class="small muted" style="margin-top:12px">${s.valuationNote}</p>` : ''}`;
  },

  analysts(d) {
    const a = d.analysts;
    if (!a.available) return emptyState('No analyst estimates connected', a.note);
    return html`<div class="stack">
      <div class="callout ${a.sample ? '' : 'info'}">${a.sample ? html`${kindBadge('sample')} These estimates and broker names are simulated. ` : ''}${a.note}</div>
      <div class="grid cols-4">
        ${statCard('Estimates', a.count, `${a.counts.Buy || 0} Buy · ${a.counts.Hold || 0} Hold · ${a.counts.Sell || 0} Sell`)}
        ${statCard('Median target', fmt.inr(a.target.median, 0), `vs price ${fmt.inr(d.quote.price, 0)}`, 'price-target')}
        ${statCard('Target range', `${fmt.inr(a.target.low, 0)}–${fmt.inr(a.target.high, 0)}`, `spread ${fmt.pctAbs(a.target.dispersion, 0)} of median`)}
        ${statCard('Disagreement', a.disagreement, 'based on target spread')}
      </div>
      <div class="grid cols-2">
        <div class="card"><h3>Why some are more positive</h3><ul class="bullet small">${a.bulls.length ? a.bulls.map((b) => html`<li>${b.point} <span class="muted">— ${b.broker}</span></li>`) : html`<li class="muted">None above the current price</li>`}</ul></div>
        <div class="card"><h3>Why some are more cautious</h3><ul class="bullet small">${a.bears.length ? a.bears.map((b) => html`<li>${b.point} <span class="muted">— ${b.broker}</span></li>`) : html`<li class="muted">None at or below the current price</li>`}</ul></div>
      </div>
      <div class="card pad-0"><div class="table-wrap"><table><thead><tr><th>Source</th><th>Published</th><th>Rating</th><th class="r">Target</th><th class="r">EPS next FY</th></tr></thead>
        <tbody>${a.estimates.map((e) => html`<tr><td>${e.broker}</td><td class="small">${fmt.date(e.publishedAt)}</td><td>${e.rating}</td><td class="r num">${fmt.inr(e.targetPrice, 0)}</td><td class="r num">${fmt.num(e.epsNextFy, 1)}</td></tr>`)}</tbody></table></div></div>
    </div>`;
  },

  risks(d) {
    const r = d.recommendation;
    return html`<div class="grid cols-2">
      <div class="card"><div class="card-head"><div><h3>Risk factors</h3><p>Overall: <b class="risk ${r.riskLevel}">${r.riskLevel}</b></p></div>${kindBadge('fact')}</div>
        <ul class="list-plain">${r.risks.map((x) => html`<li class="row" style="align-items:flex-start;flex-wrap:nowrap"><span class="dot" style="margin-top:7px;background:${['', 'var(--up)', 'var(--hold)', 'var(--sell)'][x.level]}" aria-hidden="true"></span><div><b>${x.label}</b> <span class="small muted">${['', 'low', 'moderate', 'high'][x.level]}</span> ${x.term ? explain(x.term) : ''}<div class="small">${x.fact}</div>${x.note ? html`<div class="small muted">${x.note}</div>` : ''}</div></li>`)}</ul>
        ${d.stress?.narrative ? html`<hr class="divider"><div class="small"><b>Market stress: ${d.stress.label}.</b> ${d.stress.narrative}</div>` : ''}
      </div>
      <div class="stack">
        <div class="card"><h3>What would change this view</h3><p class="small muted">Conditions that would invalidate or weaken the ${r.view} view.</p>
          ${r.invalidation.length ? html`<ul class="bullet small">${r.invalidation.map((i) => html`<li><b>${i.signal}:</b> ${i.condition} <span class="muted">(${i.direction})</span></li>`)}</ul>` : html`<p class="small muted">No dominant signal — the view would shift with any material new evidence.</p>`}</div>
        <div class="card"><h3>Upcoming events</h3>
          ${d.upcoming.length ? html`<ul class="list-plain small">${d.upcoming.slice(0, 8).map((e) => html`<li><b>${fmt.date(e.date)}</b> · ${e.title} ${e.confirmed === false ? html`<span class="badge neutral">expected</span>` : ''}${e.sample ? kindBadge('sample') : ''}${e.note ? html`<div class="muted">${e.note}</div>` : ''}</li>`)}</ul>` : html`<p class="small muted">No scheduled events from the connected sources.</p>`}
          <a class="small" href="#/calendar">Open catalyst calendar →</a></div>
      </div></div>`;
  },

  history(d) {
    return html`<div class="stack">
      <div class="card"><div class="card-head"><div><h3>Composite score over time</h3><p>Point-in-time model output every five sessions (${d.recommendation.horizonLabel}). Above +0.16 is Buy, below −0.16 is Sell. Only data available on each date was used.</p></div></div><div class="chart" id="score-chart"></div></div>
      <div class="card"><h3>How the view evolved</h3>
        <div class="timeline" style="margin-top:12px">${[...d.history].reverse().map((h) => html`<div class="tl-item"><div class="row"><b>${fmt.date(h.date)}</b>${viewBadge(h.view)}<span class="small">${h.confidenceBand} confidence (${h.confidence}) · risk ${h.riskLevel} · price ${fmt.inr(h.price)}</span></div><p class="small muted">${h.summary}</p></div>`)}</div></div>
      <div class="card pad-0"><div class="card-head" style="padding:16px 18px 0"><div><h3>Published-view log</h3><p>Views this server actually displayed, recorded when shown (an audit trail).</p></div></div>
        ${d.serverLog.length ? html`<div class="table-wrap"><table><thead><tr><th>Recorded</th><th>Data date</th><th>View</th><th>Confidence</th><th>Risk</th><th>Model</th></tr></thead><tbody>${[...d.serverLog].reverse().map((x) => html`<tr><td class="small">${fmt.datetime(x.recordedAt)}</td><td class="small">${fmt.date(x.asOfDate)}</td><td>${viewBadge(x.view)}</td><td class="small">${x.confidenceBand} (${x.confidence})</td><td class="small">${x.riskLevel}</td><td class="small mono">${x.modelVersion}</td></tr>`)}</tbody></table></div>` : html`<p class="small muted" style="padding:0 18px 16px">No entries yet.</p>`}</div>
    </div>`;
  },

  reasoning(d) {
    const r = d.recommendation;
    return html`<div class="stack">
      <div class="card"><h3>How this view was computed</h3>
        <ol class="small" style="padding-left:18px">
          <li>Each signal gets a score from −1 (supports a lower price) to +1 (supports a higher price) using fixed, published rules.</li>
          <li>Within a category, scores are averaged, weighting stronger evidence more (high 1.0, medium 0.7, low 0.4).</li>
          <li>Categories are combined with weights that depend on the horizon (technicals matter more short term, fundamentals and valuation long term). Missing categories are dropped and the remaining weights rescaled.</li>
          <li>Composite ≥ +${r.thresholds.buy} → Buy; ≤ ${r.thresholds.sell} → Sell; otherwise Hold.</li>
        </ol>
        <p class="small muted">No machine-learning model or opaque system is used. The rules have no verified record of predicting returns.</p></div>
      <div class="card pad-0"><div class="table-wrap"><table><thead><tr><th>Category</th><th class="r">Weight</th><th class="r">Score</th><th class="r">Weighted</th><th class="r">Signals</th></tr></thead>
        <tbody>${Object.entries(r.categories).map(([k, c]) => html`<tr><td>${CAT_LABEL[k] || k}</td><td class="r num">${fmt.pctAbs(c.weight, 0)}</td><td class="r num ${tone(c.score)}">${fmt.num(c.score, 3)}</td><td class="r num ${tone(c.score)}">${fmt.num(c.score * c.weight, 3)}</td><td class="r">${c.signals}</td></tr>`)}
        <tr><td><b>Composite</b></td><td></td><td></td><td class="r num"><b>${fmt.num(r.score, 3)}</b></td><td></td></tr></tbody></table></div></div>
      <div class="card"><h3>Confidence breakdown (${r.confidence}/100)</h3><ul class="list-plain small" style="margin-top:8px"><li>Base: 30</li>${r.confidenceParts.map((p) => html`<li>${p.label}: <b class="${tone(p.points)}">${p.points > 0 ? '+' : ''}${p.points}</b></li>`)}<li class="muted">Capped between 10 and 85 — no view is presented as certain.</li></ul></div>
      <div class="card pad-0"><div class="table-wrap"><table><thead><tr><th>Signal</th><th>Category</th><th class="r">Score</th><th>Evidence</th><th class="r">Contribution</th></tr></thead>
        <tbody>${[...r.signals].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).map((s) => html`<tr><td>${s.label}</td><td class="small">${CAT_LABEL[s.category]}</td><td class="r num ${tone(s.score)}">${fmt.num(s.score, 2)}</td><td class="small">${s.evidence}</td><td class="r num ${tone(s.contribution)}">${fmt.num(s.contribution, 4)}</td></tr>`)}</tbody></table></div></div>
      <p class="small"><a href="#/methodology">Full methodology, weights and sector assumptions →</a></p>
    </div>`;
  },
};

function signalCard(s) {
  return html`<article class="signal">
    <div class="signal-head"><h4>${s.label} ${s.term ? explain(s.term) : ''}</h4><div class="row" style="flex-wrap:nowrap">${dirBar(s.score)}<span class="small num ${tone(s.score)}" title="Signal score">${s.score > 0 ? '+' : ''}${s.score.toFixed(2)}</span></div></div>
    <div class="fact-line"><span class="badge fact">Fact</span><span>${s.fact}</span></div>
    <div class="analysis-line"><span class="badge analysis">Analysis</span><span>${s.analysis}${s.note ? html` <span class="muted">${s.note}</span>` : ''}</span></div>
    <div class="row small muted" style="gap:14px"><span>Strength: <b>${s.strength}</b></span><span>Evidence quality: <b>${s.evidence}</b></span><span>Contribution: <b class="${tone(s.contribution)}">${s.contribution > 0 ? '+' : ''}${s.contribution.toFixed(3)}</b></span></div>
    ${s.ifChanges ? html`<div class="small"><b>What could change it:</b> ${s.ifChanges}</div>` : ''}
    ${s.evidenceItems?.length ? html`<details><summary class="small">Evidence items (${s.evidenceItems.length})</summary><ul class="list-plain small" style="margin-top:6px">${s.evidenceItems.map((it) => html`<li>${newsLink(it)} <span class="muted">· ${it.source} · ${fmt.datetime(it.publishedAt)} · classified ${it.tone > 0 ? 'positive' : 'negative'}</span></li>`)}</ul></details>` : ''}
    ${sourceLine(s.source)}
  </article>`;
}

function newsCard(n) {
  const re = n.reaction;
  return html`<div class="news-item">
    <div class="row between"><h4>${newsLink(n)}</h4>${n.sample ? kindBadge('sample') : ''}</div>
    <div class="source-line">${n.source} · ${fmt.datetime(n.publishedAt)} · ${n.category}</div>
    ${n.facts?.length ? html`<div class="fact-line"><span class="badge fact">Reported</span><span>${n.facts.join('. ')}.</span></div>` : ''}
    <div class="analysis-line"><span class="badge analysis">Analysis</span><span>${n.analysis}</span></div>
    ${re ? html`<div class="small muted">Observed price move in the next session (${fmt.date(re.session)}): <b class="${tone(re.ret)}">${fmt.pct(re.ret)}</b>${re.marketRet != null ? ` vs market ${fmt.pct(re.marketRet)}` : ''} — timing only, not proof of cause.</div>` : ''}
    ${n.note ? html`<div class="small muted">${n.note}</div>` : ''}
  </div>`;
}

const statCard = (label, value, sub, term) => html`<div class="card"><div class="stat"><span class="label">${label} ${term ? explain(term) : ''}</span><span class="value num">${value}</span>${sub ? html`<span class="sub muted">${sub}</span>` : ''}</div></div>`;
const statMini = (label, value) => html`<div class="stat"><span class="label">${label}</span><span class="value num" style="font-size:1.05rem">${value}</span></div>`;

export { skeleton };
