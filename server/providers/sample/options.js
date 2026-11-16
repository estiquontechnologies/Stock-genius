// SIMULATED option chains for sample mode. Prices are generated from a
// Black-Scholes model with a volatility smile, so analytics behave
// realistically, but every number is fictional.

import { createRng } from '../../lib/random.js';
import { addDays, parseIsoDate, isoDate, daysBetween } from '../../lib/dates.js';
import { bsPrice, yearsToExpiry } from '../../analysis/options.js';

const FNO = ['AURLEDGR', 'VRDMBANK', 'QLSTNINF', 'NBLRSOFT', 'SFFRDLTA', 'MRGLDCON', 'HLXRPHRM', 'TRVLNMOT', 'IRNCRSTL', 'ZNTHMNRL', 'FRGWYENG', 'VLTRAPWR', 'SGNLWAVE', 'SKYHRBR'];
export const INDEX_SYMBOL = 'DEMOIDX';

function lastTuesday(y, m) {
  const d = new Date(Date.UTC(y, m + 1, 0));
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() - 1);
  return isoDate(d);
}

export function sampleExpiries(asOf, weekly) {
  const d = parseIsoDate(asOf);
  const monthly = [];
  for (let k = 0; monthly.length < 3; k++) {
    const e = lastTuesday(d.getUTCFullYear(), d.getUTCMonth() + k);
    if (e > asOf) monthly.push(e);
  }
  if (!weekly) return monthly;
  const weeks = [];
  let w = addDays(asOf, 1);
  while (weeks.length < 2) { if (parseIsoDate(w).getUTCDay() === 2 && !monthly.includes(w)) weeks.push(w); w = addDays(w, 1); }
  return [...new Set([...weeks, ...monthly])].sort();
}

const stepFor = (S, index) => (index ? 50 : S < 250 ? 5 : S < 1000 ? 10 : S < 2500 ? 20 : S < 5000 ? 50 : 100);
const r05 = (x) => Math.max(0.05, Math.round(x * 20) / 20);

function realisedVol(closes, end, n = 20) {
  const rs = [];
  for (let i = Math.max(1, end - n + 1); i <= end; i++) rs.push(Math.log(closes[i] / closes[i - 1]));
  const m = rs.reduce((a, b) => a + b, 0) / rs.length;
  return Math.sqrt(rs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, rs.length - 1)) * Math.sqrt(252);
}

export function buildSampleOptions(world) {
  const { dates, companies, calendar } = world;
  const n = dates.length;
  const asOf = dates[n - 1];
  // Simulated index from cap-weighted sample companies.
  const all = Object.values(companies);
  const raw = dates.map((_, i) => all.reduce((a, c) => a + c.bars[i].close * c.profile.shares, 0));
  const idxCloses = raw.map((v) => +(22000 * v / raw[0]).toFixed(2));

  const underlyings = [{ symbol: INDEX_SYMBOL, name: 'Demo index (simulated)', kind: 'index', ticker: null, closes: idxCloses }];
  for (const t of FNO) if (companies[t]) underlyings.push({ symbol: t, name: companies[t].profile.name, kind: 'stock', ticker: t, closes: companies[t].bars.map((b) => b.close) });

  const out = {};
  for (const u of underlyings) {
    const rng = createRng(`sample-opt-${u.symbol}`);
    const S = u.closes[n - 1];
    const index = u.kind === 'index';
    const lotSize = index ? 75 : Math.max(25, Math.round(800000 / S / 25) * 25);
    const nextEarn = calendar.find((e) => e.type === 'earnings' && e.tickers?.includes(u.ticker));
    const base = realisedVol(u.closes, n - 1) * rng.range(1.0, 1.25) + 0.015;

    // ATM IV / PCR history (simulated, but tied to realised volatility).
    const history = [];
    let pcr = rng.range(0.8, 1.1);
    let noise = 0;
    for (let i = Math.max(25, n - 250); i < n; i++) {
      noise = 0.85 * noise + rng.normal(0, 0.012);
      pcr = Math.min(1.6, Math.max(0.5, pcr + 0.05 * (0.95 - pcr) + rng.normal(0, 0.04)));
      history.push({ date: dates[i], spot: u.closes[i], atmIv: +Math.max(0.06, realisedVol(u.closes, i) * 1.08 + 0.015 + noise).toFixed(4), pcr: +pcr.toFixed(3) });
    }

    const expiries = sampleExpiries(asOf, index);
    const rows = [];
    const step = stepFor(S, index);
    const width = index ? 0.08 : 0.2;
    const lo = Math.ceil((S * (1 - width)) / step) * step;
    const hi = Math.floor((S * (1 + width)) / step) * step;
    const callPeak = Math.round((S * rng.range(1.03, 1.08)) / step) * step;
    const putPeak = Math.round((S * rng.range(0.92, 0.97)) / step) * step;
    for (const expiry of expiries) {
      const T = yearsToExpiry(asOf, expiry);
      const eventBump = nextEarn && nextEarn.date <= expiry ? 0.06 * Math.sqrt(0.08 / Math.max(T, 0.02)) : 0;
      const ivT = Math.max(0.08, base * (1 + 0.04 * Math.log(1 + T * 12)) + Math.min(eventBump, 0.25));
      const oiScale = (index ? 60000 : 2500) * (expiry === expiries[0] ? 1.4 : expiry === expiries[1] ? 1 : 0.5);
      for (let K = lo; K <= hi; K += step) {
        const m = Math.log(K / S);
        const iv = ivT * (1 - 0.9 * m + 2.5 * m * m);
        const round = K % (step * 10) === 0 ? 2.2 : K % (step * 5) === 0 ? 1.5 : 1;
        for (const type of ['CE', 'PE']) {
          const price = r05(bsPrice(type, S, K, T, iv) * (1 + rng.normal(0, 0.01)));
          const peak = type === 'CE' ? callPeak : putPeak;
          const w = S * (index ? 0.03 : 0.07);
          const oi = Math.round(oiScale * round * (0.15 + Math.exp(-(((K - peak) / w) ** 2))) * rng.range(0.7, 1.3) / lotSize) * lotSize;
          const prevOi = Math.max(0, Math.round(oi * (1 + rng.normal(-0.04, 0.12)) / lotSize) * lotSize);
          const moneyness = Math.exp(-((m / 0.06) ** 2));
          rows.push({ expiry, strike: K, type, price, settle: price, oi, chgOi: oi - prevOi, volume: Math.round(oi * rng.range(0.2, 0.8) * (0.4 + moneyness)), lotSize });
        }
      }
    }
    out[u.symbol] = {
      symbol: u.symbol, name: u.name, kind: u.kind, ticker: u.ticker, lotSize, spot: S, asOf, expiries, rows, history,
      realisedVol20: realisedVol(u.closes, n - 1), source: 'Sample option chain (simulated)', freshness: 'sample', simulated: true,
      nextEarnings: nextEarn ? { date: nextEarn.date, daysAway: daysBetween(asOf, nextEarn.date) } : null,
    };
  }
  return out;
}
