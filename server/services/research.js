// Orchestrates point-in-time contexts, recommendations, history, alerts,
// news impact and the full stock research payload.

import { loadUniverse, sectorStats, universeVols } from './universe.js';
import { quartersAsOf, ttmMetrics, peAt } from '../analysis/fundamentals.js';
import { collectSignals, recommend, HORIZONS, MODEL_VERSION } from '../analysis/recommend.js';
import { computeStress } from '../analysis/stress.js';
import { computeBreadth } from '../analysis/breadth.js';
import { detectMoves } from '../analysis/moves.js';
import { buildScenarios } from '../analysis/scenarios.js';
import { analyseImpact, observedReaction } from '../analysis/news-impact.js';
import { daysBetween, addDays } from '../lib/dates.js';

const shared = { key: null, value: null };

export async function getShared(provider) {
  const u = await loadUniverse(provider);
  const key = `${provider.id}:${u.meta.asOf}:${u.meta.version || ''}`;
  if (shared.key === key) return shared.value;
  if (u.empty) return { u, news: { all: [], byTicker: {}, bySector: {}, market: [] }, macro: {}, macroAligned: {}, calendar: [] };
  const [news, macro, calendar] = await Promise.all([
    provider.getNews(), provider.getMacro(), provider.getCalendar({ from: u.dates[0], to: addDays(u.dates.at(-1), 120) }),
  ]);
  const byTicker = {};
  const bySector = {};
  const market = [];
  for (const it of news) {
    if (it.scope === 'company') for (const t of it.tickers) (byTicker[t] ||= []).push(it);
    else if (it.scope === 'sector') (bySector[it.sector] ||= []).push(it);
    else market.push(it);
  }
  // Align daily macro series to universe sessions (forward fill).
  const macroAligned = {};
  for (const [id, m] of Object.entries(macro)) {
    if (m.frequency === 'monthly') continue;
    const pts = [...m.series].sort((a, b) => (a.date < b.date ? -1 : 1));
    let j = 0;
    let last = pts[0]?.value ?? null;
    macroAligned[id] = u.dates.map((d) => {
      while (j < pts.length && pts[j].date <= d) last = pts[j++].value;
      return last;
    });
  }
  const value = {
    u, news: { all: news, byTicker, bySector, market }, macro, macroAligned, calendar,
    estimates: new Map(), stress: new Map(), breadth: new Map(), history: new Map(), recs: new Map(),
    macroSourceLabel: u.meta.simulated ? 'simulated macro series' : (Object.values(macro)[0]?.source || 'macro data provider'),
  };
  shared.key = key;
  shared.value = value;
  return value;
}

export function breadthAt(sh, idx) {
  if (!sh.breadth.has(idx)) sh.breadth.set(idx, computeBreadth(sh.u, idx));
  return sh.breadth.get(idx);
}

export function macroAsOf(sh, idx) {
  const date = sh.u.dates[idx];
  const out = {};
  for (const [id, arr] of Object.entries(sh.macroAligned)) out[id] = arr.slice(0, idx + 1);
  if (sh.macro.cpi) out.cpi = sh.macro.cpi.series.filter((p) => p.date <= date).map((p) => p.value);
  return out;
}

export function stressAt(sh, idx) {
  if (!sh.stress.has(idx)) sh.stress.set(idx, computeStress(macroAsOf(sh, idx), { breadth: breadthAt(sh, idx).market, sectorNames: sh.u.sectors }));
  return sh.stress.get(idx);
}

async function estimatesFor(provider, sh, ticker) {
  if (!sh.estimates.has(ticker)) sh.estimates.set(ticker, (await provider.getEstimates?.(ticker)) || []);
  return sh.estimates.get(ticker);
}

const eod = (date) => Date.parse(`${date}T23:59:59+05:30`);

export async function buildContext(provider, sh, ticker, idx = sh.u.dates.length - 1, { light = false } = {}) {
  const { u } = sh;
  const t = u.byTicker[ticker];
  if (!t) return null;
  const asOfDate = u.dates[idx];
  const cutoff = eod(asOfDate);
  const bars = t.bars.filter((b) => b.date <= asOfDate);
  const quarters = quartersAsOf(t.fundamentals, asOfDate);
  const ttm = ttmMetrics(quarters);
  const before = (it) => Date.parse(it.publishedAt) <= cutoff;
  const ests = (await estimatesFor(provider, sh, ticker)).filter(before);
  const upcoming = [];
  for (const q of t.fundamentals?.quarters || []) if (q.reportDate > asOfDate) upcoming.push({ date: q.reportDate, type: 'earnings', title: `${q.label} results`, confirmed: true });
  for (const e of sh.calendar) {
    if (e.date <= asOfDate) continue;
    if (e.type === 'earnings' && upcoming.some((x) => x.type === 'earnings')) continue;
    if (e.tickers?.includes(ticker) || e.sectors?.includes(t.inst.sector)) upcoming.push(e);
  }
  upcoming.sort((a, b) => (a.date < b.date ? -1 : 1));
  const ctx = {
    ticker, inst: t.inst, kind: t.fundamentals?.kind || 'operating', sharesCr: t.fundamentals?.sharesCr,
    idx, asOfDate, asOfTs: `${asOfDate}T15:30:00+05:30`,
    bars, closes: t.aligned.slice(0, idx + 1), market: u.indices.ALL.series.slice(0, idx + 1).map((x) => x.value),
    sectorCloses: u.sectorIndex[t.inst.sector]?.slice(0, idx + 1).map((x) => x.value),
    quarters, ttm, balance: t.fundamentals?.balance, cashFlow: t.fundamentals?.cashFlow,
    daysSinceResults: ttm ? daysBetween(ttm.latestReportDate, asOfDate) : null,
    sectorStats: sectorStats(u, t.inst.sector, idx), universeVols: universeVols(u, idx),
    news: {
      company: (sh.news.byTicker[ticker] || []).filter(before),
      sector: (sh.news.bySector[t.inst.sector] || []).filter(before),
      market: sh.news.market.filter(before),
    },
    macro: macroAsOf(sh, idx), macroSourceLabel: sh.macroSourceLabel,
    estimates: ests, upcoming: upcoming.filter((e) => daysBetween(asOfDate, e.date) <= 120),
    stress: light ? null : stressAt(sh, idx),
    priceSource: t.quote?.source || u.meta.name, fundamentalsSource: t.fundamentals?.source || u.meta.name,
    simulated: !!u.meta.simulated, exchangesNote: t.inst.exchanges.join(' + '),
  };
  return ctx;
}

/** Latest recommendation for a ticker/horizon (cached per snapshot). */
export async function latestRecommendation(provider, sh, ticker, horizon = 'medium') {
  const key = `${ticker}:${horizon}`;
  if (sh.recs.has(key)) return sh.recs.get(key);
  const ctx = await buildContext(provider, sh, ticker);
  if (!ctx) return null;
  const sigs = collectSignals(ctx);
  const out = {};
  for (const h of Object.keys(HORIZONS)) {
    // Signals are mutated with contributions; clone per horizon.
    out[h] = { rec: recommend(ctx, h, sigs.map((s) => ({ ...s }))), ctx };
    sh.recs.set(`${ticker}:${h}`, out[h]);
  }
  return out[horizon];
}

const compactSignals = (rec) => Object.fromEntries(rec.signals.map((s) => [s.id, { label: s.label, score: s.score, contribution: s.contribution, fact: s.fact, source: s.source, evidenceItems: s.evidenceItems }]));

/** Point-in-time recommendation history (every 5 sessions, ~6 months). */
export async function recommendationHistory(provider, sh, ticker) {
  if (sh.history.has(ticker)) return sh.history.get(ticker);
  const n = sh.u.dates.length;
  const points = [];
  for (let k = 0; k <= 26; k++) points.push(n - 1 - k * 5);
  const hist = { short: [], medium: [], long: [] };
  for (const idx of points.reverse()) {
    if (idx < 210) continue;
    const ctx = await buildContext(provider, sh, ticker, idx, { light: true });
    ctx.stress = stressAt(sh, idx);
    const sigs = collectSignals(ctx);
    for (const h of Object.keys(HORIZONS)) {
      const rec = recommend(ctx, h, sigs.map((s) => ({ ...s })));
      hist[h].push({
        date: ctx.asOfDate, view: rec.view, score: rec.score, confidence: rec.confidence, confidenceBand: rec.confidenceBand,
        riskLevel: rec.riskLevel, price: ctx.closes.at(-1), signals: compactSignals(rec), summary: rec.summary, modelVersion: MODEL_VERSION,
      });
    }
  }
  sh.history.set(ticker, hist);
  return hist;
}

const WATCHED_SIGNAL_FLIPS = {
  trend: ['Price moved above its long-term trend', 'Price moved below its long-term trend'],
  valuation: ['Valuation signal turned favourable', 'Valuation signal turned unfavourable'],
  'earnings-growth': ['Earnings growth signal turned positive', 'Earnings growth signal turned negative'],
  results: ['Latest results turned the results signal positive', 'Latest results turned the results signal negative'],
  'company-news': ['Company news flow turned favourable', 'Company news flow turned unfavourable'],
  'macro-exposure': ['Macro backdrop turned into a tailwind', 'Macro backdrop turned into a headwind'],
  momentum: ['Relative strength turned positive', 'Relative strength turned negative'],
};

/** Derive signal-change alerts from consecutive history entries. */
export function deriveAlerts(ticker, name, hist, horizon) {
  const list = hist[horizon] || [];
  const alerts = [];
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1];
    const b = list[i];
    const drivers = Object.entries(b.signals)
      .map(([id, s]) => ({ id, ...s, delta: s.contribution - (a.signals[id]?.contribution ?? 0), before: a.signals[id]?.fact ?? null }))
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).slice(0, 3)
      .filter((d) => Math.abs(d.delta) > 0.002);
    const evidence = drivers.map((d) => ({ signal: d.label, now: d.fact, before: d.before, source: d.source, items: (d.evidenceItems || []).slice(0, 3) }));
    const base = { ticker, name, horizon, date: b.date, price: b.price, evidence };
    const id = (type) => `${ticker}:${horizon}:${type}:${b.date}`;
    if (a.view !== b.view) {
      alerts.push({ ...base, id: id('view'), type: 'view', severity: 'high', title: `${name}: view changed from ${a.view} to ${b.view}`, from: a.view, to: b.view,
        explanation: `The composite score moved from ${a.score} to ${b.score}. Largest changes: ${drivers.map((d) => `${d.label} (${d.delta > 0 ? 'more positive' : 'more negative'})`).join('; ') || 'several small changes'}.` });
    }
    if (a.confidenceBand !== b.confidenceBand) {
      alerts.push({ ...base, id: id('confidence'), type: 'confidence', severity: 'medium', title: `${name}: confidence ${b.confidence > a.confidence ? 'rose' : 'fell'} to ${b.confidenceBand}`, from: `${a.confidenceBand} (${a.confidence})`, to: `${b.confidenceBand} (${b.confidence})`,
        explanation: 'Confidence reflects how strong and how consistent the signals are, plus risk and data coverage.' });
    }
    if (a.riskLevel !== b.riskLevel) {
      alerts.push({ ...base, id: id('risk'), type: 'risk', severity: 'medium', title: `${name}: risk level changed from ${a.riskLevel} to ${b.riskLevel}`, from: a.riskLevel, to: b.riskLevel,
        explanation: 'Risk level combines volatility, drawdown, liquidity, leverage or credit quality, upcoming results and market stress.' });
    }
    if (horizon === 'medium') {
      for (const [sid, [upText, downText]] of Object.entries(WATCHED_SIGNAL_FLIPS)) {
        const sa = a.signals[sid];
        const sb = b.signals[sid];
        if (!sa || !sb) continue;
        if (Math.abs(sb.score) < 0.2 || Math.sign(sa.score) === Math.sign(sb.score) || Math.abs(sa.score) < 0.05) continue;
        alerts.push({ ...base, id: id(`signal-${sid}`), type: 'signal', severity: 'low', title: `${name}: ${sb.score > 0 ? upText : downText}`, from: sa.fact, to: sb.fact,
          explanation: `Signal score moved from ${sa.score} to ${sb.score}.`, evidence: [{ signal: sb.label, now: sb.fact, before: sa.fact, source: sb.source, items: (sb.evidenceItems || []).slice(0, 3) }] });
      }
    }
  }
  return alerts;
}

function analystView(ests, price) {
  if (!ests.length) return { available: false, note: 'No published analyst estimates are connected for this stock. The app does not invent a consensus.' };
  const tg = ests.map((e) => e.targetPrice).sort((a, b) => a - b);
  const med = tg[Math.floor(tg.length / 2)];
  const counts = { Buy: 0, Hold: 0, Sell: 0 };
  for (const e of ests) counts[e.rating] = (counts[e.rating] || 0) + 1;
  const disp = (tg.at(-1) - tg[0]) / med;
  const bulls = ests.filter((e) => e.targetPrice > price).map((e) => ({ broker: e.broker, point: e.keyPoint }));
  const bears = ests.filter((e) => e.targetPrice <= price).map((e) => ({ broker: e.broker, point: e.keyPoint }));
  return {
    available: true, count: ests.length, enough: ests.length >= 3, counts,
    target: { median: med, low: tg[0], high: tg.at(-1), dispersion: +disp.toFixed(2) },
    disagreement: disp > 0.4 ? 'High' : disp > 0.2 ? 'Moderate' : 'Low',
    bulls, bears, estimates: ests.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1)),
    note: ests.length < 3 ? 'Fewer than three estimates — too few to summarise as a consensus.' : 'Targets and ratings are third-party opinions with mixed track records.',
    sample: ests.some((e) => e.sample),
  };
}

/** Equal-weighted composite of sector peers, excluding the stock itself. */
function peerComposite(u, sector, ticker) {
  const peers = Object.values(u.byTicker).filter((x) => x.inst.sector === sector && x.inst.ticker !== ticker);
  if (!peers.length) return null;
  return u.dates.map((_, i) => peers.reduce((a, p) => a + p.aligned[i] / p.aligned[0], 0) / peers.length);
}

/** Full research payload for the stock page. */
export async function stockResearch(provider, ticker, horizon = 'medium') {
  const sh = await getShared(provider);
  const t = sh.u.byTicker[ticker];
  if (!t) return null;
  const { rec, ctx } = await latestRecommendation(provider, sh, ticker, horizon);
  const all = {};
  for (const h of Object.keys(HORIZONS)) {
    const r = (await latestRecommendation(provider, sh, ticker, h)).rec;
    all[h] = { view: r.view, confidence: r.confidence, confidenceBand: r.confidenceBand, horizonLabel: r.horizonLabel, score: r.score };
  }
  const hist = await recommendationHistory(provider, sh, ticker);
  const changes = [];
  const hl = hist[horizon];
  for (let i = 0; i < hl.length; i++) if (i === 0 || hl[i].view !== hl[i - 1].view || hl[i].confidenceBand !== hl[i - 1].confidenceBand || hl[i].riskLevel !== hl[i - 1].riskLevel) changes.push({ date: hl[i].date, view: hl[i].view, confidence: hl[i].confidence, confidenceBand: hl[i].confidenceBand, riskLevel: hl[i].riskLevel, price: hl[i].price, summary: hl[i].summary });

  const dates = sh.u.dates;
  const withImpact = (it) => ({ ...it, analysis: analyseImpact(it, { sector: t.inst.sector }), reaction: observedReaction(it, dates, t.aligned, ctx.market) });
  const price = ctx.closes.at(-1);
  const pe = peAt(price, ctx.quarters);
  const st = ctx.sectorStats;
  const moves = detectMoves({
    dates, closes: t.aligned, volumes: (() => { const m = new Map(t.bars.map((b) => [b.date, b.volume])); return dates.map((d) => m.get(d) || 0); })(),
    market: ctx.market, sector: peerComposite(sh.u, t.inst.sector, ticker), news: [...ctx.news.company, ...ctx.news.sector, ...ctx.news.market],
  });

  return {
    instrument: t.inst, quote: t.quote, data: sh.u.meta,
    recommendation: rec, horizons: all, history: changes, historySeries: hl.map((h) => ({ date: h.date, score: h.score, view: h.view, confidence: h.confidence })),
    fundamentals: {
      kind: ctx.kind, quarters: ctx.quarters, ttm: ctx.ttm, balance: ctx.balance, cashFlow: ctx.cashFlow, source: t.fundamentals?.source,
      valuation: { pe: pe?.pe ?? null, sectorMedianPe: st.medianPe, pb: ctx.balance?.netWorth ? (price * ctx.sharesCr) / ctx.balance.netWorth : null, sectorMedianPb: st.medianPb, marketCapCr: price * (ctx.sharesCr || 0), peers: st.rows },
    },
    levels: ctx.levels,
    news: {
      company: ctx.news.company.slice(0, 20).map(withImpact),
      sector: ctx.news.sector.slice(0, 6).map(withImpact),
      market: ctx.news.market.slice(0, 6).map(withImpact),
    },
    upcoming: ctx.upcoming,
    scenarios: buildScenarios(ctx, rec),
    analysts: analystView(ctx.estimates, price),
    moves,
    stress: { label: ctx.stress?.label, narrative: ctx.stress?.narrative, sectorExposure: ctx.stress?.sectors.find((s) => s.sector === t.inst.sector) },
  };
}
