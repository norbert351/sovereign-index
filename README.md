# Sovereign Index

**Set-and-forget personalized index of Coinbase Tokenized Stocks on Base — auto-rebalanced 24/7 by an autonomous agent.**

Built for the **Base Builder Quests** — *"Build a project that helps people trade or use Coinbase Tokenized Stocks on Base."*

## The problem
Most of the world's investors have no easy, low-fee, 24/7 way to hold a real basket of US megacaps — and even with access, managing a portfolio across many separate stock tokens is manual, tedious, and error-prone. Offchain index managers need scale, so they can only offer broad products, never *your* portfolio.

## The product
The user states exactly what they want to own (tickers + target weights). The **Sovereign Index agent** then:
1. Reads **live Chainlink Total-Return prices** for the Coinbase Tokenized Stock B20 tokens on Base,
2. Measures each holding's **drift** from the stated target,
3. **Rebalances autonomously** when drift exceeds the threshold — selling over-weights to fund under-weights (self-funding, no external cash),
4. **Recurring DCA** — a scheduled deposit mints new paper capital into the index by target weight on a periodic cadence (set-and-forget dollar-cost averaging),
5. Records every decision in a deterministic, **tamper-evident manifest hash** (`SOV-…`), so what the agent did is always auditable.

It's a **software-callable surface**: the rebalance engine is a set of pure functions plus `POST /api/indexes/:id/rebalance` and `POST /api/indexes/:id/dca`, so a program/agent can drive it — the index runs on its own schedule under its own identity.

## Sponsor tech (all load-bearing)
- **Coinbase Tokenized Stocks on Base** — the 13 B20 assets are the index constituents; the product cannot exist without them.
- **Chainlink Total-Return feeds** (Base, per the B20 "Tokenized Stocks on Base" spec) — live USD value per token, auto-includes the B20 multiplier for dividends/splits. Read via `latestRoundData()` on Base mainnet.
- **Regulation S / onchain jurisdiction gating** — the app enforces a geo-block (US + protected jurisdictions rejected, 403) aligned with the token's transfer policy.

## Honest scope note
The rebalance is executed against a **paper ledger** at the **live Chainlink price** (verified `simulated` mode, surfaced on every response and the dashboard). Onchain settlement of B20 tokens is policy-gated to authorized venues (which is why general DEX aggregators like 0x return "no route"); the execution seam is the documented, honest place where an authorized-venue router would be called. Prices, weights, drift and all decisions are real; token *movement* is simulated and clearly labeled.

## Run it
```bash
node --version   # >= 22.5 required (node:sqlite)
npm run smoke    # 18 tests (engine + DCA-deposit unit + live server e2e w/ real Chainlink prices)
npm start        # SOV_DB_PATH=./data/sovereign.db SOV_GEO=demo PORT=8080 node src/index.js
```
Open `http://localhost:8080` → build an index → watch the agent rebalance.

### Env
| Var | Default | Meaning |
|---|---|---|
| `PORT` | 8080 | HTTP port |
| `SOV_DB_PATH` | `./data/sovereign.db` | SQLite DB |
| `SOV_GEO` | `strict` | `strict` blocks US + unknown; `demo` blocks US only |
| `SOV_RPC_URLS` | base RPCs | comma-separated failover list |
| `SOV_EXEC` | `simulated` | execution mode (paper, at live price) |
| `SOV_CACHE_MS` | 30000 | price cache TTL |

## API
```
GET  /health                     -> ok, mode, deadline
GET  /api/meta                   -> asset registry + geo status
GET  /api/presets                -> intent presets (one-click mixes)
GET  /api/prices                 -> live Chainlink prices per token
GET  /api/indexes                -> all indexes (NAV, holdings, drift, DCA, agent, log)
POST /api/indexes                -> { name, weights:{TICKER:wMicro} | preset, seedUsd, driftThresholdBps, dcaUsd, periodDays }
GET  /api/indexes/:id            -> full view-model (incl. DCA schedule)
POST /api/indexes/:id/rebalance  -> force rebalance (returns SOV- manifest)
POST /api/indexes/:id/dca        -> set/replace { dcaUsd, periodDays } schedule
POST /api/indexes/:id/deposit    -> trigger an immediate DCA deposit (demo/agent call)
GET  /api/indexes/:id/plan       -> dry-run decision layer: drift + exact orders the agent WILL execute (no write)
GET  /api/agent/stream           -> server-sent events (agent decisions)
```

## Integrity
- Integer micro-units throughout (`1e6 = $1`; weights `1e6 = 100%`) — no float money.
- `planRebalance` is **self-funding by construction** (buys ≤ realized sells; only whole-token dust remains as cash).
- Every rebalance signs a deterministic `SOV-<sha256>` over {chainId, indexId, nonce, targets, prices, orders} — replay/tamper-evident.

## Deadline (quest)
Submission end **Sep 9, 2026 11:59pm EST** (03:59 UTC Sep 10).

## Disclaimer
Not investment, legal, tax or financial advice. Coinbase Tokenized Stocks are Reg-S assets available only to eligible non-US users; this app enforces that restriction at the app layer (the token itself enforces it onchain). Provided for informational/educational purposes in connection with the Base Builder Quest.