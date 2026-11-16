// Tiny JSON-file store for USER-ENTERED data (watchlists, follows, theses,
// journal, portfolio) and the server's own log of recommendations it has
// published. Single-user MVP: add authentication and a real database
// before serving multiple users.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const EMPTY = () => ({
  version: 1,
  watchlists: [{ id: 'default', name: 'My watchlist', tickers: [], createdAt: new Date().toISOString() }],
  follows: [],
  readAlerts: [],
  theses: [],
  journal: [],
  portfolio: { holdings: [], updatedAt: null },
  recommendationLog: [],
});

export class Store {
  constructor(file) {
    this.file = file;
    this.data = EMPTY();
    if (file && fs.existsSync(file)) {
      try {
        this.data = { ...EMPTY(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
      } catch (e) {
        const bad = `${file}.corrupt-${Date.now()}`;
        fs.renameSync(file, bad);
        console.warn(`[store] Could not parse ${file}; moved to ${bad} and started fresh.`);
      }
    }
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  id() {
    return crypto.randomUUID();
  }

  // ---------------------------------------------------------- watchlists
  listWatchlists() { return this.data.watchlists; }
  createWatchlist(name) {
    const w = { id: this.id(), name, tickers: [], createdAt: new Date().toISOString() };
    this.data.watchlists.push(w); this.save(); return w;
  }
  updateWatchlist(id, { name, tickers }) {
    const w = this.data.watchlists.find((x) => x.id === id);
    if (!w) return null;
    if (name != null) w.name = name;
    if (tickers != null) w.tickers = [...new Set(tickers)];
    this.save(); return w;
  }
  deleteWatchlist(id) {
    const before = this.data.watchlists.length;
    this.data.watchlists = this.data.watchlists.filter((x) => x.id !== id);
    this.save(); return this.data.watchlists.length < before;
  }

  // ------------------------------------------------------------- follows
  listFollows() { return this.data.follows; }
  follow(ticker, { horizon = 'medium', types = ['view', 'confidence', 'risk', 'signal'] } = {}) {
    this.data.follows = this.data.follows.filter((f) => f.ticker !== ticker);
    const f = { ticker, horizon, types, since: new Date().toISOString() };
    this.data.follows.push(f); this.save(); return f;
  }
  unfollow(ticker) {
    this.data.follows = this.data.follows.filter((f) => f.ticker !== ticker); this.save();
  }
  markRead(ids) {
    this.data.readAlerts = [...new Set([...this.data.readAlerts, ...ids])].slice(-5000); this.save();
  }

  // -------------------------------------------------------------- theses
  listTheses() { return this.data.theses; }
  getThesis(id) { return this.data.theses.find((t) => t.id === id) || null; }
  createThesis(t) {
    const th = { id: this.id(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), reviews: [], ...t };
    this.data.theses.push(th); this.save(); return th;
  }
  updateThesis(id, patch) {
    const t = this.getThesis(id);
    if (!t) return null;
    Object.assign(t, patch, { updatedAt: new Date().toISOString() });
    this.save(); return t;
  }
  deleteThesis(id) { this.data.theses = this.data.theses.filter((t) => t.id !== id); this.save(); }

  // ------------------------------------------------------------- journal
  listJournal() { return this.data.journal; }
  addJournal(e) {
    const j = { id: this.id(), createdAt: new Date().toISOString(), ...e };
    this.data.journal.unshift(j); this.save(); return j;
  }
  deleteJournal(id) { this.data.journal = this.data.journal.filter((j) => j.id !== id); this.save(); }

  // ----------------------------------------------------------- portfolio
  getPortfolio() { return this.data.portfolio; }
  setPortfolio(holdings) { this.data.portfolio = { holdings, updatedAt: new Date().toISOString() }; this.save(); return this.data.portfolio; }

  // ------------------------------------------------- recommendation log
  /** Append a published recommendation if it differs from the last one logged. */
  logRecommendation(entry) {
    const prev = [...this.data.recommendationLog].reverse().find((r) => r.ticker === entry.ticker && r.horizon === entry.horizon);
    if (prev && prev.view === entry.view && prev.confidenceBand === entry.confidenceBand && prev.riskLevel === entry.riskLevel && prev.asOfDate === entry.asOfDate) return false;
    if (prev && prev.asOfDate === entry.asOfDate && prev.view === entry.view) return false;
    this.data.recommendationLog.push({ ...entry, recordedAt: new Date().toISOString() });
    if (this.data.recommendationLog.length > 20000) this.data.recommendationLog.splice(0, 1000);
    this.save(); return true;
  }
  recommendationLog(ticker) { return this.data.recommendationLog.filter((r) => !ticker || r.ticker === ticker); }
}
