// Templates for SIMULATED news. Every generated headline is prefixed in the UI
// with a "Sample" label and links to an internal page explaining it is not real.

export const MARKET_EVENTS = {
  crude_spike: {
    category: 'commodities',
    headline: 'Crude oil prices jump on supply disruption concerns',
    tone: -1,
    effects: { crude: 0.07, inr: 0.006, global: -0.008, geo: 12, in10y: 0.06, market: -0.016 },
  },
  global_selloff: {
    category: 'global markets',
    headline: 'Global equities fall sharply after weak growth data in major economies',
    tone: -1,
    effects: { global: -0.03, inr: 0.004, us10y: -0.08, market: -0.018 },
  },
  policy_cut: {
    category: 'monetary policy',
    headline: 'Central bank cuts policy repo rate by 25 basis points',
    tone: 1,
    effects: { repo: -0.25, in10y: -0.12, market: 0.014 },
  },
  policy_hawkish: {
    category: 'monetary policy',
    headline: 'Central bank holds rates and signals caution on inflation',
    tone: -1,
    effects: { in10y: 0.08, market: -0.009 },
  },
  inr_slide: {
    category: 'currency',
    headline: 'Rupee weakens to a record low against the US dollar amid foreign outflows',
    tone: -1,
    effects: { inr: 0.011, market: -0.011 },
  },
  geo_tension: {
    category: 'geopolitics',
    headline: 'Escalating regional tensions lift oil and weigh on risk assets',
    tone: -1,
    effects: { geo: 22, crude: 0.035, global: -0.012, inr: 0.004, market: -0.017 },
  },
  global_rally: {
    category: 'global markets',
    headline: 'Global stocks rally as inflation data in the US comes in softer than expected',
    tone: 1,
    effects: { global: 0.022, us10y: -0.1, inr: -0.003, market: 0.015 },
  },
  cpi_soft: {
    category: 'economic data',
    headline: 'India retail inflation eases more than expected',
    tone: 1,
    effects: { in10y: -0.07, cpi: -0.6, market: 0.009 },
  },
  trade_deal: {
    category: 'trade',
    headline: 'India and a major trading partner announce progress on a trade agreement',
    tone: 1,
    effects: { global: 0.006, inr: -0.004, market: 0.012 },
  },
};

export const SECTOR_EVENTS = {
  Banks: { tone: -1, mag: 0.028, headline: 'Regulator raises risk weights on certain unsecured loans', category: 'regulation' },
  'IT Services': { tone: -1, mag: 0.035, headline: 'Large overseas clients signal cautious technology budgets', category: 'sector demand' },
  'Oil & Gas': { tone: -1, mag: 0.03, headline: 'Government revises special levy on domestic crude production', category: 'policy' },
  FMCG: { tone: 1, mag: 0.022, headline: 'Rural demand indicators show improvement for a second month', category: 'sector demand' },
  Pharma: { tone: 1, mag: 0.026, headline: 'Overseas regulator clears backlog of facility inspections', category: 'regulation' },
  Automobiles: { tone: 1, mag: 0.03, headline: 'Monthly vehicle sales data shows strong festive-season demand', category: 'sector data' },
  'Metals & Mining': { tone: -1, mag: 0.036, headline: 'Base metal prices fall on weak global factory data', category: 'commodities' },
  'Capital Goods': { tone: 1, mag: 0.028, headline: 'Government raises infrastructure capital expenditure allocation', category: 'policy' },
  'Power & Utilities': { tone: 1, mag: 0.024, headline: 'Peak electricity demand hits a new high', category: 'sector data' },
  Telecom: { tone: 1, mag: 0.04, headline: 'Operators announce industry-wide mobile tariff increases', category: 'pricing' },
  Cement: { tone: 1, mag: 0.03, headline: 'Dealers report cement price increases across regions', category: 'pricing' },
  Realty: { tone: 1, mag: 0.034, headline: 'Lenders trim home-loan rates following policy easing', category: 'sector demand' },
  Chemicals: { tone: 1, mag: 0.03, headline: 'Anti-dumping duty imposed on certain chemical imports', category: 'trade' },
};

export const COMPANY_EVENTS = [
  { kind: 'order_win', tone: 1, mag: [0.035, 0.06], sectors: ['Capital Goods', 'IT Services', 'Power & Utilities', 'Telecom', 'Automobiles', 'Chemicals', 'Cement'], headline: (n) => `${n} discloses a large multi-year contract win`, facts: (r, c) => [`Contract value stated as about ₹${r.int(4, 30) * 100} crore`, `Execution period stated as ${r.int(2, 5)} years`] },
  { kind: 'capacity', tone: 1, mag: [0.025, 0.045], headline: (n) => `${n} board approves capacity expansion`, facts: (r) => [`Planned capital expenditure of about ₹${r.int(5, 40) * 100} crore`, 'Commissioning targeted over 18–24 months'] },
  { kind: 'rating_up', tone: 1, mag: [0.015, 0.03], headline: (n) => `Credit rating agency upgrades ${n}'s long-term rating`, facts: () => ['Long-term rating upgraded by one notch', 'Agency cited improved cash generation'] },
  { kind: 'buyback', tone: 1, mag: [0.03, 0.05], headline: (n) => `${n} announces share buyback`, facts: (r) => [`Buyback size about ₹${r.int(5, 25) * 100} crore`, `Buyback price set at a ${r.int(12, 25)}% premium to the prior close`] },
  { kind: 'loan_growth', tone: 1, mag: [0.025, 0.04], sectors: ['Banks'], headline: (n) => `${n} business update shows strong loan and deposit growth`, facts: (r) => [`Advances up ${r.int(16, 24)}% year on year`, `Deposits up ${r.int(13, 20)}% year on year`] },
  { kind: 'regulatory', tone: -1, mag: [0.05, 0.08], sectors: ['Pharma'], headline: (n) => `${n} receives regulatory observations at a manufacturing site`, facts: (r) => [`${r.int(3, 9)} observations issued after inspection`, 'Company says it will respond within the stipulated time'] },
  { kind: 'mgmt_exit', tone: -1, mag: [0.03, 0.05], headline: (n) => `${n} announces resignation of its chief financial officer`, facts: () => ['Resignation effective at the end of the notice period', 'Interim arrangement announced'] },
  { kind: 'block_deal', tone: -1, mag: [0.02, 0.035], headline: (n) => `Promoter group entity sells stake in ${n} via block deal`, facts: (r) => [`About ${r.range(1.5, 4.5).toFixed(1)}% of equity changed hands`, 'Sale price at a discount to the prior close'] },
  { kind: 'plant_outage', tone: -1, mag: [0.03, 0.05], sectors: ['Chemicals', 'Metals & Mining', 'Cement', 'Oil & Gas', 'Pharma'], headline: (n) => `${n} reports temporary shutdown at a plant`, facts: (r) => [`Shutdown expected to last about ${r.int(2, 6)} weeks`, 'Company says the plant is insured'] },
  { kind: 'tax_notice', tone: -1, mag: [0.015, 0.03], headline: (n) => `${n} discloses tax demand notice and says it will contest`, facts: (r) => [`Demand of about ₹${r.int(2, 15) * 100} crore including interest`, 'Company states it has strong grounds for appeal'] },
  { kind: 'asset_quality', tone: -1, mag: [0.035, 0.055], sectors: ['Banks'], headline: (n) => `${n} flags rise in stressed loans in its business update`, facts: (r) => [`Stressed-loan pool reported up ${r.int(15, 40)}% quarter on quarter`, 'Management expects elevated credit costs for two quarters'] },
];

export const ROUTINE_NEWS = [
  { kind: 'rating_reaffirmed', headline: (n) => `Credit rating agency reaffirms ${n}'s ratings`, facts: () => ['Ratings reaffirmed with stable outlook'] },
  { kind: 'analyst_meet', headline: (n) => `${n} to hold an analyst and investor meeting`, facts: () => ['Schedule filed with the exchanges'] },
  { kind: 'agm', headline: (n) => `${n} files notice of annual general meeting`, facts: () => ['AGM notice and annual report filed'] },
];
