// Assembles options research payloads from a provider's end-of-day chains.
import { analyseExpiry, interpretExpiry, RISK_FREE } from '../analysis/options.js';

export const F_AND_O_RISK = {
  headline: 'Most individual F&O traders lose money.',
  body: 'A SEBI study published in September 2024 found that about 93% of individual traders in equity futures and options made net losses over FY22–FY24. Options can expire worthless, sellers can face losses far larger than the premium received, and leverage magnifies both. This page is research and education only — it does not suggest any trade.',
  source: 'Securities and Exchange Board of India (sebi.gov.in) — study on profit and loss of individual traders in equity F&O, September 2024',
};

const cache = new Map();

function ivPercentile(history, current) {
  const xs = history.map((h) => h.atmIv).filter((x) => x != null);
  if (xs.length < 20 || current == null) return null;
  return xs.filter((x) => x <= current).length / xs.length;
}

export async function optionsOverview(provider) {
  if (!provider.getOptionUnderlyings) return { available: false, underlyings: [] };
  const list = await provider.getOptionUnderlyings();
  const out = [];
  for (const u of list) {
    const d = await optionsDetail(provider, u.symbol);
    if (!d) continue;
    const a = d.selected;
    out.push({
      symbol: u.symbol, name: u.name, kind: u.kind, ticker: u.ticker, spot: u.spot, lotSize: u.lotSize, expiry: a.expiry, daysToExpiry: a.daysToExpiry,
      atmIv: a.atmIv, realisedVol: d.realisedVol, ivPercentile: d.ivPercentile, pcr: a.pcrOi, maxPain: a.maxPain,
      expectedMovePct: a.expectedMove.straddlePct, nextEarnings: d.nextEarnings, simulated: d.simulated,
    });
  }
  out.sort((a, b) => (a.kind === b.kind ? a.symbol.localeCompare(b.symbol) : a.kind === 'index' ? -1 : 1));
  return { available: true, underlyings: out, risk: F_AND_O_RISK };
}

export async function optionsDetail(provider, symbol, expiry) {
  if (!provider.getOptionChain) return null;
  const c = await provider.getOptionChain(symbol);
  if (!c) return null;
  const key = `${provider.id}:${c.asOf}:${symbol}:${expiry || ''}`;
  if (cache.has(key)) return cache.get(key);
  const expiries = c.expiries.filter((e) => e >= c.asOf && c.rows.some((r) => r.expiry === e));
  const sel = expiries.includes(expiry) ? expiry : expiries.find((e) => e > c.asOf) || expiries[0];
  if (!sel) return null;
  const analyse = (e) => analyseExpiry({ spot: c.spot, asOfDate: c.asOf, expiry: e, rows: c.rows.filter((r) => r.expiry === e), lotSize: c.lotSize });
  const selected = analyse(sel);
  const term = expiries.map((e) => {
    const a = e === sel ? selected : analyse(e);
    return { expiry: e, daysToExpiry: a.daysToExpiry, atmIv: a.atmIv, pcr: a.pcrOi, straddlePct: a.expectedMove.straddlePct };
  });
  const pct = ivPercentile(c.history || [], selected.atmIv);
  const notes = interpretExpiry(selected, { realisedVol: c.realisedVol20, ivPercentile: pct });
  if (c.nextEarnings && c.nextEarnings.date <= sel) {
    notes.push({ id: 'event', fact: `Results expected on ${c.nextEarnings.date}, before this expiry.`, analysis: 'Option prices usually include an extra premium for the results-day move, which tends to drop sharply after the announcement (an “IV crush”).' });
  }
  const out = {
    symbol, name: c.name, kind: c.kind, ticker: c.ticker, lotSize: c.lotSize, spot: c.spot, asOf: c.asOf,
    source: c.source, sourceUrl: c.sourceUrl || null, freshness: c.freshness, simulated: !!c.simulated,
    expiries, selected, term, notes, history: c.history || [], ivPercentile: pct, realisedVol: c.realisedVol20,
    nextEarnings: c.nextEarnings || null, riskFree: RISK_FREE, risk: F_AND_O_RISK,
    method: 'Implied volatility and Greeks are computed by Stock Genius from end-of-day option prices using the Black-Scholes model (European options, no dividends) and an assumed risk-free rate. Treat them as approximations.',
  };
  cache.set(key, out);
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return out;
}
