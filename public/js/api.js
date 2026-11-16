// Fetch wrapper with consistent error objects.
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `Request failed (${status})`);
    this.status = status;
    this.code = body?.error;
    this.body = body;
  }
}

const cache = new Map();

export async function api(path, { method = 'GET', body, fresh = false } = {}) {
  const key = method === 'GET' ? path : null;
  if (key && !fresh && cache.has(key) && Date.now() - cache.get(key).at < 30000) return cache.get(key).data;
  let res;
  try {
    res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, { message: 'Could not reach the server. Check your connection and try again.' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  if (key) cache.set(key, { at: Date.now(), data });
  else cache.clear();
  return data;
}

export const clearCache = () => cache.clear();
