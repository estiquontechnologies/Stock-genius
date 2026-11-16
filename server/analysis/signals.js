// Signal library. Each signal separates:
//   fact      – a verifiable data statement (with source and timestamp)
//   analysis  – the model's interpretation (inference, not fact)
//   score     – direction in [-1, 1] (+ supports a higher price)
//   evidence  – how robust the link between this signal and returns is
//   ifChanges – what would flip or weaken the signal
// Signals never claim causation or certainty.

import { sma, rsi, macd, pctChange, annualVol, supportResistance, mean, maxDrawdown, beta } from './indicators.js';
import { peAt } from './fundamentals.js';
import { sectorInfo, FACTORS } from './sectors.js';
import { pct, pctAbs, inr, num, clamp } from '../lib/format.js';

const strengthOf = (s) => (Math.abs(s) >= 0.55 ? 'strong' : Math.abs(s) >= 0.25 ? 'moderate' : 'weak');

function mk(ctx, o) {
  return {
    strength: strengthOf(o.score),
    source: o.source || ctx.priceSource,
    ...o,
    score: +clamp(o.score).toFixed(3),
  };
}

// ------------------------------------------------------------ technical
export function technicalSignals(ctx) {
  const out = [];
  const c = ctx.closes;
  const price = c[c.length - 1];
  const s50 = sma(c, 50).at(-1);
  const s200 = sma(c, 200).at(-1);
  const s200prev = sma(c.slice(0, -20), 200).at(-1);
  const src = { name: ctx.priceSource, asOf: ctx.asOfTs };

  if (s50 && s200) {
    let score = price > s50 && s50 > s200 ? 0.6 : price > s200 ? 0.3 : price > s50 ? -0.25 : -0.6;
    const slope = s200prev ? s200 / s200prev - 1 : 0;
    score += clamp(slope / 0.03, -0.2, 0.2);
    const above200 = price > s200;
    out.push(mk(ctx, {
      id: 'trend', category: 'technical', label: 'Price trend (50- and 200-day averages)', term: 'moving-average',
      fact: `Close ${inr(price)}; 50-day average ${inr(s50)}; 200-day average ${inr(s200)} (200-day average ${slope >= 0 ? 'rising' : 'falling'} ${pctAbs(Math.abs(slope))} over 20 sessions).`,
      analysis: score > 0.3 ? 'The price is above both averages with a supportive long-term slope, which the model reads as an established uptrend.'
        : score > 0 ? 'Mixed trend: the long-term trend is intact but short-term momentum has softened.'
          : score > -0.3 ? 'Mixed trend: price is below the long-term average but has recovered above the short-term average.'
            : 'The price is below both averages, which the model reads as a downtrend.',
      brief: score > 0 ? 'the price trend is positive' : 'the price trend is negative',
      score, evidence: 'medium', value: { above200, price, s50, s200 }, source: src,
      ifChanges: above200 ? `A sustained close below the 200-day average (${inr(s200)}) would turn this signal negative.` : `A sustained close above the 200-day average (${inr(s200)}) would turn this signal positive.`,
    }));
  }

  const rel3 = pctChange(c, 63);
  const mkt3 = pctChange(ctx.market, 63);
  if (rel3 != null && mkt3 != null) {
    const rel = rel3 - mkt3;
    out.push(mk(ctx, {
      id: 'momentum', category: 'technical', label: 'Relative strength vs market (3 months)', term: 'relative-strength',
      fact: `3-month return ${pct(rel3)} vs ${pct(mkt3)} for the composite of tracked stocks (difference ${pct(rel)}).`,
      analysis: rel > 0.03 ? 'Outperforming the broad market; momentum tends to persist over weeks to months, but can reverse sharply.'
        : rel < -0.03 ? 'Underperforming the broad market, suggesting investors currently prefer other stocks.' : 'Moving roughly in line with the market.',
      brief: rel > 0 ? `it has outperformed the market by ${pctAbs(rel)} over 3 months` : `it has lagged the market by ${pctAbs(-rel)} over 3 months`,
      score: clamp(rel / 0.15) * 0.8, evidence: 'medium', value: { rel }, source: src,
      ifChanges: 'A reversal in relative performance over the next 1–2 months would weaken this signal.',
    }));
  }

  const r = rsi(c, 14).at(-1);
  if (r != null) {
    const score = r > 70 ? -0.3 : r < 30 ? 0.3 : r > 60 ? -0.05 : r < 40 ? 0.05 : 0;
    out.push(mk(ctx, {
      id: 'rsi', category: 'technical', label: 'RSI (14-day)', term: 'rsi', shortOnly: true,
      fact: `RSI(14) is ${num(r, 0)}.`,
      analysis: r > 70 ? 'Overbought territory: recent gains have been fast, raising the chance of a pause or pullback. This is a weak signal on its own.'
        : r < 30 ? 'Oversold territory: selling has been intense, and short-term rebounds are common, though downtrends can persist.'
          : 'Neutral zone; not informative on its own.',
      brief: r > 70 ? 'the stock looks overbought short term' : r < 30 ? 'the stock looks oversold short term' : 'momentum is neutral',
      score, evidence: 'low', value: { rsi: r }, source: src,
      ifChanges: 'RSI changes quickly; a move back toward 50 neutralises it.',
    }));
  }

  const m = macd(c);
  const h = m.hist.at(-1);
  const h5 = m.hist.at(-6);
  if (h != null && h5 != null) {
    const crossed = Math.sign(h) !== Math.sign(h5);
    out.push(mk(ctx, {
      id: 'macd', category: 'technical', label: 'MACD momentum', term: 'macd', shortOnly: true,
      fact: `MACD histogram ${num(h, 2)} (five sessions ago ${num(h5, 2)}).`,
      analysis: crossed ? `MACD ${h > 0 ? 'turned positive' : 'turned negative'} recently, an early ${h > 0 ? 'bullish' : 'bearish'} momentum signal that often gives false starts.`
        : `MACD has been ${h > 0 ? 'positive' : 'negative'}, consistent with ${h > 0 ? 'upward' : 'downward'} short-term momentum.`,
      brief: h > 0 ? 'short-term momentum is positive' : 'short-term momentum is negative',
      score: (h > 0 ? 1 : -1) * (crossed ? 0.3 : 0.15), evidence: 'low', value: { hist: h }, source: src,
      ifChanges: 'A crossover in the opposite direction would flip this signal.',
    }));
  }

  const b20 = ctx.bars.slice(-21);
  const up = [];
  const dn = [];
  for (let i = 1; i < b20.length; i++) (b20[i].close >= b20[i - 1].close ? up : dn).push(b20[i].volume);
  if (up.length >= 3 && dn.length >= 3) {
    const ratio = mean(up) / mean(dn);
    out.push(mk(ctx, {
      id: 'volume', category: 'technical', label: 'Volume confirmation (20 sessions)', term: 'volume',
      fact: `Average volume on up days is ${num(ratio, 2)}× the average on down days (${up.length} up / ${dn.length} down sessions).`,
      analysis: ratio > 1.2 ? 'Heavier volume on rising days suggests buying interest (accumulation).' : ratio < 0.83 ? 'Heavier volume on falling days suggests selling pressure (distribution).' : 'Volume is balanced between up and down days.',
      brief: ratio > 1.2 ? 'volume favours buyers' : ratio < 0.83 ? 'volume favours sellers' : 'volume is balanced',
      score: ratio > 1.2 ? clamp((ratio - 1) / 1.2, 0, 0.4) : ratio < 0.83 ? -clamp((1 / ratio - 1) / 1.2, 0, 0.4) : 0,
      evidence: 'low', value: { ratio }, source: src,
      ifChanges: 'A shift in which days carry heavier volume would change this reading.',
    }));
  }

  const sr = supportResistance(ctx.bars);
  ctx.levels = sr;
  if (sr.support || sr.resistance) {
    const dS = sr.support ? price / sr.support.price - 1 : null;
    const dR = sr.resistance ? sr.resistance.price / price - 1 : null;
    let score = 0;
    let analysis = 'The price is between identified levels, so they are not a strong factor right now.';
    if (dR != null && dR < 0.03) { score = -0.2; analysis = 'The price is close to a level where it previously met selling; it may struggle to break through without new buying.'; }
    else if (dS != null && dS < 0.03) { score = 0.15; analysis = 'The price is close to a level where buyers previously stepped in; a break below would be a negative signal.'; }
    out.push(mk(ctx, {
      id: 'levels', category: 'technical', label: 'Support and resistance', term: 'support-resistance', shortOnly: true,
      fact: `Nearest support ${sr.support ? `${inr(sr.support.price)} (${sr.support.touches} touches, ${pctAbs(dS)} below)` : 'not identified'}; nearest resistance ${sr.resistance ? `${inr(sr.resistance.price)} (${sr.resistance.touches} touches, ${pctAbs(dR)} above)` : 'not identified (near highs)'}.`,
      analysis, brief: score < 0 ? 'it is near resistance' : score > 0 ? 'it is near support' : 'it is between key levels',
      score, evidence: 'low', value: { support: sr.support?.price, resistance: sr.resistance?.price }, source: src,
      ifChanges: `${sr.support ? `A close below ${inr(sr.support.price)} would be a negative development.` : ''} ${sr.resistance ? `A close above ${inr(sr.resistance.price)} would be a positive development.` : ''}`.trim(),
    }));
  }
  return out;
}

// ----------------------------------------------------------- fundamental
export function fundamentalSignals(ctx) {
  const out = [];
  const t = ctx.ttm;
  if (!t) return out;
  const fin = ctx.kind === 'financial';
  const src = { name: ctx.fundamentalsSource, asOf: t.latestReportDate, note: `Latest results: ${t.latestLabel}` };

  if (t.revGrowth != null) {
    out.push(mk(ctx, {
      id: 'revenue-growth', category: 'fundamental', label: fin ? 'Income growth' : 'Revenue growth', term: 'revenue-growth',
      fact: `${fin ? 'Total income' : 'Revenue'} growth ${pct(t.revGrowth)} (${t.growthBasis}).`,
      analysis: t.revGrowth > 0.15 ? 'Strong top-line growth, which supports future earnings if margins hold.' : t.revGrowth > 0.07 ? 'Moderate growth, broadly in line with nominal economic growth.' : t.revGrowth > 0 ? 'Slow growth; earnings gains would need to come from margins.' : 'Revenue is shrinking, a negative for the earnings outlook.',
      brief: `${fin ? 'income' : 'revenue'} growth is ${pct(t.revGrowth)}`,
      score: clamp((t.revGrowth - 0.08) / 0.12), evidence: 'high', value: { revGrowth: t.revGrowth }, source: src,
      ifChanges: `Next results showing growth ${t.revGrowth > 0.08 ? 'below 8%' : 'above 12%'} would change this reading.`,
    }));
  }
  if (t.npGrowth != null) {
    out.push(mk(ctx, {
      id: 'earnings-growth', category: 'fundamental', label: 'Net profit growth', term: 'eps',
      fact: `Net profit growth ${pct(t.npGrowth)} (${t.growthBasis}); trailing EPS ${inr(t.epsTtm)}.`,
      analysis: t.npGrowth > 0.15 ? 'Earnings are compounding quickly, the single most important long-run driver of share prices.' : t.npGrowth > 0.05 ? 'Earnings are growing modestly.' : 'Earnings are flat or declining, which usually weighs on valuations.',
      brief: `net profit growth is ${pct(t.npGrowth)}`,
      score: clamp((t.npGrowth - 0.1) / 0.15), evidence: 'high', value: { npGrowth: t.npGrowth }, source: src,
      ifChanges: 'A change in the earnings growth trend in the next one or two results would change this reading.',
    }));
  }
  if (fin && t.nimDelta != null) {
    out.push(mk(ctx, {
      id: 'margin', category: 'fundamental', label: 'Net interest margin trend', term: 'nim',
      fact: `Net interest margin ${num(t.latest.nim, 2)}% in ${t.latestLabel} vs ${num(t.latest.nim - t.nimDelta, 2)}% in ${t.yearAgoLabel}.`,
      analysis: t.nimDelta > 0.1 ? 'Expanding lending margins support profitability.' : t.nimDelta < -0.1 ? 'Compressing lending margins pressure profitability.' : 'Margins are stable.',
      brief: `lending margins ${t.nimDelta >= 0 ? 'expanded' : 'compressed'} ${num(Math.abs(t.nimDelta), 2)} pp`,
      score: clamp(t.nimDelta / 0.3), evidence: 'medium', value: { delta: t.nimDelta }, source: src,
      ifChanges: 'A reversal of the margin trend in the next results would change this reading.',
    }));
  } else if (t.marginDelta != null) {
    out.push(mk(ctx, {
      id: 'margin', category: 'fundamental', label: 'Operating margin trend', term: 'operating-margin',
      fact: `Operating margin ${num(t.latest.operatingMargin, 1)}% in ${t.latestLabel} vs ${num(t.marginYearAgo, 1)}% in ${t.yearAgoLabel}.`,
      analysis: t.marginDelta > 0.5 ? 'Margins are expanding, suggesting pricing power or cost control.' : t.marginDelta < -0.5 ? 'Margins are contracting, which may reflect cost pressure or competition.' : 'Margins are broadly stable.',
      brief: `operating margin ${t.marginDelta >= 0 ? 'expanded' : 'contracted'} ${num(Math.abs(t.marginDelta), 1)} pp`,
      score: clamp(t.marginDelta / 2.5), evidence: 'medium', value: { delta: t.marginDelta }, source: src,
      ifChanges: 'A reversal of the margin trend in the next results would change this reading.',
    }));
  }
  const b = ctx.balance || {};
  if (b.roe != null) {
    const base = fin ? 12 : 14;
    out.push(mk(ctx, {
      id: 'roe', category: 'fundamental', label: 'Return on equity', term: 'roe',
      fact: `Return on equity ${num(b.roe, 1)}% (latest reported).`,
      analysis: b.roe > base + 4 ? 'High returns on shareholder capital indicate a quality business.' : b.roe < base - 4 ? 'Low returns on capital limit how fast the business can compound value.' : 'Returns on capital are moderate.',
      brief: `return on equity is ${num(b.roe, 1)}%`,
      score: clamp((b.roe - base) / 8) * 0.8, evidence: 'medium', value: { roe: b.roe }, source: src,
      ifChanges: 'A sustained change in profitability or a large equity raise would change this reading.',
    }));
  }
  if (fin && t.latest.gnpa != null) {
    const g = t.latest.gnpa;
    let score = g < 2 ? 0.3 : g < 4 ? 0 : -0.5;
    if (t.gnpaDelta != null) score += clamp(-t.gnpaDelta / 0.8, -0.3, 0.3);
    out.push(mk(ctx, {
      id: 'balance', category: 'fundamental', label: 'Asset quality (gross NPA)', term: 'npa',
      fact: `Gross NPA ${num(g, 2)}%${t.gnpaDelta != null ? ` (${t.gnpaDelta <= 0 ? 'down' : 'up'} ${num(Math.abs(t.gnpaDelta), 2)} pp year on year)` : ''}; capital adequacy ${num(b.capitalAdequacy, 1)}%.`,
      analysis: score > 0.1 ? 'Asset quality is healthy and/or improving, lowering the risk of credit losses.' : score < -0.1 ? 'Asset quality is weak or deteriorating, which can force higher provisions.' : 'Asset quality is average.',
      brief: `gross NPA is ${num(g, 2)}%`, score, evidence: 'high', value: { gnpa: g }, source: src,
      ifChanges: 'A rise in bad loans in coming quarters would weaken this signal.',
    }));
  } else if (!fin && b.debtToEquity != null) {
    const de = b.debtToEquity;
    let score = de < 0.5 ? 0.3 : de < 1 ? 0 : de < 2 ? -0.3 : -0.6;
    if (b.interestCoverage != null && b.interestCoverage < 3) score -= 0.3;
    out.push(mk(ctx, {
      id: 'balance', category: 'fundamental', label: 'Balance sheet (leverage)', term: 'debt-to-equity',
      fact: `Debt-to-equity ${num(de, 2)}; interest coverage ${num(b.interestCoverage, 1)}× (debt ${b.debtYearAgo ? `${b.debt > b.debtYearAgo ? 'up' : 'down'} from` : ''} ${b.debtYearAgo ? `₹${b.debtYearAgo.toLocaleString('en-IN')} cr a year ago to ` : ''}₹${(b.debt ?? 0).toLocaleString('en-IN')} cr).`,
      analysis: score > 0.1 ? 'Low leverage gives the company resilience in downturns.' : score < -0.1 ? 'High leverage increases risk if earnings or interest rates move unfavourably.' : 'Leverage is moderate.',
      brief: `debt-to-equity is ${num(de, 2)}`, score, evidence: 'high', value: { de }, source: src,
      ifChanges: 'A material change in debt levels or interest costs would change this reading.',
    }));
  }
  const cf = ctx.cashFlow;
  if (cf && !fin) {
    let score = cf.ocfToNetProfit >= 0.9 ? 0.3 : cf.ocfToNetProfit < 0.7 ? -0.3 : 0;
    if (cf.freeCashFlow < 0) score -= 0.25;
    out.push(mk(ctx, {
      id: 'cashflow', category: 'fundamental', label: 'Cash flow quality', term: 'free-cash-flow',
      fact: `Operating cash flow is ${num(cf.ocfToNetProfit, 2)}× net profit; free cash flow ₹${cf.freeCashFlow.toLocaleString('en-IN')} cr (${cf.period.toLowerCase()}).`,
      analysis: score > 0.1 ? 'Profits are backed by cash, a sign of earnings quality.' : score < -0.1 ? 'Cash generation lags reported profit or is consumed by investment; this deserves monitoring.' : 'Cash conversion is acceptable.',
      brief: cf.freeCashFlow < 0 ? 'free cash flow is negative' : 'profits convert to cash', score, evidence: 'medium', value: { ocf: cf.ocfToNetProfit }, source: src,
      ifChanges: 'An improvement or deterioration in working capital or capex would change this reading.',
    }));
  }
  if (t.surprise != null && ctx.daysSinceResults != null && ctx.daysSinceResults < 100) {
    out.push(mk(ctx, {
      id: 'results', category: 'fundamental', label: `Latest results (${t.latestLabel}) vs recent trend`, term: 'earnings-surprise',
      fact: `${t.latestLabel} net profit ₹${t.latest.netProfit.toLocaleString('en-IN')} cr, ${pct(t.surprise)} versus the level implied by the prior quarter and trend growth. Reported ${t.latestReportDate}.`,
      analysis: t.surprise > 0.03 ? 'Results came in ahead of the recent trajectory, which can lead investors to raise expectations.' : t.surprise < -0.03 ? 'Results fell short of the recent trajectory, which can lead investors to lower expectations.' : 'Results were in line with the recent trajectory.',
      brief: t.surprise > 0.03 ? 'latest results beat the trend' : t.surprise < -0.03 ? 'latest results missed the trend' : 'latest results were in line',
      score: clamp(t.surprise / 0.06) * 0.7, evidence: 'medium', value: { surprise: t.surprise }, source: src,
      ifChanges: 'The next quarterly results will update this signal. Note this compares with the company’s own trend, not with analyst estimates.',
    }));
  }
  return out;
}

// ------------------------------------------------------------- valuation
export function valuationSignals(ctx) {
  const out = [];
  const price = ctx.closes.at(-1);
  const fin = ctx.kind === 'financial';
  const st = ctx.sectorStats;
  const peers = st ? st.rows.filter((r) => r.ticker !== ctx.ticker) : [];
  const src = { name: `${ctx.priceSource}; ${ctx.fundamentalsSource}`, asOf: ctx.asOfTs };
  const pe = peAt(price, ctx.quarters);

  if (pe?.loss) {
    out.push(mk(ctx, {
      id: 'valuation', category: 'valuation', label: 'Valuation', term: 'pe-ratio',
      fact: 'Trailing earnings are negative, so P/E is not meaningful.', analysis: 'Loss-making companies are valued on recovery expectations, which adds uncertainty.',
      brief: 'it is loss-making', score: -0.4, evidence: 'medium', source: src, ifChanges: 'A return to profitability would change this.',
    }));
    return out;
  }
  if (fin) {
    const pb = ctx.balance?.netWorth ? (price * ctx.sharesCr) / ctx.balance.netWorth : null;
    const peerPb = peers.map((p) => p.pb).filter(Boolean);
    const med = peerPb.length ? peerPb.sort((a, b) => a - b)[Math.floor(peerPb.length / 2)] : null;
    if (pb && med) {
      const roeAdj = clamp(((ctx.balance.roe ?? 12) - 13) / 10, -0.4, 0.4);
      const ratio = pb / med;
      out.push(mk(ctx, {
        id: 'valuation', category: 'valuation', label: 'Valuation (price-to-book vs peers)', term: 'pb-ratio',
        fact: `Price-to-book ${num(pb, 2)}× vs peer median ${num(med, 2)}× (${peers.length} peers); P/E ${num(pe?.pe, 1)}×.`,
        analysis: ratio > 1.3 ? 'Trades at a premium to peers; this is justified only if returns on equity stay superior.' : ratio < 0.8 ? 'Trades at a discount to peers, which may reflect concerns or an opportunity.' : 'Valued broadly in line with peers.',
        brief: `it trades at ${num(pb, 1)}× book vs ${num(med, 1)}× for peers`,
        score: clamp((1 - ratio) * 1.2) * 0.7 + roeAdj * 0.5, evidence: peers.length >= 2 ? 'medium' : 'low', value: { pb, ratio }, source: src,
        ifChanges: 'A change in relative profitability or a peer re-rating would change this reading.',
      }));
    }
  } else if (pe?.pe) {
    const peerPe = peers.map((p) => p.pe).filter(Boolean).sort((a, b) => a - b);
    const med = peerPe.length ? peerPe[Math.floor(peerPe.length / 2)] : null;
    if (med) {
      const ratio = pe.pe / med;
      const g = ctx.ttm?.npGrowth ?? 0;
      const sg = st.medianNpGrowth ?? 0.1;
      const growthAdj = clamp((g - sg) / 0.12, -0.35, 0.35);
      out.push(mk(ctx, {
        id: 'valuation', category: 'valuation', label: 'Valuation (P/E vs sector peers)', term: 'pe-ratio',
        fact: `Trailing P/E ${num(pe.pe, 1)}× vs peer median ${num(med, 1)}× (${peers.length} peer${peers.length === 1 ? '' : 's'}); net profit growth ${pct(g)} vs sector median ${pct(sg)}.`,
        analysis: ratio > 1.3 ? (g > sg ? 'Premium valuation, partly supported by faster growth; it leaves less room for disappointment.' : 'Premium valuation without superior growth, a risk if sentiment cools.')
          : ratio < 0.8 ? (g < sg ? 'Discount valuation, consistent with slower growth; cheap for a reason is possible.' : 'Discount valuation despite comparable or better growth, which the model reads as positive.') : 'Valuation broadly in line with peers.',
        brief: `the P/E of ${num(pe.pe, 0)}× compares with ${num(med, 0)}× for peers`,
        score: clamp((1 - ratio) * 1.2) * 0.65 + growthAdj, evidence: peers.length >= 2 ? 'medium' : 'low', value: { pe: pe.pe, ratio }, source: src,
        ifChanges: `Earnings growth that ${ratio > 1 ? 'slows' : 'accelerates'} or a re-rating toward the peer median (${num(med, 1)}×) would change this reading.`,
      }));
    }
  }
  if (pe?.pe && ctx.macro.in10y?.length) {
    const y = ctx.macro.in10y.at(-1) / 100;
    const ey = 1 / pe.pe;
    const spread = ey - y;
    out.push(mk(ctx, {
      id: 'earnings-yield', category: 'valuation', label: 'Earnings yield vs bond yield', term: 'earnings-yield', longOnly: true,
      fact: `Earnings yield ${pctAbs(ey)} vs India 10Y government bond yield ${pctAbs(y, 2)} (${ctx.macroSourceLabel}).`,
      analysis: spread > 0 ? 'Equity earnings yield exceeds the risk-free bond yield, which supports valuation.' : 'The bond yield exceeds the earnings yield, so investors are paying up for expected growth.',
      brief: `earnings yield is ${pctAbs(ey)} vs a ${pctAbs(y, 1)} bond yield`,
      score: clamp((spread + 0.03) / 0.05) * 0.4, evidence: 'low', value: { spread }, source: { name: ctx.macroSourceLabel, asOf: ctx.asOfTs },
      ifChanges: 'Higher bond yields or lower earnings would weaken this signal.',
    }));
  }
  return out;
}

// ------------------------------------------------------------------ news
function newsFlow(items, asOfTs, halfLifeDays = 20, windowDays = 45) {
  const t0 = Date.parse(asOfTs);
  let s = 0;
  const used = [];
  for (const it of items) {
    const age = (t0 - Date.parse(it.publishedAt)) / 86400000;
    if (age < 0 || age > windowDays || !it.tone) continue;
    const w = Math.exp(-age / halfLifeDays) * Math.min(1.5, Math.max(0.4, (it.magnitude || 0.02) / 0.03));
    s += it.tone * w;
    used.push({ id: it.id, headline: it.headline, publishedAt: it.publishedAt, tone: it.tone, source: it.source, url: it.url });
  }
  return { score: s, used };
}

export function newsSignals(ctx) {
  const out = [];
  const co = newsFlow(ctx.news.company, ctx.asOfTs);
  const nAll = ctx.news.company.filter((x) => (Date.parse(ctx.asOfTs) - Date.parse(x.publishedAt)) / 86400000 <= 45).length;
  out.push(mk(ctx, {
    id: 'company-news', category: 'news', label: 'Company news flow (45 days)', term: 'news-flow',
    fact: nAll ? `${nAll} company item${nAll === 1 ? '' : 's'} in the last 45 days; ${co.used.length} classified as positive or negative.` : 'No company-specific news in the last 45 days.',
    analysis: co.used.length === 0 ? 'No material company news; the view rests on other signals.' : co.score > 0.3 ? 'Recent company news has been mostly favourable.' : co.score < -0.3 ? 'Recent company news has been mostly unfavourable.' : 'Recent company news is mixed.',
    brief: co.score > 0.3 ? 'recent company news is favourable' : co.score < -0.3 ? 'recent company news is unfavourable' : 'company news is mixed',
    score: clamp(co.score / 1.5) * 0.8, evidence: co.used.length >= 2 ? 'medium' : 'low', evidenceItems: co.used, source: { name: 'News items listed below', asOf: ctx.asOfTs },
    note: 'Positive/negative tone is a model classification of each item, not a fact.',
    ifChanges: 'New material announcements would update this signal.',
  }));
  const se = newsFlow(ctx.news.sector, ctx.asOfTs);
  if (se.used.length) {
    out.push(mk(ctx, {
      id: 'sector-news', category: 'news', label: `${ctx.inst.sector} sector news (45 days)`, term: 'news-flow',
      fact: `${se.used.length} sector-level item${se.used.length === 1 ? '' : 's'} in the last 45 days.`,
      analysis: se.score > 0 ? 'Sector developments have been supportive.' : 'Sector developments have been a headwind.',
      brief: se.score > 0 ? 'sector news is supportive' : 'sector news is a headwind',
      score: clamp(se.score / 1.2) * 0.6, evidence: 'low', evidenceItems: se.used, source: { name: 'News items listed below', asOf: ctx.asOfTs },
      note: 'Tone is a model classification.', ifChanges: 'New sector developments would update this.',
    }));
  }
  return out;
}

// ----------------------------------------------------------------- macro
export function macroFactorMoves(macro, lookback = 21) {
  const ch = (arr, mode) => {
    if (!arr || arr.length <= lookback) return null;
    const a = arr.at(-1);
    const b = arr.at(-1 - lookback);
    return mode === 'pct' ? a / b - 1 : a - b;
  };
  const crude = ch(macro.brent, 'pct');
  const inrMv = ch(macro.usdinr, 'pct');
  const rates = ch(macro.in10y, 'abs');
  const glob = ch(macro.global_eq, 'pct');
  const cpiArr = macro.cpi;
  const infl = cpiArr && cpiArr.length >= 4 ? cpiArr.at(-1) - cpiArr.at(-4) : null;
  return {
    raw: { crude, inr: inrMv, rates, globalRisk: glob, inflation: infl },
    z: {
      crude: crude == null ? 0 : clamp(crude / 0.08, -1.5, 1.5),
      inr: inrMv == null ? 0 : clamp(inrMv / 0.015, -1.5, 1.5),
      rates: rates == null ? 0 : clamp(rates / 0.25, -1.5, 1.5),
      globalRisk: glob == null ? 0 : clamp(-glob / 0.05, -1.5, 1.5),
      inflation: infl == null ? 0 : clamp(infl / 0.5, -1.5, 1.5),
    },
  };
}

export function macroSignals(ctx) {
  const out = [];
  const info = sectorInfo(ctx.inst.sector);
  const mv = macroFactorMoves(ctx.macro);
  let s = 0;
  const parts = [];
  for (const [k, sens] of Object.entries(info.sens)) {
    const contrib = sens * mv.z[k];
    s += contrib;
    if (Math.abs(contrib) >= 0.12) parts.push({ k, contrib });
  }
  parts.sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib));
  const raw = mv.raw;
  const fmt = (k) => ({
    crude: `Brent ${pct(raw.crude)}`, inr: `USD/INR ${pct(raw.inr)}`, rates: `India 10Y ${raw.rates == null ? 'n/a' : `${raw.rates >= 0 ? '+' : ''}${Math.round(raw.rates * 100)} bp`}`,
    globalRisk: `global equities ${pct(raw.globalRisk)}`, inflation: `CPI ${raw.inflation == null ? 'n/a' : `${raw.inflation >= 0 ? '+' : ''}${num(raw.inflation, 2)} pp over 3 prints`}`,
  }[k]);
  out.push(mk(ctx, {
    id: 'macro-exposure', category: 'macro', label: `Macro backdrop for ${ctx.inst.sector}`, term: 'macro-sensitivity',
    fact: `One-month moves: ${['crude', 'inr', 'rates', 'globalRisk'].map(fmt).join('; ')}; ${fmt('inflation')} (${ctx.macroSourceLabel}).`,
    analysis: parts.length ? parts.slice(0, 2).map(({ k, contrib }) => `${FACTORS[k].label.toLowerCase()} is ${contrib > 0 ? 'a tailwind' : 'a headwind'}${info.why[k] ? ` — ${info.why[k].charAt(0).toLowerCase()}${info.why[k].slice(1)}` : '.'}`).join(' Also, ').replace(/^./, (x) => x.toUpperCase())
      : 'Recent macro moves are small relative to this sector’s typical sensitivities.',
    brief: s > 0.15 ? 'the macro backdrop is a tailwind for the sector' : s < -0.15 ? 'the macro backdrop is a headwind for the sector' : 'the macro backdrop is neutral',
    score: clamp(s / 1.2) * 0.7, evidence: 'low', value: { s }, source: { name: ctx.macroSourceLabel, asOf: ctx.asOfTs },
    note: 'Sector sensitivities are model assumptions (see Methodology).',
    ifChanges: 'Reversals in crude, the rupee, bond yields or global risk appetite would change this.',
  }));

  const mk200 = sma(ctx.market, 200).at(-1);
  const mLast = ctx.market.at(-1);
  const v = ctx.macro.india_vol?.at(-1);
  if (mk200) {
    const b = beta(ctx.closes, ctx.market);
    const regime = (mLast > mk200 ? 0.3 : -0.3) + (v != null ? (v > 20 ? -0.2 : v < 14 ? 0.1 : 0) : 0);
    out.push(mk(ctx, {
      id: 'market-regime', category: 'macro', label: 'Broad market regime', term: 'beta',
      fact: `Composite of tracked stocks is ${pctAbs(Math.abs(mLast / mk200 - 1))} ${mLast > mk200 ? 'above' : 'below'} its 200-day average; volatility index ${num(v, 1)}; this stock's beta ${num(b, 2)}.`,
      analysis: `${regime > 0 ? 'A constructive market backdrop' : 'A weaker market backdrop'} matters more for higher-beta stocks; with a beta of ${num(b, 2)}, this stock tends to move ${b > 1.1 ? 'more than' : b < 0.9 ? 'less than' : 'about as much as'} the market.`,
      brief: regime > 0 ? 'the broad market backdrop is constructive' : 'the broad market backdrop is weak',
      score: clamp(regime * clamp(b, 0.5, 1.6)), evidence: 'medium', value: { regime, beta: b }, source: { name: `${ctx.priceSource}; ${ctx.macroSourceLabel}`, asOf: ctx.asOfTs },
      ifChanges: 'A change in market trend or a volatility spike would change this.',
    }));
  }
  return out;
}

// ------------------------------------------------------------- estimates
export function estimateSignals(ctx) {
  const e = ctx.estimates || [];
  if (e.length < 3) return [];
  const price = ctx.closes.at(-1);
  const tgts = e.map((x) => x.targetPrice).sort((a, b) => a - b);
  const med = tgts[Math.floor(tgts.length / 2)];
  const up = med / price - 1;
  return [mk(ctx, {
    id: 'estimates', category: 'estimates', label: 'Published analyst targets', term: 'price-target',
    fact: `${e.length} published targets; median ${inr(med, 0)} (${pct(up)} vs last close); range ${inr(tgts[0], 0)}–${inr(tgts.at(-1), 0)}.`,
    analysis: 'Analyst targets reflect opinions, are often revised after price moves, and have a mixed record. They receive a small weight.',
    brief: `the median published target implies ${pct(up)}`,
    score: clamp(up / 0.2) * 0.6, evidence: 'low', value: { upside: up }, source: { name: 'See analyst disagreement view', asOf: ctx.asOfTs },
    ifChanges: 'Target revisions would update this signal.',
  })];
}

// ------------------------------------------------------------ risk lens
export function riskFactors(ctx) {
  const out = [];
  const c = ctx.closes;
  const vol = annualVol(c, 60);
  const vols = ctx.universeVols || [vol];
  const pctile = vols.filter((v) => v <= vol).length / vols.length;
  out.push({ id: 'volatility', label: 'Price volatility', term: 'volatility', level: pctile > 0.8 ? 3 : pctile > 0.55 ? 2 : 1, fact: `Annualised 60-day volatility ${pctAbs(vol)} (higher than ${Math.round(pctile * 100)}% of tracked stocks).`, value: vol });
  const hi = Math.max(...c.slice(-250));
  const dd = c.at(-1) / hi - 1;
  out.push({ id: 'drawdown', label: 'Distance from 52-week high', term: 'drawdown', level: dd < -0.3 ? 3 : dd < -0.15 ? 2 : 1, fact: `${pctAbs(-dd)} below the 52-week high of ${inr(hi)}; maximum drawdown over the period ${pctAbs(-maxDrawdown(c.slice(-250)))}.`, value: dd });
  const tv = mean(ctx.bars.slice(-20).map((b) => (b.close * b.volume) / 1e7));
  out.push({ id: 'liquidity', label: 'Liquidity', term: 'liquidity', level: tv < 5 ? 3 : tv < 25 ? 2 : 1, fact: `Average daily traded value ₹${num(tv, 1)} crore over 20 sessions${ctx.exchangesNote ? ` (${ctx.exchangesNote})` : ''}.`, value: tv, note: tv < 25 ? 'Lower liquidity can mean wider bid-ask spreads and larger price impact.' : undefined });
  const b = ctx.balance || {};
  if (ctx.kind === 'financial' && ctx.ttm?.latest?.gnpa != null) {
    const g = ctx.ttm.latest.gnpa;
    out.push({ id: 'credit', label: 'Credit risk', term: 'npa', level: g > 4 ? 3 : g > 2.5 ? 2 : 1, fact: `Gross NPA ${num(g, 2)}%.`, value: g });
  } else if (b.debtToEquity != null) {
    out.push({ id: 'leverage', label: 'Leverage', term: 'debt-to-equity', level: b.debtToEquity > 1.5 || (b.interestCoverage ?? 9) < 3 ? 3 : b.debtToEquity > 0.8 ? 2 : 1, fact: `Debt-to-equity ${num(b.debtToEquity, 2)}; interest coverage ${num(b.interestCoverage, 1)}×.`, value: b.debtToEquity });
  }
  const nextEarn = ctx.upcoming.find((e) => e.type === 'earnings');
  if (nextEarn) {
    const days = Math.round((Date.parse(nextEarn.date) - Date.parse(ctx.asOfDate)) / 86400000);
    out.push({ id: 'event', label: 'Upcoming results', term: 'event-risk', level: days <= 14 ? 3 : days <= 35 ? 2 : 1, fact: `Next results ${nextEarn.confirmed ? 'scheduled' : 'expected'} on ${nextEarn.date} (${days} days).`, value: days });
  }
  if (ctx.stress) out.push({ id: 'market-stress', label: 'Market stress', term: 'stress-radar', level: ctx.stress.level >= 2 ? 3 : ctx.stress.level >= 1 ? 2 : 1, fact: `Market stress radar: ${ctx.stress.label}.`, value: ctx.stress.score });
  return out;
}
