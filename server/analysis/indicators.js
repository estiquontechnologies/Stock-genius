// Pure technical-indicator functions. Inputs are arrays oldest → newest.
// Each returns an array aligned to the input (null where undefined).

export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) continue;
    if (prev === null) {
      prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

/** Wilder RSI. */
export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function macd(closes, fast = 12, slow = 26, signal = 9) {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const line = closes.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
  const start = line.findIndex((x) => x != null);
  const sig = new Array(closes.length).fill(null);
  if (start >= 0) {
    const e = ema(line.slice(start), signal);
    for (let i = 0; i < e.length; i++) sig[start + i] = e[i];
  }
  const hist = line.map((x, i) => (x != null && sig[i] != null ? x - sig[i] : null));
  return { line, signal: sig, hist };
}

export function atr(bars, period = 14) {
  const tr = bars.map((b, i) => {
    if (i === 0) return b.high - b.low;
    const pc = bars[i - 1].close;
    return Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
  });
  const out = new Array(bars.length).fill(null);
  let prev = null;
  for (let i = 0; i < bars.length; i++) {
    if (i < period - 1) continue;
    prev = prev === null ? tr.slice(0, period).reduce((a, b) => a + b, 0) / period : (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

export function returns(closes) {
  const out = [];
  for (let i = 1; i < closes.length; i++) out.push(closes[i] / closes[i - 1] - 1);
  return out;
}

export function stdev(xs) {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

export function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function median(xs) {
  const s = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Annualised volatility of daily returns over the trailing window. */
export function annualVol(closes, window = 60) {
  const r = returns(closes.slice(-window - 1));
  return stdev(r) * Math.sqrt(252);
}

export function maxDrawdown(closes) {
  let peak = -Infinity;
  let mdd = 0;
  for (const c of closes) {
    peak = Math.max(peak, c);
    mdd = Math.min(mdd, c / peak - 1);
  }
  return mdd;
}

export function beta(stockCloses, marketCloses, window = 120) {
  const n = Math.min(stockCloses.length, marketCloses.length, window + 1);
  const rs = returns(stockCloses.slice(-n));
  const rm = returns(marketCloses.slice(-n));
  const mm = mean(rm);
  const ms = mean(rs);
  let cov = 0;
  let varm = 0;
  for (let i = 0; i < rm.length; i++) {
    cov += (rs[i] - ms) * (rm[i] - mm);
    varm += (rm[i] - mm) ** 2;
  }
  return varm ? cov / varm : 1;
}

export function pctChange(closes, lookback) {
  if (closes.length <= lookback) return null;
  return closes[closes.length - 1] / closes[closes.length - 1 - lookback] - 1;
}

/**
 * Support / resistance from clustered swing highs and lows over the
 * trailing window. Returns levels with a touch count (more touches =
 * more significant level).
 */
export function supportResistance(bars, { window = 160, swing = 4, tolerance = 0.018 } = {}) {
  const b = bars.slice(-window);
  const pivots = [];
  for (let i = swing; i < b.length - swing; i++) {
    const seg = b.slice(i - swing, i + swing + 1);
    if (b[i].high === Math.max(...seg.map((x) => x.high))) pivots.push({ price: b[i].high, type: 'high', date: b[i].date });
    if (b[i].low === Math.min(...seg.map((x) => x.low))) pivots.push({ price: b[i].low, type: 'low', date: b[i].date });
  }
  pivots.sort((x, y) => x.price - y.price);
  const clusters = [];
  for (const p of pivots) {
    const c = clusters[clusters.length - 1];
    if (c && Math.abs(p.price / c.price - 1) < tolerance) {
      c.members.push(p);
      c.price = mean(c.members.map((m) => m.price));
    } else {
      clusters.push({ price: p.price, members: [p] });
    }
  }
  const last = b[b.length - 1].close;
  const levels = clusters
    .filter((c) => c.members.length >= 2)
    .map((c) => ({ price: +c.price.toFixed(2), touches: c.members.length, lastTouch: c.members.map((m) => m.date).sort().pop() }));
  const supports = levels.filter((l) => l.price < last).sort((a, b) => b.price - a.price);
  const resistances = levels.filter((l) => l.price > last).sort((a, b) => a.price - b.price);
  return { support: supports[0] || null, resistance: resistances[0] || null, supports: supports.slice(0, 3), resistances: resistances.slice(0, 3) };
}
