import { api } from '../api.js';
import { html, fmt, viewBadge, emptyState, newsLink, toast } from '../ui.js';
import { refreshAlertCount } from '../app.js';

const TYPE_LABEL = { view: 'View change', confidence: 'Confidence', risk: 'Risk level', signal: 'Key signal' };

export async function render(el, _p, query) {
  const filter = query.get('type') || '';
  const d = await api('/api/alerts', { fresh: true });
  if (!d.follows.length) {
    el.innerHTML = String(html`<div class="page-head"><div><div class="kicker">Signal-change alerts</div><h1>Alerts</h1></div></div>
      <div class="card">${emptyState('You are not following any stocks yet', 'Open a stock and choose “Follow changes”. You will see when its view, confidence, risk level or key signals change — each with the evidence behind it.', html`<a class="btn primary" href="#/explore">Find a stock</a>`)}</div>`);
    return;
  }
  const list = d.alerts.filter((a) => !filter || a.type === filter);
  el.innerHTML = String(html`
    <div class="page-head"><div><div class="kicker">Signal-change alerts</div><h1>What changed in the stocks you follow</h1><p>${d.note}</p></div>
      <button class="btn" id="read-all">Mark all as read</button></div>
    <div class="row" style="margin-bottom:12px">
      <div class="seg" role="group" aria-label="Alert type">${[['', 'All'], ...Object.entries(TYPE_LABEL)].map(([k, l]) => html`<button type="button" data-t="${k}" aria-pressed="${k === filter}">${l}</button>`)}</div>
      <span class="small muted">Following: ${d.follows.map((f) => html`<a href="#/stock/${f.ticker}">${f.ticker}</a> `)}</span>
    </div>
    ${list.length ? '' : html`<div class="card">${emptyState('No alerts in the last 90 days', 'Nothing changed for this filter.')}</div>`}
    <div class="stack">${list.map((a) => html`
      <article class="card" style="${a.read ? '' : 'border-left:4px solid var(--brand)'}">
        <div class="row between"><div class="row"><span class="pill">${TYPE_LABEL[a.type]}</span><b>${a.title}</b>${a.read ? '' : html`<span class="badge eod">New</span>`}</div><span class="small muted">${fmt.date(a.date)} · ${({ short: '1–3 months', medium: '6–12 months', long: '1–3 years' })[a.horizon]}</span></div>
        ${a.type === 'view' ? html`<div class="row" style="margin-top:8px">${viewBadge(a.from)} → ${viewBadge(a.to)}<span class="small muted">price then ${fmt.inr(a.price)}</span></div>` : html`<div class="small" style="margin-top:6px"><b>Before:</b> ${a.from}<br><b>After:</b> ${a.to}</div>`}
        <p class="small" style="margin-top:8px"><span class="badge analysis">Analysis</span> ${a.explanation}</p>
        ${a.evidence?.length ? html`<details><summary class="small">Evidence (${a.evidence.length})</summary><ul class="list-plain small" style="margin-top:8px">${a.evidence.map((e) => html`<li><b>${e.signal}</b><div><span class="badge fact">Now</span> ${e.now}</div>${e.before ? html`<div class="muted">Before: ${e.before}</div>` : ''}${e.items?.length ? html`<div>${e.items.map((it) => html`<div>↳ ${newsLink(it)} <span class="muted">${fmt.datetime(it.publishedAt)}</span></div>`)}</div>` : ''}</li>`)}</ul></details>` : ''}
        <div class="row" style="margin-top:8px"><a class="btn sm" href="#/stock/${a.ticker}?horizon=${a.horizon}&tab=history">Open view history</a></div>
      </article>`)}</div>`);
  el.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => { location.hash = `#/alerts?type=${b.dataset.t}`; }));
  el.querySelector('#read-all').addEventListener('click', async () => {
    await api('/api/alerts/read', { method: 'POST', body: { ids: d.alerts.map((a) => a.id) } });
    toast('All alerts marked as read');
    refreshAlertCount();
    render(el, _p, query);
  });
}
