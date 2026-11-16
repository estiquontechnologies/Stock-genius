import { api } from '../api.js';
import { html, fmt, kindBadge, emptyState } from '../ui.js';

const TYPE = { earnings: 'Results', dividend: 'Dividend', 'corporate action': 'Corporate action', macro: 'Macro / policy' };

export async function render(el, _p, query) {
  const scope = query.get('scope') || 'all';
  const type = query.get('type') || '';
  const d = await api(`/api/calendar?days=90${scope === 'watched' ? '&scope=watched' : ''}`);
  const events = d.events.filter((e) => !type || e.type === type);
  const byWeek = new Map();
  for (const e of events) {
    const dt = new Date(`${e.date}T12:00:00+05:30`);
    const monday = new Date(dt); monday.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
    const k = monday.toISOString().slice(0, 10);
    if (!byWeek.has(k)) byWeek.set(k, []);
    byWeek.get(k).push(e);
  }
  el.innerHTML = String(html`
    <div class="page-head"><div><div class="kicker">Catalyst calendar</div><h1>Upcoming events that can move stocks</h1>
      <p>Results, dividends, corporate actions and policy or data releases over the next 90 days, with the stocks you follow that may be affected — directly or through their sector.</p></div></div>
    <div class="row" style="margin-bottom:14px">
      <div class="seg" role="group" aria-label="Scope">${[['all', 'All events'], ['watched', `My stocks (${d.watchedCount})`]].map(([k, l]) => html`<button type="button" data-scope="${k}" aria-pressed="${k === scope}">${l}</button>`)}</div>
      <div class="seg" role="group" aria-label="Event type">${[['', 'All types'], ...Object.entries(TYPE)].map(([k, l]) => html`<button type="button" data-type="${k}" aria-pressed="${k === type}">${l}</button>`)}</div>
      ${d.data.simulated ? kindBadge('sample') : ''}
    </div>
    ${d.note ? html`<div class="callout info" style="margin-bottom:14px">${d.note}</div>` : ''}
    ${!events.length ? html`<div class="card">${emptyState(scope === 'watched' ? 'No events for your stocks' : 'No upcoming events', scope === 'watched' ? 'Add stocks to a watchlist or follow them to see their events here.' : 'Nothing scheduled in the next 90 days from the connected sources.')}</div>` : ''}
    <div class="stack">${[...byWeek].map(([wk, list]) => html`
      <section class="card"><h2 style="font-size:1rem">Week of ${fmt.date(wk)}</h2>
        <ul class="list-plain" style="margin-top:10px">${list.map((e) => html`
          <li class="row" style="align-items:flex-start;flex-wrap:nowrap;gap:14px;padding:8px 0;border-top:1px solid var(--line)">
            <div style="min-width:86px"><b>${fmt.date(e.date)}</b><div class="small muted">in ${e.daysAway} day${e.daysAway === 1 ? '' : 's'}</div></div>
            <div style="flex:1">
              <div class="row"><span class="pill">${TYPE[e.type] || e.type}</span><b>${e.title}</b>${e.confirmed === false ? html`<span class="badge neutral">expected</span>` : html`<span class="badge fact">announced</span>`}</div>
              ${e.note ? html`<div class="small muted">${e.note}</div>` : ''}
              ${e.tickers?.length ? html`<div class="small">Stocks: ${e.tickers.map((t) => html`<a href="#/stock/${t}">${t}</a> `)}</div>` : ''}
              ${e.sectors?.length ? html`<div class="small muted">Sectors most exposed (model assumption): ${e.sectors.join(', ')}</div>` : ''}
              ${e.watchedDirect?.length || e.watchedViaSector?.length ? html`<div class="small" style="color:var(--brand)">Your stocks: ${[...e.watchedDirect, ...e.watchedViaSector.map((t) => `${t} (via sector)`)].join(', ')}</div>` : ''}
              <div class="source-line">${e.source || ''}</div>
            </div></li>`)}</ul></section>`)}</div>`);
  el.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => { location.hash = `#/calendar?scope=${b.dataset.scope}&type=${type}`; }));
  el.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => { location.hash = `#/calendar?scope=${scope}&type=${b.dataset.type}`; }));
}
