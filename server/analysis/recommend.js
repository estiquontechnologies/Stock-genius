// Transparent, rules-based scoring model. Every number that influences the
// view is returned so users can inspect the reasoning. This is a research
// signal, not a forecast, and never a personalised recommendation.

import { technicalSignals, fundamentalSignals, valuationSignals, newsSignals, macroSignals, estimateSignals, riskFactors } from './signals.js';
import { clamp } from '../lib/format.js';

export const MODEL_VERSION = 'sg-rules-0.4';

export const HORIZONS = {
  short: { id: 'short', label: '1–3 months', months: 3, sessions: 63 },
  medium: { id: 'medium', label: '6–12 months', months: 12, sessions: 252 },
  long: { id: 'long', label: '1–3 years', months: 36, sessions: 756 },
};

export const CATEGORY_WEIGHTS = {
  short: { technical: 0.4, news: 0.15, macro: 0.17, fundamental: 0.13, valuation: 0.08, estimates: 0.07 },
  medium: { technical: 0.2, news: 0.08, macro: 0.12, fundamental: 0.32, valuation: 0.2, estimates: 0.08 },
  long: { technical: 0.06, news: 0.04, macro: 0.1, fundamental: 0.45, valuation: 0.3, estimates: 0.05 },
};

export const EVIDENCE_WEIGHT = { high: 1, medium: 0.7, low: 0.4 };
export const THRESHOLDS = { buy: 0.16, sell: -0.16 };
const CONFIDENCE_CAP = 85;

export function collectSignals(ctx) {
  return [
    ...technicalSignals(ctx), ...fundamentalSignals(ctx), ...valuationSignals(ctx),
    ...newsSignals(ctx), ...macroSignals(ctx), ...estimateSignals(ctx),
  ];
}

export function recommend(ctx, horizonId = 'medium', precomputed) {
  const horizon = HORIZONS[horizonId] || HORIZONS.medium;
  const all = precomputed || collectSignals(ctx);
  const signals = all.filter((s) => !(s.shortOnly && horizon.id !== 'short') && !(s.longOnly && horizon.id === 'short'));
  const weights = CATEGORY_WEIGHTS[horizon.id];

  // Category scores (evidence-weighted mean of signal scores).
  const byCat = {};
  for (const s of signals) (byCat[s.category] ||= []).push(s);
  const present = Object.keys(weights).filter((c) => byCat[c]?.length);
  const wSum = present.reduce((a, c) => a + weights[c], 0) || 1;
  const categories = {};
  let composite = 0;
  for (const c of present) {
    const list = byCat[c];
    const ew = list.reduce((a, s) => a + EVIDENCE_WEIGHT[s.evidence], 0);
    const cs = list.reduce((a, s) => a + s.score * EVIDENCE_WEIGHT[s.evidence], 0) / ew;
    const w = weights[c] / wSum;
    categories[c] = { score: +cs.toFixed(3), weight: +w.toFixed(3), signals: list.length };
    composite += w * cs;
    for (const s of list) s.contribution = +((w * s.score * EVIDENCE_WEIGHT[s.evidence]) / ew).toFixed(4);
  }
  const missing = Object.keys(weights).filter((c) => !present.includes(c));

  const view = composite >= THRESHOLDS.buy ? 'Buy' : composite <= THRESHOLDS.sell ? 'Sell' : 'Hold';

  // Confidence: magnitude, agreement, coverage and risk.
  const sign = view === 'Hold' ? 0 : Math.sign(composite);
  const active = signals.filter((s) => Math.abs(s.score) >= 0.05);
  const totalAbs = active.reduce((a, s) => a + Math.abs(s.contribution), 0) || 1;
  const agree = sign === 0
    ? 1 - Math.abs(active.reduce((a, s) => a + s.contribution, 0)) / totalAbs
    : active.filter((s) => Math.sign(s.score) === sign).reduce((a, s) => a + Math.abs(s.contribution), 0) / totalAbs;
  const risks = riskFactors(ctx);
  const riskScore = risks.reduce((a, r) => a + r.level, 0) / Math.max(1, risks.length);
  const highRisks = risks.filter((r) => r.level === 3).length;
  const riskLevel = riskScore >= 2.3 || highRisks >= 3 ? 'High' : riskScore >= 1.9 || highRisks >= 2 ? 'Elevated' : riskScore >= 1.45 ? 'Moderate' : 'Low';

  const parts = [];
  let conf = 30;
  const mag = view === 'Hold' ? 20 * (1 - Math.abs(composite) / THRESHOLDS.buy) : Math.min(30, 110 * (Math.abs(composite) - THRESHOLDS.buy) + 10);
  conf += mag; parts.push({ label: view === 'Hold' ? 'Distance from Buy/Sell thresholds' : 'Strength of composite score', points: +mag.toFixed(1) });
  const ag = (agree - 0.5) * 40;
  conf += ag; parts.push({ label: 'Agreement between signals', points: +ag.toFixed(1) });
  if (missing.length) { const p = -6 * missing.length; conf += p; parts.push({ label: `Missing evidence: ${missing.join(', ')}`, points: p }); }
  const rp = riskLevel === 'High' ? -12 : riskLevel === 'Elevated' ? -6 : 0;
  if (rp) { conf += rp; parts.push({ label: `${riskLevel} risk level`, points: rp }); }
  const ev = risks.find((r) => r.id === 'event');
  if (horizon.id === 'short' && ev && ev.value <= 30) { conf -= 8; parts.push({ label: 'Results due within the horizon', points: -8 }); }
  const confidence = Math.round(clamp(conf, 10, CONFIDENCE_CAP));
  const confidenceBand = confidence >= 65 ? 'High' : confidence >= 42 ? 'Medium' : 'Low';

  const sorted = [...signals].sort((a, b) => b.contribution - a.contribution);
  const topPositive = sorted.filter((s) => s.contribution > 0.003).slice(0, 3);
  const topNegative = sorted.filter((s) => s.contribution < -0.003).reverse().slice(0, 3);

  const summary = buildSummary(view, horizon, topPositive, topNegative, ctx);
  const invalidation = buildInvalidation(view, topPositive, topNegative);

  return {
    ticker: ctx.ticker, horizon: horizon.id, horizonLabel: horizon.label, view,
    score: +composite.toFixed(3), confidence, confidenceBand, riskLevel,
    summary, invalidation,
    topPositive: topPositive.map(pick), topNegative: topNegative.map(pick),
    categories, missing, risks, confidenceParts: parts, signals,
    thresholds: THRESHOLDS, weights, modelVersion: MODEL_VERSION,
    asOf: ctx.asOfTs, asOfDate: ctx.asOfDate, simulated: !!ctx.simulated,
  };
}

const pick = (s) => ({ id: s.id, label: s.label, brief: s.brief, contribution: s.contribution, score: s.score, evidence: s.evidence });

function joinList(xs) {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
}

function buildSummary(view, horizon, pos, neg, ctx) {
  const p = pos.slice(0, 2).map((s) => s.brief);
  const n = neg.slice(0, 2).map((s) => s.brief);
  const lead = {
    Buy: `The model leans Buy for ${horizon.label}`,
    Sell: `The model leans Sell for ${horizon.label}`,
    Hold: `The model’s view is Hold for ${horizon.label}`,
  }[view];
  let s = lead;
  if (view === 'Buy') s += p.length ? ` mainly because ${joinList(p)}.` : '.';
  else if (view === 'Sell') s += n.length ? ` mainly because ${joinList(n)}.` : '.';
  else s += p.length && n.length ? `: positives (${joinList(p)}) are roughly offset by negatives (${joinList(n)}).` : ' because signals are weak or mixed.';
  if (view === 'Buy' && n.length) s += ` The main offsets are that ${joinList(n)}.`;
  if (view === 'Sell' && p.length) s += ` Offsetting this, ${joinList(p)}.`;
  if (ctx.simulated) s += ' (Computed on simulated sample data.)';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildInvalidation(view, pos, neg) {
  const out = [];
  if (view === 'Buy' || view === 'Hold') for (const s of pos.slice(0, 2)) if (s.ifChanges) out.push({ signal: s.label, condition: s.ifChanges, direction: view === 'Buy' ? 'would weaken the Buy view' : 'could move the view toward Sell' });
  if (view === 'Sell' || view === 'Hold') for (const s of neg.slice(0, 2)) if (s.ifChanges) out.push({ signal: s.label, condition: s.ifChanges, direction: view === 'Sell' ? 'would weaken the Sell view' : 'could move the view toward Buy' });
  return out;
}
