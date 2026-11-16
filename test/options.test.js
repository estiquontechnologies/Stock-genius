import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bsPrice, impliedVol, greeks, analyseExpiry, payoffAtExpiry, normCdf } from '../server/analysis/options.js';
import { parseUdiffFo } from '../server/collector/sources.js';
import { SampleProvider } from '../server/providers/sample/index.js';
import { optionsOverview, optionsDetail } from '../server/services/options.js';

test('normal CDF and put-call parity', () => {
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-7);
  assert.ok(Math.abs(normCdf(1.96) - 0.975) < 1e-3);
  const S = 100; const K = 105; const T = 0.25; const s = 0.3; const r = 0.065;
  const parity = bsPrice('CE', S, K, T, s, r) - bsPrice('PE', S, K, T, s, r) - (S - K * Math.exp(-r * T));
  assert.ok(Math.abs(parity) < 1e-9);
});

test('implied volatility recovers the input volatility', () => {
  for (const [type, K, sigma] of [['CE', 100, 0.2], ['PE', 90, 0.45], ['CE', 120, 0.6]]) {
    const p = bsPrice(type, 100, K, 0.1, sigma);
    assert.ok(Math.abs(impliedVol(type, p, 100, K, 0.1) - sigma) < 1e-4);
  }
  assert.equal(impliedVol('CE', 0.01, 100, 50, 0.1), null, 'below intrinsic → null');
});

test('greeks have expected signs', () => {
  const c = greeks('CE', 100, 100, 0.25, 0.25);
  const p = greeks('PE', 100, 100, 0.25, 0.25);
  assert.ok(c.delta > 0 && c.delta < 1 && p.delta < 0 && p.delta > -1);
  assert.ok(c.gamma > 0 && c.vega > 0 && c.theta < 0);
});

test('chain analytics: PCR, max pain, walls, expected move', () => {
  const rows = [];
  for (const k of [90, 95, 100, 105, 110]) {
    rows.push({ strike: k, type: 'CE', price: bsPrice('CE', 100, k, 30 / 365, 0.3), oi: k === 110 ? 5000 : 1000, chgOi: 0, volume: 100 });
    rows.push({ strike: k, type: 'PE', price: bsPrice('PE', 100, k, 30 / 365, 0.3), oi: k === 90 ? 6000 : 1000, chgOi: 0, volume: 100 });
  }
  const asOf = '2026-11-16';
  const a = analyseExpiry({ spot: 100, asOfDate: asOf, expiry: '2026-12-16', rows });
  assert.equal(a.atmStrike, 100);
  assert.ok(Math.abs(a.atmIv - 0.3) < 0.01);
  assert.ok(Math.abs(a.pcrOi - 10000 / 9000) < 1e-9);
  assert.equal(a.callWall[0].strike, 110);
  assert.equal(a.putWall[0].strike, 90);
  assert.ok(a.maxPain >= 90 && a.maxPain <= 110);
  assert.ok(a.expectedMove.straddlePct > 0.05 && a.expectedMove.straddlePct < 0.12);
});

test('payoff at expiry for a bull call spread', () => {
  const legs = [{ type: 'CE', strike: 100, premium: 5, side: 'buy', qty: 1 }, { type: 'CE', strike: 110, premium: 2, side: 'sell', qty: 1 }];
  assert.equal(payoffAtExpiry(legs, 90), -3);
  assert.equal(payoffAtExpiry(legs, 103), 0);
  assert.equal(payoffAtExpiry(legs, 130), 7);
});

test('F&O UDiFF parser keeps index and stock options only', () => {
  const head = 'TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,XpryDt,FininstrmActlXpryDt,StrkPric,OptnTp,FinInstrmNm,OpnPric,HghPric,LwPric,ClsPric,LastPric,PrvsClsgPric,UndrlygPric,SttlmPric,OpnIntrst,ChngInOpnIntrst,TtlTradgVol,TtlTrfVal,TtlNbOfTxsExctd,SsnId,NewBrdLotQty,Rmks,Rsvd1,Rsvd2,Rsvd3,Rsvd4';
  const csv = [head,
    '2026-11-13,2026-11-13,FO,NSE,IDO,1,,NIFTY,,2026-11-25,2026-11-25,24000,CE,NIFTY25NOV24000CE,100,120,90,110,110,100,24050,110,500000,25000,9000,1,1,F1,75,,,,,',
    '2026-11-13,2026-11-13,FO,NSE,STO,2,,ABC,,2026-11-25,2026-11-25,500,PE,ABC25NOV500PE,5,6,4,0,0,5,510,4.5,1000,-50,0,1,1,F1,500,,,,,',
    '2026-11-13,2026-11-13,FO,NSE,IDF,3,,NIFTY,,2026-11-25,2026-11-25,,,NIFTY25NOVFUT,24000,24100,23900,24060,24060,24000,24050,24060,1,1,1,1,1,F1,75,,,,,'].join('\n');
  const p = parseUdiffFo(csv);
  assert.equal(p.date, '2026-11-13');
  assert.equal(p.rows.length, 2);
  assert.equal(p.rows[0].kind, 'index');
  assert.equal(p.rows[0].lotSize, 75);
  assert.equal(p.rows[1].price, 4.5, 'untraded option falls back to settlement price');
});

test('sample options overview and detail are consistent and flagged simulated', async () => {
  const prov = new SampleProvider();
  const o = await optionsOverview(prov);
  assert.ok(o.available && o.underlyings.length > 5);
  assert.match(o.risk.body, /research and education only/);
  const d = await optionsDetail(prov, o.underlyings[1].symbol);
  assert.ok(d.simulated);
  assert.ok(d.selected.chain.length > 10);
  assert.ok(d.notes.every((n) => n.fact && n.analysis));
  assert.ok(d.term.length >= 2);
  assert.equal(await optionsDetail(prov, 'NOPE'), null);
});
