const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../../..");
const vite = path.join(
  path.dirname(
    require.resolve("vite/package.json", {
      paths: [path.join(root, "apps/frontend")],
    }),
  ),
  "bin/vite.js",
);
const result = spawnSync(
  process.execPath,
  [vite, "build", "--outDir", "../desktop/ui", "--emptyOutDir"],
  {
    cwd: path.join(root, "apps/frontend"),
    env: {
      ...process.env,
      VITE_API_BASE: "https://app.glintex.in",
      VITE_DESKTOP: "true",
    },
    stdio: "inherit",
  },
);
if (result.status !== 0) process.exit(result.status || 1);
const commit =
  spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).stdout?.trim() || "unknown";
fs.writeFileSync(
  path.join(root, "apps/desktop/build-info.json"),
  JSON.stringify(
    {
      version: require("../package.json").version,
      sourceCommit: commit,
      apiOrigin: "https://app.glintex.in",
    },
    null,
    2,
  ),
);
