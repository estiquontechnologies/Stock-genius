import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from '../server/index.js';
import { SampleProvider } from '../server/providers/sample/index.js';
import { Store } from '../server/services/store.js';

let server;
let base;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-api-'));

before(async () => {
  server = createServer({ provider: new SampleProvider(), store: new Store(path.join(dir, 'store.json')), collector: null });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.json().catch(() => null), headers: r.headers }; };
const send = async (method, p, body) => { const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };

test('meta reports sample mode and ads off by default', async () => {
  const r = await get('/api/meta');
  assert.equal(r.status, 200);
  assert.equal(r.body.data.dataMode, 'sample');
  assert.equal(r.body.ads.enabled, false);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
});

test('core research endpoints respond', async () => {
  for (const p of ['/api/overview', '/api/stocks', '/api/stocks/AURLEDGR', '/api/stocks/AURLEDGR/chart', '/api/radar', '/api/breadth', '/api/calendar', '/api/compare?tickers=AURLEDGR,QLSTNINF', '/api/glossary', '/api/methodology']) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
  }
  const s = (await get('/api/stocks/AURLEDGR?horizon=long')).body;
  assert.equal(s.recommendation.horizon, 'long');
  assert.ok(s.moves.every((m) => /not prove/.test(m.caveat)));
  assert.ok(s.scenarios.disclaimer.includes('not price targets'));
});

test('input validation', async () => {
  assert.equal((await get('/api/stocks/<script>')).status, 400);
  assert.equal((await get('/api/stocks/NOPE')).status, 404);
  assert.equal((await send('POST', '/api/watchlists', '{bad json')).status, 400);
  assert.equal((await send('POST', '/api/watchlists', { name: 'x'.repeat(300 * 1024) })).status, 413);
  assert.equal((await get('/api/unknown')).status, 404);
});

test('user workflows: watchlist, follow → alerts, thesis review, journal, portfolio, log', async () => {
  const wl = (await send('POST', '/api/watchlists', { name: 'Banks' })).body;
  const upd = (await send('PUT', `/api/watchlists/${wl.id}`, { tickers: ['AURLEDGR', 'AURLEDGR', 'VRDMBANK'] })).body;
  assert.deepEqual(upd.tickers, ['AURLEDGR', 'VRDMBANK']);

  await send('POST', '/api/follows', { ticker: 'TRVLNMOT', horizon: 'medium' });
  const alerts = (await get('/api/alerts')).body;
  assert.equal(alerts.follows.length, 1);
  assert.ok(Array.isArray(alerts.alerts));
  if (alerts.alerts.length) {
    await send('POST', '/api/alerts/read', { ids: [alerts.alerts[0].id] });
    assert.equal((await get('/api/alerts')).body.alerts.find((a) => a.id === alerts.alerts[0].id).read, true);
  }

  const th = (await send('POST', '/api/theses', { ticker: 'TRVLNMOT', text: 'x', assumptions: [{ text: 'growth', metric: 'profitGrowth', op: '>=', threshold: 5 }, { text: 'manual' }] })).body;
  const rev = (await get(`/api/theses/${th.id}/review`)).body;
  assert.equal(rev.assumptions.length, 2);
  assert.ok(['holds', 'at-risk', 'broken', 'no-data'].includes(rev.assumptions[0].status));
  assert.equal(rev.assumptions[1].status, 'unreviewed');

  const j = (await send('POST', '/api/journal', { ticker: 'AURLEDGR', note: 'check NIM' })).body;
  assert.ok(j.snapshot.view);
  assert.equal((await get('/api/journal')).body[0].now.view != null, true);

  const imp = (await send('POST', '/api/portfolio/import', { csv: 'ticker,qty\nAURLEDGR,10\nBAD TICKER!,5\nTRVLNMOT,-1' })).body;
  assert.deepEqual(imp.holdings, [{ ticker: 'AURLEDGR', quantity: 10 }]);
  const pf = (await get('/api/portfolio')).body;
  assert.equal(pf.analysis.holdings[0].weight, 1);
  assert.match(pf.analysis.disclaimer, /not advice/);

  const log = (await get('/api/recommendation-log?ticker=AURLEDGR')).body;
  assert.ok(log.length >= 1);
});

test('static files and SPA fallback, no path traversal', async () => {
  const r = await fetch(`${base}/`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Stock Genius/);
  const t = await fetch(`${base}/..%2f..%2fpackage.json`);
  assert.ok([403, 200].includes(t.status));
  assert.doesNotMatch(await t.text(), /"name": "stock-genius"/);
});
