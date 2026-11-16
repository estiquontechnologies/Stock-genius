// "Why did this move?" — detects unusual daily moves and lines them up with
// news, filings, results, sector moves and market moves around the same
// time. Links are labelled as POSSIBLE explanations: timing alignment is
// not proof of cause.

import { stdev, mean, beta as betaFn } from './indicators.js';

export function detectMoves({ dates, closes, volumes, market, sector, news, maxItems = 14, lookback = 250 }) {
  const n = closes.length;
  const start = Math.max(61, n - lookback);
  const b = betaFn(closes, market);
  const items = [];
  for (let i = start; i < n; i++) {
    const r = closes[i] / closes[i - 1] - 1;
    const hist = [];
    for (let k = i - 60; k < i; k++) hist.push(closes[k] / closes[k - 1] - 1);
    const sd = stdev(hist);
    const z = sd ? r / sd : 0;
    if (Math.abs(z) < 2.4 || Math.abs(r) < 0.025) continue;
    const m = market[i] / market[i - 1] - 1;
    const s = sector ? sector[i] / sector[i - 1] - 1 : null;
    const expectedFromMarket = b * m;
    let driver = 'company-specific';
    if (Math.sign(expectedFromMarket) === Math.sign(r) && Math.abs(expectedFromMarket) >= 0.5 * Math.abs(r)) driver = 'market-wide';
    else if (s != null && Math.sign(s) === Math.sign(r) && Math.abs(s) >= 0.45 * Math.abs(r) && Math.abs(s) > Math.abs(m) * 1.3) driver = 'sector-wide';
    const avgVol = mean(volumes.slice(Math.max(0, i - 20), i));
    const volRatio = avgVol ? volumes[i] / avgVol : null;
    items.push({ i, date: dates[i], ret: r, z, market: m, sector: s, beta: b, driver, volRatio });
  }
  items.sort((a, b2) => Math.abs(b2.z) - Math.abs(a.z));
  const top = items.slice(0, maxItems).sort((a, b2) => (a.date < b2.date ? 1 : -1));

  return top.map((mv) => {
    const sessionStart = Date.parse(`${dates[mv.i - 1]}T15:30:00+05:30`);
    const sessionEnd = Date.parse(`${mv.date}T15:30:00+05:30`);
    const nearbyStart = Date.parse(`${dates[Math.max(0, mv.i - 3)]}T15:30:00+05:30`);
    const cands = [];
    for (const it of news) {
      const t = Date.parse(it.publishedAt);
      if (t <= nearbyStart || t > sessionEnd) continue;
      const timing = t > sessionStart ? 'same session' : '1–2 sessions earlier';
      const consistent = it.tone === 0 ? 'neutral' : Math.sign(it.tone) === Math.sign(mv.ret) ? 'consistent' : 'inconsistent';
      const scopeMatch = (it.scope === 'company' && mv.driver === 'company-specific') || (it.scope === 'sector' && mv.driver === 'sector-wide') || (it.scope === 'market' && mv.driver === 'market-wide');
      let strength = 0;
      if (timing === 'same session') strength += 2;
      if (consistent === 'consistent') strength += 2;
      if (consistent === 'inconsistent') strength -= 2;
      if (scopeMatch) strength += 1;
      if (it.category === 'earnings') strength += 1;
      cands.push({
        id: it.id, headline: it.headline, scope: it.scope, category: it.category, publishedAt: it.publishedAt, source: it.source, url: it.url,
        timing, toneAlignment: consistent, strength, sample: it.sample,
      });
    }
    cands.sort((a, b2) => b2.strength - a.strength);
    const best = cands.find((c) => c.strength >= 3);
    const linkStrength = best ? (best.strength >= 5 ? 'stronger' : 'weaker') : 'none';
    const dir = mv.ret > 0 ? 'rose' : 'fell';
    const ctxText = mv.driver === 'market-wide'
      ? `The broad market moved ${(mv.market * 100).toFixed(1)}% the same day; with a beta of ${mv.beta.toFixed(2)}, much of this move is consistent with a market-wide move.`
      : mv.driver === 'sector-wide'
        ? `Sector peers moved ${(mv.sector * 100).toFixed(1)}% on average the same day, so the move looks sector-wide rather than company-specific.`
        : `The market (${(mv.market * 100).toFixed(1)}%) and sector peers (${mv.sector == null ? 'no peers tracked' : `${(mv.sector * 100).toFixed(1)}%`}) moved much less, so the move looks company-specific.`;
    const explanation = best
      ? `Possible explanation: “${best.headline}” (${best.timing}). ${ctxText}`
      : `No clear explanation found in the connected sources. ${ctxText}`;
    return {
      date: mv.date, ret: +mv.ret.toFixed(4), z: +mv.z.toFixed(1), marketRet: +mv.market.toFixed(4), sectorRet: mv.sector == null ? null : +mv.sector.toFixed(4),
      volumeRatio: mv.volRatio == null ? null : +mv.volRatio.toFixed(1), driver: mv.driver, direction: dir,
      linkStrength, explanation, candidates: cands.slice(0, 4),
      caveat: 'Timing alignment suggests, but does not prove, a link. Other information may have driven the move.',
    };
  });
}
