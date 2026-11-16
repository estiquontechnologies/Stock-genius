export const pct = (x, d = 1) => (x == null || !Number.isFinite(x) ? 'n/a' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`);
export const pctAbs = (x, d = 1) => (x == null || !Number.isFinite(x) ? 'n/a' : `${(x * 100).toFixed(d)}%`);
export const inr = (x, d = 2) => (x == null || !Number.isFinite(x) ? 'n/a' : `₹${Number(x).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })}`);
export const num = (x, d = 1) => (x == null || !Number.isFinite(x) ? 'n/a' : Number(x).toFixed(d));
export const crore = (x) => (x == null || !Number.isFinite(x) ? 'n/a' : `₹${Math.round(x).toLocaleString('en-IN')} cr`);
export const clamp = (x, a = -1, b = 1) => Math.min(b, Math.max(a, x));
