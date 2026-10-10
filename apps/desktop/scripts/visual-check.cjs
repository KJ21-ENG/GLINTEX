const path = require("node:path");
const fs = require("node:fs/promises");
const http = require("node:http");
const root = path.resolve(__dirname, "../../..");
const output = path.join(root, "apps/desktop/test/visual/output");
async function main() {
  await fs.mkdir(output, { recursive: true });
  const esbuild = require(
    path.join(root, "apps/frontend/node_modules/esbuild"),
  );
  await esbuild.build({
    entryPoints: [path.join(root, "apps/desktop/test/visual/fixture.jsx")],
    bundle: true,
    outdir: output,
    format: "esm",
    // Desktop-local Forge tooling has its own React. The fixture must use
    // the same React instance as the actual frontend and its renderer.
    alias: Object.fromEntries(
      ["react", "react-dom"].map((name) => [
        name,
        path.dirname(
          require.resolve(`${name}/package.json`, {
            paths: [path.join(root, "apps/frontend")],
          }),
        ),
      ]),
    ),
    define: {
      "import.meta.env": JSON.stringify({ VITE_API_BASE: "http://127.0.0.1:4188" }),
    },
    loader: { ".woff2": "file", ".woff": "file" },
    publicPath: "/",
    plugins: [
      {
        // Vite's `?url` asset imports: hand the bare file to the file loader.
        name: "vite-url-suffix",
        setup(build) {
          build.onResolve({ filter: /\?url$/ }, (args) => ({
            path: require.resolve(args.path.replace(/\?url$/, ""), { paths: [args.resolveDir, path.join(root, "apps/frontend")] }),
          }));
        },
      },
    ],
    nodePaths: [
      path.join(root, "apps/frontend/node_modules"),
      path.join(root, "node_modules"),
    ],
  });
  const assets = await fs.readdir(path.join(root, "apps/frontend/dist/assets"));
  const appCss = assets.find((x) => x.endsWith(".css"));
  await fs.copyFile(
    path.join(root, "apps/frontend/dist/assets", appCss),
    path.join(output, "app.css"),
  );
  await fs.writeFile(
    path.join(output, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>GLINTEX offline visual QA</title><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/fixture.css"><style>body{padding:24px;background:#e8edf2;color:#17202b}h1{font-size:26px}#labels{display:flex;gap:20px;flex-wrap:wrap}.label-card{background:white;padding:14px;border:1px solid #aab5c0}.label-card h2{font-size:18px}.label-card p{max-width:400px;font-size:12px}img{border:1px solid #ddd}#results{font-size:12px;white-space:pre-wrap}</style><h1>GLINTEX visual QA • simulated devices only</h1><div id="panel"></div><pre id="results">Preparing real Chromium artwork...</pre><div id="labels"></div><h1>Real label editor profile-change test</h1><div id="editor"></div><script type="module" src="/fixture.js"></script>`,
  );
  http
    .createServer(async (req, res) => {
      try {
        if (req.url === "/api/auth/status") {
          res.setHeader("Content-Type", "application/json");
          return res.end(
            JSON.stringify({ hasUsers: true, needsBootstrap: false }),
          );
        }
        if (req.url === "/api/auth/me") {
          res.setHeader("Content-Type", "application/json");
          return res.end(
            JSON.stringify({
              user: {
                id: "fixture",
                username: "qa-fixture",
                isAdmin: true,
                permissions: { settings: 3 },
              },
            }),
          );
        }
        if (req.url === "/results" && req.method === "POST") {
          let raw = "";
          for await (const chunk of req) {
            raw += chunk;
            if (raw.length > 4000000) throw Error("too large");
          }
          const r = JSON.parse(raw);
          if (!/^[a-z_]+$/.test(r.name)) throw Error("name");
          if (r.png) {
            await fs.writeFile(
              path.join(output, r.name + ".png"),
              Buffer.from(r.png.split(",")[1], "base64"),
            );
            delete r.png;
          }
          await fs.writeFile(
            path.join(output, r.name + ".json"),
            JSON.stringify(r, null, 2),
          );
          return res.end("ok");
        }
        const name =
          req.url === "/" ? "index.html" : decodeURIComponent(req.url.slice(1));
        if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw Error("path");
        const data = await fs.readFile(path.join(output, name));
        const type =
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".png": "image/png",
            ".woff2": "font/woff2",
          }[path.extname(name)] || "application/octet-stream";
        res.setHeader("Content-Type", type);
        res.end(data);
      } catch (e) {
        res.statusCode = 404;
        res.end(e.message);
      }
    })
    .listen(4188, "127.0.0.1", () =>
      console.log("Offline visual QA http://127.0.0.1:4188"),
    );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
