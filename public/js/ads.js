// Advertising (Google AdSense) with consent, kept visually and logically
// separate from research content. Ads never render inside recommendation,
// evidence, risk or news sections — only in designated slots.
import { html, $$ } from './ui.js';

let cfg = { enabled: false };
let scriptLoaded = false;
const KEY = 'sg-consent-v1';

const getConsent = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const setConsent = (v) => { try { localStorage.setItem(KEY, v); } catch { /* storage unavailable */ } };

export function initAds(adsCfg) {
  cfg = adsCfg || { enabled: false };
  if (cfg.enabled && !getConsent()) showConsent();
  document.getElementById('consent-reopen')?.addEventListener('click', showConsent);
}

function showConsent() {
  document.querySelector('.consent')?.remove();
  const el = document.createElement('div');
  el.className = 'consent';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Advertising and privacy choices');
  el.innerHTML = `<div><b>Stock Genius is free because of advertising.</b>
    <p class="small muted">With your permission our ad partner (Google) may use cookies to show more relevant ads. If you choose “Essential only”, we request non-personalised ads. Your research notes, watchlists and portfolio are never shared with advertisers. Ads are always labelled and are never part of any research view.</p></div>
    <div class="row"><button class="btn primary" data-c="all">Accept personalised ads</button><button class="btn" data-c="essential">Essential only</button><a class="btn ghost" href="#/methodology/privacy">Privacy details</a></div>`;
  el.addEventListener('click', (e) => {
    const c = e.target.closest('[data-c]')?.dataset.c;
    if (!c) return;
    setConsent(c);
    el.remove();
    hydrateAds();
  });
  document.body.appendChild(el);
}

function loadScript() {
  if (scriptLoaded || !cfg.enabled) return;
  scriptLoaded = true;
  window.adsbygoogle = window.adsbygoogle || [];
  if (getConsent() !== 'all') window.adsbygoogle.requestNonPersonalizedAds = 1;
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(cfg.client)}`;
  s.crossOrigin = 'anonymous';
  document.head.appendChild(s);
}

/** Placeholder for an ad. kind: banner | inline | sidebar */
export function adSlot(kind = 'banner') {
  if (!cfg.enabled) {
    return html`<aside class="ad-slot placeholder" aria-label="Advertisement space"><span class="ad-label">Advertisement</span><span>Ad space — ads are not configured on this server.</span></aside>`;
  }
  return html`<aside class="ad-slot" aria-label="Advertisement" data-ad="${kind}"><span class="ad-label">Advertisement · not part of Stock Genius research</span></aside>`;
}

export function hydrateAds() {
  if (!cfg.enabled || !getConsent()) return;
  loadScript();
  for (const el of $$('.ad-slot[data-ad]:not([data-filled])')) {
    const slot = cfg.slots?.[el.dataset.ad] || cfg.slots?.banner;
    if (!slot) continue;
    el.dataset.filled = '1';
    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.dataset.adClient = cfg.client;
    ins.dataset.adSlot = slot;
    ins.dataset.adFormat = 'auto';
    ins.dataset.fullWidthResponsive = 'true';
    el.appendChild(ins);
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* blocked */ }
  }
}
