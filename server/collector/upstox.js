// Upstox market-data adapter (free tier).
//   • Historical daily candles:  GET /v2/historical-candle/{instrument_key}/day/{to}/{from}
//     (public endpoint; a token is sent if configured)
//   • Live last traded price:    GET /v2/market-quote/ltp?instrument_key=...
//     (requires an access token from YOUR Upstox account; tokens expire daily)
// Docs: https://upstox.com/developer/api-documentation/
// Upstox terms restrict data to personal use by account holders; public
// redistribution needs a licence (version 2). The token stays server-side.

import fs from 'node:fs';
import path from 'node:path';
import { addDays, lastCompletedSession } from '../lib/dates.js';

const BASE = process.env.UPSTOX_BASE_URL || 'https://api.upstox.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const UPSTOX_INDICES = {
  'Nifty 50': 'NSE_INDEX|Nifty 50',
  'Nifty 500': 'NSE_INDEX|Nifty 500',
  'India VIX': 'NSE_INDEX|India VIX',
  SENSEX: 'BSE_INDEX|SENSEX',
};

export const instrumentKey = (exchange, isin) => `${exchange}_EQ|${isin}`;

/** Convert Upstox candles ([ts, o, h, l, c, v, oi], newest first) to bars. */
export function candlesToBars(candles) {
  return (candles || [])
    .map((c) => ({ date: String(c[0]).slice(0, 10), open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] || 0 }))
    .filter((b) => Number.isFinite(b.close) && b.close > 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export class UpstoxClient {
  constructor({ token = process.env.UPSTOX_ACCESS_TOKEN || '', fetchImpl = globalThis.fetch, delayMs = 250 } = {}) {
    this.token = token;
    this.fetch = fetchImpl;
    this.delayMs = delayMs;
    this.lastError = null;
  }

  headers() {
    const h = { Accept: 'application/json' };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  async getJson(url) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await this.fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(20000) });
      if (res.status === 429) { await sleep(1500 * (attempt + 1)); continue; }
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.status === 'error') {
        const msg = body?.errors?.[0]?.message || `HTTP ${res.status}`;
        const err = new Error(msg);
        err.status = res.status;
        throw err;
      }
      return body;
    }
    throw new Error('Rate limited by Upstox');
  }

  async dailyCandles(key, from, to) {
    const url = `${BASE}/v2/historical-candle/${encodeURIComponent(key)}/day/${to}/${from}`;
    const j = await this.getJson(url);
    return candlesToBars(j?.data?.candles);
  }

  /** Live LTP for up to ~500 keys per call (token required). */
  async ltp(keys) {
    if (!this.token) return null;
    const out = {};
    for (let i = 0; i < keys.length; i += 400) {
      const chunk = keys.slice(i, i + 400);
      const j = await this.getJson(`${BASE}/v2/market-quote/ltp?instrument_key=${chunk.map(encodeURIComponent).join(',')}`);
      for (const v of Object.values(j.data || {})) if (v?.instrument_token) out[v.instrument_token] = v.last_price;
      await sleep(this.delayMs);
    }
    return out;
  }
}

/**
 * Keeps per-instrument candle files up to date under data/market/upstox/.
 * Backfill ~15 months on first run; afterwards fetch the last 10 days daily.
 */
export class UpstoxCollector {
  constructor({ dir, client, log = console, historyDays = 460 }) {
    this.dir = path.join(dir, 'upstox');
    this.client = client;
    this.log = log;
    this.historyDays = historyDays;
    fs.mkdirSync(this.dir, { recursive: true });
    this.stats = { ok: 0, failed: 0, lastError: null };
  }

  file(name) {
    return path.join(this.dir, `${name.replace(/[^A-Za-z0-9&_-]/g, '_')}.json`);
  }

  read(name) {
    try { return JSON.parse(fs.readFileSync(this.file(name), 'utf8')); } catch { return null; }
  }

  async update(name, key) {
    const to = lastCompletedSession();
    const existing = this.read(name);
    const have = existing?.bars?.length ? existing.bars.at(-1).date : null;
    if (have === to) return 'current';
    const from = have ? addDays(have, -10) : addDays(to, -this.historyDays);
    let bars = [];
    // Request in ≤ 200-day windows to stay within per-request range limits.
    for (let start = from; start <= to; start = addDays(start, 201)) {
      const end = addDays(start, 200) < to ? addDays(start, 200) : to;
      bars = bars.concat(await this.client.dailyCandles(key, start, end));
      await sleep(this.client.delayMs);
    }
    const merged = new Map((existing?.bars || []).map((b) => [b.date, b]));
    for (const b of bars) merged.set(b.date, b);
    const out = { key, updatedAt: new Date().toISOString(), source: 'Upstox historical candle API', bars: [...merged.values()].sort((a, b) => (a.date < b.date ? -1 : 1)) };
    fs.writeFileSync(this.file(name), JSON.stringify(out));
    return 'updated';
  }

  /** Update all instruments; returns success ratio so callers can fall back. */
  async run(universe) {
    this.stats = { ok: 0, failed: 0, lastError: null, startedAt: new Date().toISOString() };
    const jobs = [
      ...Object.entries(UPSTOX_INDICES).map(([name, key]) => ({ name: `INDEX_${name}`, key })),
      ...universe.map((c) => ({ name: c.symbol, key: instrumentKey('NSE', c.isin) })),
    ];
    let consecutiveFail = 0;
    for (const j of jobs) {
      try {
        await this.update(j.name, j.key);
        this.stats.ok++;
        consecutiveFail = 0;
      } catch (e) {
        this.stats.failed++;
        this.stats.lastError = `${j.name}: ${e.message}`;
        consecutiveFail++;
        if (consecutiveFail >= 15 && this.stats.ok === 0) {
          this.log.warn?.(`[upstox] giving up this run: ${e.message}`);
          break;
        }
      }
    }
    this.stats.finishedAt = new Date().toISOString();
    return this.stats.ok / Math.max(1, this.stats.ok + this.stats.failed);
  }
}
