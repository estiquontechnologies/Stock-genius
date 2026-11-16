import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema, rsi, supportResistance, maxDrawdown, beta } from '../server/analysis/indicators.js';
import { ttmMetrics, quartersAsOf } from '../server/analysis/fundamentals.js';
import { detectMoves } from '../server/analysis/moves.js';
import { computeStress } from '../server/analysis/stress.js';
import { SampleProvider } from '../server/providers/sample/index.js';
import { getShared, latestRecommendation, recommendationHistory, deriveAlerts, buildContext } from '../server/services/research.js';
import { THRESHOLDS } from '../server/analysis/recommend.js';

test('sma and ema basics', () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  const e = ema([1, 2, 3, 4, 5], 3);
  assert.equal(e[2], 2);
  assert.ok(Math.abs(e[4] - 4) < 1e-9);
});

test('rsi is 100 for a monotonic rise and ~0 for a fall', () => {
  const up = Array.from({ length: 30 }, (_, i) => 100 + i);
  assert.equal(rsi(up).at(-1), 100);
  const down = up.slice().reverse();
  assert.ok(rsi(down).at(-1) < 1);
});

test('max drawdown and beta', () => {
  assert.ok(Math.abs(maxDrawdown([100, 120, 90, 130]) - (90 / 120 - 1)) < 1e-12);
  const m = Array.from({ length: 130 }, (_, i) => 100 * (1 + 0.01 * Math.sin(i)));
  const s = m.map((x, i) => (i === 0 ? x : x));
  assert.ok(Math.abs(beta(s, m) - 1) < 1e-9);
});

test('support/resistance clusters repeated touches', () => {
  const bars = [];
  for (let i = 0; i < 160; i++) {
    const c = 100 + 10 * Math.sin(i / 6);
    bars.push({ date: `d${i}`, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1 });
  }
  const sr = supportResistance(bars);
  assert.ok(sr.support || sr.resistance);
  for (const l of [...sr.supports, ...sr.resistances]) assert.ok(l.touches >= 2);
});

test('ttm metrics and point-in-time filtering', () => {
  const qs = Array.from({ length: 8 }, (_, k) => ({ label: `Q${k}`, reportDate: `2025-0${k + 1}-15`, revenue: 100 + k * 10, netProfit: 10 + k, eps: 1 + k / 10, operatingProfit: 20, operatingMargin: 20 }));
  const t = ttmMetrics(qs);
  assert.ok(t.revGrowth > 0 && t.npGrowth > 0);
  assert.equal(quartersAsOf({ quarters: qs }, '2025-03-31').length, 3);
});

test('detectMoves labels a company-specific shock and finds its news', () => {
  const n = 200;
  const dates = Array.from({ length: n }, (_, i) => `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`);
  let p = 100;
  let q = 100;
  const closes = [];
  const market = [];
  for (let i = 0; i < n; i++) {
    const noise = 0.004 * Math.sin(i * 1.7);
    q *= 1 + noise * 0.8;
    p *= 1 + noise + (i === 150 ? 0.08 : 0);
    closes.push(p);
    market.push(q);
  }
  const news = [{ id: 'x', scope: 'company', tone: 1, category: 'earnings', headline: 'Results beat', publishedAt: `${dates[149]}T16:45:00+05:30`, source: 'test', url: '#' }];
  const moves = detectMoves({ dates, closes, volumes: closes.map(() => 1), market, sector: null, news });
  const m = moves.find((x) => x.date === dates[150]);
  assert.ok(m, 'shock detected');
  assert.equal(m.driver, 'company-specific');
  assert.equal(m.candidates[0].id, 'x');
  assert.match(m.explanation, /^Possible explanation/);
  assert.match(m.caveat, /does not prove/);
});

test('stress radar flags an outsized crude move', () => {
  const n = 300;
  const brent = Array.from({ length: n }, (_, i) => 80 + Math.sin(i / 9));
  for (let i = n - 10; i < n; i++) brent[i] = brent[i - 1] * 1.03;
  const s = computeStress({ brent });
  const g = s.gauges.find((x) => x.id === 'brent');
  assert.notEqual(g.status, 'calm');
  assert.ok(s.sectors.length > 0);
});

const provider = new SampleProvider();

test('every recommendation separates facts and analysis and never claims certainty', async () => {
  const sh = await getShared(provider);
  for (const t of Object.keys(sh.u.byTicker)) {
    for (const h of ['short', 'medium', 'long']) {
      const { rec } = await latestRecommendation(provider, sh, t, h);
      assert.ok(['Buy', 'Hold', 'Sell'].includes(rec.view));
      assert.ok(rec.confidence >= 10 && rec.confidence <= 85, 'confidence capped');
      if (rec.score >= THRESHOLDS.buy) assert.equal(rec.view, 'Buy');
      else if (rec.score <= THRESHOLDS.sell) assert.equal(rec.view, 'Sell');
      else assert.equal(rec.view, 'Hold');
      for (const s of rec.signals) {
        assert.ok(s.fact && s.analysis, `${t}/${s.id} has fact and analysis`);
        assert.ok(s.score >= -1 && s.score <= 1);
        assert.ok(['high', 'medium', 'low'].includes(s.evidence));
      }
      assert.ok(rec.simulated);
      assert.match(rec.summary, /simulated/);
    }
  }
});

test('point-in-time contexts never see future results or news', async () => {
  const sh = await getShared(provider);
  const idx = sh.u.dates.length - 100;
  const ctx = await buildContext(provider, sh, 'AURLEDGR', idx);
  const asOf = sh.u.dates[idx];
  assert.ok(ctx.quarters.every((q) => q.reportDate <= asOf));
  assert.ok(ctx.news.company.every((n) => n.publishedAt.slice(0, 10) <= asOf));
  assert.equal(ctx.closes.length, idx + 1);
});

test('history and alerts are derived consistently', async () => {
  const sh = await getShared(provider);
  const hist = await recommendationHistory(provider, sh, 'TRVLNMOT');
  assert.ok(hist.medium.length > 10);
  const alerts = deriveAlerts('TRVLNMOT', 'Travelon Motors', hist, 'medium');
  for (const a of alerts) {
    assert.ok(a.title && a.explanation && a.date);
    if (a.type === 'view') assert.notEqual(a.from, a.to);
  }
});

test('sample data is deterministic and clearly fictional', async () => {
  const a = new SampleProvider().world();
  const b = new SampleProvider().world();
  assert.deepEqual(a.companies.AURLEDGR.bars.at(-1), b.companies.AURLEDGR.bars.at(-1));
  assert.ok(a.news.every((n) => n.sample === true && n.url.startsWith('#/source/')));
  const inst = await provider.listInstruments();
  assert.ok(inst.every((i) => i.simulated));
});
