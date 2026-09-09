# Sovereign Index

**Set-and-forget personalized index of Coinbase Tokenized Stocks on Base — auto-rebalanced 24/7 by an autonomous agent.**

Built for the **Base Builder Quests** — *"Build a project that helps people trade or use Coinbase Tokenized Stocks on Base."*

**► Live demo:** https://sovereign-index.onrender.com
**► Live demo video:** [`docs/demo/sovereign-index-demo.mp4`](docs/demo/sovereign-index-demo.mp4) (62s 720p — real live session: create from preset → holdings/plan → DCA deposit with signed `SOV-` manifests → live Chainlink prices on Base mainnet).

## The problem

Most of the world's investors have no easy, low-fee, **24/7** way to hold a real basket of US megacaps. Bankless flagged the class-level friction right after launch: far more attention flows to RWA tokens than to actual *trading volume* on these tokenized stocks — the spreads and execution are the #1 complaint. And even with access, holding a diversified portfolio across many separate stock tokens is manual, tedious, and error-prone. Offchain index managers need scale, so they can only offer broad products, never *your* portfolio.

## The product

The user states exactly what they want to own (tickers + target weights) — or picks a one-click **preset** (Mag-7 Blend, Megacap Core, AI & Semis, Crypto Equities, Innovation Mix). The **Sovereign Index agent** then:

1. Reads **live Chainlink Total-Return prices** for the Coinbase Tokenized Stock B20 tokens on **Base mainnet**,
2. Measures each holding's **drift** from the stated target (in bps),
3. **Rebalances autonomously** when drift exceeds the threshold — a 60s sweep under the agent's own identity, selling over-weights to fund under-weights (self-funding, no external cash),
4. **Recurring DCA** — a scheduled deposit mints new capital into the index by target weight on a periodic cadence (set-and-forget dollar-cost averaging),
5. Records every decision in a deterministic, **tamper-evident `SOV-` manifest hash**, so what the agent did is always auditable — and exposes a `/plan` dry-run decision layer so you see the EXACT orders it will execute before it acts.

It's a **software-callable surface**: the engine is a set of pure functions plus `POST /api/indexes/:id/rebalance`, `POST /api/indexes/:id/dca` and `POST /api/indexes/:id/deposit`, so a program or agent can drive it — the index runs on its own schedule under its own identity.

## Sponsor tech (all load-bearing — remove it and nothing runs)

- **Coinbase Tokenized Stocks on Base (B20, Reg-S)** — the 13 assets are the index **constituents**; the product cannot exist without them. If you can't hold B20 tokenized stocks, Sovereign Index has nothing to index.
- **Chainlink Total-Return feeds** (Base mainnet) — every NAV, drift and rebalance decision is computed from a **live `latestRoundData()` read** on the per-asset feed proxy (USD per token, auto-includes the B20 dividend/split multiplier). Remove Chainlink and the agent cannot measure a single holding → no rebalance → the product stops.
- **Regulation S / onchain jurisdiction gating** — the app enforces a geo-block (US + protected jurisdictions rejected, 403) at its own front door via per-request IP-country lookup, mirroring the token's onchain transfer policy.

## Honest scope note (verified, not overclaimed)

The rebalance executes against a **paper ledger at the live Chainlink price** — `simulated` mode, surfaced on every API response and the dashboard. Onchain *settlement* of B20 tokens is policy-gated to authorized venues (general DEX aggregators like 0x return "no route" — verified 404 for every direction), so the execution seam is the documented, honest place where an authorized-venue router would be called. **Prices, weights, drift and every decision are real** (verified live against Base mainnet RPCs); token *movement* is simulated and clearly labeled. We deliberately do not claim onchain settlement we don't have.

## Verification / how to see it work

- **Live URL:** https://sovereign-index.onrender.com — open `GET /api/prices` for real live Chainlink prices, `GET /api/indexes/:id/plan` for the agent's exact intended orders, and hit `POST /api/indexes/:id/deposit` to watch the DCA mint paper capital by target weight.
- **Tests:** `npm run smoke` → **18/18** (engine + DCA-deposit unit + live server e2e against real Chainlink prices, including the US-origin geo-block).
- **On mainnet:** `CHAIN_ID = 8453`, 13 B20 token addresses + their Chainlink feed proxies are hard-coded in `src/config.js` and match `base.org/stocks`.

## Run it

```bash
node --version   # >= 22.5 required (node:sqlite; use 22.x)
npm install      # zero runtime deps — only dev tooling
npm run smoke    # 18 tests
npm start        # SOV_GEO=demo SOV_EXEC=simulated PORT=8080 node src/index.js
```

Open `http://localhost:8080` → build an index (or pick a preset) → watch the agent self-rebalance via the live SSE stream.

### Env

| Var | Default | Meaning |
|---|---|---|
| `PORT` | 8080 | HTTP port (Render injects this) |
| `SOV_DB_PATH` | `./data/sovereign.db` | SQLite DB (git-ignored runtime) |
| `SOV_GEO` | `strict` | `strict` blocks US + unknown; `demo` blocks US only |
| `SOV_RPC_URLS` | Base mainnet RPCs | comma-separated failover list (429/5xx backoff) |
| `SOV_EXEC` | `simulated` | execution mode (paper at live price) |
| `SOV_CACHE_MS` | 30000 | Chainlink price cache TTL |
| `SOV_SEED_ON_BOOT` | `0` | `1` seeds a demo index so a fresh deploy isn't empty |

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

## Tech stack

**Zero-dependency Node 22** · `node:sqlite` · `chainlink` V3 Total-Return feeds on **Base mainnet** (chain 8453) · **Coinbase Tokenized Stocks (B20)** · Reg-S geo-gating · Server-Sent Events · Render (free-tier web service)

## Integrity

- Integer micro-units throughout (`1e6 = $1`; weights `1e6 = 100%`) — no float money.
- `planRebalance` is **self-funding by construction** (buys ≤ realized sells; only whole-token dust remains as cash).
- Every rebalance signs a deterministic `SOV-<sha256>` over {chainId, indexId, nonce, targets, prices, orders} — replay/tamper-evident.
- Serialized per-index execution lock (sweep vs manual rebalance can't double-apply).
- Honest `"amount too small"` DCA guard when a deposit can't buy a whole token.

See **`ARCHITECTURE.md`** (system design), **`docs/TECHNICAL.md`** (implementation detail), **`docs/ROADMAP.md`** (where it goes next), **`docs/SUBMISSION.md`** (quest entry kit).

## Deadline (quest)

Submission end **Sep 9, 2026 11:59pm EST** (03:59 UTC Sep 10). **No US users in scope** (Base rule) — enforced in-app.

## Disclaimer

Not investment, legal, tax or financial advice. Coinbase Tokenized Stocks are Reg-S assets available only to eligible non-US users; this app enforces that restriction at the app layer (the token enforces it onchain). Provided for informational/educational purposes in connection with the Base Builder Quest.