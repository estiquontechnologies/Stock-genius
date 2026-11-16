// Free news via publisher RSS feeds that YOU configure (NEWS_RSS_FEEDS).
// Only headline, link, time and the feed's own short description are kept;
// the app links back to the publisher. Check each publisher's RSS terms.
// Tone is NOT classified (tone: 0), so news never moves the score unless
// you add a classifier. Items are matched to companies by name or ticker.

const TTL_MS = 30 * 60 * 1000;

const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/\s+/g, ' ').trim();

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]) : '';
};

export function parseRss(xml, feedUrl) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  const channel = tag(xml.split(/<item|<entry/i)[0], 'title') || new URL(feedUrl).hostname;
  for (const b of blocks) {
    const title = tag(b, 'title');
    let link = tag(b, 'link');
    if (!link) { const m = b.match(/<link[^>]*href="([^"]+)"/i); link = m ? m[1] : ''; }
    const date = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    const t = Date.parse(date);
    if (!title || !link || !Number.isFinite(t)) continue;
    if (!/^https?:\/\//i.test(link)) continue;
    items.push({ title, link, publishedAt: new Date(t).toISOString(), description: (tag(b, 'description') || tag(b, 'summary')).slice(0, 300), channel });
  }
  return items;
}

const stripSuffix = (name) => name.replace(/\b(limited|ltd\.?|industries|corporation|corp\.?|company|co\.?|india)\b/gi, '').replace(/\s+/g, ' ').trim();

export class RssNews {
  constructor(feeds, { fetchImpl = globalThis.fetch } = {}) {
    this.feeds = feeds;
    this.fetch = fetchImpl;
    this.cache = null;
    this.fetchedAt = 0;
    this.errors = [];
  }

  get enabled() { return this.feeds.length > 0; }

  async load(instruments) {
    if (!this.enabled) return [];
    if (this.cache && Date.now() - this.fetchedAt < TTL_MS) return this.cache;
    this.errors = [];
    const matchers = instruments.map((i) => ({ ticker: i.ticker, sector: i.sector, re: new RegExp(`\\b(${[stripSuffix(i.name), i.ticker].filter((x) => x.length >= 3).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i') }));
    const out = [];
    await Promise.all(this.feeds.map(async (url) => {
      try {
        const res = await this.fetch(url, { headers: { 'User-Agent': 'stock-genius/0.1 (RSS reader)' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        for (const it of parseRss(await res.text(), url)) {
          const hits = matchers.filter((m) => m.re.test(it.title));
          const id = `rss-${Buffer.from(it.link).toString('base64url').slice(-24)}`;
          out.push({
            id, scope: hits.length ? 'company' : 'market', tickers: hits.map((h) => h.ticker), sector: hits[0]?.sector || null,
            category: 'news', kind: 'rss', headline: it.title, facts: it.description ? [it.description] : [],
            tone: 0, magnitude: 0, source: it.channel, url: it.link, publishedAt: it.publishedAt, sample: false,
            note: 'Headline from a publisher RSS feed. Tone not classified. Company matching is by name and may be wrong.',
          });
        }
      } catch (e) {
        this.errors.push(`${url}: ${e.message}`);
      }
    }));
    const seen = new Set();
    this.cache = out.filter((x) => (seen.has(x.id) ? false : seen.add(x.id)));
    this.fetchedAt = Date.now();
    return this.cache;
  }
}
