// Sovereign Index persistence — zero-dep node:sqlite (Node >= 22.5).
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

const DB_PATH = process.env.SOV_DB_PATH || path.resolve(process.cwd(), "data/sovereign.db");

export function openDB() {
  if (DB_PATH !== ":memory:") mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  migrate(db);
  return db;
}

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS indexes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      drift_threshold_bps INTEGER NOT NULL DEFAULT 300
    );
    CREATE TABLE IF NOT EXISTS index_weights (
      index_id INTEGER NOT NULL,
      ticker TEXT NOT NULL,
      target_wmicro INTEGER NOT NULL,
      PRIMARY KEY (index_id, ticker)
    );
    CREATE TABLE IF NOT EXISTS positions (
      index_id INTEGER NOT NULL,
      ticker TEXT NOT NULL,
      balance_raw INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (index_id, ticker)
    );
    CREATE TABLE IF NOT EXISTS agent_state (
      index_id INTEGER PRIMARY KEY,
      nonce INTEGER NOT NULL DEFAULT 0,
      last_run_ts INTEGER,
      last_rebalance_ts INTEGER,
      last_drift_bps INTEGER,
      status TEXT NOT NULL DEFAULT 'idle'
    );
    CREATE TABLE IF NOT EXISTS rebalance_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      index_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      ticker TEXT NOT NULL,
      qty INTEGER NOT NULL,
      usd_micro INTEGER NOT NULL,
      px_micro INTEGER NOT NULL,
      ref TEXT,
      ts INTEGER NOT NULL,
      decision_hash TEXT,
      payload TEXT
    );
    CREATE TABLE IF NOT EXISTS price_snapshot (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      payload TEXT NOT NULL
    );
  `);
  // idempotent DCA columns (added 2026-09; CREATE IF NOT EXISTS never adds columns)
  const cols = db.prepare(`PRAGMA table_info(indexes)`).all().map((c) => c.name);
  if (!cols.includes("dca_usd_micro")) db.exec(`ALTER TABLE indexes ADD COLUMN dca_usd_micro INTEGER NOT NULL DEFAULT 0`);
  if (!cols.includes("dca_period_days")) db.exec(`ALTER TABLE indexes ADD COLUMN dca_period_days INTEGER NOT NULL DEFAULT 7`);
  if (!cols.includes("dca_next_ts")) db.exec(`ALTER TABLE indexes ADD COLUMN dca_next_ts INTEGER`);
}

// --- index CRUD --------------------------------------------------------------
export function createIndex(db, { name, weights, thresholdBps, seedUsdMicro, dcaUsdMicro, dcaPeriodDays }) {
  const now = Date.now();
  dcaUsdMicro = BigInt(dcaUsdMicro || 0);
  const period = Number(dcaPeriodDays || 7);
  const ins = db.prepare(`
    INSERT INTO indexes(name, created_at, drift_threshold_bps, dca_usd_micro, dca_period_days, dca_next_ts)
    VALUES(?,?,?,?,?,?)
  `);
  const info = ins.run(name, now, thresholdBps ?? 300, String(dcaUsdMicro), period,
    dcaUsdMicro > 0n ? now + period * 86_400_000 : null);
  const id = Number(info.lastInsertRowid);
  const w = db.prepare("INSERT INTO index_weights(index_id, ticker, target_wmicro) VALUES(?,?,?)");
  for (const [tk, micro] of Object.entries(weights)) w.run(id, tk, Number(micro));
  // optional seed: insert placeholder position rows so the view is complete
  if (seedUsdMicro && seedUsdMicro > 0) seedPositions(db, id, weights, seedUsdMicro);
  return id;
}

export function updateDca(db, id, { dcaUsdMicro, dcaPeriodDays }) {
  const idx = db.prepare("SELECT * FROM indexes WHERE id=?").get(id);
  if (!idx) return null;
  const period = Number(dcaPeriodDays || 7);
  const usd = BigInt(dcaUsdMicro || 0);
  if (usd > 0n) {
    db.prepare("UPDATE indexes SET dca_usd_micro=?, dca_period_days=?, dca_next_ts=? WHERE id=?")
      .run(String(usd), period, Date.now() + period * 86_400_000, id);
  } else {
    db.prepare("UPDATE indexes SET dca_usd_micro=0, dca_period_days=?, dca_next_ts=NULL WHERE id=?")
      .run(period, id);
  }
  return getIndex(db, id);
}

export function getIndex(db, id) {
  const r = db.prepare("SELECT * FROM indexes WHERE id=?").get(id);
  if (!r) return null;
  r.dca = {
    usd_micro: r.dca_usd_micro,
    period_days: r.dca_period_days,
    next_ts: r.dca_next_ts,
  };
  r.weights = db.prepare("SELECT ticker, target_wmicro AS w FROM index_weights WHERE index_id=?").all(id)
    .reduce((a, x) => ({ ...a, [x.ticker]: BigInt(x.w) }), {});
  r.positions = db.prepare("SELECT ticker, balance_raw AS b FROM positions WHERE index_id=?").all(id)
    .reduce((a, x) => ({ ...a, [x.ticker]: BigInt(x.b) }), {});
  r.agent = db.prepare("SELECT * FROM agent_state WHERE index_id=?").get(id) || { nonce: 0, status: "idle" };
  r.log = db.prepare("SELECT id, action, ticker, qty, usd_micro AS usd, px_micro AS px, ref, ts, decision_hash AS hash FROM rebalance_log WHERE index_id=? ORDER BY id DESC LIMIT 30").all(id);
  return r;
}

export function listIndexes(db) {
  return db.prepare("SELECT id, name, created_at FROM indexes ORDER BY id").all();
}

export function setPositions(db, indexId, positions) {
  const up = db.prepare(`
    INSERT INTO positions(index_id, ticker, balance_raw) VALUES (?,?,?)
    ON CONFLICT(index_id,ticker) DO UPDATE SET balance_raw=excluded.balance_raw
  `);
  for (const [tk, bal] of Object.entries(positions)) up.run(indexId, tk, String(bal));
}

export function logRebalance(db, { indexId, action, ticker, qty, usdMicro, pxMicro, ref, decisionHash, payload }) {
  db.prepare(`
    INSERT INTO rebalance_log(index_id, action, ticker, qty, usd_micro, px_micro, ref, ts, decision_hash, payload)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(indexId, action, ticker, String(qty), String(usdMicro), String(pxMicro), ref ?? null, Date.now(), decisionHash ?? null, payload ?? null);
}

export function setAgentState(db, indexId, patch) {
  const cur = db.prepare("SELECT * FROM agent_state WHERE index_id=?").get(indexId);
  const next = { nonce: 0, status: "idle", last_run_ts: null, last_rebalance_ts: null, last_drift_bps: null, ...cur, ...patch };
  db.prepare(`
    INSERT INTO agent_state(index_id, nonce, status, last_run_ts, last_rebalance_ts, last_drift_bps)
    VALUES(?,?,?,?,?,?)
    ON CONFLICT(index_id) DO UPDATE SET nonce=excluded.nonce, status=excluded.status,
      last_run_ts=excluded.last_run_ts, last_rebalance_ts=excluded.last_rebalance_ts, last_drift_bps=excluded.last_drift_bps
  `).run(indexId, next.nonce, next.status, next.last_run_ts, next.last_rebalance_ts, next.last_drift_bps);
}

export function savePriceSnapshot(db, payload) {
  db.prepare("INSERT INTO price_snapshot(ts, payload) VALUES(?,?)").run(Date.now(), payload);
}

// seed: allocate `seedUsdMicro` across tickers proportional to target weights,
// buying at the target's current price (used at index creation demo).
function seedPositions(db, indexId, weights, seedUsdMicro) {
  const up = db.prepare(`
    INSERT INTO positions(index_id, ticker, balance_raw) VALUES (?,?,?)
    ON CONFLICT(index_id,ticker) DO UPDATE SET balance_raw=excluded.balance_raw
  `);
  // equal weight placeholder; actual seeding needs prices, done in service layer
  const present = Object.keys(weights);
  for (const tk of present) up.run(indexId, tk, 0);
}

export default openDB;