// Bull / base / bear scenarios. Price bands are ILLUSTRATIVE: they show the
// size of moves that past volatility would make unremarkable over the
// horizon, plus simple valuation arithmetic. They are not predictions.

import { annualVol } from './indicators.js';
import { peAt } from './fundamentals.js';
import { inr, pct, num, pctAbs } from '../lib/format.js';
import { sectorInfo, FACTORS } from './sectors.js';

export function buildScenarios(ctx, rec) {
  const price = ctx.closes.at(-1);
  const vol = annualVol(ctx.closes, 120);
  const years = { short: 0.25, medium: 1, long: 2 }[rec.horizon] || 1;
  const sd = vol * Math.sqrt(years);
  const band = (lo, hi) => ({ low: +(price * Math.exp(lo * sd)).toFixed(0), high: +(price * Math.exp(hi * sd)).toFixed(0) });
  const t = ctx.ttm || {};
  const fin = ctx.kind === 'financial';
  const g = t.npGrowth;
  const m = fin ? t.latest?.nim : t.latest?.operatingMargin;
  const pe = peAt(price, ctx.quarters)?.pe;
  const st = ctx.sectorStats;
  const medPe = st?.medianPe;
  const info = sectorInfo(ctx.inst.sector);
  const topSens = Object.entries(info.sens).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  const macroLine = topSens && Math.abs(topSens[1]) >= 0.3
    ? (good) => `${FACTORS[topSens[0]].label} ${(topSens[1] > 0) === good ? 'continues' : 'reverses'} (the sector’s largest macro sensitivity under model assumptions)`
    : () => 'No single macro factor dominates under model assumptions';
  const levels = ctx.levels || {};
  const valuationNote = pe && medPe ? `At the sector-median P/E of ${num(medPe, 1)}× and current trailing EPS, the price would be about ${inr(medPe * (price / pe), 0)} — arithmetic, not a target.` : null;

  const cases = [
    {
      id: 'bull', label: 'Bull case', band: band(0.5, 1.0),
      assumptions: [
        g != null ? `Profit growth stays at or above ${pctAbs(Math.max(g, 0.1), 0)} (latest ${pct(g)})` : 'Earnings grow faster than recently',
        m != null ? `${fin ? 'Net interest margin' : 'Operating margin'} holds at or above ${num(m, fin ? 2 : 1)}%` : 'Margins expand',
        macroLine(true),
        'Investor appetite for the sector stays firm',
      ],
      supports: [levels.resistance ? `A sustained close above resistance at ${inr(levels.resistance.price)}` : 'New 52-week highs on strong volume', 'Results ahead of the recent trend', 'Upward revisions in published estimates'],
      weakens: ['Results below the recent trend', 'Margin pressure from costs or competition'],
    },
    {
      id: 'base', label: 'Base case', band: band(-0.35, 0.35),
      assumptions: [
        g != null ? `Profit growth broadly continues around ${pct(g, 0)}` : 'Earnings growth continues at recent rates',
        pe ? `Valuation stays near the current ${num(pe, 1)}× trailing P/E` : 'Valuation stays near current levels',
        'No major change in the macro backdrop',
      ],
      supports: ['Results in line with the recent trajectory', 'Range-bound trading between support and resistance'],
      weakens: ['A decisive break of support or resistance', 'A material surprise in results or guidance'],
    },
    {
      id: 'bear', label: 'Bear case', band: band(-1.0, -0.5),
      assumptions: [
        g != null ? `Profit growth slows to below ${pctAbs(Math.max(0, (g ?? 0.1) / 2), 0)}` : 'Earnings decline',
        pe && medPe && pe > medPe ? `Valuation de-rates toward the sector median (${num(medPe, 1)}×)` : 'Valuation compresses on weaker sentiment',
        macroLine(false),
      ],
      supports: [levels.support ? `A sustained close below support at ${inr(levels.support.price)}` : 'New 52-week lows', 'Results below the recent trend', 'Rising leverage or deteriorating cash flow'],
      weakens: ['Earnings resilience in the next results', 'Easing of macro headwinds'],
    },
  ];
  return {
    horizon: rec.horizon, horizonLabel: rec.horizonLabel, price, volatility: vol,
    method: `Bands are the current price moved by 0.5–1.0 (bull), ±0.35 (base) and −0.5 to −1.0 (bear) standard deviations of the stock’s past 120-day volatility (${pctAbs(vol)} annualised), scaled to ${rec.horizonLabel}.`,
    disclaimer: 'Illustrative ranges only — not price targets or predictions. Actual outcomes can fall well outside every band.',
    valuationNote, cases, simulated: !!ctx.simulated,
  };
}
