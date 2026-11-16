// Point-in-time fundamental helpers. Only quarters whose results were
// published on or before the as-of date are used, so historical
// recommendations never "see" results that were not yet public.

export function quartersAsOf(fundamentals, asOfDate) {
  if (!fundamentals) return [];
  return fundamentals.quarters.filter((q) => q.reportDate <= asOfDate);
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

export function ttmMetrics(quarters) {
  const n = quarters.length;
  if (!n) return null;
  const latest = quarters[n - 1];
  const out = { latest, latestLabel: latest.label, latestReportDate: latest.reportDate };
  if (n >= 4) {
    const last4 = quarters.slice(-4);
    out.revTtm = sum(last4.map((q) => q.revenue));
    out.npTtm = sum(last4.map((q) => q.netProfit));
    out.epsTtm = sum(last4.map((q) => q.eps));
    out.opTtm = sum(last4.map((q) => q.operatingProfit));
  }
  if (n >= 8) {
    const prev4 = quarters.slice(-8, -4);
    out.revGrowth = out.revTtm / sum(prev4.map((q) => q.revenue)) - 1;
    out.npGrowth = out.npTtm / sum(prev4.map((q) => q.netProfit)) - 1;
    out.growthBasis = 'trailing four quarters vs the prior four';
  } else if (n >= 5) {
    const yo = quarters[n - 5];
    out.revGrowth = latest.revenue / yo.revenue - 1;
    out.npGrowth = latest.netProfit / yo.netProfit - 1;
    out.growthBasis = `${latest.label} vs ${yo.label} (year on year)`;
  }
  if (n >= 5) {
    const yo = quarters[n - 5];
    out.marginYearAgo = yo.operatingMargin;
    out.marginDelta = latest.operatingMargin - yo.operatingMargin;
    if (latest.nim != null) out.nimDelta = latest.nim - yo.nim;
    if (latest.gnpa != null) out.gnpaDelta = latest.gnpa - yo.gnpa;
    out.yearAgoLabel = yo.label;
  }
  if (n >= 2) {
    const prev = quarters[n - 2];
    const g = out.npGrowth != null ? (1 + out.npGrowth) ** 0.25 - 1 : 0;
    out.surprise = latest.netProfit / (prev.netProfit * (1 + g)) - 1;
  }
  return out;
}

export function peAt(price, quarters) {
  const t = ttmMetrics(quarters);
  if (!t || t.epsTtm == null) return null;
  if (t.epsTtm <= 0) return { pe: null, loss: true, eps: t.epsTtm };
  return { pe: price / t.epsTtm, eps: t.epsTtm };
}
