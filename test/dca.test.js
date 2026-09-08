import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrate, createIndex, setPositions, setAgentState, getIndex } from "../src/db.js";
import { depositDue } from "../src/agent.js";

// synthetic live prices (micro-USD per token)
const P = { NVDAc: { micro: 200_000_000n }, TSLAc: { micro: 300_000_000n } };

function freshDb() {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  return db;
}

test("DCA deposit mints new paper capital by target weights when due", async () => {
  const db = freshDb();
  const id = createIndex(db, {
    name: "Test", weights: { NVDAc: 500_000n, TSLAc: 500_000n },
    thresholdBps: 300, dcaUsdMicro: 1_000_000_000n, dcaPeriodDays: 1, // $1000 / day
  });
  setPositions(db, id, { NVDAc: 50n, TSLAc: 50n });
  setAgentState(db, id, { status: "idle" });
  // force the deposit to be due now
  db.prepare("UPDATE indexes SET dca_next_ts = ? WHERE id=?").run(Date.now() - 1000, id);

  const res = await depositDue(db, id, P);
  assert.ok(res && res.depositedMicro > 0n);
  // deposits deploy into whole tokens; sub-token dust may remain (never exceeds amount)
  assert.ok(res.depositedMicro > 0n && res.depositedMicro <= 1_000_000_000n,
    `deposited ${res.depositedMicro}`);

  // positions grew toward ~50/50 with the new capital
  const idx = getIndex(db, id);
  assert.ok(idx.positions.NVDAc > 50n, "NVDAc grew");
  assert.ok(idx.positions.TSLAc > 50n, "TSLAc grew");

  // next deposit is scheduled in the future (respects the period)
  assert.ok(idx.dca.next_ts > Date.now(), "next scheduled in future");
  assert.ok(idx.dca.period_days === 1);

  // not due again immediately (no double-bank on the same tick)
  const again = await depositDue(db, id, P);
  assert.equal(again, null);
});

test("DCA deposit with no schedule returns null", async () => {
  const db = freshDb();
  const id = createIndex(db, { name: "NoDca", weights: { NVDAc: 1_000_000n }, thresholdBps: 300 });
  const res = await depositDue(db, id, P);
  assert.equal(res, null);
});