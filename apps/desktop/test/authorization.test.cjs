const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  assertPermission,
  stagePermission,
  mayReadJob,
} = require("../src/authorization.cjs");
test("logged-out hardware access rejected", () =>
  assert.throws(() => assertPermission(null, "scale.capture")));
test("optional driver setup requires a signed-in Settings writer", () => {
  for (const user of [null, { id: "reader", permissions: { settings: 1 } }, { id: "operator", permissions: { inbound: 2 } }])
    assert.throws(() => assertPermission(user, "scale.driverSetup"));
  for (const user of [{ id: "writer", permissions: { settings: 2 } }, { id: "admin", isAdmin: true }])
    assert.doesNotThrow(() => assertPermission(user, "scale.driverSetup"));
});
test("settings writes and print stages preserve role boundaries", () => {
  const user = { id: "operator", permissions: { "receive.cutter": 2 } };
  assert.doesNotThrow(() => assertPermission(user, "scale.capture"));
  assert.doesNotThrow(() =>
    assertPermission(user, "printers.submit", "cutter_receive"),
  );
  assert.throws(() =>
    assertPermission(user, "printers.submit", "holo_receive"),
  );
  assert.throws(() => assertPermission(user, "printers.configure"));
  assert.throws(() => assertPermission(user, "printers.submit", "unknown"));
  assert.equal(stagePermission("cutter_issue_small"), "issue.cutter");
});
test("read-only can print viewed labels but cannot capture", () => {
  const user = { id: "reader", permissions: { "receive.cutter": 1 } };
  assert.doesNotThrow(() =>
    assertPermission(user, "printers.getJob", "cutter_receive"),
  );
  assert.doesNotThrow(() =>
    assertPermission(user, "printers.reprint", "cutter_receive"),
  );
  assert.throws(() => assertPermission(user, "scale.capture"));
});

test("retained queue is owned by authenticated submitter, never renderer claim", () => {
  const u = { id: "opening", permissions: { opening_stock: 1 } };
  assert.doesNotThrow(() =>
    assertPermission(u, "printers.submit", "cutter_receive"),
  );
  assert.equal(
    mayReadJob(u, { stageKey: "cutter_receive", ownerUserId: "other" }),
    false,
  );
  assert.equal(
    mayReadJob(u, { stageKey: "cutter_receive", ownerUserId: "opening" }),
    true,
  );
  assert.equal(
    mayReadJob(
      { id: "admin", isAdmin: true },
      { stageKey: "cutter_receive", ownerUserId: "other" },
    ),
    true,
  );
});
