const PRODUCTION = [
  "inbound",
  "opening_stock",
  "issue.cutter",
  "issue.holo",
  "issue.coning",
  "receive.cutter",
  "receive.holo",
  "receive.coning",
];
function has(user, key, level = 1) {
  return (
    user?.isAdmin === true || Number(user?.permissions?.[key] || 0) >= level
  );
}
function stagePermission(stage) {
  const s = String(stage || "").toLowerCase();
  if (s === "calibration") return "settings";
  if (s.includes("inbound")) return "inbound";
  if (s.includes("opening")) return "opening_stock";
  for (const p of ["cutter", "holo", "coning"]) {
    if (s.includes(p) && s.includes("receive")) return "receive." + p;
    if (s.includes(p) && s.includes("issue")) return "issue." + p;
  }
  return null;
}
function mayPrintStage(user, stage) {
  const key = stagePermission(stage);
  if (!key) return false;
  if (key === "settings") return has(user, "settings", 2);
  // Existing stock/history readers may print labels they can view; opening-stock
  // uses the same receive artwork. This grants no receipt mutation authority.
  return (
    has(user, key) ||
    has(user, "stock") ||
    ((key === "inbound" || key.startsWith("receive.")) &&
      has(user, "opening_stock"))
  );
}
function mayReadJob(user, job) {
  return (
    !!user?.id &&
    (user.isAdmin === true || job.ownerUserId === user.id) &&
    mayPrintStage(user, job.stageKey)
  );
}
function assertPermission(user, operation, stage) {
  if (!user?.id)
    throw new Error("Sign in to GLINTEX to use workstation devices");
  if (operation === "settings.update" || operation === "scale.driverSetup" || operation.endsWith(".configure")) {
    if (!has(user, "settings", 2))
      throw new Error("Settings write permission required");
    return;
  }
  if (
    ["printers.submit", "printers.reprint", "printers.getJob"].includes(
      operation,
    )
  ) {
    if (!mayPrintStage(user, stage))
      throw new Error("Permission required for this label stage");
    return;
  }
  if (operation === "scale.capture" && !PRODUCTION.some((k) => has(user, k, 2)))
    throw new Error("Production write permission required for scale capture");
  if (
    !user.isAdmin &&
    ![...PRODUCTION, "stock", "settings"].some((k) => has(user, k))
  )
    throw new Error("Workstation permission required");
}
module.exports = {
  has,
  stagePermission,
  mayPrintStage,
  mayReadJob,
  assertPermission,
};
