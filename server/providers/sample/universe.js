// SAMPLE UNIVERSE — every company below is FICTIONAL. Names and tickers were
// invented for demonstration and do not refer to any real listed company.
// Parameters only shape the simulated price and fundamentals series.
//
// Fields: growth = annual revenue growth; margin = operating (EBITDA) margin;
// marginTrend = change in margin (percentage points) across 8 quarters;
// netMargin = net profit / revenue; de = debt/equity (operating cos);
// ocf = operating cash flow / net profit; pe = target trailing P/E at latest
// close; drift = annual price drift; idio = annual idiosyncratic volatility.

const S = (ticker, name, sector, exchanges, p) => ({ ticker, name, sector, exchanges, ...p });

export const SAMPLE_COMPANIES = [
  // Banks (financial metrics: gnpa = gross NPA %, nim = net interest margin %)
  S('AURLEDGR', 'Aurora Ledger Bank', 'Banks', ['NSE', 'BSE'], { beta: 1.1, idio: 0.2, drift: 0.14, pe: 17, growth: 0.16, margin: 0.42, marginTrend: 1.0, netMargin: 0.2, gnpa: 1.8, nim: 3.9, ocf: 1.0, shares: 760, start: 1420 }),
  S('VRDMBANK', 'Veridian Mutual Bank', 'Banks', ['NSE', 'BSE'], { beta: 1.25, idio: 0.27, drift: -0.12, pe: 11, growth: 0.07, margin: 0.36, marginTrend: -2.5, netMargin: 0.13, gnpa: 4.6, nim: 3.1, ocf: 0.8, shares: 540, start: 610 }),
  S('KSTRLFIN', 'Kestrel Lane Finance', 'Banks', ['NSE'], { beta: 1.35, idio: 0.32, drift: 0.05, pe: 24, growth: 0.24, margin: 0.48, marginTrend: -1.2, netMargin: 0.22, gnpa: 2.9, nim: 6.2, ocf: 0.7, shares: 62, start: 2300 }),
  // IT Services
  S('QLSTNINF', 'Quillstone Infotech', 'IT Services', ['NSE', 'BSE'], { beta: 0.85, idio: 0.21, drift: 0.1, pe: 27, growth: 0.09, margin: 0.25, marginTrend: 0.6, netMargin: 0.18, de: 0.05, ocf: 1.1, shares: 410, start: 3650 }),
  S('NBLRSOFT', 'Nimbleridge Software', 'IT Services', ['NSE', 'BSE'], { beta: 1.0, idio: 0.3, drift: -0.18, pe: 34, growth: 0.03, margin: 0.17, marginTrend: -2.2, netMargin: 0.11, de: 0.1, ocf: 0.85, shares: 95, start: 1480 }),
  S('CYPHRDGT', 'Cypherleaf Digital', 'IT Services', ['NSE'], { beta: 1.15, idio: 0.34, drift: 0.24, pe: 41, growth: 0.21, margin: 0.21, marginTrend: 1.4, netMargin: 0.14, de: 0.15, ocf: 0.9, shares: 30, start: 4200 }),
  // Oil & Gas
  S('SFFRDLTA', 'Saffron Delta Energy', 'Oil & Gas', ['NSE', 'BSE'], { beta: 0.95, idio: 0.24, drift: 0.06, pe: 9, growth: 0.05, margin: 0.38, marginTrend: 0.5, netMargin: 0.16, de: 0.45, ocf: 1.3, shares: 1250, start: 265 }),
  S('BRNTWLLS', 'Brentwell Hydrocarbons', 'Oil & Gas', ['BSE'], { beta: 1.05, idio: 0.29, drift: -0.05, pe: 7.5, growth: 0.02, margin: 0.31, marginTrend: -1.5, netMargin: 0.12, de: 0.9, ocf: 1.1, shares: 380, start: 188 }),
  // FMCG
  S('MRGLDCON', 'Marigold Consumer Products', 'FMCG', ['NSE', 'BSE'], { beta: 0.6, idio: 0.16, drift: 0.08, pe: 52, growth: 0.08, margin: 0.24, marginTrend: 0.4, netMargin: 0.17, de: 0.02, ocf: 1.15, shares: 235, start: 2480 }),
  S('TLSIFOOD', 'Tulsi Grove Foods', 'FMCG', ['NSE', 'BSE'], { beta: 0.7, idio: 0.22, drift: -0.08, pe: 46, growth: 0.04, margin: 0.14, marginTrend: -1.8, netMargin: 0.08, de: 0.25, ocf: 0.95, shares: 120, start: 940 }),
  // Pharma
  S('HLXRPHRM', 'Helixara Pharma', 'Pharma', ['NSE', 'BSE'], { beta: 0.7, idio: 0.24, drift: 0.16, pe: 30, growth: 0.14, margin: 0.26, marginTrend: 1.8, netMargin: 0.17, de: 0.12, ocf: 1.05, shares: 160, start: 1560 }),
  S('MDVNLABS', 'Medvane Laboratories', 'Pharma', ['NSE'], { beta: 0.8, idio: 0.33, drift: -0.14, pe: 22, growth: 0.05, margin: 0.18, marginTrend: -2.0, netMargin: 0.1, de: 0.35, ocf: 0.75, shares: 84, start: 720 }),
  S('ORCHDBIO', 'Orchidline Biosciences', 'Pharma', ['BSE'], { beta: 0.75, idio: 0.28, drift: 0.04, pe: 26, growth: 0.1, margin: 0.21, marginTrend: 0.2, netMargin: 0.13, de: 0.2, ocf: 1.0, shares: 48, start: 1890 }),
  // Automobiles
  S('TRVLNMOT', 'Travelon Motors', 'Automobiles', ['NSE', 'BSE'], { beta: 1.2, idio: 0.26, drift: 0.2, pe: 24, growth: 0.15, margin: 0.13, marginTrend: 1.5, netMargin: 0.08, de: 0.3, ocf: 1.2, shares: 330, start: 980 }),
  S('GRDLAUTO', 'Gridline Auto Components', 'Automobiles', ['NSE'], { beta: 1.15, idio: 0.3, drift: -0.06, pe: 29, growth: 0.06, margin: 0.12, marginTrend: -0.8, netMargin: 0.06, de: 0.6, ocf: 0.85, shares: 70, start: 560 }),
  // Metals & Mining
  S('IRNCRSTL', 'Ironcrest Steel', 'Metals & Mining', ['NSE', 'BSE'], { beta: 1.4, idio: 0.32, drift: -0.1, pe: 12, growth: 0.01, margin: 0.17, marginTrend: -3.0, netMargin: 0.06, de: 1.1, ocf: 1.4, shares: 1100, start: 142 }),
  S('ZNTHMNRL', 'Zenthra Minerals', 'Metals & Mining', ['NSE', 'BSE'], { beta: 1.3, idio: 0.3, drift: 0.12, pe: 10, growth: 0.11, margin: 0.3, marginTrend: 1.2, netMargin: 0.15, de: 0.4, ocf: 1.25, shares: 420, start: 410 }),
  // Capital Goods
  S('FRGWYENG', 'Forgeway Engineering', 'Capital Goods', ['NSE', 'BSE'], { beta: 1.1, idio: 0.23, drift: 0.26, pe: 38, growth: 0.18, margin: 0.12, marginTrend: 0.8, netMargin: 0.08, de: 0.2, ocf: 0.8, shares: 140, start: 3150 }),
  S('PLRSTHVY', 'Polarstone Heavy Industries', 'Capital Goods', ['BSE'], { beta: 1.2, idio: 0.31, drift: 0.02, pe: 31, growth: 0.09, margin: 0.1, marginTrend: -0.5, netMargin: 0.05, de: 0.7, ocf: 0.6, shares: 52, start: 870 }),
  // Power & Utilities
  S('VLTRAPWR', 'Voltara Power Grid', 'Power & Utilities', ['NSE', 'BSE'], { beta: 0.8, idio: 0.19, drift: 0.11, pe: 18, growth: 0.1, margin: 0.55, marginTrend: 0.3, netMargin: 0.2, de: 1.6, ocf: 1.5, shares: 900, start: 305 }),
  S('SUNRYGRN', 'Sunray Green Energy', 'Power & Utilities', ['NSE'], { beta: 1.3, idio: 0.4, drift: -0.2, pe: 85, growth: 0.3, margin: 0.68, marginTrend: -1.0, netMargin: 0.08, de: 2.8, ocf: 1.1, shares: 155, start: 1320 }),
  // Telecom
  S('SGNLWAVE', 'Signalwave Communications', 'Telecom', ['NSE', 'BSE'], { beta: 0.9, idio: 0.22, drift: 0.15, pe: 48, growth: 0.13, margin: 0.5, marginTrend: 1.6, netMargin: 0.1, de: 1.9, ocf: 2.5, shares: 590, start: 1180 }),
  // Cement
  S('BSLTCMNT', 'Basalt Ridge Cement', 'Cement', ['NSE', 'BSE'], { beta: 0.95, idio: 0.22, drift: 0.07, pe: 35, growth: 0.08, margin: 0.18, marginTrend: 0.9, netMargin: 0.09, de: 0.4, ocf: 1.2, shares: 29, start: 9800 }),
  S('GRNTFRT', 'Granitefort Cement', 'Cement', ['BSE'], { beta: 1.0, idio: 0.28, drift: -0.09, pe: 40, growth: 0.03, margin: 0.13, marginTrend: -1.7, netMargin: 0.05, de: 0.85, ocf: 0.9, shares: 41, start: 2100 }),
  // Realty
  S('SKYHRBR', 'Skyharbor Estates', 'Realty', ['NSE', 'BSE'], { beta: 1.5, idio: 0.38, drift: 0.18, pe: 44, growth: 0.25, margin: 0.28, marginTrend: 1.1, netMargin: 0.17, de: 0.55, ocf: 0.7, shares: 110, start: 1350 }),
  S('LNTRNHMS', 'Lanternhill Homes', 'Realty', ['NSE'], { beta: 1.45, idio: 0.42, drift: -0.15, pe: 58, growth: 0.06, margin: 0.2, marginTrend: -2.4, netMargin: 0.08, de: 1.3, ocf: 0.5, shares: 64, start: 640 }),
  // Chemicals
  S('CBLTCHEM', 'Cobaltine Chemicals', 'Chemicals', ['NSE', 'BSE'], { beta: 1.0, idio: 0.27, drift: 0.0, pe: 33, growth: 0.07, margin: 0.19, marginTrend: -0.6, netMargin: 0.11, de: 0.3, ocf: 0.95, shares: 58, start: 1720 }),
  S('INDGSPEC', 'Indigospire Specialty Chemicals', 'Chemicals', ['NSE'], { beta: 1.05, idio: 0.31, drift: 0.13, pe: 39, growth: 0.16, margin: 0.23, marginTrend: 1.3, netMargin: 0.14, de: 0.15, ocf: 1.0, shares: 26, start: 2650 }),
];
