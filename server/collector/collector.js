// Automated daily collector for free exchange files.
//
// • Runs once at startup (backfilling missing sessions) and then daily at
//   COLLECT_TIME_IST (default 19:15 IST, after exchanges publish files).
// • Polite by design: one request at a time, REQUEST_DELAY_MS between
//   requests, a descriptive User-Agent, no page crawling.
// • Stores compact per-day JSON under data/market/.

import fs from 'node:fs';
import path from 'node:path';
import { SOURCES, bhavcopyText, parseUdiffBhavcopy, parseIndexClose, parseConstituents } from './sources.js';
import { lastCompletedSession, previousWeekday, nowInIst, isoDate } from '../lib/dates.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Collector {
  constructor({ dir, backfillSessions = 300, delayMs = 2500, userAgent, collectTimeIst = '19:15', fetchImpl = globalThis.fetch, log = console, upstox = null } = {}) {
    this.upstox = upstox;
    this.dir = dir;
    this.daysDir = path.join(dir, 'days');
    this.backfillSessions = backfillSessions;
    this.delayMs = delayMs;
    this.userAgent = userAgent || 'Mozilla/5.0 (compatible; stock-genius/0.1; personal research; once-daily download)';
    this.collectTimeIst = collectTimeIst;
    this.fetch = fetchImpl;
    this.log = log;
    this.running = false;
    this.timer = null;
    fs.mkdirSync(this.daysDir, { recursive: true });
    this.status = this.readJson('status.json', { lastRunStarted: null, lastRunFinished: null, latestSession: null, errors: [], sessionsStored: 0, notPublished: [] });
    this.holidays = new Set(this.readJson('holidays.json', []));
  }

  readJson(name, fallback) {
    try { return JSON.parse(fs.readFileSync(path.join(this.dir, name), 'utf8')); } catch { return fallback; }
  }

  writeJson(name, value) {
    const f = path.join(this.dir, name);
    fs.writeFileSync(`${f}.tmp`, JSON.stringify(value));
    fs.renameSync(`${f}.tmp`, f);
  }

  async get(url) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const ctl = AbortSignal.timeout(30000);
        const res = await this.fetch(url, { headers: { 'User-Agent': this.userAgent, Accept: '*/*' }, signal: ctl });
        if (res.status === 404) return { notFound: true };
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        // Some servers return an HTML error page with 200.
        if (/^\s*<(!doctype|html)/i.test(buf.subarray(0, 64).toString('utf8'))) return { notFound: true, html: true };
        return { buf };
      } catch (e) {
        if (attempt === 2) throw e;
        await sleep(this.delayMs * (attempt + 2));
      }
    }
    return null;
  }

  dayFile(date) {
    return path.join(this.daysDir, `${date}.json`);
  }

  hasDay(date) {
    return fs.existsSync(this.dayFile(date));
  }

  universe() {
    return this.readJson('universe.json', null);
  }

  async refreshUniverse(force = false) {
    const u = this.universe();
    if (!force && u && Date.now() - Date.parse(u.fetchedAt) < 7 * 86400000) return u;
    const r = await this.get(SOURCES.universe.url());
    if (!r?.buf) throw new Error('Universe list not available');
    const list = parseConstituents(r.buf.toString('utf8'));
    const out = { fetchedAt: new Date().toISOString(), source: SOURCES.universe.url(), list };
    this.writeJson('universe.json', out);
    this.log.info?.(`[collector] universe: ${list.length} constituents`);
    return out;
  }

  /** Download and store one session. Returns 'stored' | 'holiday' | 'pending'. */
  async collectDay(date, isins) {
    const nse = await this.get(SOURCES.nseBhavcopy.url(date));
    await sleep(this.delayMs);
    if (nse?.notFound) {
      const ageDays = (Date.parse(lastCompletedSession()) - Date.parse(date)) / 86400000;
      if (ageDays >= 4) { this.holidays.add(date); return 'holiday'; }
      return 'pending';
    }
    const day = { date, collectedAt: new Date().toISOString(), nse: {}, bse: {}, indices: {}, sources: {} };
    const n = parseUdiffBhavcopy(bhavcopyText(nse.buf), 'NSE');
    for (const r of n.rows) if (!isins || isins.has(r.isin)) day.nse[r.symbol] = [r.open, r.high, r.low, r.close, r.volume, r.isin];
    day.sources.nse = SOURCES.nseBhavcopy.url(date);

    const bse = await this.get(SOURCES.bseBhavcopy.url(date));
    await sleep(this.delayMs);
    if (bse?.buf) {
      try {
        const b = parseUdiffBhavcopy(bhavcopyText(bse.buf), 'BSE');
        for (const r of b.rows) if (!isins || isins.has(r.isin)) day.bse[r.isin] = [r.open, r.high, r.low, r.close, r.volume, r.code, r.symbol];
        day.sources.bse = SOURCES.bseBhavcopy.url(date);
      } catch (e) { this.note(`BSE ${date}: ${e.message}`); }
    }
    const idx = await this.get(SOURCES.nseIndices.url(date));
    await sleep(this.delayMs);
    if (idx?.buf) {
      try {
        const p = parseIndexClose(idx.buf.toString('utf8'));
        for (const [k, v] of Object.entries(p.indices)) day.indices[k] = [v.open, v.high, v.low, v.close, v.pe, v.pb, v.divYield];
        day.sources.indices = SOURCES.nseIndices.url(date);
      } catch (e) { this.note(`Indices ${date}: ${e.message}`); }
    }
    fs.writeFileSync(this.dayFile(date), JSON.stringify(day));
    return 'stored';
  }

  note(msg) {
    this.log.warn?.(`[collector] ${msg}`);
    this.status.errors = [{ at: new Date().toISOString(), msg }, ...this.status.errors].slice(0, 50);
  }

  async run() {
    if (this.running) return;
    this.running = true;
    this.status.lastRunStarted = new Date().toISOString();
    this.status.notPublished = [];
    try {
      let isins = null;
      try {
        const u = await this.refreshUniverse();
        if (process.env.STORE_ALL_SYMBOLS !== 'true') isins = new Set(u.list.map((x) => x.isin));
      } catch (e) {
        this.note(`Universe: ${e.message}`);
        if (!this.universe()) throw new Error('Cannot continue without a universe list');
      }
      // Primary source: Upstox candles. Fall back to exchange files if it fails.
      if (this.upstox) {
        const ratio = await this.upstox.run(this.universe().list);
        this.status.upstox = this.upstox.stats;
        if (ratio >= 0.8) {
          this.status.priceSource = 'upstox';
          this.log.info?.(`[collector] Upstox update ok (${this.upstox.stats.ok} instruments)`);
          return;
        }
        this.note(`Upstox success ${(ratio * 100).toFixed(0)}% (${this.upstox.stats.lastError || 'unknown error'}); falling back to exchange files`);
      }
      this.status.priceSource = 'exchange-files';
      let d = lastCompletedSession();
      let stored = 0;
      for (let k = 0; k < this.backfillSessions; k++, d = previousWeekday(d)) {
        if (this.hasDay(d) || this.holidays.has(d)) continue;
        try {
          const r = await this.collectDay(d, isins);
          if (r === 'stored') stored++;
          if (r === 'pending') this.status.notPublished.push(d);
        } catch (e) {
          this.note(`${d}: ${e.message}`);
          await sleep(this.delayMs * 2);
        }
        if (stored && stored % 20 === 0) this.saveStatus();
      }
      this.log.info?.(`[collector] run complete, ${stored} new session(s)`);
    } catch (e) {
      this.note(e.message);
    } finally {
      this.running = false;
      this.status.lastRunFinished = new Date().toISOString();
      this.saveStatus();
    }
  }

  saveStatus() {
    const days = fs.readdirSync(this.daysDir).filter((f) => f.endsWith('.json')).sort();
    this.status.sessionsStored = days.length;
    this.status.latestSession = days.length ? days.at(-1).slice(0, 10) : null;
    this.writeJson('status.json', this.status);
    this.writeJson('holidays.json', [...this.holidays].sort());
  }

  msUntilNextRun(now = new Date()) {
    const [hh, mm] = this.collectTimeIst.split(':').map(Number);
    const ist = nowInIst(now);
    const target = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), hh, mm));
    let ms = target - ist;
    if (ms <= 0) ms += 86400000;
    return ms;
  }

  start({ runNow = true } = {}) {
    if (runNow) this.run();
    const schedule = () => {
      const ms = this.msUntilNextRun();
      this.status.nextRunAt = new Date(Date.now() + ms).toISOString();
      this.timer = setTimeout(async () => { await this.run(); schedule(); }, ms);
      this.timer.unref?.();
    };
    schedule();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
  }

  info() {
    return { ...this.status, running: this.running, holidaysKnown: this.holidays.size, today: isoDate(nowInIst()) };
  }
}
