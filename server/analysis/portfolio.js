// Portfolio exposure lens. Describes concentration and sensitivity of
// USER-ENTERED holdings. It does not recommend trades, optimise, or
// personalise; it is kept separate from stock views by design.

import { beta, returns, stdev, maxDrawdown } from './indicators.js';
import { sectorInfo, FACTORS } from './sectors.js';

export function analysePortfolio(u, holdings) {
  const rows = [];
  const unknown = [];
  for (const h of holdings) {
    const t = u.byTicker[h.ticker];
    if (!t) { unknown.push(h.ticker); continue; }
    const price = t.aligned.at(-1);
    rows.push({ ticker: h.ticker, name: t.inst.name, sector: t.inst.sector, quantity: h.quantity, price, value: price * h.quantity, t });
  }
  const total = rows.reduce((a, r) => a + r.value, 0);
  if (!rows.length || total <= 0) return { empty: true, unknown };
  for (const r of rows) r.weight = r.value / total;
  rows.sort((a, b) => b.weight - a.weight);

  const hhi = rows.reduce((a, r) => a + r.weight ** 2, 0);
  const effectiveN = 1 / hhi;
  const sectorW = {};
  for (const r of rows) sectorW[r.sector] = (sectorW[r.sector] || 0) + r.weight;
  const sectors = Object.entries(sectorW).map(([sector, weight]) => ({ sector, weight })).sort((a, b) => b.weight - a.weight);

  const market = u.indices.ALL.series.map((x) => x.value);
  let pBeta = 0;
  for (const r of rows) { r.beta = beta(r.t.aligned, market); pBeta += r.weight * r.beta; }

  const factors = Object.keys(FACTORS).map((f) => {
    const s = rows.reduce((a, r) => a + r.weight * ((sectorInfo(r.sector).sens || {})[f] || 0), 0);
    return { factor: f, label: FACTORS[f].label, sensitivity: +s.toFixed(2), reading: s <= -0.25 ? 'Notably exposed' : s >= 0.25 ? 'May benefit' : 'Limited net exposure' };
  });

  // Historical behaviour of the CURRENT weights (backtest of weights, not of trading).
  const len = Math.min(...rows.map((r) => r.t.aligned.length));
  const window = Math.min(250, len - 1);
  const pr = [];
  for (let i = len - window; i < len; i++) pr.push(rows.reduce((a, r) => a + r.weight * (r.t.aligned[i] / r.t.aligned[i - 1] - 1), 0));
  let lvl = 1;
  const curve = pr.map((x) => (lvl *= 1 + x));
  const vol = stdev(pr) * Math.sqrt(252);
  const mktVol = stdev(returns(market.slice(-window - 1))) * Math.sqrt(252);

  const flags = [];
  if (rows[0].weight > 0.25) flags.push(`Largest holding (${rows[0].ticker}) is ${(rows[0].weight * 100).toFixed(0)}% of the portfolio.`);
  if (sectors[0].weight > 0.4) flags.push(`${sectors[0].sector} is ${(sectors[0].weight * 100).toFixed(0)}% of the portfolio.`);
  if (effectiveN < 5) flags.push(`Diversification is equivalent to about ${effectiveN.toFixed(1)} equally weighted holdings.`);
  if (pBeta > 1.15) flags.push(`Portfolio beta of ${pBeta.toFixed(2)} implies larger swings than the market, on average.`);

  return {
    totalValue: total, holdings: rows.map(({ t, ...r }) => ({ ...r, beta: +r.beta.toFixed(2), weight: +r.weight.toFixed(4) })), unknown,
    concentration: { hhi: +hhi.toFixed(3), effectiveN: +effectiveN.toFixed(1), top1: rows[0].weight, top3: rows.slice(0, 3).reduce((a, r) => a + r.weight, 0) },
    sectors, beta: +pBeta.toFixed(2), factors,
    history: { volatility: vol, marketVolatility: mktVol, maxDrawdown: maxDrawdown(curve), sessions: window },
    roughMarketShock: { marketMove: -0.1, estimate: -0.1 * pBeta, note: 'Beta-based approximation of how the portfolio has tended to move with the market. Actual moves vary widely.' },
    flags,
    disclaimer: 'Describes the holdings you entered. It is not advice on what to buy or sell and does not consider your goals, taxes or risk tolerance.',
  };
}
