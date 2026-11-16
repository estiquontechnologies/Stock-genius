import { api } from '../api.js';
import { html, fmt } from '../ui.js';

const SECTIONS = [['how', 'How views work'], ['data', 'Data sources'], ['compliance', 'Compliance status'], ['privacy', 'Privacy & ads'], ['disclaimer', 'Disclaimer']];
const CAT = { technical: 'Price & technicals', fundamental: 'Fundamentals', valuation: 'Valuation', news: 'News flow', macro: 'Macro & market', estimates: 'Analyst estimates' };

export async function render(el, [section = 'how']) {
  const [m, meta] = await Promise.all([api('/api/methodology'), api('/api/meta', { fresh: true })]);
  const d = meta.data;
  const body = {
    how: () => html`
      <div class="card"><h2>What a view is — and is not</h2>
        <p>A <b>Buy / Hold / Sell view</b> summarises what a fixed set of published rules says about the evidence for one stock over one time horizon. It is a research signal to help you investigate, <b>not a recommendation to you personally</b>, not a forecast and not a promise. Stock Genius does not promote any stock, receives no payment from companies it covers, and does not rank “top picks”. Every decision is yours.</p>
        <p class="muted small">Model version ${m.modelVersion}. The rules have not been validated as predicting returns; treat them as a structured checklist.</p></div>
      <div class="card"><h2>Steps</h2><ol>
        <li><b>Signals.</b> Each signal records a <i>fact</i> (with source and time), the model’s <i>analysis</i>, a score from −1 to +1, an evidence-quality grade and what would change it.</li>
        <li><b>Categories.</b> Signal scores are averaged within a category, weighting evidence quality: ${Object.entries(m.evidenceWeights).map(([k, v]) => `${k} ${v}`).join(', ')}.</li>
        <li><b>Horizon weights.</b> Categories combine with the weights below. Categories with no data are dropped and weights rescaled — and confidence is reduced.</li>
        <li><b>View.</b> Composite ≥ ${m.thresholds.buy} → Buy; ≤ ${m.thresholds.sell} → Sell; otherwise Hold.</li>
        <li><b>Confidence</b> (10–85) reflects score strength, agreement between signals, missing data, risk level and upcoming results. It is not a probability.</li>
        <li><b>History.</b> Views are recomputed point-in-time every five sessions using only data available on each date, and each view this server displays is logged.</li></ol></div>
      <div class="card pad-0"><div class="card-head" style="padding:16px 18px 0"><h2>Category weights by horizon</h2></div><div class="table-wrap"><table><thead><tr><th>Category</th>${Object.values(m.horizons).map((h) => html`<th class="r">${h.label}</th>`)}</tr></thead>
        <tbody>${Object.keys(CAT).map((c) => html`<tr><td>${CAT[c]}</td>${Object.keys(m.horizons).map((h) => html`<td class="r num">${fmt.pctAbs(m.categoryWeights[h][c], 0)}</td>`)}</tr>`)}</tbody></table></div></div>
      <div class="card pad-0"><div class="card-head" style="padding:16px 18px 0"><div><h2>Sector macro assumptions</h2><p>Judgement-based sensitivities (−1 to +1) used for macro signals, stress exposure and the portfolio lens. They are assumptions, not measurements.</p></div></div>
        <div class="table-wrap"><table><thead><tr><th>Sector</th>${Object.values(m.factors).map((f) => html`<th class="r">${f.short}</th>`)}</tr></thead>
        <tbody>${Object.entries(m.sectorAssumptions).map(([s, v]) => html`<tr><td>${s}</td>${Object.keys(m.factors).map((f) => html`<td class="r num">${v.sens[f] ?? 0}</td>`)}</tr>`)}</tbody></table></div></div>`,
    data: () => html`
      <div class="card"><h2>Current data mode: ${d.name}</h2>
        <p>${d.licenseNote}</p>
        <ul class="bullet small"><li>Latest session: ${fmt.date(d.asOf)}${d.stale ? html` — <b>stale</b>: ${d.staleReason}` : ''}</li>
          ${d.coverage ? Object.entries(d.coverage).map(([k, v]) => html`<li><b>${k}</b>: ${v}</li>`) : ''}
          ${d.instrumentsSkipped ? html`<li>${d.instrumentsSkipped} instruments skipped (less than about one year of history)</li>` : ''}</ul></div>
      <div class="card"><h2>What is real, delayed or simulated</h2><ul class="bullet">
        <li><b>Sample mode</b>: everything is simulated and fictional, labelled “Sample”.</li>
        <li><b>Automatic free mode</b>: real end-of-day prices for Nifty 500 stocks from the Upstox historical-candle API, with NSE/BSE daily bhavcopy files as fallback; Nifty 50, SENSEX and India VIX index levels; end-of-day option prices and open interest from the NSE F&O bhavcopy (implied volatility and Greeks are computed by Stock Genius); macro series from FRED (with a free key); news headlines from RSS feeds and the NSE announcements feed. Prices are end-of-day; if the server has an Upstox access token, last-traded prices are shown as “Live”.</li>
        <li><b>Not available from free sources</b> (planned for version 2 with licensed feeds): company fundamentals, analyst estimates, corporate-action and results calendars, real-time feeds for public display.</li></ul></div>
      <div class="card"><h2>Sources and licensing</h2><p class="small">Data is fetched automatically once per day after the market closes, one request at a time with pauses. Exchange and broker data terms generally restrict automated access and redistribution; personal research use and public display are treated differently. Before operating a public website, obtain the appropriate data licences (see Compliance status).</p>
        ${meta.collector ? html`<p class="small muted">Collector: last run ${fmt.datetime(meta.collector.lastRunFinished)} · ${meta.collector.sessionsStored} sessions stored · price source ${meta.collector.priceSource || '—'} · next run ${fmt.datetime(meta.collector.nextRunAt)}</p>` : ''}</div>`,
    compliance: () => html`
      <div class="callout warn"><b>Not yet reviewed for public launch.</b> The points below are an engineering checklist for qualified legal and compliance professionals in India. A disclaimer alone does not make this product compliant.</div>
      <div class="card"><h2>SEBI</h2><ul class="bullet">
        <li><b>SEBI (Research Analysts) Regulations, 2014</b> (as amended, including the December 2024 amendments): publishing Buy/Hold/Sell views on listed securities to the public — even free and ad-funded — is likely to make the operator a research analyst requiring SEBI registration, qualified personnel (NISM certification), disclosures (conflicts of interest, holdings, compensation), research-report content rules, record keeping, a compliance audit, grievance redressal (SCORES) and membership of the RA administration and supervisory body. The amendments also require disclosure of AI or model use and keep the registered entity responsible for its output.</li>
        <li><b>SEBI (Investment Advisers) Regulations, 2013</b>: personalised advice requires IA registration. The portfolio lens must stay descriptive and must not suggest trades for individuals.</li>
        <li><b>SEBI circulars on unregistered “finfluencers” and educators (2024–2025)</b>: restrict regulated entities’ association with unregistered persons giving advice or return claims, and restrict education content that uses recent market price data. Confirm the current text and how it applies.</li>
        <li><b>Options (F&O)</b>: SEBI has highlighted widespread losses among individual F&O traders. The options pages show analytics and an educational payoff simulator only — no views, trade ideas or order placement — with a risk notice on every page.</li>
        <li><b>Advertisement code for RAs/IAs</b>: no promises of returns, no misleading claims, specific disclaimers; applies to how the site markets itself.</li></ul></div>
      <div class="card"><h2>Advertising-specific risks</h2><ul class="bullet">
        <li>Ad revenue is “consideration”; advertisers such as brokers, trading apps or listed companies create potential conflicts of interest that must be disclosed and managed. Consider blocking ad categories for brokers, trading apps, “tips” services and individual listed companies in the ad network.</li>
        <li>Keep ads visually separate from research (implemented: labelled slots, never inside views, evidence, risks or news).</li>
        <li>Google AdSense financial-services policies and Indian advertising law (Consumer Protection Act 2019, CCPA guidelines on misleading ads and dark patterns, ASCI code).</li></ul></div>
      <div class="card"><h2>Data licensing</h2><ul class="bullet">
        <li>NSE and BSE: public display or redistribution of prices (real-time, delayed or end-of-day) and index values for a commercial site generally requires a licence from the exchange or an authorised vendor. Index names and data may be trademarks of their owners.</li>
        <li>Upstox API terms restrict data use to the account holder; commercial redistribution is not permitted without agreement.</li>
        <li>FRED: some series are owned by third parties with their own terms; attribute as required.</li>
        <li>News: RSS headlines link back to publishers; confirm each publisher’s terms.</li></ul></div>
      <div class="card"><h2>Privacy and other law</h2><ul class="bullet">
        <li><b>Digital Personal Data Protection Act, 2023</b> and the DPDP Rules: notice, consent (including for advertising cookies), purpose limitation, retention, and data-principal rights for any user accounts, watchlists, theses and holdings.</li>
        <li>Information Technology Act, 2000 and IT (Intermediary Guidelines) Rules, 2021 if users can publish content.</li>
        <li>Terms of use, grievance officer contact, and a correction process for errors.</li></ul></div>
      <div class="card"><h2>Engineering items still required before public use</h2><ul class="bullet small">
        <li>User accounts with authentication (the current build is single-user).</li><li>A database with backups and retention rules instead of a JSON file.</li>
        <li>Rate limiting, monitoring and an incident process for bad data.</li><li>Model validation and periodic review of rules, weights and sector assumptions, with records.</li></ul></div>`,
    privacy: () => html`<div class="card"><h2>Privacy & advertising</h2><ul class="bullet">
      <li>Stock Genius is free and funded by advertising. Ads are always labelled “Advertisement” and appear only in separate slots — never inside a research view, the evidence, risk sections or news.</li>
      <li>Ads load only after you choose an option in the consent banner. “Essential only” requests non-personalised ads. You can change your choice from the footer at any time.</li>
      <li>Your watchlists, follows, theses, journal and holdings are stored on this server only to provide these features, and are never shared with advertisers.</li>
      <li>We never ask for brokerage logins and never execute trades.</li>
      <li>Preferences such as theme and explanation level are kept in your browser’s local storage.</li></ul></div>`,
    disclaimer: () => html`<div class="card"><h2>Disclaimer</h2>
      <p>Stock Genius provides general research information generated by transparent rules from the data sources described. It is not investment advice, not a recommendation to buy or sell any security, and does not consider your objectives, financial situation or needs. Data can be delayed, incomplete or wrong; models can be wrong. Past performance and historical patterns do not guarantee future results. Investing in shares involves risk, including loss of the entire amount invested. You are responsible for your decisions. Consider consulting a SEBI-registered investment adviser before acting.</p>
      <p class="small muted">Stock Genius has not yet obtained SEBI registration; see Compliance status.</p></div>`,
  };
  el.innerHTML = String(html`
    <div class="page-head"><div><div class="kicker">Methodology & disclosures</div><h1>How Stock Genius works</h1><p>Everything that influences a view is published here, so you can judge it for yourself.</p></div></div>
    <div class="row" style="margin-bottom:14px">${SECTIONS.map(([k, l]) => html`<a class="btn sm ${k === section ? 'primary' : ''}" href="#/methodology/${k}">${l}</a>`)}</div>
    <div class="stack">${(body[section] || body.how)()}</div>`);
}
