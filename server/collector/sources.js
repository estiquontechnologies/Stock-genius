// Free, publicly published exchange files used by the automated collector.
// Formats: NSE/BSE "UDiFF" common bhavcopy (in use since July 2024), the
// NSE all-indices daily close file and the Nifty 500 constituents list.
// URL patterns can change without notice — they are centralised here and
// overridable via environment variables.

import { parseCsvObjects } from '../lib/csv.js';
import { unzip } from '../lib/unzip.js';

const ymd = (iso) => iso.replaceAll('-', '');
const dmy = (iso) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;

const tpl = (pattern, iso) => pattern.replaceAll('{YYYYMMDD}', ymd(iso)).replaceAll('{DDMMYYYY}', dmy(iso));

export const SOURCES = {
  nseBhavcopy: {
    label: 'NSE equity bhavcopy (UDiFF)',
    pattern: process.env.NSE_BHAVCOPY_URL || 'https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{YYYYMMDD}_F_0000.csv.zip',
    url: (iso) => tpl(SOURCES.nseBhavcopy.pattern, iso),
  },
  bseBhavcopy: {
    label: 'BSE equity bhavcopy (UDiFF)',
    pattern: process.env.BSE_BHAVCOPY_URL || 'https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_{YYYYMMDD}_F_0000.CSV',
    url: (iso) => tpl(SOURCES.bseBhavcopy.pattern, iso),
  },
  nseIndices: {
    label: 'NSE all-indices daily close',
    pattern: process.env.NSE_INDICES_URL || 'https://nsearchives.nseindia.com/content/indices/ind_close_all_{DDMMYYYY}.csv',
    url: (iso) => tpl(SOURCES.nseIndices.pattern, iso),
  },
  universe: {
    label: 'Nifty 500 constituents (with industry)',
    url: () => process.env.UNIVERSE_LIST_URL || 'https://nsearchives.nseindia.com/content/indices/ind_nifty500list.csv',
  },
  announcementsRss: {
    label: 'NSE corporate announcements RSS',
    url: () => process.env.NSE_ANNOUNCEMENTS_RSS || 'https://nsearchives.nseindia.com/content/RSS/Online_announcements.xml',
  },
};

const num = (x) => {
  const v = Number(String(x).replace(/,/g, ''));
  return Number.isFinite(v) ? v : null;
};

/** Decode a downloaded bhavcopy body (zip or plain CSV) to text. */
export function bhavcopyText(buf) {
  if (buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50) {
    const f = unzip(buf).find((x) => /\.csv$/i.test(x.name));
    if (!f) throw new Error('Zip contains no CSV');
    return f.data.toString('utf8');
  }
  return buf.toString('utf8');
}

/**
 * Parse a UDiFF bhavcopy. Returns { date, rows: [{ symbol, isin, code, series,
 * open, high, low, close, prevClose, volume, turnover }] }. Equity cash
 * segment only.
 */
export function parseUdiffBhavcopy(text, exchange) {
  const { headers, records } = parseCsvObjects(text);
  if (!headers.includes('TckrSymb') || !headers.includes('ClsPric')) throw new Error(`Unrecognised ${exchange} bhavcopy format (headers: ${headers.slice(0, 6).join(',')}…)`);
  const okSeries = exchange === 'NSE' ? new Set(['EQ', 'BE', 'BZ']) : null;
  const rows = [];
  let date = null;
  for (const r of records) {
    if (r.FinInstrmTp && r.FinInstrmTp !== 'STK') continue;
    if (okSeries && !okSeries.has(r.SctySrs)) continue;
    const close = num(r.ClsPric);
    if (close == null || close <= 0) continue;
    date ||= r.TradDt;
    rows.push({
      symbol: r.TckrSymb, isin: r.ISIN, code: r.FinInstrmId, series: r.SctySrs, name: r.FinInstrmNm,
      open: num(r.OpnPric), high: num(r.HghPric), low: num(r.LwPric), close, prevClose: num(r.PrvsClsgPric),
      volume: num(r.TtlTradgVol) ?? 0, turnover: num(r.TtlTrfVal) ?? 0,
    });
  }
  return { date: normaliseDate(date), rows };
}

/** Parse the NSE all-indices close file → { date, indices: { name: {open,high,low,close,pe,pb,divYield} } }. */
export function parseIndexClose(text) {
  const { headers, records } = parseCsvObjects(text);
  if (!headers.includes('Index Name') || !headers.includes('Closing Index Value')) throw new Error('Unrecognised index close format');
  const out = {};
  let date = null;
  for (const r of records) {
    const close = num(r['Closing Index Value']);
    if (close == null) continue;
    date ||= r['Index Date'];
    out[r['Index Name'].trim()] = {
      open: num(r['Open Index Value']), high: num(r['High Index Value']), low: num(r['Low Index Value']), close,
      pe: num(r['P/E']), pb: num(r['P/B']), divYield: num(r['Div Yield']),
    };
  }
  return { date: normaliseDate(date), indices: out };
}

/** Parse the index constituents list → [{ name, industry, symbol, series, isin }]. */
export function parseConstituents(text) {
  const { headers, records } = parseCsvObjects(text);
  if (!headers.includes('Symbol') || !headers.includes('Industry')) throw new Error('Unrecognised constituents format');
  return records.filter((r) => r.Symbol).map((r) => ({ name: r['Company Name'], industry: r.Industry, symbol: r.Symbol, series: r.Series, isin: r['ISIN Code'] }));
}

const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

export function normaliseDate(s) {
  if (!s) return null;
  s = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  let m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{4})$/);
  if (m) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}`;
  return null;
}
