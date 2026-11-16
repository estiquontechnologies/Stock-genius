// Turns a news item into: reported facts (from the source) + a reasoned,
// clearly-labelled analysis of possible stock impact + the observed price
// reaction (a fact, but not proof of cause).

import { sectorInfo } from './sectors.js';

const COMPANY = {
  results: {
    1: 'Results ahead of the recent trend can lead investors to raise earnings expectations. Whether the beat is recurring (volume, pricing) or one-off (other income, tax) matters for how long any effect lasts.',
    '-1': 'Results below the recent trend can lead investors to lower earnings expectations. Management commentary on whether the weakness is temporary is the key thing to watch.',
    0: 'Results in line with the recent trend usually have limited lasting price impact on their own.',
  },
  order_win: { 1: 'Adds revenue visibility over the execution period. The effect on profit depends on contract margins, which are often not disclosed.' },
  capacity: { 1: 'Could support growth once commissioned, but adds execution and funding risk while it is being built.' },
  rating_up: { 1: 'A rating upgrade can lower borrowing costs and signals improved credit health; equity impact is usually modest.' },
  buyback: { 1: 'A buyback returns cash and can signal management confidence; the effect depends on its size relative to market value.' },
  loan_growth: { 1: 'Strong loan growth supports future interest income, provided asset quality holds.' },
  regulatory: { '-1': 'Regulatory observations can delay approvals or exports from the site. Severity depends on the nature of the observations and the site’s revenue share.' },
  mgmt_exit: { '-1': 'Senior management exits can raise questions about strategy or governance; the market often waits for clarity on the successor.' },
  block_deal: { '-1': 'A promoter stake sale increases share supply and may be read as a negative signal, though reasons vary (for example, debt reduction or estate planning).' },
  plant_outage: { '-1': 'A shutdown can cost production for its duration; the earnings effect depends on the plant’s share of output and insurance cover.' },
  tax_notice: { '-1': 'Tax demands are often contested and can take years to resolve; the risk is a cash outflow if the appeal fails.' },
  asset_quality: { '-1': 'Rising stressed loans can lead to higher provisions, reducing profit in coming quarters.' },
  board_meeting: { 0: 'A routine filing. It sets the date for results, which can be a source of price movement.' },
  rating_reaffirmed: { 0: 'A routine filing with little expected price impact.' },
  analyst_meet: { 0: 'A routine filing. Commentary at the meeting may matter more than the filing itself.' },
  agm: { 0: 'A routine filing with little expected price impact.' },
};

export function analyseImpact(item, { sector } = {}) {
  if (item.scope === 'company') {
    const t = COMPANY[item.kind] || {};
    return t[String(item.tone)] || t[item.tone] || (item.tone > 0 ? 'The development appears favourable, but its financial effect is not yet quantified.' : item.tone < 0 ? 'The development appears unfavourable, but its financial effect is not yet quantified.' : 'Limited expected price impact.');
  }
  if (item.scope === 'sector') {
    return `${item.tone > 0 ? 'A supportive' : 'An adverse'} development for the ${item.sector} sector broadly. Individual companies differ in how much they are affected.`;
  }
  // market-level: describe likely sector channels
  const info = sector ? sectorInfo(sector) : null;
  const k = item.kind;
  const channel = {
    crude_spike: 'crude', geo_tension: 'crude', inr_slide: 'inr', policy_cut: 'rates', policy_hawkish: 'rates', cpi_soft: 'rates', global_selloff: 'globalRisk', global_rally: 'globalRisk', trade_deal: 'globalRisk',
  }[k];
  const base = `A market-wide development (${item.category}).`;
  if (info && channel && info.why[channel]) return `${base} For ${sector}: ${info.why[channel]}`;
  return `${base} It may affect most stocks through overall risk appetite.`;
}

export function observedReaction(item, dates, closes, market) {
  const t = Date.parse(item.publishedAt);
  let i = dates.findIndex((d) => Date.parse(`${d}T15:30:00+05:30`) >= t);
  if (i <= 0) return null;
  const r = closes[i] / closes[i - 1] - 1;
  const m = market ? market[i] / market[i - 1] - 1 : null;
  return { session: dates[i], ret: +r.toFixed(4), marketRet: m == null ? null : +m.toFixed(4) };
}
