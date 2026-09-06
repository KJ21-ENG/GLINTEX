import test from "node:test";
import assert from "node:assert/strict";
import {
  calendarMonths,
  createRequestGate,
  filterError,
  filterKey,
  kgLabel,
  monthlySearch,
  readMonthlyFilters,
} from "./workerMonthlyReportState.js";

test("business calendar defaults handle year and leap transitions and reject future/invalid/unsupported filters", () => {
  assert.deepEqual(calendarMonths(new Date("2026-12-31T19:00Z")), {
    current: "2027-01",
    previous: "2026-12",
  });
  assert.equal(
    calendarMonths(new Date("2024-03-01T00:00Z")).previous,
    "2024-02",
  );
  const f = readMonthlyFilters("", new Date("2026-09-06T12:00Z"));
  assert.deepEqual(f, { month: "2026-08", process: "coning", workerId: "all" });
  assert.equal(filterError(f, new Date("2026-09-06")), null);
  for (const patch of [
    { month: "2026-13" },
    { month: "" },
    { month: "2026-10" },
    { process: "holo" },
    { workerId: "" },
  ])
    assert.ok(filterError({ ...f, ...patch }, new Date("2026-09-06")));
});
test("addressable filters preserve unrelated report state and stable duplicate-name worker IDs", () => {
  const f = { month: "2026-08", process: "coning", workerId: "worker/0" };
  const search = monthlySearch("?unrelated=retained&reportTab=production", f);
  assert.equal(new URLSearchParams(search).get("unrelated"), "retained");
  assert.deepEqual(readMonthlyFilters(search), f);
  assert.notEqual(filterKey(f), filterKey({ ...f, workerId: "worker/1" }));
});
test("late preview failure/success and late download cannot survive filter change or newer generation", async () => {
  const gate = createRequestGate();
  const old = gate.start();
  let resolveOld;
  const request = new Promise((resolve) => {
    resolveOld = resolve;
  });
  gate.invalidate();
  const next = gate.start();
  resolveOld({ stale: true });
  await request;
  assert.equal(gate.current(old), false);
  assert.equal(gate.current(next), true);
  const download = gate.start();
  gate.invalidate();
  assert.equal(gate.current(download), false);
  assert.equal(gate.current(next), false);
});
test("known subtotal is explicitly incomplete while recorded zero remains complete", () => {
  assert.equal(kgLabel({ netKg: 0, weightComplete: true }), "0.000 kg");
  assert.match(
    kgLabel({ netKg: 0, weightComplete: false, unknownWeightRows: 3 }),
    /known subtotal \(incomplete; 3 unknown\)/,
  );
});
