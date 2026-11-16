import { api } from '../api.js';
import { html, raw, fmt, kindBadge, explain, newsLink, sectorLink } from '../ui.js';
import { sparkline } from '../charts.js';

export async function render(el) {
  const d = await api('/api/radar');
  const color = { calm: 'var(--buy)', watch: 'var(--hold)', elevated: 'var(--sell)' };
  el.innerHTML = String(html`
    <div class="page-head"><div><div class="kicker">Market stress radar ${explain('stress-radar')}</div><h1>Overall: ${d.label}</h1>
      <p>Each gauge compares today’s reading with its own past year. “Watch” and “Elevated” mean unusually high stress. A month ago the radar read <b>${d.previous.label}</b>.</p></div>${d.data.simulated ? kindBadge('sample') : ''}</div>
    <div class="callout info" style="margin-bottom:16px"><span class="badge analysis">Analysis</span> ${d.narrative}</div>
    <div class="grid cols-3">${d.gauges.map((g) => html`
      <div class="gauge">
        <div><div class="state ${g.status}">${g.status === 'watch' ? 'Watch' : g.status === 'elevated' ? 'Elevated' : 'Calm'} <span class="muted" style="text-transform:none;letter-spacing:0">· ${g.trend}</span></div><h3 style="margin-top:2px">${g.label}</h3></div>
        <div>${g.spark ? raw(sparkline(g.spark, { w: 100, h: 36, color: color[g.status] })) : ''}</div>
        <div style="grid-column:1/-1" class="small"><span class="badge fact">Fact</span> ${g.reading}</div>
        <div style="grid-column:1/-1" class="small muted">${g.explain}</div>
        <div style="grid-column:1/-1" class="small muted">Stress score (z) ${fmt.num(g.z, 2)}</div>
      </div>`)}</div>

    <section class="card" style="margin-top:16px">
      <div class="card-head"><div><h2>Which sectors may be exposed</h2><p>Combines stressed gauges with the sector sensitivity assumptions in the methodology. Higher = more exposed to current stresses.</p></div><span class="badge analysis">Analysis</span></div>
      <div class="table-wrap"><table><thead><tr><th>Sector</th><th class="r">Exposure</th><th>Why (model assumptions)</th></tr></thead>
        <tbody>${d.sectors.map((s) => html`<tr><td>${sectorLink(s.sector)}</td><td class="r num" style="color:${s.exposure > 0.3 ? 'var(--sell)' : s.exposure < -0.3 ? 'var(--buy)' : 'inherit'}">${s.exposure > 0 ? '+' : ''}${fmt.num(s.exposure, 2)}</td>
          <td class="small">${s.drivers.filter((x) => x.why).map((x) => html`<div><b>${x.label}</b> — ${x.effect}: ${x.why}</div>`)}${!s.drivers.some((x) => x.why) ? html`<span class="muted">No strong exposure to current stresses</span>` : ''}</td></tr>`)}</tbody></table></div>
    </section>

    <section class="grid cols-2" style="margin-top:16px">
      <div class="card"><h2>Data behind the gauges</h2><ul class="list-plain small" style="margin-top:10px">${Object.values(d.macroSources).map((m) => html`<li><b>${m.name}</b>: ${fmt.num(m.last?.value, 2)} on ${fmt.date(m.last?.date)} · ${m.sourceUrl ? html`<a href="${m.sourceUrl}" target="_blank" rel="noopener nofollow">${m.source}</a>` : m.source}${m.simulated ? ' (simulated)' : ''}</li>`)}</ul>
        ${Object.keys(d.macroSources).length < 5 ? html`<p class="small muted">Some gauges are unavailable. Add a free FRED API key on the server to enable crude, rupee, US yields and global equities.</p>` : ''}</div>
      <div class="card"><h2>Recent market developments</h2>${d.news.length ? d.news.map((n) => html`<div class="news-item"><h4>${newsLink(n)}</h4><div class="source-line">${n.source} · ${fmt.datetime(n.publishedAt)}</div></div>`) : html`<p class="muted small">No market news from connected sources.</p>`}</div>
    </section>`);
}
