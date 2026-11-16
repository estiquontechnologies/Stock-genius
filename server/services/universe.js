// Loads every tracked instrument once per data snapshot and derives
// composite indices, sector indices and per-date lookups.
//
// Composite indices are COMPUTED by this app from the tracked universe
// (market-cap weighted, constant share counts). They are not official
// exchange indices; in live mode connect licensed index data instead.

import { quartersAsOf, peAt, ttmMetrics } from '../analysis/fundamentals.js';
import { annualVol, median } from '../analysis/indicators.js';

let cache = { key: null, value: null };

export function clearUniverseCache() {
  cache = { key: null, value: null };
}

export async function loadUniverse(provider) {
  const meta = await provider.describe();
  const key = `${provider.id}:${meta.asOf}:${meta.version || ''}`;
  if (cache.key === key) return cache.value;

  const instruments = await provider.listInstruments();
  const byTicker = {};
  await Promise.all(instruments.map(async (inst) => {
    const [bars, fundamentals, quote] = await Promise.all([
      provider.getBars(inst.ticker), provider.getFundamentals(inst.ticker), provider.getQuote(inst.ticker),
    ]);
    if (!bars || bars.length < 2) return;
    byTicker[inst.ticker] = { inst, bars, fundamentals, quote };
  }));

  const dateSet = new Set();
  for (const t of Object.values(byTicker)) for (const b of t.bars) dateSet.add(b.date);
  const dates = [...dateSet].sort();
  const dateIdx = new Map(dates.map((d, i) => [d, i]));

  // Aligned close arrays (forward-filled for missing sessions).
  for (const t of Object.values(byTicker)) {
    const map = new Map(t.bars.map((b) => [b.date, b.close]));
    let last = t.bars[0].close;
    t.aligned = dates.map((d) => {
      if (map.has(d)) last = map.get(d);
      return last;
    });
  }

  // Market-cap weighted when share counts are known, otherwise equal-weighted.
  const composite = (members, base = 10000) => {
    if (!members.length) return null;
    const capW = members.every((t) => t.fundamentals?.sharesCr);
    const raw = dates.map((_, i) => members.reduce((a, t) => a + (capW ? t.aligned[i] * t.fundamentals.sharesCr : t.aligned[i] / t.aligned[0]), 0));
    return dates.map((d, i) => ({ date: d, value: +(base * raw[i] / raw[0]).toFixed(2) }));
  };
  const weighting = (members) => (members.every((t) => t.fundamentals?.sharesCr) ? 'cap-weighted' : 'equal-weighted');
  const all = Object.values(byTicker);
  const nseM = all.filter((t) => t.inst.exchanges.includes('NSE'));
  const bseM = all.filter((t) => t.inst.exchanges.includes('BSE'));
  const indices = {
    ALL: { id: 'ALL', name: `All tracked stocks (computed, ${weighting(all)})`, series: composite(all), computed: true },
    NSE: { id: 'NSE', name: meta.simulated ? 'Demo NSE Composite (simulated)' : `Tracked NSE stocks (computed, ${weighting(nseM)})`, series: composite(nseM), computed: true },
    BSE: { id: 'BSE', name: meta.simulated ? 'Demo BSE Composite (simulated)' : `Tracked BSE-listed stocks (computed, ${weighting(bseM)})`, series: composite(bseM, 30000), computed: true },
  };
  // Prefer official index series supplied by the provider, aligned to sessions.
  if (provider.getIndices) {
    const official = await provider.getIndices();
    for (const [k, ix] of Object.entries(official || {})) {
      if (!ix?.series?.length) continue;
      const map = new Map(ix.series.map((p) => [p.date, p.value]));
      let last = ix.series[0].value;
      indices[k] = { id: k, name: ix.name, source: ix.source, computed: false, series: dates.map((d) => { if (map.has(d)) last = map.get(d); return { date: d, value: last }; }) };
    }
  }
  const sectors = [...new Set(all.map((t) => t.inst.sector))].sort();
  const sectorIndex = {};
  for (const s of sectors) sectorIndex[s] = composite(all.filter((t) => t.inst.sector === s), 1000);

  if (!all.length) {
    const empty = { meta, instruments: [], byTicker: {}, dates, dateIdx, indices: {}, sectors: [], sectorIndex: {}, statsCache: new Map(), empty: true };
    cache = { key, value: empty };
    return empty;
  }
  const value = { meta, instruments: all.map((t) => t.inst), byTicker, dates, dateIdx, indices, sectors, sectorIndex, statsCache: new Map() };
  cache = { key, value };
  return value;
}

/** Sector valuation/growth stats as of a session index (cached). */
export function sectorStats(u, sector, idx) {
  const key = `${sector}:${idx}`;
  if (u.statsCache.has(key)) return u.statsCache.get(key);
  const date = u.dates[idx];
  const rows = Object.values(u.byTicker).filter((t) => t.inst.sector === sector).map((t) => {
    const q = quartersAsOf(t.fundamentals, date);
    const price = t.aligned[idx];
    const pe = peAt(price, q);
    const m = ttmMetrics(q);
    const pb = t.fundamentals?.balance?.netWorth ? (price * t.fundamentals.sharesCr) / t.fundamentals.balance.netWorth : null;
    return { ticker: t.inst.ticker, pe: pe?.pe ?? null, pb, npGrowth: m?.npGrowth ?? null, revGrowth: m?.revGrowth ?? null };
  });
  const out = {
    sector, count: rows.length, rows,
    medianPe: median(rows.map((r) => r.pe)), medianPb: median(rows.map((r) => r.pb)),
    medianNpGrowth: median(rows.map((r) => r.npGrowth)), medianRevGrowth: median(rows.map((r) => r.revGrowth)),
  };
  u.statsCache.set(key, out);
  return out;
}

export function universeVols(u, idx) {
  const key = `vols:${idx}`;
  if (u.statsCache.has(key)) return u.statsCache.get(key);
  const v = Object.values(u.byTicker).map((t) => annualVol(t.aligned.slice(0, idx + 1), 60));
  u.statsCache.set(key, v);
  return v;
}
