// JSON API routes.

import { getShared, latestRecommendation, recommendationHistory, deriveAlerts, stockResearch, stressAt, breadthAt, buildContext } from './services/research.js';
import { HORIZONS, MODEL_VERSION, CATEGORY_WEIGHTS, THRESHOLDS, EVIDENCE_WEIGHT } from './analysis/recommend.js';
import { analysePortfolio } from './analysis/portfolio.js';
import { sma, rsi, pctChange, annualVol } from './analysis/indicators.js';
import { evaluateAssumption, THESIS_METRICS } from './services/thesis.js';
import { GLOSSARY } from './content/glossary.js';
import { parseCsv } from './lib/csv.js';
import { lastCompletedSession, previousWeekday, addDays, daysBetween } from './lib/dates.js';
import { SECTORS, SECTOR_ALIASES, FACTORS } from './analysis/sectors.js';

const MAX_BODY = 200 * 1024;
const TICKER_RE = /^[A-Z0-9&\-_.]{1,20}$/;

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

function send(res, status, body) {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(s);
}

async function readBody(req) {
  if (Number(req.headers['content-length'] || 0) > MAX_BODY) {
    req.resume();
    throw new HttpError(413, 'Request body too large');
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooBig = false;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { tooBig = true; chunks.length = 0; return; }
      if (!tooBig) chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return reject(new HttpError(413, 'Request body too large'));
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const str = (v, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const horizonOf = (q) => (HORIZONS[q] ? q : 'medium');
const ticker = (t) => {
  const v = String(t || '').toUpperCase();
  if (!TICKER_RE.test(v)) throw new HttpError(400, 'Invalid ticker');
  return v;
};

export function createApi({ provider, store, collector, ads }) {
  const routes = [];
  const on = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    routes.push({ method, re, keys, handler });
  };

  async function sharedReady() {
    const sh = await getShared(provider);
    if (sh.u.empty) {
      const m = await provider.describe();
      throw new HttpError(503, m.setupMessage || 'Data is not available yet.', { code: 'not_ready', collector: collector?.info() });
    }
    return sh;
  }

  async function dataMeta() {
    const m = await provider.describe();
    let stale = false;
    let staleReason = null;
    if (m.asOf) {
      const latest = m.asOf.slice(0, 10);
      const expected = lastCompletedSession();
      const holidays = new Set(collector ? collector.readJson('holidays.json', []) : []);
      let missed = 0;
      for (let d = expected; d > latest && missed < 30; d = previousWeekday(d)) if (!holidays.has(d)) missed++;
      // Allow one session of publication lag for end-of-day files.
      if (missed > 1) { stale = true; staleReason = `Latest data is from ${latest}; ${missed} more recent session(s) are missing.`; }
    }
    return { ...m, stale, staleReason };
  }

  async function recRow(sh, t, horizon) {
    const r = await latestRecommendation(provider, sh, t, horizon);
    const rec = r.rec;
    const u = sh.u.byTicker[t];
    store.logRecommendation({ ticker: t, horizon, view: rec.view, confidence: rec.confidence, confidenceBand: rec.confidenceBand, riskLevel: rec.riskLevel, score: rec.score, asOfDate: rec.asOfDate, modelVersion: MODEL_VERSION });
    const c = u.aligned;
    return {
      ticker: t, name: u.inst.name, sector: u.inst.sector, exchanges: u.inst.exchanges,
      price: u.quote?.price ?? c.at(-1), changePct: u.quote?.changePct ?? ((c.at(-1) / c.at(-2) - 1) * 100), freshness: u.quote?.freshness, asOf: u.quote?.asOf,
      ret1m: pctChange(c, 21), view: rec.view, confidence: rec.confidence, confidenceBand: rec.confidenceBand, riskLevel: rec.riskLevel, score: rec.score,
      spark: c.slice(-60),
    };
  }

  // ------------------------------------------------------------ meta
  on('GET', '/api/meta', async () => ({
    data: await dataMeta(), modelVersion: MODEL_VERSION, horizons: HORIZONS,
    ads: { enabled: ads.enabled, client: ads.enabled ? ads.client : null, slots: ads.enabled ? ads.slots : {} },
    collector: collector?.info() || null,
  }));

  on('GET', '/api/methodology', async () => ({
    modelVersion: MODEL_VERSION, categoryWeights: CATEGORY_WEIGHTS, thresholds: THRESHOLDS, evidenceWeights: EVIDENCE_WEIGHT, horizons: HORIZONS,
    sectorAssumptions: SECTORS, sectorAliases: SECTOR_ALIASES, factors: FACTORS,
  }));

  on('GET', '/api/glossary', async () => GLOSSARY);

  // -------------------------------------------------------- overview
  on('GET', '/api/overview', async (q) => {
    const sh = await sharedReady();
    const h = horizonOf(q.get('horizon'));
    const rows = [];
    for (const t of Object.keys(sh.u.byTicker)) rows.push(await recRow(sh, t, h));
    const idx = sh.u.dates.length - 1;
    const indices = ['NSE', 'BSE', 'ALL'].map((k) => sh.u.indices[k]).filter((x) => x?.series).map((ix) => {
      const v = ix.series.map((p) => p.value);
      return { id: ix.id, name: ix.name, computed: ix.computed !== false, source: ix.source || null, last: v.at(-1), change1d: v.at(-1) / v.at(-2) - 1, change1m: pctChange(v, 21), change1y: pctChange(v, Math.min(250, v.length - 1)), spark: v.slice(-120), asOf: sh.u.dates.at(-1) };
    });
    const breadth = breadthAt(sh, idx);
    const stress = stressAt(sh, idx);
    const sorted = [...rows].sort((a, b) => b.changePct - a.changePct);
    const counts = { Buy: 0, Hold: 0, Sell: 0 };
    for (const r of rows) counts[r.view]++;
    return {
      horizon: h, asOfDate: sh.u.dates.at(-1), data: await dataMeta(), indices,
      breadth: { market: breadth.market, sectors: breadth.sectors },
      stress: { label: stress.label, level: stress.level, score: stress.score, narrative: stress.narrative, gauges: stress.gauges.map(({ spark, ...g }) => g) },
      gainers: sorted.slice(0, 5), losers: sorted.slice(-5).reverse(), views: counts,
      news: sh.news.market.slice(0, 6), stocks: rows,
    };
  });

  on('GET', '/api/stocks', async (q) => {
    const sh = await sharedReady();
    const h = horizonOf(q.get('horizon'));
    const term = str(q.get('q'), 60).toLowerCase();
    const ex = str(q.get('exchange'), 5).toUpperCase();
    const sector = str(q.get('sector'), 80);
    const view = str(q.get('view'), 5);
    const list = sh.u.instruments.filter((i) => (!term || i.ticker.toLowerCase().includes(term) || i.name.toLowerCase().includes(term))
      && (!ex || i.exchanges.includes(ex)) && (!sector || i.sector === sector));
    const rows = [];
    for (const i of list) rows.push(await recRow(sh, i.ticker, h));
    return { horizon: h, sectors: sh.u.sectors, results: rows.filter((r) => !view || r.view === view) };
  });

  on('GET', '/api/stocks/:t', async (q, p) => {
    const t = ticker(p.t);
    const h = horizonOf(q.get('horizon'));
    await sharedReady();
    const r = await stockResearch(provider, t, h);
    if (!r) throw new HttpError(404, `No data for ${t}`);
    store.logRecommendation({ ticker: t, horizon: h, view: r.recommendation.view, confidence: r.recommendation.confidence, confidenceBand: r.recommendation.confidenceBand, riskLevel: r.recommendation.riskLevel, score: r.recommendation.score, asOfDate: r.recommendation.asOfDate, modelVersion: MODEL_VERSION });
    r.data = await dataMeta();
    r.following = store.listFollows().find((f) => f.ticker === t) || null;
    r.serverLog = store.recommendationLog(t).filter((x) => x.horizon === h).slice(-20);
    return r;
  });

  on('GET', '/api/stocks/:t/chart', async (q, p) => {
    const t = ticker(p.t);
    const sh = await sharedReady();
    const u = sh.u.byTicker[t];
    if (!u) throw new HttpError(404, 'Unknown ticker');
    const range = Math.min(Number(q.get('sessions')) || 250, u.bars.length);
    const closes = u.bars.map((b) => b.close);
    const s50 = sma(closes, 50);
    const s200 = sma(closes, 200);
    const r14 = rsi(closes, 14);
    const start = u.bars.length - range;
    return {
      ticker: t, source: u.quote?.source, freshness: u.quote?.freshness,
      bars: u.bars.slice(start).map((b, i) => ({ ...b, sma50: s50[start + i], sma200: s200[start + i], rsi: r14[start + i] })),
    };
  });

  // ----------------------------------------------------------- radar
  on('GET', '/api/radar', async () => {
    const sh = await sharedReady();
    const idx = sh.u.dates.length - 1;
    const s = stressAt(sh, idx);
    const prev = stressAt(sh, Math.max(0, idx - 21));
    const macroSources = Object.fromEntries(Object.entries(sh.macro).map(([k, m]) => [k, { name: m.name, source: m.source, sourceUrl: m.sourceUrl || null, simulated: !!m.simulated, last: m.series.at(-1) }]));
    return { ...s, previous: { label: prev.label, score: prev.score, date: sh.u.dates[Math.max(0, idx - 21)] }, asOfDate: sh.u.dates[idx], macroSources, news: sh.news.market.slice(0, 8), data: await dataMeta() };
  });

  on('GET', '/api/breadth', async () => {
    const sh = await sharedReady();
    const b = breadthAt(sh, sh.u.dates.length - 1);
    const hist = [];
    for (let k = 60; k >= 0; k -= 5) {
      const i = sh.u.dates.length - 1 - k;
      if (i < 210) continue;
      const m = breadthAt(sh, i).market;
      hist.push({ date: sh.u.dates[i], pctAbove50: m.pctAbove50, ret1mEqual: m.ret1mEqual, ret1mCap: m.ret1mCap });
    }
    return { ...b, history: hist, data: await dataMeta() };
  });

  // -------------------------------------------------------- calendar
  on('GET', '/api/calendar', async (q) => {
    const sh = await sharedReady();
    const days = Math.min(Number(q.get('days')) || 60, 120);
    const from = sh.u.dates.at(-1);
    const to = addDays(from, days);
    const watched = new Set(store.listWatchlists().flatMap((w) => w.tickers));
    for (const f of store.listFollows()) watched.add(f.ticker);
    const events = [];
    for (const e of sh.calendar) if (e.date > from && e.date <= to) events.push({ ...e });
    // Add earnings derived from fundamentals reporting cadence when no calendar entry exists.
    for (const [t, u] of Object.entries(sh.u.byTicker)) {
      if (events.some((e) => e.type === 'earnings' && e.tickers?.includes(t))) continue;
      const qs = u.fundamentals?.quarters;
      if (!qs?.length) continue;
      const est = addDays(qs.at(-1).reportDate, 91);
      if (est > from && est <= to) events.push({ id: `derived-${t}-${est}`, date: est, type: 'earnings', title: `${u.inst.name}: results (estimated from reporting pattern)`, tickers: [t], sector: u.inst.sector, confirmed: false, note: 'Estimated as about 91 days after the last results; not announced.' });
    }
    for (const e of events) {
      const direct = (e.tickers || []).filter((t) => watched.has(t));
      const viaSector = [...watched].filter((t) => !direct.includes(t) && sh.u.byTicker[t] && (e.sectors || []).includes(sh.u.byTicker[t].inst.sector));
      e.watchedDirect = direct;
      e.watchedViaSector = viaSector;
      e.daysAway = daysBetween(from, e.date);
    }
    events.sort((a, b) => (a.date < b.date ? -1 : 1));
    const scope = q.get('scope');
    return {
      from, to, watchedCount: watched.size, data: await dataMeta(),
      events: scope === 'watched' ? events.filter((e) => e.watchedDirect.length || e.watchedViaSector.length) : events,
      note: sh.calendar.length ? null : 'No event calendar is available from the connected free sources. Corporate-action and results calendars are planned for version 2.',
    };
  });

  // ---------------------------------------------------------- compare
  on('GET', '/api/compare', async (q) => {
    const sh = await sharedReady();
    const h = horizonOf(q.get('horizon'));
    const list = str(q.get('tickers'), 200).split(',').map((x) => x.trim().toUpperCase()).filter(Boolean).slice(0, 4);
    const out = [];
    for (const t of list) {
      if (!sh.u.byTicker[t]) continue;
      const { rec, ctx } = await latestRecommendation(provider, sh, t, h);
      const c = ctx.closes;
      const pe = rec.signals.find((s) => s.id === 'valuation')?.value?.pe ?? null;
      out.push({
        ticker: t, name: ctx.inst.name, sector: ctx.inst.sector, price: c.at(-1), view: rec.view, confidence: rec.confidence, confidenceBand: rec.confidenceBand, riskLevel: rec.riskLevel, score: rec.score,
        ret1m: pctChange(c, 21), ret3m: pctChange(c, 63), ret1y: pctChange(c, Math.min(250, c.length - 1)), vol: annualVol(c, 60),
        pe, revGrowth: ctx.ttm?.revGrowth ?? null, npGrowth: ctx.ttm?.npGrowth ?? null, roe: ctx.balance?.roe ?? null, de: ctx.balance?.debtToEquity ?? null,
        categories: rec.categories, topPositive: rec.topPositive, topNegative: rec.topNegative,
        series: c.slice(-250).map((v, i, a) => v / a[0] * 100), dates: sh.u.dates.slice(-250),
      });
    }
    return { horizon: h, items: out };
  });

  // ---------------------------------------------------------- sources
  on('GET', '/api/sources/:id', async (q, p) => {
    const item = await provider.getSourceItem(decodeURIComponent(p.id));
    if (!item) throw new HttpError(404, 'Source item not found');
    return { item, data: await dataMeta() };
  });

  // ------------------------------------------------- follows & alerts
  on('GET', '/api/follows', async () => store.listFollows());
  on('POST', '/api/follows', async (q, p, body) => {
    const t = ticker(body.ticker);
    const sh = await sharedReady();
    if (!sh.u.byTicker[t]) throw new HttpError(404, 'Unknown ticker');
    const types = Array.isArray(body.types) ? body.types.filter((x) => ['view', 'confidence', 'risk', 'signal'].includes(x)) : undefined;
    return store.follow(t, { horizon: horizonOf(body.horizon), types });
  });
  on('DELETE', '/api/follows/:t', async (q, p) => { store.unfollow(ticker(p.t)); return { ok: true }; });

  on('GET', '/api/alerts', async () => {
    const follows = store.listFollows();
    if (!follows.length) return { alerts: [], follows: [] };
    const sh = await sharedReady();
    const read = new Set(store.data.readAlerts);
    const cutoff = addDays(sh.u.dates.at(-1), -90);
    const alerts = [];
    for (const f of follows) {
      const u = sh.u.byTicker[f.ticker];
      if (!u) continue;
      const hist = await recommendationHistory(provider, sh, f.ticker);
      for (const a of deriveAlerts(f.ticker, u.inst.name, hist, f.horizon)) if (f.types.includes(a.type) && a.date >= cutoff) alerts.push({ ...a, read: read.has(a.id) });
    }
    alerts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return { alerts, follows, note: 'Alerts compare the model’s point-in-time views at five-session checkpoints, so they also cover changes before you followed a stock.' };
  });
  on('POST', '/api/alerts/read', async (q, p, body) => {
    const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === 'string').slice(0, 500) : [];
    store.markRead(ids);
    return { ok: true };
  });

  // ------------------------------------------------------- watchlists
  on('GET', '/api/watchlists', async () => store.listWatchlists());
  on('POST', '/api/watchlists', async (q, p, body) => {
    const name = str(body.name, 60);
    if (!name) throw new HttpError(400, 'Name required');
    return store.createWatchlist(name);
  });
  on('PUT', '/api/watchlists/:id', async (q, p, body) => {
    const tickers = Array.isArray(body.tickers) ? body.tickers.map(ticker).slice(0, 200) : undefined;
    const w = store.updateWatchlist(p.id, { name: body.name != null ? str(body.name, 60) : undefined, tickers });
    if (!w) throw new HttpError(404, 'Watchlist not found');
    return w;
  });
  on('DELETE', '/api/watchlists/:id', async (q, p) => ({ ok: store.deleteWatchlist(p.id) }));

  // ----------------------------------------------------------- theses
  on('GET', '/api/thesis-metrics', async () => Object.fromEntries(Object.entries(THESIS_METRICS).map(([k, v]) => [k, { label: v.label, unit: v.unit }])));
  on('GET', '/api/theses', async () => store.listTheses());
  on('POST', '/api/theses', async (q, p, body) => {
    const t = ticker(body.ticker);
    const sh = await sharedReady();
    if (!sh.u.byTicker[t]) throw new HttpError(404, 'Unknown ticker');
    const h = horizonOf(body.horizon);
    const { rec, ctx } = await latestRecommendation(provider, sh, t, h);
    const assumptions = (Array.isArray(body.assumptions) ? body.assumptions : []).slice(0, 12).map((a) => cleanAssumption(a, store));
    return store.createThesis({
      ticker: t, horizon: h, title: str(body.title, 120) || `${t} thesis`, text: str(body.text, 4000), assumptions,
      atCreation: { price: ctx.closes.at(-1), date: ctx.asOfDate, view: rec.view, confidence: rec.confidence },
    });
  });
  on('PUT', '/api/theses/:id', async (q, p, body) => {
    const patch = {};
    if (body.title != null) patch.title = str(body.title, 120);
    if (body.text != null) patch.text = str(body.text, 4000);
    if (Array.isArray(body.assumptions)) patch.assumptions = body.assumptions.slice(0, 12).map((a) => cleanAssumption(a, store));
    const t = store.updateThesis(p.id, patch);
    if (!t) throw new HttpError(404, 'Thesis not found');
    return t;
  });
  on('DELETE', '/api/theses/:id', async (q, p) => { store.deleteThesis(p.id); return { ok: true }; });
  on('GET', '/api/theses/:id/review', async (q, p) => {
    const th = store.getThesis(p.id);
    if (!th) throw new HttpError(404, 'Thesis not found');
    const sh = await sharedReady();
    if (!sh.u.byTicker[th.ticker]) throw new HttpError(404, 'Ticker no longer covered');
    const { rec, ctx } = await latestRecommendation(provider, sh, th.ticker, th.horizon);
    const assumptions = th.assumptions.map((a) => evaluateAssumption(a, ctx));
    const since = th.atCreation?.date || th.createdAt.slice(0, 10);
    const hist = (await recommendationHistory(provider, sh, th.ticker))[th.horizon].filter((x) => x.date >= since);
    const viewChanges = hist.filter((x, i) => i > 0 && x.view !== hist[i - 1].view).map((x) => ({ date: x.date, view: x.view }));
    const newsSince = ctx.news.company.filter((n) => n.publishedAt.slice(0, 10) >= since).slice(0, 10);
    const resultsSince = ctx.quarters.filter((x) => x.reportDate >= since);
    const counts = { holds: 0, 'at-risk': 0, broken: 0, other: 0 };
    for (const a of assumptions) counts[counts[a.status] != null ? a.status : 'other']++;
    return {
      thesis: th, assumptions, counts,
      now: { price: ctx.closes.at(-1), date: ctx.asOfDate, view: rec.view, confidence: rec.confidence, riskLevel: rec.riskLevel },
      priceChange: th.atCreation?.price ? ctx.closes.at(-1) / th.atCreation.price - 1 : null,
      viewChanges, newsSince, resultsSince: resultsSince.map((x) => ({ label: x.label, reportDate: x.reportDate, revenue: x.revenue, netProfit: x.netProfit })),
    };
  });

  // ---------------------------------------------------------- journal
  on('GET', '/api/journal', async () => {
    const list = store.listJournal();
    let sh = null;
    try { sh = await getShared(provider); } catch { /* data unavailable */ }
    const out = [];
    for (const j of list) {
      let now = null;
      if (sh && !sh.u.empty && j.ticker && sh.u.byTicker[j.ticker]) {
        const { rec, ctx } = await latestRecommendation(provider, sh, j.ticker, j.snapshot?.horizon || 'medium');
        now = { price: ctx.closes.at(-1), date: ctx.asOfDate, view: rec.view, confidence: rec.confidence, riskLevel: rec.riskLevel };
      }
      out.push({ ...j, now, priceChange: now && j.snapshot?.price ? now.price / j.snapshot.price - 1 : null });
    }
    return out;
  });
  on('POST', '/api/journal', async (q, p, body) => {
    const note = str(body.note, 4000);
    const t = body.ticker ? ticker(body.ticker) : null;
    if (!note && !t) throw new HttpError(400, 'A note or ticker is required');
    let snapshot = null;
    if (t) {
      const sh = await sharedReady();
      if (!sh.u.byTicker[t]) throw new HttpError(404, 'Unknown ticker');
      const h = horizonOf(body.horizon);
      const { rec, ctx } = await latestRecommendation(provider, sh, t, h);
      snapshot = {
        horizon: h, view: rec.view, confidence: rec.confidence, confidenceBand: rec.confidenceBand, riskLevel: rec.riskLevel, score: rec.score,
        price: ctx.closes.at(-1), asOfDate: ctx.asOfDate, summary: rec.summary, modelVersion: MODEL_VERSION,
        topPositive: rec.topPositive.map((s) => s.label), topNegative: rec.topNegative.map((s) => s.label), simulated: rec.simulated,
      };
    }
    return store.addJournal({ ticker: t, note, title: str(body.title, 120), snapshot });
  });
  on('DELETE', '/api/journal/:id', async (q, p) => { store.deleteJournal(p.id); return { ok: true }; });

  // -------------------------------------------------------- portfolio
  on('GET', '/api/portfolio', async () => {
    const pf = store.getPortfolio();
    if (!pf.holdings.length) return { holdings: [], analysis: null };
    const sh = await sharedReady();
    return { holdings: pf.holdings, updatedAt: pf.updatedAt, analysis: analysePortfolio(sh.u, pf.holdings) };
  });
  on('PUT', '/api/portfolio', async (q, p, body) => {
    const holdings = cleanHoldings(body.holdings);
    store.setPortfolio(holdings);
    return { ok: true, holdings };
  });
  on('POST', '/api/portfolio/import', async (q, p, body) => {
    const rows = parseCsv(str(body.csv, 100000));
    const holdings = [];
    for (const r of rows) {
      const [t, qty] = r.map((x) => x.trim());
      if (!t || /ticker|symbol/i.test(t)) continue;
      holdings.push({ ticker: t.toUpperCase(), quantity: Number(qty) });
    }
    const clean = cleanHoldings(holdings);
    store.setPortfolio(clean);
    return { ok: true, holdings: clean, skipped: holdings.length - clean.length };
  });

  on('GET', '/api/recommendation-log', async (q) => store.recommendationLog(q.get('ticker') ? ticker(q.get('ticker')) : null).slice(-500));

  on('GET', '/api/health', async () => ({ ok: true, provider: provider.id, collector: collector?.info() || null }));

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    try {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = url.pathname.match(r.re);
        if (!m) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : null;
        return send(res, 200, await r.handler(url.searchParams, params, body || {}));
      }
      send(res, 404, { error: 'not_found', message: 'Unknown API route' });
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.extra?.code || 'error', message: e.message, ...e.extra });
      console.error(e);
      send(res, 500, { error: 'server_error', message: 'Something went wrong while preparing this data.' });
    }
  };
}

function cleanAssumption(a, store) {
  const metric = THESIS_METRICS[a?.metric] ? a.metric : null;
  return {
    id: typeof a?.id === 'string' && a.id.length < 60 ? a.id : store.id(),
    text: str(a?.text, 300),
    metric, op: a?.op === '<=' ? '<=' : '>=',
    threshold: metric ? Number(a.threshold) || 0 : null,
    manualStatus: ['holds', 'at-risk', 'broken', 'unclear'].includes(a?.manualStatus) ? a.manualStatus : null,
  };
}

function cleanHoldings(list) {
  if (!Array.isArray(list)) return [];
  const merged = new Map();
  for (const h of list.slice(0, 300)) {
    const t = String(h?.ticker || '').toUpperCase();
    const qty = Number(h?.quantity);
    if (!TICKER_RE.test(t) || !Number.isFinite(qty) || qty <= 0) continue;
    merged.set(t, (merged.get(t) || 0) + qty);
  }
  return [...merged].map(([ticker, quantity]) => ({ ticker, quantity }));
}
