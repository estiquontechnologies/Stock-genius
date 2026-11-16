// Builds a self-consistent SIMULATED market: macro series, market/sector/company
// shocks, the news items that "cause" them, prices, fundamentals, a corporate
// calendar and sample analyst estimates. Nothing here is real data.

import { createRng } from '../../lib/random.js';
import {
  weekdaySessions, istTimestamp, addDays, isWeekday, previousWeekday, nextWeekday,
  quarterEndBefore, previousQuarterEnd, fiscalQuarterLabel, daysBetween, parseIsoDate, isoDate,
} from '../../lib/dates.js';
import { SECTORS } from '../../analysis/sectors.js';
import { SAMPLE_COMPANIES } from './universe.js';
import { MARKET_EVENTS, SECTOR_EVENTS, COMPANY_EVENTS, ROUTINE_NEWS } from './templates.js';

const SRC = {
  wire: 'Sample Newswire (simulated)',
  filing: 'Sample Exchange Filing (simulated)',
  macro: 'Sample Macro Desk (simulated)',
  data: 'Sample Market Data (simulated)',
};

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const SQ252 = Math.sqrt(252);

function snapWeekday(iso) {
  return isWeekday(iso) ? iso : nextWeekday(iso);
}

function newsUrl(id) {
  return `#/source/${encodeURIComponent(id)}`;
}

export function buildSampleWorld({ endDate, sessions = 320 }) {
  const dates = weekdaySessions(endDate, sessions);
  const n = dates.length;
  const idxOf = new Map(dates.map((d, i) => [d, i]));
  const news = [];
  const calendar = [];

  // ---------------------------------------------------------------- macro
  const r = createRng('sample-macro-v1');
  const f = {
    global: dates.map(() => r.normal(0.0003, 0.0085)),
    crude: dates.map(() => r.normal(0.0, 0.017)),
    inr: dates.map(() => r.normal(0.00006, 0.0022)),
    in10y: dates.map(() => r.normal(0, 0.022)),
    us10y: dates.map(() => r.normal(0, 0.035)),
    geo: dates.map(() => 0),
    repo: dates.map(() => 0),
    cpi: dates.map(() => 0),
    market: dates.map(() => 0),
  };

  // Place market events: spaced out, plus one forced recent stress event.
  const types = r.shuffle(Object.keys(MARKET_EVENTS));
  const marketEvents = [];
  const used = new Set();
  const recentIdx = n - r.int(4, 12);
  const placed = [{ type: 'geo_tension', idx: recentIdx }];
  let cursor = 45;
  for (const t of types.filter((x) => x !== 'geo_tension')) {
    cursor += r.int(22, 34);
    if (cursor >= n - 15) break;
    placed.push({ type: t, idx: cursor });
  }
  for (const p of placed) {
    used.add(p.idx);
    const tpl = MARKET_EVENTS[p.type];
    const scale = r.range(0.85, 1.25);
    for (const [k, v] of Object.entries(tpl.effects)) f[k][p.idx] += k === 'repo' ? v : v * scale;
    marketEvents.push({ ...p, scale, tpl });
  }

  // Integrate macro levels.
  const level = (start, rets, mode = 'pct') => {
    const out = [];
    let x = start;
    for (let i = 0; i < n; i++) {
      x = mode === 'pct' ? x * (1 + rets[i]) : x + rets[i];
      out.push(x);
    }
    return out;
  };
  const brent = level(78, f.crude);
  const usdinr = level(83.1, f.inr);
  const in10y = level(6.98, f.in10y, 'abs');
  const us10y = level(4.35, f.us10y, 'abs');
  const globalEq = level(1000, f.global);
  const repo = level(6.5, f.repo, 'abs');

  // Geopolitical tension index: mean-reverting with event jumps.
  const geo = [];
  let g = 34;
  for (let i = 0; i < n; i++) {
    g = g + 0.06 * (34 - g) + r.normal(0, 1.2) + f.geo[i];
    geo.push(clamp(g, 5, 95));
  }

  // Market return depends on global, crude, rupee and event shocks.
  const mkt = dates.map((_, i) => 0.00025 + 0.42 * f.global[i] - 0.05 * f.crude[i] - 0.45 * f.inr[i] + r.normal(0, 0.0058) + f.market[i]);

  // Volatility index tracks realised market volatility and tension.
  const vol = [];
  for (let i = 0; i < n; i++) {
    const w = mkt.slice(Math.max(0, i - 19), i + 1);
    const m = w.reduce((a, b) => a + b, 0) / w.length;
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, w.length - 1));
    vol.push(clamp(6 + sd * SQ252 * 100 * 0.75 + (geo[i] - 34) * 0.08 + r.normal(0, 0.4), 9, 40));
  }

  // Monthly CPI prints (published ~12th of following month).
  const cpiSeries = [];
  let cpi = 4.9;
  const firstMonth = parseIsoDate(dates[0]);
  for (let k = 0; k < 16; k++) {
    const d = new Date(Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + k, 12));
    const iso = snapWeekday(isoDate(d));
    if (iso > dates[n - 1]) break;
    const i = idxOf.get(iso);
    cpi = clamp(cpi + r.normal(-0.05, 0.25) + (i != null ? f.cpi[i] : 0), 2, 8);
    cpiSeries.push({ date: iso, value: round(cpi, 2) });
  }

  const macro = {
    india_vol: { name: 'India volatility index', unit: 'pts', values: vol },
    usdinr: { name: 'USD/INR', unit: '₹ per $', values: usdinr },
    brent: { name: 'Brent crude', unit: '$/bbl', values: brent },
    in10y: { name: 'India 10Y government bond yield', unit: '%', values: in10y },
    us10y: { name: 'US 10Y Treasury yield', unit: '%', values: us10y },
    global_eq: { name: 'Global equity index', unit: 'pts', values: globalEq },
    geo: { name: 'Geopolitical tension index', unit: '0–100', values: geo },
    repo: { name: 'Policy repo rate', unit: '%', values: repo },
  };
  const macroOut = {};
  for (const [id, m] of Object.entries(macro)) {
    macroOut[id] = {
      id, name: m.name, unit: m.unit, simulated: true, source: SRC.data,
      series: dates.map((d, i) => ({ date: d, value: round(m.values[i], id === 'usdinr' ? 3 : 2) })),
    };
  }
  macroOut.cpi = { id: 'cpi', name: 'CPI inflation (YoY)', unit: '%', simulated: true, source: SRC.data, frequency: 'monthly', series: cpiSeries };

  // Market-event news (published pre-open on the event day).
  for (const ev of marketEvents) {
    const d = dates[ev.idx];
    const i = ev.idx;
    const facts = [];
    const pct = (a, b) => ((a / b - 1) * 100).toFixed(1);
    if (ev.tpl.effects.crude) facts.push(`Brent crude moved ${pct(brent[i], brent[i - 1])}% to $${brent[i].toFixed(1)}/bbl`);
    if (ev.tpl.effects.inr) facts.push(`USD/INR moved to ${usdinr[i].toFixed(2)} (${pct(usdinr[i], usdinr[i - 1])}%)`);
    if (ev.tpl.effects.in10y) facts.push(`India 10Y yield moved ${((in10y[i] - in10y[i - 1]) * 100).toFixed(0)} bp to ${in10y[i].toFixed(2)}%`);
    if (ev.tpl.effects.repo) facts.push(`Policy repo rate now ${repo[i].toFixed(2)}%`);
    if (ev.tpl.effects.global) facts.push(`Global equity index moved ${pct(globalEq[i], globalEq[i - 1])}%`);
    if (ev.tpl.effects.geo) facts.push(`Geopolitical tension index rose to ${geo[i].toFixed(0)}`);
    if (ev.tpl.effects.cpi) facts.push(`Headline CPI inflation printed lower than the prior month`);
    const id = `mkt-${ev.type}-${d}`;
    news.push({
      id, scope: 'market', tickers: [], sector: null, category: ev.tpl.category, kind: ev.type,
      headline: ev.tpl.headline, facts, tone: ev.tpl.tone, magnitude: Math.abs(ev.tpl.effects.market || 0) * ev.scale,
      source: SRC.macro, url: newsUrl(id), publishedAt: istTimestamp(d, '08:40'), sample: true,
    });
  }

  // ------------------------------------------------------------ sectors
  const z = {
    crude: f.crude.map((x) => x / 0.017),
    inr: f.inr.map((x) => x / 0.0022),
    rates: f.in10y.map((x) => x / 0.022),
    globalRisk: f.global.map((x) => -x / 0.0085),
    inflation: dates.map(() => 0),
  };
  const sectorRet = {};
  const sectorEventIdx = {};
  for (const [sector, info] of Object.entries(SECTORS)) {
    const rs = createRng(`sample-sector-${sector}`);
    const arr = dates.map((_, i) => {
      let s = 0;
      for (const [k, v] of Object.entries(info.sens)) s += v * (z[k] ? z[k][i] : 0);
      return 0.0035 * s + rs.normal(0, 0.0042);
    });
    const ev = SECTOR_EVENTS[sector];
    if (ev) {
      let idx = rs.int(40, n - 8);
      while (used.has(idx)) idx += 1;
      arr[idx] += ev.tone * ev.mag * rs.range(0.9, 1.2);
      sectorEventIdx[sector] = idx;
      const d = dates[idx];
      const id = `sec-${sector.replace(/\W+/g, '').toLowerCase()}-${d}`;
      news.push({
        id, scope: 'sector', tickers: [], sector, category: ev.category, kind: 'sector_event',
        headline: ev.headline, facts: [`Development reported as affecting the ${sector} sector broadly`],
        tone: ev.tone, magnitude: ev.mag, source: SRC.wire, url: newsUrl(id), publishedAt: istTimestamp(d, '09:05'), sample: true,
      });
    }
    sectorRet[sector] = arr;
  }

  // ----------------------------------------------------------- companies
  const companies = {};
  const lastDate = dates[n - 1];
  for (const c of SAMPLE_COMPANIES) {
    const rc = createRng(`sample-co-${c.ticker}`);
    const isFin = SECTORS[c.sector]?.kind === 'financial';
    const shocks = dates.map(() => 0);
    const volBoost = dates.map(() => 1);

    // Result calendar with a realistic 25–50 day lag after quarter end.
    let lag = rc.int(25, 48);
    let qe0 = quarterEndBefore(lastDate, lag);
    let report0 = snapWeekday(addDays(qe0, lag));
    if (report0 >= lastDate) {
      qe0 = previousQuarterEnd(qe0);
      report0 = snapWeekday(addDays(qe0, lag));
    }
    const quarterEnds = [qe0];
    for (let k = 1; k < 8; k++) quarterEnds.push(previousQuarterEnd(quarterEnds[k - 1]));
    quarterEnds.reverse(); // oldest first, index 7 = latest
    const reportDates = quarterEnds.map((qe, k) => snapWeekday(addDays(qe, lag + (k === 7 ? 0 : rc.int(-3, 3)))));

    // Quarterly shape (relative units) and surprises.
    const g4 = (1 + c.growth) ** 0.25 - 1;
    const surpriseBias = c.drift > 0.05 ? 0.015 : c.drift < -0.05 ? -0.02 : 0;
    const rev = [];
    const margin = [];
    const np = [];
    for (let k = 0; k < 8; k++) {
      const prev = k === 0 ? 100 : rev[k - 1];
      const extra = k >= 5 ? surpriseBias : 0;
      rev.push(prev * (1 + g4 + extra + rc.normal(0, 0.018)));
      margin.push(c.margin + (c.marginTrend / 100) * (k / 7) + rc.normal(0, 0.004));
    }
    for (let k = 0; k < 8; k++) np.push(rev[k] * c.netMargin * (margin[k] / c.margin) * (1 + rc.normal(0, 0.03)));
    const surprise = np.map((x, k) => (k === 0 ? 0 : x / (np[k - 1] * (1 + g4)) - 1));

    // Earnings reactions: results filed after the close, reaction next session.
    const resultIdx = {};
    for (let k = 0; k < 8; k++) {
      const i = idxOf.get(reportDates[k]);
      if (i == null || i + 1 >= n) continue;
      resultIdx[k] = i;
      shocks[i + 1] += clamp(surprise[k] * 1.1, -0.085, 0.085) + rc.normal(0, 0.008);
      volBoost[i + 1] = 2.6;
    }

    // Company-specific events.
    const eligible = COMPANY_EVENTS.filter((e) => !e.sectors || e.sectors.includes(c.sector));
    const posBias = c.drift > 0 ? 0.65 : 0.35;
    const companyEvents = [];
    const nEvents = rc.int(1, 3);
    for (let e = 0; e < nEvents; e++) {
      const wantPos = rc.next() < posBias;
      const pool = eligible.filter((x) => (x.tone > 0) === wantPos);
      if (!pool.length) continue;
      const tpl = rc.pick(pool);
      let idx = rc.int(30, n - 2);
      const nearResult = Object.values(resultIdx).some((ri) => Math.abs(ri - idx) < 4);
      if (nearResult || used.has(idx)) idx = Math.min(n - 2, idx + 5);
      const mag = rc.range(tpl.mag[0], tpl.mag[1]);
      shocks[idx] += tpl.tone * mag;
      volBoost[idx] = 3;
      companyEvents.push({ idx, tpl, mag, facts: tpl.facts(rc, c) });
    }
    // An unexplained large move (no news) for realism.
    if (rc.next() < 0.6) {
      const idx = rc.int(60, n - 3);
      shocks[idx] += (rc.next() < 0.5 ? -1 : 1) * rc.range(0.03, 0.045);
      volBoost[idx] = 2;
    }

    // Prices.
    const dailyIdio = c.idio / SQ252;
    const drag = 0.5 * ((c.beta * 0.0095) ** 2 + 0.0045 ** 2 + dailyIdio ** 2);
    const sRet = sectorRet[c.sector];
    const bars = [];
    let close = c.start;
    const exchangeTurnover = c.exchanges.includes('NSE') ? rc.range(0.0022, 0.004) : rc.range(0.0006, 0.0011);
    for (let i = 0; i < n; i++) {
      const ret = i === 0 ? 0 : c.beta * mkt[i] + sRet[i] + rc.normal(0, dailyIdio) + (0.7 * c.drift) / 252 - drag + shocks[i];
      const prev = close;
      close = prev * Math.exp(ret);
      const gap = shocks[i] !== 0 ? shocks[i] * 0.7 : rc.normal(0, dailyIdio * 0.35);
      const open = prev * Math.exp(gap);
      const span = Math.abs(rc.normal(0, dailyIdio * 0.55)) + Math.abs(ret) * 0.15;
      const high = Math.max(open, close) * (1 + span);
      const low = Math.min(open, close) * (1 - Math.abs(rc.normal(0, dailyIdio * 0.55)) - Math.abs(ret) * 0.1);
      const sharesTraded = (c.shares * 1e7 * exchangeTurnover) * Math.exp(rc.normal(0, 0.28)) * (1 + 1.4 * Math.abs(ret) / (dailyIdio + 0.006)) * volBoost[i] * 0.55;
      bars.push({ date: dates[i], open: round(open), high: round(high), low: round(low), close: round(close), volume: Math.round(sharesTraded) });
    }
    const lastPrice = bars[n - 1].close;

    // Scale fundamentals so that trailing P/E at the latest close ≈ c.pe.
    const epsTtm = lastPrice / c.pe;
    const npTtmCr = epsTtm * c.shares; // ₹ crore (shares in crore)
    const scale = npTtmCr / (np[4] + np[5] + np[6] + np[7]);
    const roe = clamp((isFin ? 0.11 : 0.12) + c.drift * 0.25 + rc.normal(0, 0.02), 0.05, 0.32);
    const quarters = quarterEnds.map((qe, k) => {
      const revenue = (rev[k] * scale) / c.netMargin;
      const netProfit = np[k] * scale;
      const q = {
        quarterEnd: qe, label: fiscalQuarterLabel(qe), reportDate: reportDates[k],
        revenue: round(revenue, 1), operatingProfit: round(revenue * margin[k], 1),
        operatingMargin: round(margin[k] * 100, 2), netProfit: round(netProfit, 1),
        eps: round(netProfit / c.shares, 2),
      };
      if (isFin) {
        const trend = c.drift > 0 ? -0.06 : 0.12;
        q.gnpa = round(clamp(c.gnpa + (k - 7) * -trend + rc.normal(0, 0.05), 0.4, 12), 2);
        q.nim = round(c.nim + (c.marginTrend / 100) * ((k - 7) / 7) * 10 + rc.normal(0, 0.04), 2);
      }
      return q;
    });
    const equity = npTtmCr / roe;
    const yearAgoFactor = 1 - (c.growth * 0.5);
    const balance = isFin
      ? { netWorth: round(equity, 0), capitalAdequacy: round(clamp(16 + c.drift * 10 + rc.normal(0, 0.8), 11, 22), 1), roe: round(roe * 100, 1), roa: round((roe / 10) * 100, 2) }
      : (() => {
        const debt = (c.de ?? 0.3) * equity;
        const revTtm = quarters.slice(4).reduce((a, q) => a + q.revenue, 0);
        const ebitdaTtm = quarters.slice(4).reduce((a, q) => a + q.operatingProfit, 0);
        const ebit = ebitdaTtm - revTtm * 0.04;
        const interest = Math.max(1, debt * 0.085);
        return {
          equity: round(equity, 0), debt: round(debt, 0), debtYearAgo: round(debt * (c.de > 1 ? 0.9 : yearAgoFactor + 0.2), 0),
          cash: round(equity * rc.range(0.05, 0.3), 0), debtToEquity: round(c.de ?? 0.3, 2),
          interestCoverage: round(ebit / interest, 1), roe: round(roe * 100, 1),
        };
      })();
    const ocfTtm = npTtmCr * c.ocf;
    const capexRatio = c.ticker === 'SUNRYGRN' ? 1.6 : rc.range(0.3, 0.85);
    const cashFlow = { operatingCashFlow: round(ocfTtm, 0), capex: round(ocfTtm * capexRatio, 0), freeCashFlow: round(ocfTtm * (1 - capexRatio), 0), ocfToNetProfit: round(c.ocf, 2), period: 'Trailing four quarters' };
    const payout = isFin ? 0.2 : rc.range(0.1, 0.45);
    const fundamentals = {
      kind: isFin ? 'financial' : 'operating', sharesCr: c.shares, quarters, balance, cashFlow,
      dividendPerShare: round(epsTtm * payout, 1), source: SRC.filing, simulated: true,
    };

    // Company news.
    const name = c.name;
    for (let k = 0; k < 8; k++) {
      if (resultIdx[k] == null) continue;
      const q = quarters[k];
      const yoy = k >= 4 ? quarters[k - 4] : null;
      const facts = [
        `${isFin ? 'Total income' : 'Revenue'} ₹${q.revenue.toLocaleString('en-IN')} crore${yoy ? `, ${((q.revenue / yoy.revenue - 1) * 100).toFixed(1)}% year on year` : ''}`,
        `Net profit ₹${q.netProfit.toLocaleString('en-IN')} crore${yoy ? `, ${((q.netProfit / yoy.netProfit - 1) * 100).toFixed(1)}% year on year` : ''}`,
        isFin ? `Gross NPA ${q.gnpa}% and net interest margin ${q.nim}%` : `Operating margin ${q.operatingMargin}%${yoy ? ` versus ${yoy.operatingMargin}% a year earlier` : ''}`,
      ];
      const id = `res-${c.ticker}-${q.label.replace(/\s/g, '')}`;
      news.push({
        id, scope: 'company', tickers: [c.ticker], sector: c.sector, category: 'earnings', kind: 'results',
        headline: `${name} reports ${q.label} results`, facts,
        tone: surprise[k] > 0.015 ? 1 : surprise[k] < -0.015 ? -1 : 0, magnitude: Math.abs(surprise[k]),
        surprisePct: round(surprise[k] * 100, 1), source: SRC.filing, url: newsUrl(id),
        publishedAt: istTimestamp(reportDates[k], '16:45'), sample: true,
      });
      // Board-meeting intimation ~8 days before.
      const bm = previousWeekday(addDays(reportDates[k], -7));
      if (idxOf.has(bm)) {
        const bid = `bm-${c.ticker}-${q.label.replace(/\s/g, '')}`;
        news.push({
          id: bid, scope: 'company', tickers: [c.ticker], sector: c.sector, category: 'corporate filing', kind: 'board_meeting',
          headline: `${name} schedules board meeting to consider ${q.label} results`, facts: [`Board meeting date: ${reportDates[k]}`],
          tone: 0, magnitude: 0, source: SRC.filing, url: newsUrl(bid), publishedAt: istTimestamp(bm, '18:10'), sample: true,
        });
      }
    }
    for (const ev of companyEvents) {
      const d = dates[ev.idx];
      const id = `co-${c.ticker}-${ev.tpl.kind}-${d}`;
      news.push({
        id, scope: 'company', tickers: [c.ticker], sector: c.sector, category: ev.tpl.kind.replace('_', ' '), kind: ev.tpl.kind,
        headline: ev.tpl.headline(name), facts: ev.facts, tone: ev.tpl.tone, magnitude: ev.mag,
        source: ev.tpl.kind === 'block_deal' ? SRC.data : SRC.filing, url: newsUrl(id), publishedAt: istTimestamp(d, '09:02'), sample: true,
      });
    }
    for (let j = 0; j < 2; j++) {
      const tpl = rc.pick(ROUTINE_NEWS);
      const idx = rc.int(20, n - 1);
      const d = dates[idx];
      const id = `rt-${c.ticker}-${tpl.kind}-${d}`;
      if (news.some((x) => x.id === id)) continue;
      news.push({
        id, scope: 'company', tickers: [c.ticker], sector: c.sector, category: 'corporate filing', kind: tpl.kind,
        headline: tpl.headline(name), facts: tpl.facts(rc), tone: 0, magnitude: 0, source: SRC.filing,
        url: newsUrl(id), publishedAt: istTimestamp(d, '17:30'), sample: true,
      });
    }

    // Upcoming corporate calendar.
    const nextQe = (() => {
      const d = parseIsoDate(quarterEnds[7]);
      const m = d.getUTCMonth() + 1;
      const y = d.getUTCFullYear();
      const map = { 3: [y, 6, 30], 6: [y, 9, 30], 9: [y, 12, 31], 12: [y + 1, 3, 31] };
      const [yy, mm, dd] = map[m];
      return isoDate(new Date(Date.UTC(yy, mm - 1, dd)));
    })();
    const nextResult = snapWeekday(addDays(nextQe, lag));
    calendar.push({ id: `cal-res-${c.ticker}-${nextResult}`, date: nextResult, type: 'earnings', title: `${name}: ${fiscalQuarterLabel(nextQe)} results (expected)`, tickers: [c.ticker], sector: c.sector, confirmed: false, note: 'Expected date based on the company’s usual reporting lag; not yet announced.', sample: true, source: SRC.filing });
    if (rc.next() < 0.35) {
      const ex = snapWeekday(addDays(lastDate, rc.int(5, 40)));
      const dps = round(Math.max(1, epsTtm * payout * 0.5), 1);
      calendar.push({ id: `cal-div-${c.ticker}-${ex}`, date: ex, type: 'dividend', title: `${name}: ex-dividend date (₹${dps} per share)`, tickers: [c.ticker], sector: c.sector, confirmed: true, note: 'Shares bought on or after the ex-date do not receive this dividend.', sample: true, source: SRC.filing });
    }
    companies[c.ticker] = { profile: c, bars, fundamentals, isFin };
  }

  // A few distinct corporate actions.
  const ca = [
    ['CYPHRDGT', 'split', 'Stock split (face value ₹10 to ₹2) — record date', 18],
    ['MRGLDCON', 'bonus', 'Bonus issue (1:1) — record date', 26],
    ['QLSTNINF', 'buyback', 'Buyback tender offer opens', 12],
    ['AURLEDGR', 'agm', 'Annual general meeting', 33],
  ];
  for (const [t, type, title, off] of ca) {
    const d = snapWeekday(addDays(lastDate, off));
    calendar.push({ id: `cal-${type}-${t}-${d}`, date: d, type: 'corporate action', subtype: type, title: `${companies[t].profile.name}: ${title}`, tickers: [t], sector: companies[t].profile.sector, confirmed: true, sample: true, source: SRC.filing });
  }

  // Macro / policy calendar (illustrative sample dates).
  const macroCal = [
    ['policy', 'Monetary policy committee decision', 9, ['Banks', 'Realty', 'Automobiles', 'Power & Utilities']],
    ['data', 'CPI inflation release (monthly)', 4, ['FMCG', 'Banks']],
    ['data', 'GDP growth estimate (quarterly)', 21, ['Capital Goods', 'Cement', 'Banks']],
    ['global', 'US Federal Reserve policy decision', 15, ['IT Services', 'Pharma', 'Banks']],
    ['data', 'Monthly vehicle sales data', 2, ['Automobiles']],
    ['global', 'OPEC+ production meeting', 27, ['Oil & Gas', 'Chemicals', 'FMCG']],
    ['data', 'Industrial production (IIP) release', 30, ['Capital Goods', 'Metals & Mining']],
  ];
  for (const [kind, title, off, sectors] of macroCal) {
    const d = snapWeekday(addDays(lastDate, off));
    calendar.push({ id: `cal-macro-${kind}-${d}-${off}`, date: d, type: 'macro', subtype: kind, title, tickers: [], sectors, confirmed: false, note: 'Illustrative sample date — check the official schedule.', sample: true, source: SRC.macro });
  }

  // Sample analyst estimates for ~60% of companies.
  const estimates = {};
  const brokers = ['Sample Broker A', 'Sample Broker B', 'Sample Broker C', 'Sample Broker D', 'Sample Broker E', 'Sample Broker F'];
  const bullPts = ['Expects market-share gains to continue', 'Sees margin expansion from operating leverage', 'Views valuation as reasonable relative to growth', 'Expects new capacity to drive volume growth', 'Highlights balance-sheet strength'];
  const bearPts = ['Sees limited upside after the recent rally', 'Concerned about slowing demand in the core segment', 'Flags rising competition and pricing pressure', 'Expects input-cost inflation to weigh on margins', 'Highlights high leverage and refinancing needs'];
  for (const c of SAMPLE_COMPANIES) {
    const re = createRng(`sample-est-${c.ticker}`);
    if (re.next() > 0.62) continue;
    const price = companies[c.ticker].bars[n - 1].close;
    const eps = price / c.pe;
    const bias = c.drift * 0.5 + 0.06;
    const list = [];
    for (const b of re.shuffle(brokers).slice(0, re.int(3, 6))) {
      const upside = re.normal(bias, 0.11);
      const rating = upside > 0.1 ? 'Buy' : upside < -0.04 ? 'Sell' : 'Hold';
      const pub = previousWeekday(addDays(lastDate, -re.int(3, 70)));
      list.push({
        broker: b, rating, targetPrice: round(price * (1 + upside), 0), epsNextFy: round(eps * (1 + c.growth + re.normal(0, 0.05)), 1),
        publishedAt: istTimestamp(pub, '11:00'), keyPoint: upside > 0.05 ? re.pick(bullPts) : re.pick(bearPts), sample: true,
      });
    }
    estimates[c.ticker] = list;
  }

  return { dates, macro: macroOut, news, calendar, companies, estimates, marketEvents, sectorEventIdx, generatedFor: lastDate };
}

export { SRC };
export { daysBetween };
