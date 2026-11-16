// Stock Genius HTTP server: JSON API + static frontend. Zero dependencies.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { createProvider } from './providers/index.js';
import { Store } from './services/store.js';
import { createApi } from './api.js';

const PUBLIC = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };

export const ads = {
  provider: (process.env.AD_PROVIDER || 'none').toLowerCase(),
  client: process.env.ADSENSE_CLIENT || '',
  slots: { banner: process.env.ADSENSE_SLOT_BANNER || '', sidebar: process.env.ADSENSE_SLOT_SIDEBAR || '', inline: process.env.ADSENSE_SLOT_INLINE || '' },
  adsTxt: process.env.ADS_TXT || '',
};
const adsEnabled = ads.provider === 'adsense' && /^ca-pub-\d+$/.test(ads.client);

function securityHeaders(res) {
  const adSrc = adsEnabled ? ' https://pagead2.googlesyndication.com https://*.googlesyndication.com https://*.doubleclick.net https://*.google.com https://*.gstatic.com https://adservice.google.com' : '';
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    `script-src 'self'${adSrc}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self' data:${adSrc}`,
    `frame-src${adsEnabled ? adSrc : " 'none'"}`,
    `connect-src 'self'${adSrc}`,
    "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function serveStatic(req, res) {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel === '/') rel = '/index.html';
  if (rel === '/ads.txt') {
    res.writeHead(ads.adsTxt ? 200 : 404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(ads.adsTxt ? `${ads.adsTxt.replace(/\\n/g, '\n')}\n` : 'No ads.txt configured\n');
  }
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(file, (err, st) => {
    const target = !err && st.isFile() ? file : path.join(PUBLIC, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] || 'application/octet-stream', 'Cache-Control': target.endsWith('index.html') ? 'no-cache' : 'public, max-age=300' });
    fs.createReadStream(target).pipe(res);
  });
}

export function createServer({ provider, store, collector }) {
  const api = createApi({ provider, store, collector, ads: { ...ads, enabled: adsEnabled } });
  return http.createServer(async (req, res) => {
    securityHeaders(res);
    if (req.url.startsWith('/api/')) return api(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res);
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.join(ROOT, 'server', 'index.js');
if (isMain) {
  const { provider, collector } = createProvider(config);
  const store = new Store(config.storeFile);
  const server = createServer({ provider, store, collector });
  server.listen(config.port, config.host, () => {
    console.log(`Stock Genius running at http://${config.host}:${config.port}  (data: ${provider.id}${adsEnabled ? ', ads: AdSense' : ', ads: off'})`);
  });
}
