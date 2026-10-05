const fs = require("node:fs/promises");
const path = require("node:path");
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
function isAppUrl(value, origin) {
  try {
    const u = new URL(value);
    return (
      u.origin === origin &&
      !u.username &&
      !u.password &&
      !u.pathname.startsWith("/api")
    );
  } catch {
    return false;
  }
}
function assertSender(event, webContents, origin) {
  if (
    !webContents ||
    webContents.isDestroyed() ||
    event.sender !== webContents ||
    !event.senderFrame ||
    event.senderFrame !== webContents.mainFrame ||
    !isAppUrl(event.senderFrame.url, origin)
  )
    throw new Error("Untrusted desktop request");
}
function assertPlain(value, maxBytes = 16384) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    JSON.stringify(value).length > maxBytes
  )
    throw new Error("Invalid request payload");
  return value;
}
function validId(id) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(id))
    throw new Error("Invalid job ID");
  return id;
}
function apiTarget(url, origin) {
  const u = new URL(url);
  if (
    u.origin !== origin ||
    u.username ||
    u.password ||
    !u.pathname.startsWith("/api/") ||
    /%2f|%5c|%00/i.test(u.pathname)
  )
    throw new Error("API destination rejected");
  return u.href;
}
function createAppHandler({
  origin,
  uiDirectory,
  fetchApi,
  onAuthInvalidated = () => {},
}) {
  return async (request) => {
    try {
      const u = new URL(request.url);
      if (u.origin !== origin || u.username || u.password)
        return new Response("Blocked origin", { status: 403 });
      if (request.initiatorOrigin && request.initiatorOrigin !== origin)
        return new Response("Blocked initiator", { status: 403 });
      if (u.pathname === "/api" || u.pathname.startsWith("/api/")) {
        if (!METHODS.has(request.method))
          return new Response("Method not allowed", { status: 405 });
        const target = apiTarget(u.href, origin);
        // Redirects are never followed: credentials and mutations cannot escape the configured API.
        const headers = new Headers();
        for (const name of [
          "content-type",
          "accept",
          "if-none-match",
          "if-modified-since",
        ]) {
          const value = request.headers.get(name);
          if (value) headers.set(name, value);
        }
        const body = ["GET", "HEAD"].includes(request.method)
          ? undefined
          : await request.arrayBuffer();
        if (body && body.byteLength > 20 * 1024 * 1024)
          return new Response("Request too large", { status: 413 });
        const response = await fetchApi(target, {
          method: request.method,
          headers,
          body,
          credentials: "include",
          redirect: "error",
          bypassCustomProtocolHandlers: true,
          signal: AbortSignal.timeout(60000),
        });
        if (
          response.status === 401 ||
          (u.pathname === "/api/auth/logout" && response.ok)
        )
          await onAuthInvalidated();
        const out = new Headers(response.headers);
        out.set(
          "Content-Security-Policy",
          "default-src 'none'; frame-ancestors 'none'",
        );
        out.set("X-Content-Type-Options", "nosniff");
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: out,
        });
      }
      if (!["GET", "HEAD"].includes(request.method))
        return new Response("Method not allowed", { status: 405 });
      const decoded = decodeURIComponent(u.pathname);
      if (
        decoded.includes("\0") ||
        decoded.includes("\\") ||
        decoded.split("/").includes("..")
      )
        return new Response("Bad path", { status: 400 });
      const relative = decoded.replace(/^\/+/, "");
      let file = path.resolve(uiDirectory, relative || "index.html");
      const safe = path.relative(uiDirectory, file);
      if (safe.startsWith("..") || path.isAbsolute(safe))
        return new Response("Bad path", { status: 400 });
      let data;
      try {
        data = await fs.readFile(file);
      } catch {
        if (path.extname(relative))
          return new Response("Not found", { status: 404 });
        file = path.join(uiDirectory, "index.html");
        data = await fs.readFile(file);
      }
      const types = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".svg": "image/svg+xml",
        ".woff2": "font/woff2",
        ".woff": "font/woff",
        ".ico": "image/x-icon",
        ".json": "application/json",
      };
      return new Response(request.method === "HEAD" ? null : data, {
        headers: {
          "Content-Type":
            types[path.extname(file)] || "application/octet-stream",
          "Content-Security-Policy": CSP,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        },
      });
    } catch {
      return new Response(
        JSON.stringify({
          error:
            "Server unavailable or request rejected. Check connection and try again.",
        }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }
  };
}
module.exports = {
  isAppUrl,
  assertSender,
  assertPlain,
  validId,
  apiTarget,
  createAppHandler,
  CSP,
};
