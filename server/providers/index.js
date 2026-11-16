// Provider selection. To add a paid/licensed feed (version 2), implement the
// same methods as SampleProvider / AutoEodProvider and register it here.
// Credentials must come from environment variables and stay server-side.

import path from 'node:path';
import { SampleProvider } from './sample/index.js';
import { AutoEodProvider } from './auto-eod.js';
import { Collector } from '../collector/collector.js';
import { UpstoxClient, UpstoxCollector } from '../collector/upstox.js';
import { ROOT } from '../config.js';

export function createProvider(config, log = console) {
  if (config.provider === 'auto') {
    const dir = path.resolve(ROOT, process.env.MARKET_DATA_DIR || 'data/market');
    const upstoxClient = process.env.PRICE_SOURCE === 'exchange-files' ? null : new UpstoxClient({ token: process.env.UPSTOX_ACCESS_TOKEN || '' });
    const collector = new Collector({
      dir,
      upstox: upstoxClient ? new UpstoxCollector({ dir, client: upstoxClient, log }) : null,
      backfillSessions: Number(process.env.BACKFILL_SESSIONS || 300),
      delayMs: Number(process.env.REQUEST_DELAY_MS || 2500),
      collectTimeIst: process.env.COLLECT_TIME_IST || '19:15',
      userAgent: process.env.COLLECTOR_USER_AGENT || undefined,
      log,
    });
    if (process.env.AUTO_COLLECT !== 'false') collector.start({ runNow: true });
    return { provider: new AutoEodProvider({ dir, collector, fredApiKey: config.fredApiKey, rssFeeds: config.rssFeeds, upstox: upstoxClient }), collector };
  }
  if (config.provider !== 'sample') log.warn(`[provider] Unknown DATA_PROVIDER "${config.provider}", using sample data.`);
  return { provider: new SampleProvider({ forceStale: config.sampleForceStale }), collector: null };
}
