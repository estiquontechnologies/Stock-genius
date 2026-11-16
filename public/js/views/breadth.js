import { api } from '../api.js';
import { html, fmt, tone, kindBadge, explain } from '../ui.js';
import { lineChart } from '../charts.js';

export async function render(el) {
  const d = await api('/api/breadth');
  const m = d.market;
  const heatBg = (r) => {
    const a = Math.min(0.85, Math.abs(r) * 6 + 0.08);
    return r >= 0 ? `color-mix(in srgb, var(--up) ${a * 100}%, var(--surface))` : `color-mix(in srgb, var(--down) ${a * 100}%, var(--surface))`;
  };
  el.innerHTML = String(html`
    <div class="page-head"><div><div class="kicker">Sector & market breadth ${explain('breadth')}</div><h1>Is the move broad or narrow?</h1>
      <p>Shows which sectors are strengthening or weakening, how many stocks participate, and whether a few large names drive the move. ${explain('concentration', 'About concentration')}</p></div>${d.data.simulated ? kindBadge('sample') : kindBadge('fact')}</div>
    <div class="grid cols-4">
      ${card('Above 50-day average', fmt.pctAbs(m.pctAbove50, 0), `${fmt.pctAbs(m.pctAbove200, 0)} above 200-day`)}
      ${card('Advancers / decliners', `${m.advancers} / ${m.decliners}`, 'latest session')}
      ${card('1M: cap-weighted vs average stock', `${fmt.pct(m.ret1mCap)} / ${fmt.pct(m.ret1mEqual)}`, m.narrowLeadership ? 'Narrow leadership' : 'Broad participation')}
      ${card('New 52-week highs / lows', `${m.newHighs} / ${m.newLows}`, 'latest session')}
    </div>
    <div class="callout ${m.narrowLeadership ? 'warn' : 'info'}" style="margin-top:14px"><span class="badge analysis">Analysis</span> ${m.note}</div>
    <section class="card" style="margin-top:16px"><div class="card-head"><div><h2>Participation over time</h2><p>Share of tracked stocks above their 50-day average.</p></div></div><div class="chart" id="b-chart"></div></section>
    <section style="margin-top:16px"><h2 style="margin-bottom:10px">Sector map (1-month, equal-weighted)</h2>
      <div class="heat">${[...d.sectors].sort((a, b) => b.ret1mEqual - a.ret1mEqual).map((s) => html`
        <a class="heat-cell" href="#/explore?sector=${encodeURIComponent(s.sector)}" style="background:${heatBg(s.ret1mEqual)}">
          <b>${s.sector}</b>
          <span class="num" style="font-size:1.2rem;font-weight:700">${fmt.pct(s.ret1mEqual)}</span>
          <span class="small">${s.status} · ${Math.round(s.pctAbove50 * 100)}% above 50-day · ${s.count} stocks</span>
          <span class="small">${s.concentrated ? `Concentrated: top 2 = ${Math.round(s.top2Share * 100)}% of move (${s.leaders.map((x) => x.ticker).join(', ')})` : 'Move is spread across members'}</span>
        </a>`)}</div></section>
    <section class="card pad-0" style="margin-top:16px"><div class="table-wrap"><table>
      <thead><tr><th>Sector</th><th>Status</th><th class="r">1M avg</th><th class="r">1M cap-wtd</th><th class="r">&gt;50-day</th><th class="r">&gt;200-day</th><th class="r">Adv/Dec</th><th class="r">Top-2 share</th></tr></thead>
      <tbody>${d.sectors.map((s) => html`<tr><td>${s.sector}</td><td>${s.status}</td><td class="r num ${tone(s.ret1mEqual)}">${fmt.pct(s.ret1mEqual)}</td><td class="r num ${tone(s.ret1mCap)}">${fmt.pct(s.ret1mCap)}</td><td class="r num">${fmt.pctAbs(s.pctAbove50, 0)}</td><td class="r num">${fmt.pctAbs(s.pctAbove200, 0)}</td><td class="r num">${s.advancers}/${s.decliners}</td><td class="r num">${fmt.pctAbs(s.top2Share, 0)}</td></tr>`)}</tbody></table></div></section>`);
  if (d.history.length > 1) return lineChart(el.querySelector('#b-chart'), { dates: d.history.map((h) => h.date), series: [{ name: '% above 50-day', values: d.history.map((h) => h.pctAbove50 * 100), color: 'var(--chart-1)' }], baseline: 50, height: 200, yFormat: (v) => `${v.toFixed(0)}%` });
  return null;
}
const card = (l, v, s) => html`<div class="card"><div class="stat"><span class="label">${l}</span><span class="value num">${v}</span><span class="sub muted">${s}</span></div></div>`;
