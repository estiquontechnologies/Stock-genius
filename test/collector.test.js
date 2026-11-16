import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseCsv } from '../server/lib/csv.js';
import { unzip } from '../server/lib/unzip.js';
import { parseUdiffBhavcopy, parseIndexClose, parseConstituents, normaliseDate, bhavcopyText, SOURCES } from '../server/collector/sources.js';
import { candlesToBars, UpstoxCollector, instrumentKey } from '../server/collector/upstox.js';
import { Collector } from '../server/collector/collector.js';
import { parseRss } from '../server/providers/free/rss.js';
import { AutoEodProvider } from '../server/providers/auto-eod.js';
import { weekdaySessions } from '../server/lib/dates.js';

const UDIFF_HEAD = 'TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,XpryDt,FininstrmActlXpryDt,StrkPric,OptnTp,FinInstrmNm,OpnPric,HghPric,LwPric,ClsPric,LastPric,PrvsClsgPric,UndrlygPric,SttlmPric,OpnIntrst,ChngInOpnIntrst,TtlTradgVol,TtlTrfVal,TtlNbOfTxsExctd,SsnId,NewBrdLotQty,Rmks,Rsvd1,Rsvd2,Rsvd3,Rsvd4';
const udiffRow = (d, sym, isin, series, close) => `${d},${d},CM,NSE,STK,1234,${isin},${sym},${series},,,,,"${sym} LTD",${close - 1},${close + 2},${close - 3},${close},${close},${close - 1},,,,,1000,${close * 1000},10,F1,1,,,,,`;

function makeZip(name, content) {
  const data = Buffer.from(content);
  const comp = zlib.deflateRawSync(data);
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(0, 42);
  const cdOffset = local.length + nameBuf.length + comp.length;
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(central.length + nameBuf.length, 12); eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, nameBuf, comp, central, nameBuf, eocd]);
}

test('csv parser handles quotes, commas and CRLF', () => {
  assert.deepEqual(parseCsv('a,"b,c","d ""e"""\r\n1,2,3\r\n'), [['a', 'b,c', 'd "e"'], ['1', '2', '3']]);
});

test('unzip reads a deflated entry; bhavcopyText detects zip vs csv', () => {
  const z = makeZip('x.csv', 'hello,world\n');
  assert.equal(unzip(z)[0].data.toString(), 'hello,world\n');
  assert.equal(bhavcopyText(z), 'hello,world\n');
  assert.equal(bhavcopyText(Buffer.from('plain')), 'plain');
});

test('UDiFF bhavcopy parser keeps equity series only', () => {
  const csv = [UDIFF_HEAD, udiffRow('2026-11-13', 'ABC', 'INE000A01011', 'EQ', 100), udiffRow('2026-11-13', 'XYZ', 'INE000A01012', 'N1', 50)].join('\n');
  const p = parseUdiffBhavcopy(csv, 'NSE');
  assert.equal(p.date, '2026-11-13');
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].close, 100);
  assert.throws(() => parseUdiffBhavcopy('foo,bar\n1,2', 'NSE'), /Unrecognised/);
});

test('index close and constituents parsers', () => {
  const ix = parseIndexClose('Index Name,Index Date,Open Index Value,High Index Value,Low Index Value,Closing Index Value,Points Change,Change(%),Volume,Turnover (Rs. Cr.),P/E,P/B,Div Yield\nNifty 50,13-11-2026,24000,24100,23900,24050.5,10,0.1,1,1,22.1,3.5,1.2\nIndia VIX,13-11-2026,14,15,13,14.2,-,-,-,-,-,-,-');
  assert.equal(ix.date, '2026-11-13');
  assert.equal(ix.indices['Nifty 50'].close, 24050.5);
  assert.equal(ix.indices['India VIX'].close, 14.2);
  const c = parseConstituents('Company Name,Industry,Symbol,Series,ISIN Code\nABC Ltd.,Capital Goods,ABC,EQ,INE000A01011');
  assert.deepEqual(c[0], { name: 'ABC Ltd.', industry: 'Capital Goods', symbol: 'ABC', series: 'EQ', isin: 'INE000A01011' });
  assert.equal(normaliseDate('13-Nov-2026'), '2026-11-13');
});

test('source URL templates fill dates', () => {
  assert.match(SOURCES.nseBhavcopy.url('2026-11-13'), /_20261113_F_0000\.csv\.zip$/);
  assert.match(SOURCES.nseIndices.url('2026-11-13'), /ind_close_all_13112026\.csv$/);
});

test('upstox candles convert and sort oldest first', () => {
  const bars = candlesToBars([['2026-11-13T00:00:00+05:30', 10, 12, 9, 11, 500, 0], ['2026-11-12T00:00:00+05:30', 9, 10, 8, 10, 400, 0]]);
  assert.deepEqual(bars.map((b) => b.date), ['2026-11-12', '2026-11-13']);
  assert.equal(instrumentKey('NSE', 'INE1'), 'NSE_EQ|INE1');
});

test('RSS parser extracts items and drops non-http links', () => {
  const xml = `<rss><channel><title>Feed</title><item><title><![CDATA[ABC wins order]]></title><link>https://ex.com/a</link><pubDate>Mon, 16 Nov 2026 10:00:00 +0530</pubDate></item><item><title>Bad</title><link>javascript:alert(1)</link><pubDate>Mon, 16 Nov 2026 10:00:00 +0530</pubDate></item></channel></rss>`;
  const items = parseRss(xml, 'https://ex.com/feed');
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'ABC wins order');
});

test('collector + auto provider end-to-end with a fake fetch (Upstox path and exchange-file fallback)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-'));
  const universeCsv = 'Company Name,Industry,Symbol,Series,ISIN Code\nAlpha Ltd.,Capital Goods,ALPHA,EQ,INE0ALPHA01\nBeta Ltd.,Information Technology,BETA,EQ,INE0BETA001';
  const sessions = weekdaySessions('2026-11-13', 240);
  let upstoxCalls = 0;
  const fakeFetch = async (url) => {
    const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => body, arrayBuffer: async () => Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) });
    if (url.includes('nifty500list')) return ok(universeCsv);
    if (url.includes('historical-candle')) {
      upstoxCalls++;
      const m = url.match(/day\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})/);
      const [to, from] = [m[1], m[2]];
      const candles = sessions.filter((d) => d >= from && d <= to).map((d, i) => [`${d}T00:00:00+05:30`, 100 + i, 102 + i, 99 + i, 101 + i, 1000, 0]).reverse();
      return ok({ status: 'success', data: { candles } });
    }
    return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => Buffer.from('') };
  };
  const { UpstoxClient } = await import('../server/collector/upstox.js');
  const client = new UpstoxClient({ fetchImpl: fakeFetch, delayMs: 0 });
  const collector = new Collector({ dir, delayMs: 0, fetchImpl: fakeFetch, log: { info() {}, warn() {} }, upstox: new UpstoxCollector({ dir, client, log: { warn() {} }, historyDays: 400 }), backfillSessions: 5 });
  await collector.run();
  assert.ok(upstoxCalls > 0);
  assert.equal(collector.status.priceSource, 'upstox');
  const prov = new AutoEodProvider({ dir, collector, fredApiKey: '', rssFeeds: [] });
  prov.rss.feeds = []; // no network in tests
  const inst = await prov.listInstruments();
  assert.deepEqual(inst.map((i) => i.ticker).sort(), ['ALPHA', 'BETA']);
  const meta = await prov.describe();
  assert.equal(meta.dataMode, 'eod');
  assert.equal(meta.simulated, false);
  const q = await prov.getQuote('ALPHA');
  assert.equal(q.freshness, 'eod');
  assert.equal(await prov.getFundamentals('ALPHA'), null);

  // Fallback: Upstox fails → exchange files are attempted.
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-'));
  const tried = [];
  const failingFetch = async (url) => {
    tried.push(url);
    if (url.includes('nifty500list')) return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(universeCsv) };
    if (url.includes('historical-candle')) return { ok: false, status: 401, json: async () => ({ status: 'error', errors: [{ message: 'Unauthorized' }] }) };
    if (url.includes('BhavCopy_NSE')) return { ok: true, status: 200, arrayBuffer: async () => makeZip('b.csv', [UDIFF_HEAD, udiffRow('2026-11-13', 'ALPHA', 'INE0ALPHA01', 'EQ', 100)].join('\n')) };
    return { ok: false, status: 404, arrayBuffer: async () => Buffer.from('') };
  };
  const c2 = new Collector({ dir: dir2, delayMs: 0, fetchImpl: failingFetch, log: { info() {}, warn() {} }, upstox: new UpstoxCollector({ dir: dir2, client: new UpstoxClient({ fetchImpl: failingFetch, delayMs: 0 }), log: { warn() {} } }), backfillSessions: 1 });
  await c2.run();
  assert.equal(c2.status.priceSource, 'exchange-files');
  assert.ok(tried.some((u) => u.includes('BhavCopy_NSE')));
});
