// "auto" provider: end-of-day data gathered automatically by the collector
// from free, publicly published exchange files, plus free macro (FRED) and
// free news (RSS). Real data, END-OF-DAY only (not live, not delayed).
// No fundamentals or analyst estimates are available from these free
// sources, so those signals are shown as missing (version 2: paid feeds).

import fs from 'node:fs';
import path from 'node:path';
import { FredMacro } from './free/fred.js';
import { RssNews } from './free/rss.js';
import { SOURCES } from '../collector/sources.js';
import { instrumentKey } from '../collector/upstox.js';

const MIN_BARS = 220;

export class AutoEodProvider {
  constructor({ dir, collector, fredApiKey, rssFeeds = [], upstox = null }) {
    this.upstox = upstox;
    this.live = { at: 0, prices: {} };
    this.id = 'auto';
    this.dir = dir;
    this.collector = collector;
    this.fred = new FredMacro(fredApiKey);
    this.rss = new RssNews([SOURCES.announcementsRss.url(), ...rssFeeds]);
    this.cacheKey = null;
    this.data = null;
  }

  load() {
    const daysDir = path.join(this.dir, 'days');
    const files = fs.existsSync(daysDir) ? fs.readdirSync(daysDir).filter((f) => f.endsWith('.json')).sort() : [];
    const upDir = path.join(this.dir, 'upstox');
    const upFiles = fs.existsSync(upDir) ? fs.readdirSync(upDir).filter((f) => f.endsWith('.json')) : [];
    const upStamp = upFiles.length ? Math.max(...upFiles.map((f) => fs.statSync(path.join(upDir, f)).mtimeMs)) : 0;
    const key = `${files.length}:${files.at(-1) || ''}:${upFiles.length}:${upStamp}`;
    if (this.cacheKey === key) return this.data;
    const uni = this.collector?.universe() || null;
    const list = uni?.list || [];
    const bars = {};
    const bseIsins = new Set();
    const indices = {};
    const sources = {};
    for (const f of files) {
      let day;
      try { day = JSON.parse(fs.readFileSync(path.join(daysDir, f), 'utf8')); } catch { continue; }
      sources[day.date] = day.sources;
      for (const [sym, v] of Object.entries(day.nse || {})) {
        (bars[sym] ||= []).push({ date: day.date, open: v[0] ?? v[3], high: v[1] ?? v[3], low: v[2] ?? v[3], close: v[3], volume: v[4] || 0 });
      }
      for (const isin of Object.keys(day.bse || {})) bseIsins.add(isin);
      for (const [name, v] of Object.entries(day.indices || {})) (indices[name] ||= []).push({ date: day.date, value: v[3], pe: v[4], pb: v[5] });
    }
    // Upstox candle files take precedence over exchange-file bars.
    const priceSource = {};
    for (const f of upFiles) {
      let j;
      try { j = JSON.parse(fs.readFileSync(path.join(upDir, f), 'utf8')); } catch { continue; }
      const name = f.slice(0, -5);
      if (!j?.bars?.length) continue;
      if (name.startsWith('INDEX_')) {
        const ixName = name.slice(6).replace(/_/g, ' ');
        indices[ixName] = j.bars.map((b) => ({ date: b.date, value: b.close }));
        priceSource[`index:${ixName}`] = 'Upstox historical candle API';
      } else {
        bars[name] = j.bars;
        priceSource[name] = 'Upstox historical candle API';
      }
    }
    const instruments = [];
    const skipped = [];
    for (const c of list) {
      const b = bars[c.symbol];
      if (!b || b.length < MIN_BARS) { skipped.push(c.symbol); continue; }
      instruments.push({ ticker: c.symbol, name: c.name, exchanges: bseIsins.has(c.isin) ? ['NSE', 'BSE'] : ['NSE'], sector: c.industry || 'Unclassified', isin: c.isin, currency: 'INR', simulated: false });
    }
    this.data = { files, instruments, bars, indices, skipped, sources, priceSource, universeSource: uni?.source, universeFetchedAt: uni?.fetchedAt };
    this.cacheKey = key;
    return this.data;
  }

  async describe() {
    const d = this.load();
    const lastBar = Object.values(d.bars).map((b) => b.at(-1)?.date).filter(Boolean).sort().at(-1);
    const last = lastBar || d.files.at(-1)?.slice(0, 10) || null;
    const ready = d.instruments.length > 0;
    return {
      id: this.id, version: this.cacheKey, name: d.priceSource && Object.keys(d.priceSource).length ? 'Upstox daily candles + exchange files (free, collected automatically)' : 'Exchange end-of-day files (free, collected automatically)', dataMode: 'eod', simulated: false, delayMinutes: null,
      asOf: last ? `${last}T15:30:00+05:30` : null, ready,
      setupMessage: ready ? null : `Collecting data automatically (${Object.keys(d.bars).length} instruments so far). At least ${MIN_BARS} sessions of history per stock are needed for analysis; the first backfill can take 10–60 minutes depending on the source.`,
      sessionsStored: d.files.length, instrumentsSkipped: d.skipped.length, liveQuotes: !!this.upstox?.token,
      licenseNote: 'End-of-day prices from files published by NSE and BSE, downloaded automatically once per day. Exchange terms restrict automated access and redistribution; public display requires a data licence (planned for version 2).',
      collector: this.collector?.info(), macroErrors: this.fred.errors, newsErrors: this.rss.errors,
      coverage: { options: 'NSE F&O bhavcopy, end-of-day', prices: 'eod', fundamentals: 'not available (version 2)', estimates: 'not available (version 2)', calendar: 'not available from free sources (version 2)', macro: this.fred.enabled ? 'FRED + India VIX' : 'India VIX only (add a free FRED_API_KEY for more)', news: 'RSS headlines (tone not classified)' },
    };
  }

  async listInstruments() { return this.load().instruments; }

  async getBars(ticker) { return this.load().bars[ticker] || null; }

  async getQuote(ticker) {
    const d = this.load();
    const b = d.bars[ticker];
    if (!b || b.length < 2) return null;
    const last = b.at(-1);
    const prev = b.at(-2);
    const eodQuote = {
      ticker, price: last.close, previousClose: prev.close, change: +(last.close - prev.close).toFixed(2), changePct: +((last.close / prev.close - 1) * 100).toFixed(2),
      currency: 'INR', asOf: `${last.date}T15:30:00+05:30`, freshness: 'eod', simulated: false, exchange: 'NSE',
      source: d.priceSource[ticker] ? 'Upstox daily candles (NSE)' : 'NSE end-of-day bhavcopy', sourceUrl: d.priceSource[ticker] ? null : d.sources[last.date]?.nse || null,
    };
    const live = await this.liveQuotes();
    const inst = d.instruments.find((i) => i.ticker === ticker);
    const lp = inst && live?.prices[instrumentKey('NSE', inst.isin)];
    if (lp) {
      return { ...eodQuote, price: lp, previousClose: last.close, change: +(lp - last.close).toFixed(2), changePct: +((lp / last.close - 1) * 100).toFixed(2), asOf: new Date(live.at).toISOString(), freshness: 'live', source: 'Upstox market quote (your account)', eodClose: last.close };
    }
    return eodQuote;
  }

  /** Live LTPs via the user's Upstox token, refreshed at most once a minute. */
  async liveQuotes() {
    if (!this.upstox?.token) return null;
    if (Date.now() - this.live.at < 60000) return this.live;
    if (this._liveP) return this._liveP;
    this._liveP = (async () => {
      try {
        const keys = this.load().instruments.map((i) => instrumentKey('NSE', i.isin));
        const prices = await this.upstox.ltp(keys);
        this.live = { at: Date.now(), prices: Object.fromEntries(Object.entries(prices || {}).map(([k, v]) => [k.replace(':', '|'), v])) };
      } catch (e) {
        this.live = { at: Date.now(), prices: {}, error: e.message };
      } finally { this._liveP = null; }
      return this.live;
    })();
    return this._liveP;
  }

  // ------------------------------------------------------------ options
  latestFo() {
    const foDir = path.join(this.dir, 'fo');
    const files = fs.existsSync(foDir) ? fs.readdirSync(foDir).filter((f) => f.endsWith('.json')).sort() : [];
    if (!files.length) return null;
    const f = files.at(-1);
    if (this._fo?.file === f) return this._fo.data;
    const data = JSON.parse(fs.readFileSync(path.join(foDir, f), 'utf8'));
    this._fo = { file: f, data };
    return data;
  }

  optionMeta(sym, u, fo) {
    const inst = this.load().instruments.find((i) => i.ticker === sym);
    const INDEX_NAMES = { NIFTY: 'Nifty 50', BANKNIFTY: 'Nifty Bank', FINNIFTY: 'Nifty Financial Services', MIDCPNIFTY: 'Nifty Midcap Select', NIFTYNXT50: 'Nifty Next 50' };
    return {
      symbol: sym, name: inst?.name || INDEX_NAMES[sym] || sym, kind: u.kind, ticker: inst ? sym : null, lotSize: u.lotSize, spot: u.spot,
      asOf: fo.date, expiries: u.expiries, source: 'NSE F&O bhavcopy (end-of-day)', sourceUrl: fo.source, freshness: 'eod', simulated: false,
    };
  }

  async getOptionUnderlyings() {
    const fo = this.latestFo();
    if (!fo) return [];
    return Object.entries(fo.underlyings).map(([sym, u]) => this.optionMeta(sym, u, fo));
  }

  async getOptionChain(symbol) {
    const fo = this.latestFo();
    const u = fo?.underlyings[symbol];
    if (!u) return null;
    const summary = this.collector?.foSummary().bySymbol[symbol] || [];
    const bars = this.load().bars[symbol];
    let rv = null;
    if (bars?.length > 21) {
      const rs = bars.slice(-21).map((b, i, a) => (i ? Math.log(b.close / a[i - 1].close) : null)).filter((x) => x != null);
      const m = rs.reduce((a, b) => a + b, 0) / rs.length;
      rv = Math.sqrt(rs.reduce((a, b) => a + (b - m) ** 2, 0) / (rs.length - 1)) * Math.sqrt(252);
    }
    return { ...this.optionMeta(symbol, u, fo), rows: u.rows.map((r) => ({ ...r, lotSize: u.lotSize })), history: summary, realisedVol20: rv, nextEarnings: null };
  }

  async getFundamentals() { return null; }
  async getEstimates() { return null; }

  async getIndices() {
    const d = this.load();
    const pick = (names) => names.find((n) => d.indices[n]?.length);
    const nse = pick(['Nifty 50', 'NIFTY 50']);
    const sensex = pick(['SENSEX']);
    const broad = pick(['Nifty 500', 'NIFTY 500']);
    return {
      NSE: nse ? { id: 'NSE', name: `${nse} (NSE)`, series: d.indices[nse], source: 'NSE all-indices daily close file' } : null,
      ALL: broad ? { id: 'ALL', name: `${broad} (NSE)`, series: d.indices[broad], source: 'NSE all-indices daily close file' } : null,
      BSE: sensex ? { id: 'BSE', name: 'SENSEX (BSE)', series: d.indices[sensex], source: 'Upstox historical candle API' } : null,
    };
  }

  async getNews() {
    try { return await this.rss.load(this.load().instruments); } catch { return []; }
  }

  async getCalendar() { return []; }

  async getMacro() {
    const d = this.load();
    const start = d.files[0]?.slice(0, 10) || '2024-01-01';
    let fred = {};
    try { fred = await this.fred.load(start); } catch { fred = {}; }
    const out = { ...fred };
    const vix = d.indices['India VIX'];
    if (vix?.length) out.india_vol = { id: 'india_vol', name: 'India VIX', unit: 'pts', simulated: false, source: 'NSE all-indices daily close file', series: vix.map((x) => ({ date: x.date, value: x.value })) };
    return out;
  }

  async getSourceItem(id) {
    const news = await this.getNews();
    return news.find((x) => x.id === id) || null;
  }
}
