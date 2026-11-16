// Dependency-free SVG charts rendered at the container's real pixel width.
import { esc, fmt } from './ui.js';

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export function sparkline(values, { w = 120, h = 34, color } = {}) {
  const v = (values || []).filter((x) => Number.isFinite(x));
  if (v.length < 2) return '';
  const min = Math.min(...v);
  const max = Math.max(...v);
  const span = max - min || 1;
  const pts = v.map((x, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(h - 2 - ((x - min) / span) * (h - 4)).toFixed(1)}`).join(' ');
  const c = color || (v.at(-1) >= v[0] ? 'var(--up)' : 'var(--down)');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Trend: ${v.at(-1) >= v[0] ? 'up' : 'down'} over the period"><polyline fill="none" stroke="${c}" stroke-width="1.6" stroke-linejoin="round" points="${pts}"/></svg>`;
}

function niceTicks(min, max, n = 4) {
  const span = max - min || 1;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || step0;
  const out = [];
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) out.push(+t.toFixed(6));
  return out;
}

function monthTicks(dates, maxTicks) {
  const idx = [];
  for (let i = 1; i < dates.length; i++) if (dates[i].slice(0, 7) !== dates[i - 1].slice(0, 7)) idx.push(i);
  const every = Math.max(1, Math.ceil(idx.length / maxTicks));
  return idx.filter((_, k) => k % every === 0);
}
const monthLabel = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });

/**
 * Price chart with moving averages, volume, support/resistance lines and
 * event markers. `markers`: [{date, label, dir}] (e.g. unusual moves).
 */
export function priceChart(el, bars, { levels, markers = [], height = 340, freshness } = {}) {
  const draw = () => {
    const W = Math.max(300, el.clientWidth);
    const H = height;
    const pad = { l: 8, r: 58, t: 12, b: 26 };
    const volH = 52;
    const ph = H - pad.t - pad.b - volH - 8;
    const n = bars.length;
    const x = (i) => pad.l + (i / Math.max(1, n - 1)) * (W - pad.l - pad.r);
    const closes = bars.map((b) => b.close);
    const extra = [levels?.support?.price, levels?.resistance?.price].filter((v) => v && v > Math.min(...closes) * 0.85 && v < Math.max(...closes) * 1.15);
    const lo = Math.min(...bars.map((b) => b.low), ...extra);
    const hi = Math.max(...bars.map((b) => b.high), ...extra);
    const y = (v) => pad.t + ph - ((v - lo) / (hi - lo || 1)) * ph;
    const maxVol = Math.max(...bars.map((b) => b.volume)) || 1;
    const vy = (v) => H - pad.b - (v / maxVol) * volH;
    const line = (key) => bars.map((b, i) => (b[key] == null ? null : `${x(i).toFixed(1)},${y(b[key]).toFixed(1)}`)).filter(Boolean).join(' ');
    const up = closes.at(-1) >= closes[0];
    const c1 = css('--chart-1');
    const area = `${x(0)},${pad.t + ph} ${line('close')} ${x(n - 1)},${pad.t + ph}`;
    const ticks = niceTicks(lo, hi, 4);
    const mt = monthTicks(bars.map((b) => b.date), Math.floor(W / 90));
    const barW = Math.max(1, (W - pad.l - pad.r) / n - 1);
    const mIdx = markers.map((m) => ({ ...m, i: bars.findIndex((b) => b.date === m.date) })).filter((m) => m.i >= 0);

    el.innerHTML = `
      <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Price chart: ${esc(fmt.inr(closes[0]))} to ${esc(fmt.inr(closes.at(-1)))} over ${n} sessions, ${up ? 'up' : 'down'} ${esc(fmt.pct(closes.at(-1) / closes[0] - 1))}">
        <defs><linearGradient id="pc-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${c1}" stop-opacity="0.16"/><stop offset="1" stop-color="${c1}" stop-opacity="0"/></linearGradient></defs>
        ${ticks.map((t) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--grid)"/><text x="${W - pad.r + 6}" y="${y(t) + 4}" font-size="11" fill="var(--muted)">${esc(fmt.num(t, t >= 1000 ? 0 : 1))}</text>`).join('')}
        ${mt.map((i) => `<text x="${x(i)}" y="${H - 8}" font-size="11" fill="var(--muted)" text-anchor="middle">${esc(monthLabel(bars[i].date))}</text>`).join('')}
        ${bars.map((b, i) => `<rect x="${x(i) - barW / 2}" y="${vy(b.volume)}" width="${barW}" height="${H - pad.b - vy(b.volume)}" fill="${i && b.close < bars[i - 1].close ? 'var(--down)' : 'var(--up)'}" opacity="0.28"/>`).join('')}
        <polygon points="${area}" fill="url(#pc-fill)"/>
        <polyline points="${line('close')}" fill="none" stroke="${c1}" stroke-width="1.8" stroke-linejoin="round"/>
        ${bars.some((b) => b.sma50) ? `<polyline points="${line('sma50')}" fill="none" stroke="var(--chart-2)" stroke-width="1.3" stroke-dasharray="0"/>` : ''}
        ${bars.some((b) => b.sma200) ? `<polyline points="${line('sma200')}" fill="none" stroke="var(--chart-4)" stroke-width="1.3" stroke-dasharray="5 4"/>` : ''}
        ${[['support', levels?.support], ['resistance', levels?.resistance]].filter(([, l]) => l && l.price >= lo && l.price <= hi).map(([k, l]) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(l.price)}" y2="${y(l.price)}" stroke="${k === 'support' ? 'var(--up)' : 'var(--down)'}" stroke-dasharray="2 4" stroke-width="1.2"/><text x="${pad.l + 4}" y="${y(l.price) - 4}" font-size="10.5" fill="${k === 'support' ? 'var(--up)' : 'var(--down)'}">${k === 'support' ? 'Support' : 'Resistance'} ${esc(fmt.inr(l.price, 0))}</text>`).join('')}
        ${mIdx.map((m) => `<g class="mk" data-i="${m.i}"><circle cx="${x(m.i)}" cy="${y(bars[m.i].close)}" r="5.5" fill="var(--surface)" stroke="${m.dir > 0 ? 'var(--up)' : 'var(--down)'}" stroke-width="2.2"/></g>`).join('')}
        <line class="cross" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--line-2)" visibility="hidden"/>
        <rect class="hit" x="${pad.l}" y="${pad.t}" width="${W - pad.l - pad.r}" height="${H - pad.t - pad.b}" fill="transparent"/>
      </svg>
      <div class="tip" hidden></div>`;
    const svg = el.querySelector('svg');
    const tip = el.querySelector('.tip');
    const cross = el.querySelector('.cross');
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
      const i = Math.max(0, Math.min(n - 1, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (n - 1))));
      const b = bars[i];
      const mk = mIdx.find((m) => Math.abs(m.i - i) <= 1);
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.innerHTML = `<b>${esc(fmt.date(b.date))}</b><br>Close ${esc(fmt.inr(b.close))} <span class="${i && b.close >= bars[i - 1].close ? 'up' : 'down'}">${i ? esc(fmt.pct(b.close / bars[i - 1].close - 1)) : ''}</span><br><span class="muted">O ${esc(fmt.num(b.open, 1))} · H ${esc(fmt.num(b.high, 1))} · L ${esc(fmt.num(b.low, 1))}</span><br><span class="muted">Vol ${esc(Number(b.volume).toLocaleString('en-IN'))}</span>${b.sma50 ? `<br><span class="muted">50-day avg ${esc(fmt.num(b.sma50, 1))}</span>` : ''}${b.sma200 ? `<br><span class="muted">200-day avg ${esc(fmt.num(b.sma200, 1))}</span>` : ''}${mk ? `<hr style="border:0;border-top:1px solid var(--line)"><b>${esc(mk.label)}</b>` : ''}`;
      const tx = Math.min(W - 190, Math.max(0, x(i) + 12));
      tip.style.left = `${tx}px`; tip.style.top = '10px';
    };
    const hit = el.querySelector('.hit');
    hit.addEventListener('mousemove', move);
    hit.addEventListener('touchmove', move, { passive: true });
    hit.addEventListener('mouseleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
  };
  draw();
  const ro = new ResizeObserver(() => draw());
  ro.observe(el);
  return () => ro.disconnect();
}

/** Multi-series line chart (e.g. normalised comparison). */
export function lineChart(el, { dates, series, height = 260, yFormat = (v) => fmt.num(v, 0), baseline }) {
  const draw = () => {
    const W = Math.max(300, el.clientWidth);
    const H = height;
    const pad = { l: 8, r: 52, t: 10, b: 24 };
    const all = series.flatMap((s) => s.values).filter(Number.isFinite);
    if (baseline != null) all.push(baseline);
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const n = dates.length;
    const x = (i) => pad.l + (i / Math.max(1, n - 1)) * (W - pad.l - pad.r);
    const y = (v) => pad.t + (H - pad.t - pad.b) - ((v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);
    const ticks = niceTicks(lo, hi, 4);
    const mt = monthTicks(dates, Math.floor(W / 90));
    el.innerHTML = `<svg width="${W}" height="${H}" role="img" aria-label="${esc(series.map((s) => `${s.name}: ${yFormat(s.values.at(-1))}`).join('; '))}">
      ${ticks.map((t) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--grid)"/><text x="${W - pad.r + 6}" y="${y(t) + 4}" font-size="11" fill="var(--muted)">${esc(yFormat(t))}</text>`).join('')}
      ${baseline != null ? `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(baseline)}" y2="${y(baseline)}" stroke="var(--line-2)" stroke-dasharray="4 4"/>` : ''}
      ${mt.map((i) => `<text x="${x(i)}" y="${H - 6}" font-size="11" fill="var(--muted)" text-anchor="middle">${esc(monthLabel(dates[i]))}</text>`).join('')}
      ${series.map((s) => `<polyline fill="none" stroke="${s.color}" stroke-width="${s.width || 1.8}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} stroke-linejoin="round" points="${s.values.map((v, i) => (Number.isFinite(v) ? `${x(i).toFixed(1)},${y(v).toFixed(1)}` : null)).filter(Boolean).join(' ')}"/>`).join('')}
      ${series.map((s) => (Number.isFinite(s.values.at(-1)) ? `<circle cx="${x(n - 1)}" cy="${y(s.values.at(-1))}" r="3.5" fill="${s.color}"/>` : '')).join('')}
    </svg>`;
  };
  draw();
  const ro = new ResizeObserver(() => draw());
  ro.observe(el);
  return () => ro.disconnect();
}

export const SERIES_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];
