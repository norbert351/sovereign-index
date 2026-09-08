# Sovereign Index — Roadmap

Where this goes after the Base Builder Quest. Grounded in what's real — nothing below claims features built today.

## The thesis the roadmap serves

Personalized index as an **autonomous agent rail**, not a dashboard. The demo today proves one live loop (real prices → real drift → self-funding rebalance → signed manifest, on a schedule). The roadmap is: turn that agent loop into a product a real non-US investor can hand real capital to — and make the autonomy the durable draw.

## Now — real (shipped, working)

- Personalized index: state your mix (weights or one-click presets) → the agent builds and keeps it balanced 24/7 on live Chainlink prices.
- Autonomous 60s sweep + drift-triggered rebalance + recurring DCA deposits.
- Tamper-evident `SOV-` decision manifests + `/plan` dry-run decision layer.
- Real Chainlink Total-Return prices on Base mainnet; geographic/Reg-S gating.
- Live deployment + 18/18 test suite + keep-alive.

## Next — the path from demo → product (in priority order)

1. **Real settlement rail.** The single most important step: wire an **authorized-venue router** for B20 execution (per the token's transfer-policy allow-list) and replace the labeled `simulated` seam with real onchain settlement under a self-custody wallet. This is the one change that flips Sovereign Index from "honest simulation" to "product." Cost: a vetted authorized venue + modest mainnet capital.
2. **Persistent, multi-user state.** Move from one-process SQLite to a hosted DB so portfolios survive redeploys and multiple users each get their own indexes. Requires real auth (email/anonymous wallet sign-in) instead of the open demo model.
3. **User-facing scheduling controls.** Expose threshold, DCA cadence and per-deposit amounts in the UI (much of this exists in the API already) so a non-technical investor can set-and-forget without the CLI.
4. **Real payments in, real values out.** Deposit real stablecoin to actually fund a live index; withdrawals via the same authorized venue. This is where the software-callable surface (already built) gets a consumer face.

## The road to a real user base

- **Named day-one user:** a non-US investor with megacap/tech exposure ambitions but no brokerage access (Reg-S is exactly this population) who wants a single place that keeps "my mix" balanced automatically — the thing offchain index managers can't do personally because their economics require scale.
- **Why they stay:** set-and-forget onchain — their stated mix is rebalanced to target continuously, with every decision auditable. Retention is the recurring DCA + the trust layer (signed manifests).
- **Who it's NOT for:** US users (excluded by the quest rule and Reg-S); active traders who want discretionary single-stock execution (they need a broker UX, not an index agent).

## What would need to change to be production-grade

| Area | Today | Production |
|---|---|---|
| Execution | Paper at live Chainlink price (`simulated`, disclosed) | Real authorized-venue B20 settlement + self-custody wallet |
| State | One-process SQLite, wiped on redeploy | Hosted multi-tenant DB, backups, survivor across deploys |
| Auth | Open demo model | Anonymous wallet / email sign-in, per-user portfolios |
| Funds | No real money (seed paper NAV) | Real stablecoin deposits/withdrawals, drift-alerting SaaS model |
| Ops | Public RPC failover | Dedicated RPC/archive, load-tested, monitoring + alerting |
| Compliance | Geo-gate at app layer | Full Reg-S eligibility check (jurisdiction allow-list against B20 policy), KYC/AML where the custody route requires it |

## Longer-horizon shape

- **Agent-native portfolios:** expose the engine as a callable rail (already software-callable) so wallets/agents on Base auto-allocate into tokenized stocks — the "agents with wallets" lane from Base's own RfB.
- **Yield/credit on productive assets (lane 4):** because holdings are real B20 with real Chainlink value and real market prices, downstream rails (lend/borrow against the basket, self-repaying structures) become possible on top of the same agent-maintained position.
- **Gifting (lane 3):** a personal index is a natural vessel for time-locked gifts of diversified equity to friends/family.
- **Neobrokerage UX (lane 1):** wrap the same engine in a mobile-first, local-currency-onramp interface for the Reg-S population.

The roadmap keeps growing from the same load-bearing core (real Chainlink-priced B20 basket + autonomous rebalance + auditable decisions) — never by bolting on unrelated features.