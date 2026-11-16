// Sector macro-sensitivity map. These are MODEL ASSUMPTIONS (analyst judgement,
// not measured data). They are used to translate macro moves into sector
// exposure notes and are shown to users as assumptions, with reasons.
//
// Factor conventions (positive factor value means):
//   crude       – crude oil prices rising
//   inr         – rupee weakening versus the US dollar (USD/INR rising)
//   rates       – Indian bond yields rising
//   globalRisk  – global risk-off (global equities falling / volatility rising)
//   inflation   – Indian consumer inflation rising
//
// Sensitivity values are in [-1, 1]: + means the sector tends to benefit.

export const FACTORS = {
  crude: { label: 'Crude oil rising', short: 'Crude' },
  inr: { label: 'Rupee weakening vs USD', short: 'USD/INR' },
  rates: { label: 'Bond yields rising', short: 'Yields' },
  globalRisk: { label: 'Global risk-off', short: 'Global risk' },
  inflation: { label: 'Inflation rising', short: 'Inflation' },
};

export const SECTORS = {
  Banks: {
    kind: 'financial',
    sens: { crude: -0.2, inr: -0.1, rates: -0.1, globalRisk: -0.5, inflation: -0.2 },
    why: {
      globalRisk: 'Banks are large index weights and often see foreign outflows in risk-off phases.',
      rates: 'Rising yields can cause treasury (bond) losses, partly offset by higher loan yields.',
      inflation: 'Persistent inflation can delay rate cuts and pressure borrowers.',
    },
  },
  'IT Services': {
    kind: 'operating',
    sens: { crude: 0, inr: 0.6, rates: 0, globalRisk: -0.4, inflation: 0 },
    why: {
      inr: 'Most revenue is billed in foreign currency, so a weaker rupee lifts rupee revenue and margins.',
      globalRisk: 'Clients in the US and Europe may cut discretionary technology spending in downturns.',
    },
  },
  'Oil & Gas': {
    kind: 'operating',
    sens: { crude: 0.5, inr: 0.1, rates: -0.1, globalRisk: -0.2, inflation: 0 },
    why: {
      crude: 'Upstream producers realise higher prices when crude rises (subject to any levies).',
    },
  },
  FMCG: {
    kind: 'operating',
    sens: { crude: -0.3, inr: -0.1, rates: -0.1, globalRisk: 0.2, inflation: -0.4 },
    why: {
      crude: 'Packaging and some raw materials are crude derivatives, squeezing gross margins.',
      inflation: 'High food inflation can weaken volume demand, especially in rural markets.',
      globalRisk: 'Often treated as defensive, so it can hold up better in risk-off phases.',
    },
  },
  Pharma: {
    kind: 'operating',
    sens: { crude: -0.1, inr: 0.4, rates: 0, globalRisk: 0.2, inflation: 0 },
    why: {
      inr: 'Significant export revenue benefits from a weaker rupee.',
      globalRisk: 'Healthcare demand is relatively stable, so the sector is often defensive.',
    },
  },
  Automobiles: {
    kind: 'operating',
    sens: { crude: -0.4, inr: -0.2, rates: -0.4, globalRisk: -0.2, inflation: -0.2 },
    why: {
      crude: 'Higher fuel prices can dampen vehicle demand and raise input costs.',
      rates: 'Most vehicles are financed; higher loan rates can slow purchases.',
    },
  },
  'Metals & Mining': {
    kind: 'operating',
    sens: { crude: -0.1, inr: 0.2, rates: -0.1, globalRisk: -0.6, inflation: 0.1 },
    why: {
      globalRisk: 'Metal prices are tied to global industrial demand and fall in global slowdowns.',
      inr: 'Prices are dollar-linked, so a weaker rupee can raise rupee realisations.',
    },
  },
  'Capital Goods': {
    kind: 'operating',
    sens: { crude: -0.1, inr: -0.1, rates: -0.3, globalRisk: -0.2, inflation: -0.1 },
    why: {
      rates: 'Project financing costs and order inflows are sensitive to interest rates.',
    },
  },
  'Power & Utilities': {
    kind: 'operating',
    sens: { crude: -0.1, inr: -0.1, rates: -0.3, globalRisk: 0.1, inflation: 0 },
    why: {
      rates: 'Capital-intensive and often debt-funded, so higher rates raise financing costs.',
    },
  },
  Telecom: {
    kind: 'operating',
    sens: { crude: 0, inr: -0.2, rates: -0.2, globalRisk: 0.1, inflation: 0 },
    why: {
      rates: 'High debt from spectrum and network spending makes rates relevant.',
      inr: 'Network equipment is largely imported and priced in dollars.',
    },
  },
  Cement: {
    kind: 'operating',
    sens: { crude: -0.4, inr: -0.1, rates: -0.3, globalRisk: -0.1, inflation: -0.1 },
    why: {
      crude: 'Fuel and freight are major costs, so energy prices affect margins.',
      rates: 'Demand depends on construction and housing activity, which is rate-sensitive.',
    },
  },
  Realty: {
    kind: 'operating',
    sens: { crude: -0.1, inr: 0, rates: -0.7, globalRisk: -0.3, inflation: -0.2 },
    why: {
      rates: 'Home-loan rates strongly affect housing demand and developer funding costs.',
    },
  },
  Chemicals: {
    kind: 'operating',
    sens: { crude: -0.5, inr: 0.2, rates: -0.1, globalRisk: -0.3, inflation: 0 },
    why: {
      crude: 'Many feedstocks are crude derivatives, so rising crude raises input costs.',
      inr: 'Exporters benefit from a weaker rupee.',
    },
  },
};

// NSE industry classifications (as used in index constituent lists) mapped to
// the sensitivity profiles above. Names are kept as published; only the
// macro assumptions are borrowed.
export const SECTOR_ALIASES = {
  'Financial Services': 'Banks',
  'Information Technology': 'IT Services',
  'Oil Gas & Consumable Fuels': 'Oil & Gas',
  'Fast Moving Consumer Goods': 'FMCG',
  Healthcare: 'Pharma',
  'Automobile and Auto Components': 'Automobiles',
  'Metals & Mining': 'Metals & Mining',
  'Capital Goods': 'Capital Goods',
  Construction: 'Capital Goods',
  Power: 'Power & Utilities',
  Utilities: 'Power & Utilities',
  Telecommunication: 'Telecom',
  'Construction Materials': 'Cement',
  Realty: 'Realty',
  Chemicals: 'Chemicals',
  'Consumer Durables': 'Automobiles',
  Textiles: 'Chemicals',
};

const NEUTRAL = { kind: 'operating', sens: {}, why: {} };

export function sectorInfo(sector) {
  if (SECTORS[sector]) return SECTORS[sector];
  const alias = SECTOR_ALIASES[sector];
  if (alias && SECTORS[alias]) return { ...SECTORS[alias], kind: 'operating', aliasOf: alias };
  return NEUTRAL;
}
