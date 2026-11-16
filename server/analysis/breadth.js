// Sector and market breadth: how many stocks participate in a move and how
// concentrated the move is in a few large names.

import { sma } from './indicators.js';

function groupStats(members, idx, lookback = 21) {
  const rows = members.map((t) => {
    const c = t.aligned.slice(0, idx + 1);
    const last = c.at(-1);
    const prev = c.at(-2);
    const base = c.at(-1 - lookback) ?? c[0];
    const s50 = sma(c, 50).at(-1);
    const s200 = sma(c, 200).at(-1);
    const w = c.slice(-250);
    return {
      ticker: t.inst.ticker, name: t.inst.name, sector: t.inst.sector,
      ret1d: last / prev - 1, ret1m: last / base - 1,
      above50: s50 != null && last > s50, above200: s200 != null && last > s200,
      newHigh: last >= Math.max(...w) * 0.995, newLow: last <= Math.min(...w) * 1.005,
      capStart: base * (t.fundamentals?.sharesCr || 1),
    };
  });
  const n = rows.length || 1;
  const capTotal = rows.reduce((a, r) => a + r.capStart, 0) || 1;
  const contrib = rows.map((r) => ({ ticker: r.ticker, name: r.name, c: (r.capStart / capTotal) * r.ret1m })).sort((a, b) => Math.abs(b.c) - Math.abs(a.c));
  const absTotal = contrib.reduce((a, r) => a + Math.abs(r.c), 0) || 1;
  const capWeighted = contrib.reduce((a, r) => a + r.c, 0);
  const equalWeighted = rows.reduce((a, r) => a + r.ret1m, 0) / n;
  const top2Share = contrib.slice(0, 2).reduce((a, r) => a + Math.abs(r.c), 0) / absTotal;
  const adv = rows.filter((r) => r.ret1d > 0).length;
  const pctAbove50 = rows.filter((r) => r.above50).length / n;
  const status = pctAbove50 >= 0.6 && equalWeighted > 0 ? 'strengthening' : pctAbove50 <= 0.4 && equalWeighted < 0 ? 'weakening' : 'mixed';
  return {
    count: rows.length, advancers: adv, decliners: rows.length - adv,
    pctAbove50, pctAbove200: rows.filter((r) => r.above200).length / n,
    newHighs: rows.filter((r) => r.newHigh).length, newLows: rows.filter((r) => r.newLow).length,
    ret1mCap: capWeighted, ret1mEqual: equalWeighted, top2Share, leaders: contrib.slice(0, 2), status,
    concentrated: rows.length > 2 && top2Share > 0.7,
    rows,
  };
}

export function computeBreadth(u, idx = u.dates.length - 1) {
  const all = Object.values(u.byTicker);
  const market = groupStats(all, idx);
  const gap = market.ret1mCap - market.ret1mEqual;
  market.narrowLeadership = Math.abs(gap) > 0.02 && market.top2Share > 0.35;
  market.note = market.narrowLeadership
    ? `The cap-weighted move (${(market.ret1mCap * 100).toFixed(1)}%) differs from the average stock (${(market.ret1mEqual * 100).toFixed(1)}%), so a few large names are driving the headline move.`
    : 'Cap-weighted and average-stock performance are similar, so the move is relatively broad.';
  const sectors = u.sectors.map((s) => ({ sector: s, ...groupStats(all.filter((t) => t.inst.sector === s), idx) }));
  for (const s of sectors) delete s.rows;
  return { asOfDate: u.dates[idx], market: { ...market, rows: undefined }, sectors, stocks: market.rows };
}
