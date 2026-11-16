// Options analytics: Black-Scholes pricing, implied volatility, Greeks and
// chain-level statistics (PCR, max pain, OI concentration, expected move,
// skew, term structure). Everything here is descriptive research. Open
// interest does not reveal who bought or wrote a contract, so OI-based
// "levels" are interpretations, not facts about future prices.

const SQRT2PI = Math.sqrt(2 * Math.PI);
export const RISK_FREE = Number(process.env.OPTIONS_RISK_FREE || 0.065); // assumption, shown in UI

export function normCdf(x) {
  // Abramowitz–Stegun 7.1.26 via erf
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
const normPdf = (x) => Math.exp(-0.5 * x * x) / SQRT2PI;

/** Black-Scholes price for European options (NSE options are European). */
export function bsPrice(type, S, K, T, sigma, r = RISK_FREE) {
  if (T <= 0 || sigma <= 0) return Math.max(0, type === 'CE' ? S - K : K - S);
  const sq = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / sq;
  const d2 = d1 - sq;
  return type === 'CE' ? S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2) : K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
}

export function greeks(type, S, K, T, sigma, r = RISK_FREE) {
  if (T <= 0 || !(sigma > 0)) return null;
  const sq = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / sq;
  const d2 = d1 - sq;
  const pdf = normPdf(d1);
  const delta = type === 'CE' ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = pdf / (S * sq);
  const vega = (S * pdf * Math.sqrt(T)) / 100; // per 1 vol point
  const thetaYear = type === 'CE'
    ? -(S * pdf * sigma) / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * normCdf(d2)
    : -(S * pdf * sigma) / (2 * Math.sqrt(T)) + r * K * Math.exp(-r * T) * normCdf(-d2);
  return { delta, gamma, vega, theta: thetaYear / 365 };
}

/** Implied volatility by bisection (robust, monotone in sigma). */
export function impliedVol(type, price, S, K, T, r = RISK_FREE) {
  if (!(price > 0) || T <= 0) return null;
  const intrinsic = Math.max(0, type === 'CE' ? S - K * Math.exp(-r * T) : K * Math.exp(-r * T) - S);
  if (price <= intrinsic + 1e-6) return null;
  let lo = 0.005;
  let hi = 4;
  if (bsPrice(type, S, K, T, hi, r) < price) return null;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (bsPrice(type, S, K, T, mid, r) > price) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

export function yearsToExpiry(asOfDate, expiry) {
  const ms = Date.parse(`${expiry}T15:30:00+05:30`) - Date.parse(`${asOfDate}T15:30:00+05:30`);
  return Math.max(ms, 0) / (365 * 86400000);
}

/**
 * Build an analysed chain for one expiry.
 * rows: [{ strike, type: 'CE'|'PE', price, oi, chgOi, volume }]
 */
export function analyseExpiry({ spot, asOfDate, expiry, rows, lotSize }) {
  const T = yearsToExpiry(asOfDate, expiry);
  const strikes = [...new Set(rows.map((r) => r.strike))].sort((a, b) => a - b);
  const by = new Map(rows.map((r) => [`${r.type}:${r.strike}`, r]));
  const enrich = (r) => {
    if (!r) return null;
    const iv = impliedVol(r.type, r.price, spot, r.strike, T);
    return { ...r, iv, greeks: iv ? greeks(r.type, spot, r.strike, T, iv) : null };
  };
  const chain = strikes.map((k) => ({ strike: k, call: enrich(by.get(`CE:${k}`)), put: enrich(by.get(`PE:${k}`)) }));
  const atm = strikes.reduce((a, k) => (Math.abs(k - spot) < Math.abs(a - spot) ? k : a), strikes[0]);
  const atmRow = chain.find((c) => c.strike === atm);
  const atmIvs = [atmRow?.call?.iv, atmRow?.put?.iv].filter(Boolean);
  const atmIv = atmIvs.length ? atmIvs.reduce((a, b) => a + b, 0) / atmIvs.length : null;

  const sum = (f) => rows.reduce((a, r) => a + (f(r) || 0), 0);
  const callOi = sum((r) => (r.type === 'CE' ? r.oi : 0));
  const putOi = sum((r) => (r.type === 'PE' ? r.oi : 0));
  const callVol = sum((r) => (r.type === 'CE' ? r.volume : 0));
  const putVol = sum((r) => (r.type === 'PE' ? r.volume : 0));
  const callChg = sum((r) => (r.type === 'CE' ? r.chgOi : 0));
  const putChg = sum((r) => (r.type === 'PE' ? r.chgOi : 0));

  // Max pain: strike minimising total intrinsic value paid to option holders at expiry.
  let maxPain = null;
  let best = Infinity;
  for (const k of strikes) {
    let pain = 0;
    for (const r of rows) pain += r.oi * Math.max(0, r.type === 'CE' ? k - r.strike : r.strike - k);
    if (pain < best) { best = pain; maxPain = k; }
  }
  const top = (type, dir) => rows.filter((r) => r.type === type && (dir > 0 ? r.strike >= spot : r.strike <= spot)).sort((a, b) => b.oi - a.oi).slice(0, 3).map((r) => ({ strike: r.strike, oi: r.oi, chgOi: r.chgOi }));
  const straddle = (atmRow?.call?.price || 0) + (atmRow?.put?.price || 0);

  // Skew: IV of ~5% OTM put minus ~5% OTM call.
  const near = (target, side) => chain.filter((c) => c[side]?.iv).reduce((a, c) => (!a || Math.abs(c.strike - target) < Math.abs(a.strike - target) ? c : a), null);
  const p = near(spot * 0.95, 'put');
  const c = near(spot * 1.05, 'call');
  const skew = p && c ? p.put.iv - c.call.iv : null;

  return {
    expiry, daysToExpiry: Math.round(T * 365), T, spot, atmStrike: atm, atmIv, lotSize,
    pcrOi: callOi ? putOi / callOi : null, pcrVolume: callVol ? putVol / callVol : null,
    totals: { callOi, putOi, callVol, putVol, callChg, putChg },
    maxPain, callWall: top('CE', 1), putWall: top('PE', -1),
    expectedMove: { straddle, straddlePct: spot ? straddle / spot : null, ivPct: atmIv ? atmIv * Math.sqrt(T) : null },
    skew, chain,
  };
}

/** Plain-language, clearly-labelled reading of an analysed expiry. */
export function interpretExpiry(a, { realisedVol, ivPercentile } = {}) {
  const notes = [];
  if (a.pcrOi != null) {
    notes.push({ id: 'pcr', fact: `Put-call ratio (open interest) ${a.pcrOi.toFixed(2)}; by volume ${a.pcrVolume?.toFixed(2) ?? 'n/a'}.`,
      analysis: a.pcrOi > 1.3 ? 'More puts than calls are open. Some read this as hedging demand or bearish positioning; others read high PCR as contrarian-bullish. The signal is ambiguous.'
        : a.pcrOi < 0.7 ? 'More calls than puts are open. This can reflect bullish positioning or call writing; OI alone cannot tell which.'
          : 'Puts and calls are broadly balanced.' });
  }
  if (a.callWall[0] && a.putWall[0]) {
    notes.push({ id: 'oi-levels', fact: `Largest call OI at ${a.callWall[0].strike}; largest put OI at ${a.putWall[0].strike}. Max pain ${a.maxPain}.`,
      analysis: 'Strikes with heavy open interest are often watched as possible resistance (calls) and support (puts) into expiry. These are positioning clues, not guaranteed levels, and can shift daily.' });
  }
  if (a.atmIv != null) {
    const rv = realisedVol;
    notes.push({ id: 'iv', fact: `At-the-money implied volatility ${(a.atmIv * 100).toFixed(1)}%${rv ? ` vs 20-day realised volatility ${(rv * 100).toFixed(1)}%` : ''}${ivPercentile != null ? `; IV percentile ${Math.round(ivPercentile * 100)} over the available history` : ''}.`,
      analysis: rv ? (a.atmIv > rv * 1.25 ? 'Options are pricing larger moves than the stock has recently made — often seen before events like results. Option buyers pay more; sellers take on that event risk.' : a.atmIv < rv * 0.85 ? 'Options are pricing smaller moves than recent realised swings.' : 'Implied and realised volatility are broadly in line.') : 'Compare with realised volatility to judge whether options look expensive or cheap.' });
  }
  if (a.expectedMove.straddlePct != null) {
    notes.push({ id: 'move', fact: `ATM straddle costs ${a.expectedMove.straddle.toFixed(2)} (${(a.expectedMove.straddlePct * 100).toFixed(1)}% of spot) for ${a.daysToExpiry} days to expiry.`,
      analysis: `The options market is roughly pricing a move of about ±${(a.expectedMove.straddlePct * 100).toFixed(1)}% by expiry. Actual moves are often smaller and occasionally much larger.` });
  }
  if (a.skew != null) {
    notes.push({ id: 'skew', fact: `~5% OTM put IV minus ~5% OTM call IV: ${(a.skew * 100).toFixed(1)} vol points.`,
      analysis: a.skew > 0.03 ? 'Downside protection is relatively expensive, a sign of demand for hedges.' : a.skew < -0.01 ? 'Upside calls are relatively expensive, which can accompany speculative call buying.' : 'Skew is modest.' });
  }
  return notes;
}

/** Payoff at expiry for a set of legs (premium per unit, qty in units). */
export function payoffAtExpiry(legs, S) {
  return legs.reduce((a, l) => {
    const intrinsic = l.type === 'FUT' ? S - l.strike : Math.max(0, l.type === 'CE' ? S - l.strike : l.strike - S);
    const perUnit = l.type === 'FUT' ? intrinsic : intrinsic - l.premium;
    return a + (l.side === 'buy' ? 1 : -1) * perUnit * l.qty;
  }, 0);
}
