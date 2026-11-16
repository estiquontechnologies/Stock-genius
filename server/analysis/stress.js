// Market stress radar: compares current readings of macro and market risk
// gauges with their own trailing history (z-scores), then maps them to
// sectors using the sector-sensitivity assumptions.

import { mean, stdev } from './indicators.js';
import { SECTORS, FACTORS, sectorInfo } from './sectors.js';
import { pct, num } from '../lib/format.js';

const GAUGES = [
  { id: 'india_vol', label: 'Indian market volatility', mode: 'level', bad: 1, factor: 'globalRisk', unitFmt: (v) => num(v, 1), explain: 'Measures expected near-term swings in Indian stocks. Higher readings mean investors are paying more for protection.' },
  { id: 'usdinr', label: 'Rupee vs US dollar', mode: 'pct21', bad: 1, factor: 'inr', unitFmt: (v) => `₹${num(v, 2)}`, explain: 'A rising USD/INR means a weaker rupee. Rapid depreciation can accompany foreign outflows and imported inflation.' },
  { id: 'brent', label: 'Crude oil (Brent)', mode: 'pct21', bad: 1, factor: 'crude', unitFmt: (v) => `$${num(v, 1)}`, explain: 'India imports most of its oil, so sharp rises widen the trade deficit and raise costs for many businesses.' },
  { id: 'in10y', label: 'India 10Y bond yield', mode: 'abs21', bad: 1, factor: 'rates', unitFmt: (v) => `${num(v, 2)}%`, explain: 'Rising yields raise borrowing costs and make bonds more attractive relative to stocks.' },
  { id: 'us10y', label: 'US 10Y Treasury yield', mode: 'abs21', bad: 1, factor: 'globalRisk', unitFmt: (v) => `${num(v, 2)}%`, explain: 'Higher US yields can draw global capital away from emerging markets like India.' },
  { id: 'global_eq', label: 'Global equities', mode: 'pct21', bad: -1, factor: 'globalRisk', unitFmt: (v) => num(v, 0), explain: 'Falling global stock markets often coincide with foreign investors reducing risk in India.' },
  { id: 'geo', label: 'Geopolitical tension', mode: 'level', bad: 1, factor: 'crude', unitFmt: (v) => num(v, 0), explain: 'Conflicts and trade disputes can disrupt supply chains, lift commodity prices and hurt risk appetite.' },
];

function seriesTransform(values, mode) {
  if (mode === 'level') return values;
  const out = [];
  for (let i = 21; i < values.length; i++) out.push(mode === 'pct21' ? values[i] / values[i - 21] - 1 : values[i] - values[i - 21]);
  return out;
}

export function computeStress(macroValues, { breadth, sectorNames } = {}) {
  const gauges = [];
  for (const g of GAUGES) {
    const vals = macroValues[g.id];
    if (!vals || vals.length < 60) continue;
    const t = seriesTransform(vals, g.mode);
    const hist = t.slice(-250);
    const cur = t.at(-1);
    const sd = stdev(hist) || 1;
    const zRaw = (cur - mean(hist)) / sd;
    const z = zRaw * g.bad;
    const status = z >= 1.5 ? 'elevated' : z >= 0.75 ? 'watch' : 'calm';
    const prevT = t.at(-6);
    const z5 = prevT == null ? null : ((prevT - mean(hist)) / sd) * g.bad;
    const changeText = g.mode === 'level' ? `level ${g.unitFmt(vals.at(-1))}` : g.mode === 'pct21' ? `${pct(cur)} over 1 month (now ${g.unitFmt(vals.at(-1))})` : `${cur >= 0 ? '+' : ''}${Math.round(cur * 100)} bp over 1 month (now ${g.unitFmt(vals.at(-1))})`;
    gauges.push({
      id: g.id, label: g.label, status, z: +z.toFixed(2), trend: z5 == null ? 'flat' : z - z5 > 0.3 ? 'rising' : z - z5 < -0.3 ? 'easing' : 'flat',
      reading: changeText, explain: g.explain, factor: g.factor, spark: vals.slice(-90).map((v) => +v.toFixed(3)),
    });
  }
  if (breadth) {
    const z = (0.5 - breadth.pctAbove50) / 0.18;
    gauges.push({
      id: 'breadth', label: 'Market breadth', status: z >= 1.5 ? 'elevated' : z >= 0.75 ? 'watch' : 'calm', z: +z.toFixed(2), trend: 'flat',
      reading: `${Math.round(breadth.pctAbove50 * 100)}% of tracked stocks above their 50-day average`, explain: 'When few stocks are in uptrends, the market is more fragile even if headline indices look calm.',
      spark: null,
    });
  }
  const pos = gauges.map((g) => Math.max(0, g.z));
  const score = pos.length ? mean(pos) + 0.25 * Math.max(...pos) : 0;
  const level = score >= 1.1 ? 2 : score >= 0.6 ? 1 : 0;
  const label = ['Calm', 'Watchful', 'Elevated'][level];

  // Sector exposure: combine stressed gauges with sector sensitivities.
  const factorStress = {};
  for (const g of gauges) {
    if (!g.factor || g.z < 0.75) continue;
    factorStress[g.factor] = Math.max(factorStress[g.factor] || 0, g.z);
  }
  const names = sectorNames?.length ? sectorNames : Object.keys(SECTORS);
  const sectors = names.map((name) => {
    const info = sectorInfo(name);
    let s = 0;
    const drivers = [];
    for (const [f, z] of Object.entries(factorStress)) {
      const sens = info.sens[f] || 0;
      // Factor stress is an adverse move (e.g. crude up); sectors with
      // negative sensitivity to that move are exposed.
      const c = -sens * z;
      s += c;
      if (Math.abs(sens) >= 0.3) drivers.push({ factor: f, label: FACTORS[f].label, effect: sens < 0 ? 'exposed' : 'potential beneficiary', why: info.why[f] || null });
    }
    return { sector: name, exposure: +s.toFixed(2), drivers };
  }).sort((a, b) => b.exposure - a.exposure);

  const elevated = gauges.filter((g) => g.status !== 'calm').sort((a, b) => b.z - a.z);
  const narrative = elevated.length
    ? `${elevated.slice(0, 3).map((g) => `${g.label.toLowerCase()} (${g.reading})`).join('; ')} ${elevated.length === 1 ? 'stands' : 'stand'} out against the past year. Sectors with the most exposure under the model’s assumptions: ${sectors.filter((s) => s.exposure > 0.2).slice(0, 3).map((s) => s.sector).join(', ') || 'none stand out'}.`
    : 'Risk gauges are within their normal ranges relative to the past year.';

  return { score: +score.toFixed(2), level, label, gauges, sectors, narrative };
}
