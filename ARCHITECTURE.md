# Sovereign Index — Architecture

## System diagram

```
                     ┌────────────────────────────────────────────────────┐
                     │                 FRONTEND (static SPA)              │
                     │   public/index.html — build index / pick preset,   │
                     │   watch NAV + drift, live SSE feed, geo-aware UI   │
                     └──────────────────────┬─────────────────────────────┘
                                            │ HTTP / SSE
                     ┌──────────────────────▼─────────────────────────────┐
                     │                    API (src/index.js)              │
                     │  /api/indexes  /rebalance  /dca  /deposit  /plan   │
                     │  /api/prices  /presets  /meta  /agent/stream       │
                     └───────┬──────────────────────────────┬─────────────┘
                             │                              │
                ┌────────────▼───────────┐      ┌───────────▼─────────────┐
                │  ENGINE (src/engine.js)│      │   AGENT LOOP            │
                │  weights→targets,      │      │  60s sweep (src/agent.js)│
                │  drift bps, self-      │      │  drift-triggered rebal,  │
                │  funding planRebalance │      │  scheduled DCA deposits  │
                │  signed SOV- manifest  │      │  per-index execution lock│
                └────────────┬───────────┘      └────────────┬────────────┘
                             │                               │
                     ┌───────▼───────────────────────────────▼───────┐
                     │           CHAINLINK (src/chainlink.js)         │
                     │   live latestRoundData() per feed proxy on     │
                     │   ============ BASE MAINNET (chain 8453) ===== │
                     │   eth_call + ABI decode + 429/5xx failover     │
                     │   + per-asset inflight coalescing + 30s cache │
                     └──────────────────────┬─────────────────────────┘
                                            │ persistence
                             ┌──────────────▼──────────────┐
                             │  STORAGE: node:sqlite        │
                             │  indexes, positions, agent,  │
                             │  decision log                │
                             └─────────────────────────────┘
```

**Layers** (all one process, one origin — UI + API served by the same Node process):

1. **Frontend** — hand-built static SPA (`public/`). No framework, zero build step. Lets a user state a desired mix (weights or a preset), shows live NAV/holdings/drift, and streams agent decisions over SSE. Geo-aware: create/rebalance controls are disabled when the request origin is blocked.
2. **API** — the software-callable surface. Everything the UI does is also a REST endpoint, so a program/agent can drive the index (the autonomy story).
3. **Engine** — pure functions. Normalizes target weights, computes per-holding drift in bps vs the live Chainlink NAV, produces a **self-funding** rebalance plan (buys ≤ realized sells, whole-token floors), and signs every decision into a deterministic `SOV-<sha256>` manifest over `{chainId, indexId, nonce, targets, prices, orders}`.
4. **Agent loop** — the autonomy. A 60s sweep checks every index: DCA deposits first (by target weight), then drift-triggered rebalance. A per-index lock serializes the sweep against a manual `/rebalance` so decisions can't double-apply. Runs under its own schedule/identity — no human in the loop.
5. **Chainlink price layer** — the load-bearing external oracle. Reads `latestRoundData()` on each per-asset feed proxy on Base mainnet.
6. **Storage** — `node:sqlite`. State is git-ignored runtime data; a fresh deploy is seeded by `SOV_SEED_ON_BOOT=1`.

## After removing <sponsor stack> — what happens

| Sponsor stack | Consumer / feature | What happens if removed |
|---|---|---|
| **Chainlink Total-Return feeds** | Every `NAV` / `driftBps` / rebalance decision | **Product stops.** With no price, holdings can't be valued, drift can't be measured, the agent literally cannot decide what to buy or sell. There is no fallback price source wired. |
| **Coinbase Tokenized Stocks (B20)** | The index **constituents** (13 tickers in `src/config.js`) | **Product is empty.** There is nothing to index — the entire app's asset registry and the "personal stock index" thesis disappear. |
| **Reg-S / geo-gate** (front-door mirror of the token's transfer policy) | `/prices`, `/indexes`, `/rebalance`, `/deposit`, UI buttons | Reg-S compliance surface degrades. The app would let blocked regions through the app layer (the token still enforces onchain, but the quest's "no US users" requirement is violated). |

**Load-bearing (the ceiling, not the floor):** there is no secondary/decorative path — the product cannot compute a NAV, make a rebalance decision, or list a single constituent without Chainlink + the B20 registry. The execution *router* (0x/CoW) is deliberately **absent** — general DEX aggregators return "no route" for B20 (verified 404); settlement is an honest `simulated` paper layer at the live Chainlink price, clearly labeled everywhere.

## Key modules / files

| File | Responsibility |
|---|---|
| `src/index.js` | HTTP server + routing + SSE `/agent/stream` + geo-aware responses |
| `src/engine.js` | Pure rebalance engine: weights, drift, self-funding plan, `SOV-` signing |
| `src/agent.js` | Agent loop: 60s sweep, DCA deposit, drift rebalance, per-index lock |
| `src/chainlink.js` | Live `latestRoundData()` reads + decode + failover + cache |
| `src/geogate.js` | Per-request IP-country geo-gate (US + strict-unknown hard block) |
| `src/config.js` | Chain, 13 B20 token addresses + feed proxies, presets, thresholds |
| `src/db.js` | `node:sqlite` schema + queries |
| `public/index.html` | Frontend SPA |
| `render.yaml` | Render free-tier blueprint (seed-on-boot, geo demo, simulated exec) |