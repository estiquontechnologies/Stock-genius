// Thesis tracker: evaluates user-written assumptions against current data.

import { peAt } from '../analysis/fundamentals.js';
import { sma, pctChange } from '../analysis/indicators.js';

export const THESIS_METRICS = {
  revenueGrowth: { label: 'Revenue growth (TTM, %)', unit: '%', get: (c) => pctOrNull(c.ttm?.revGrowth) },
  profitGrowth: { label: 'Net profit growth (TTM, %)', unit: '%', get: (c) => pctOrNull(c.ttm?.npGrowth) },
  operatingMargin: { label: 'Operating margin (latest quarter, %)', unit: '%', get: (c) => c.ttm?.latest?.operatingMargin ?? null },
  roe: { label: 'Return on equity (%)', unit: '%', get: (c) => c.balance?.roe ?? null },
  debtToEquity: { label: 'Debt-to-equity (×)', unit: '×', get: (c) => c.balance?.debtToEquity ?? null },
  gnpa: { label: 'Gross NPA (%, banks)', unit: '%', get: (c) => c.ttm?.latest?.gnpa ?? null },
  pe: { label: 'Trailing P/E (×)', unit: '×', get: (c) => peAt(c.closes.at(-1), c.quarters)?.pe ?? null },
  price: { label: 'Share price (₹)', unit: '₹', get: (c) => c.closes.at(-1) },
  priceVs200dma: { label: 'Price vs 200-day average (%)', unit: '%', get: (c) => { const s = sma(c.closes, 200).at(-1); return s ? (c.closes.at(-1) / s - 1) * 100 : null; } },
  relativeStrength3m: { label: '3-month return vs market (pp)', unit: 'pp', get: (c) => { const a = pctChange(c.closes, 63); const b = pctChange(c.market, 63); return a == null || b == null ? null : (a - b) * 100; } },
};

function pctOrNull(x) {
  return x == null ? null : x * 100;
}

export function evaluateAssumption(a, ctx) {
  if (!a.metric) return { ...a, status: a.manualStatus || 'unreviewed', auto: false };
  const m = THESIS_METRICS[a.metric];
  if (!m) return { ...a, status: 'unknown-metric', auto: true };
  const v = m.get(ctx);
  if (v == null || !Number.isFinite(v)) return { ...a, status: 'no-data', current: null, metricLabel: m.label, auto: true };
  const ok = a.op === '<=' ? v <= a.threshold : v >= a.threshold;
  const margin = Math.abs(v - a.threshold) / (Math.abs(a.threshold) || 1);
  return { ...a, current: +v.toFixed(2), metricLabel: m.label, unit: m.unit, status: ok ? (margin < 0.1 ? 'at-risk' : 'holds') : 'broken', auto: true };
}
