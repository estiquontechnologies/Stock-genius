import { api } from '../api.js';
import { html, raw, fmt, tone, viewBadge, freshnessBadge, explain, newsLink, kindBadge, sectorLink } from '../ui.js';
import { sparkline } from '../charts.js';
import { adSlot } from '../ads.js';

export async function render(el, _p, query) {
  const horizon = query.get('horizon') || 'medium';
  const [d, wl] = await Promise.all([api(`/api/overview?horizon=${horizon}`), api('/api/watchlists')]);
  const sample = d.data.simulated;
  const watched = new Set(wl.flatMap((w) => w.tickers));
  const watchRows = d.stocks.filter((s) => watched.has(s.ticker));
  const b = d.breadth.market;

  el.innerHTML = String(html`
    <div class="page-head">
      <div>
        <div class="kicker">Market overview · ${fmt.date(d.asOfDate)}</div>
        <h1>Indian markets at a glance</h1>
        <p>What moved, how broad the move was and which risks stand out — with every number sourced. Views are research signals for a stated horizon, not instructions.</p>
      </div>
      <div class="seg" role="group" aria-label="Time horizon for views">
        ${[['short', '1–3 mo'], ['medium', '6–12 mo'], ['long', '1–3 yr']].map(([k, l]) => html`<button type="button" data-h="${k}" aria-pressed="${k === horizon}">${l}</button>`)}
      </div>
    </div>

    <section class="grid cols-3" aria-label="Indices">
      ${d.indices.map((ix) => html`
        <div class="card">
          <div class="row between"><span class="kicker">${ix.computed ? 'Computed composite' : 'Index'}</span>${freshnessBadge(sample ? 'sample' : d.data.dataMode)}</div>
          <h2 style="margin:6px 0 10px;font-size:1rem">${ix.name}</h2>
          <div class="index-card">
            <div><div class="stat"><span class="value num">${fmt.num(ix.last, 2)}</span><span class="sub ${tone(ix.change1d)} num">${fmt.pct(ix.change1d, 2)} today</span></div></div>
            <div>${raw(sparkline(ix.spark, { w: 130, h: 44 }))}</div>
          </div>
          <div class="row small muted" style="margin-top:8px"><span>1M <b class="${tone(ix.change1m)}">${fmt.pct(ix.change1m)}</b></span><span>1Y <b class="${tone(ix.change1y)}">${fmt.pct(ix.change1y)}</b></span></div>
          <div class="source-line">${ix.source || (ix.computed ? 'Computed by Stock Genius from tracked stocks' : '')}</div>
        </div>`)}
    </section>

    <section class="grid cols-3" style="margin-top:16px">
      <a class="card" href="#/radar" style="color:inherit;text-decoration:none">
        <div class="card-head"><div><span class="kicker">Market stress radar</span><h2 style="margin-top:4px">${d.stress.label}</h2></div><span class="badge analysis">Analysis</span></div>
        <p class="small">${d.stress.narrative}</p>
        <div class="row" style="margin-top:10px">${d.stress.gauges.filter((g) => g.status !== 'calm').slice(0, 4).map((g) => html`<span class="pill"><span class="dot" style="background:${g.status === 'elevated' ? 'var(--sell)' : 'var(--hold)'}"></span>${g.label}</span>`)}</div>
        <div class="small" style="margin-top:10px;color:var(--brand)">Open radar →</div>
      </a>
      <a class="card" href="#/breadth" style="color:inherit;text-decoration:none">
        <div class="card-head"><div><span class="kicker">Breadth ${explain('breadth')}</span><h2 style="margin-top:4px">${Math.round(b.pctAbove50 * 100)}% above 50-day average</h2></div><span class="badge fact">Fact</span></div>
        <div class="meter" aria-hidden="true"><span style="width:${b.pctAbove50 * 100}%"></span></div>
        <div class="row small" style="margin-top:10px"><span>Advancers <b class="up">${b.advancers}</b></span><span>Decliners <b class="down">${b.decliners}</b></span><span>52-wk highs ${b.newHighs}</span><span>lows ${b.newLows}</span></div>
        <p class="small muted" style="margin-top:8px">${b.note}</p>
      </a>
      <div class="card">
        <div class="card-head"><div><span class="kicker">Model views · ${horizonLabel(horizon)}</span><h2 style="margin-top:4px">How views are distributed</h2></div><span class="badge analysis">Analysis</span></div>
        <div class="stack" style="gap:8px">
          ${['Buy', 'Hold', 'Sell'].map((v) => html`<div class="row"><span style="width:62px">${viewBadge(v)}</span><div class="meter" style="flex:1"><span style="width:${(d.views[v] / d.stocks.length) * 100}%;background:var(--${v.toLowerCase()})"></span></div><span class="num small" style="width:28px;text-align:right">${d.views[v]}</span></div>`)}
        </div>
        <p class="small muted" style="margin-top:10px">A distribution of rules-based signals across ${d.stocks.length} tracked stocks — not a ranking or a list of picks. ${explain('buy-hold-sell', 'How views work')}</p>
      </div>
    </section>

    ${watchRows.length ? html`
    <section class="card pad-0" style="margin-top:16px">
      <div class="card-head" style="padding:16px 18px 0"><div><h2>Your watchlist</h2><p>Stocks you saved. ${kindBadge('user')}</p></div><a class="btn sm" href="#/desk/watchlists">Manage</a></div>
      ${stockTable(watchRows, sample)}
    </section>` : ''}

    <section class="grid cols-2" style="margin-top:16px">
      <div class="card pad-0">
        <div class="card-head" style="padding:16px 18px 0"><div><h2>Largest gains today</h2><p>Price change in the latest session. ${kindBadge('fact')}</p></div></div>
        ${stockTable(d.gainers, sample, true)}
      </div>
      <div class="card pad-0">
        <div class="card-head" style="padding:16px 18px 0"><div><h2>Largest declines today</h2><p>Price change in the latest session. ${kindBadge('fact')}</p></div></div>
        ${stockTable(d.losers, sample, true)}
      </div>
    </section>

    <div style="margin-top:16px">${adSlot('banner')}</div>

    <section class="grid cols-2" style="margin-top:16px">
      <div class="card">
        <div class="card-head"><div><h2>Sectors (1 month)</h2><p>Equal-weighted average return of tracked stocks. ${kindBadge('fact')}</p></div><a class="btn sm" href="#/breadth">Breadth map</a></div>
        <div class="stack" style="gap:6px">
          ${[...d.breadth.sectors].sort((a, c) => c.ret1mEqual - a.ret1mEqual).map((s) => html`
            <div class="row" style="gap:12px"><span style="width:170px" class="small">${sectorLink(s.sector)}</span>
              <div style="flex:1;position:relative;height:10px;background:var(--surface-2);border-radius:999px">
                <span style="position:absolute;top:0;bottom:0;${s.ret1mEqual >= 0 ? 'left:50%' : 'right:50%'};width:${Math.min(50, Math.abs(s.ret1mEqual) * 250)}%;background:${s.ret1mEqual >= 0 ? 'var(--up)' : 'var(--down)'};border-radius:999px"></span></div>
              <span class="num small ${tone(s.ret1mEqual)}" style="width:58px;text-align:right">${fmt.pct(s.ret1mEqual)}</span></div>`)}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Market & macro news</h2><p>Reported developments with their sources.</p></div>${sample ? kindBadge('sample') : ''}</div>
        ${d.news.length ? html`<div>${d.news.map((n) => html`<div class="news-item"><h4>${newsLink(n)}</h4><div class="source-line">${n.source} · ${fmt.datetime(n.publishedAt)}</div></div>`)}</div>` : html`<p class="muted">No market news from connected sources.</p>`}
      </div>
    </section>
  `);
  el.querySelectorAll('[data-h]').forEach((btn) => btn.addEventListener('click', () => { location.hash = `#/?horizon=${btn.dataset.h}`; }));
}

export const horizonLabel = (h) => ({ short: '1–3 months', medium: '6–12 months', long: '1–3 years' }[h] || h);

export function stockTable(rows, sample, compact = false) {
  return html`<div class="table-wrap"><table>
    <thead><tr><th>Company</th><th class="r">Price</th><th class="r">Day</th>${compact ? '' : html`<th class="r hide-sm">1M</th>`}<th>View</th>${compact ? '' : html`<th class="hide-sm">Confidence</th><th class="hide-sm">Risk</th>`}</tr></thead>
    <tbody>${rows.map((s) => html`<tr>
      <td><a class="name-cell" href="#/stock/${encodeURIComponent(s.ticker)}"><b>${s.name}</b><span>${s.ticker} · ${s.exchanges.join('/')} · ${s.sector}${sample ? ' · sample' : ''}</span></a></td>
      <td class="r num">${fmt.inr(s.price)}</td>
      <td class="r num ${tone(s.changePct)}">${fmt.pct(s.changePct / 100, 2)}</td>
      ${compact ? '' : html`<td class="r num hide-sm ${tone(s.ret1m)}">${fmt.pct(s.ret1m)}</td>`}
      <td>${viewBadge(s.view)}</td>
      ${compact ? '' : html`<td class="hide-sm"><span class="small">${s.confidenceBand} (${s.confidence})</span></td><td class="hide-sm"><span class="risk ${s.riskLevel}">${s.riskLevel}</span></td>`}
    </tr>`)}</tbody></table></div>`;
}
