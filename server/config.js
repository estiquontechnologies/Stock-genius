import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load .env (server-side only; never served to the browser).
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

const bool = (v, d = false) => (v == null || v === '' ? d : /^(1|true|yes)$/i.test(v));
const p = (v, d) => path.resolve(ROOT, v || d);

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '127.0.0.1',
  provider: (process.env.DATA_PROVIDER || 'sample').toLowerCase(),
  sampleForceStale: bool(process.env.SAMPLE_FORCE_STALE),
  eodDir: p(process.env.EOD_DATA_DIR, 'data/eod'),
  instrumentsFile: p(process.env.INSTRUMENTS_FILE, 'data/instruments.csv'),
  fundamentalsFile: p(process.env.FUNDAMENTALS_FILE, 'data/fundamentals.csv'),
  fredApiKey: process.env.FRED_API_KEY || '',
  rssFeeds: (process.env.NEWS_RSS_FEEDS || '').split(',').map((s) => s.trim()).filter(Boolean),
  storeFile: p(process.env.STORE_FILE, 'data/store.json'),
  staleAfterSessions: Number(process.env.STALE_AFTER_SESSIONS || 1),
};
