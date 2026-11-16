// FRED (Federal Reserve Bank of St. Louis) — free macro data with a free API
// key (https://fred.stlouisfed.org/docs/api/api_key.html). The key is read
// from the FRED_API_KEY environment variable and only used server-side.
// FRED terms ask for attribution; series IDs and source notes are shown in
// the app. Some series on FRED are owned by third parties with their own
// terms — check each series' notes before redistributing publicly.

const SERIES = {
  brent: { fred: 'DCOILBRENTEU', name: 'Brent crude', unit: '$/bbl' },
  usdinr: { fred: 'DEXINUS', name: 'USD/INR', unit: '₹ per $' },
  us10y: { fred: 'DGS10', name: 'US 10Y Treasury yield', unit: '%' },
  global_eq: { fred: 'NASDAQCOM', name: 'Global equities proxy (NASDAQ Composite)', unit: 'pts' },
  in10y: { fred: 'INDIRLTLT01STM', name: 'India long-term government bond yield (monthly, OECD via FRED)', unit: '%', monthly: true },
  cpi: { fred: 'INDCPIALLMINMEI', name: 'India CPI inflation (YoY, OECD via FRED)', unit: '%', monthly: true, yoy: true },
};

const TTL_MS = 6 * 3600 * 1000;

export class FredMacro {
  constructor(apiKey, { fetchImpl = globalThis.fetch } = {}) {
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
    this.cache = null;
    this.fetchedAt = 0;
    this.errors = [];
  }

  get enabled() {
    return !!this.apiKey;
  }

  async load(startDate) {
    if (!this.enabled) return {};
    if (this.cache && Date.now() - this.fetchedAt < TTL_MS) return this.cache;
    const out = {};
    this.errors = [];
    await Promise.all(Object.entries(SERIES).map(async ([id, s]) => {
      const start = s.yoy ? `${Number(startDate.slice(0, 4)) - 1}${startDate.slice(4)}` : startDate;
      const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${s.fred}&api_key=${encodeURIComponent(this.apiKey)}&file_type=json&observation_start=${start}`;
      try {
        const res = await this.fetch(url, { headers: { 'User-Agent': 'stock-genius/0.1' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        let pts = (j.observations || []).filter((o) => o.value !== '.').map((o) => ({ date: o.date, value: Number(o.value) }));
        if (s.yoy) {
          const byMonth = new Map(pts.map((p) => [p.date.slice(0, 7), p.value]));
          pts = pts.map((p) => {
            const prevKey = `${Number(p.date.slice(0, 4)) - 1}${p.date.slice(4, 7)}`;
            const prev = byMonth.get(prevKey);
            return prev ? { date: p.date, value: +((p.value / prev - 1) * 100).toFixed(2) } : null;
          }).filter(Boolean);
        }
        out[id] = {
          id, name: s.name, unit: s.unit, simulated: false, frequency: s.monthly && id === 'cpi' ? 'monthly' : undefined,
          source: `FRED series ${s.fred}`, sourceUrl: `https://fred.stlouisfed.org/series/${s.fred}`, series: pts,
        };
      } catch (e) {
        this.errors.push(`${s.fred}: ${e.message}`);
      }
    }));
    this.cache = out;
    this.fetchedAt = Date.now();
    return out;
  }
}
