"use strict";
// Application windows: several equal windows of the same signed-in workstation, the way
// staff used browser tabs. Every window gets the same bridge, policies and broadcasts;
// native devices and the print queue stay in the main process and are shared.
const MAX_WINDOWS = 6;

// A path of the application, opened in a new window. Only same-origin page URLs qualify:
// never the API namespace, another origin, credentials or a scheme of its own.
function appWindowUrl(target, origin) {
  if (typeof target !== "string" || target.length > 2048) throw new Error("Window target must be an application path");
  if (!target.startsWith("/") || target.startsWith("//") || /[\s\\]/.test(target)) throw new Error("Window target must be an application path");
  const url = new URL(target, origin);
  if (url.origin !== origin || url.username || url.password || url.pathname.startsWith("/api")) throw new Error("Window target must be an application path");
  return url.href;
}

class WindowRegistry {
  constructor({ create, max = MAX_WINDOWS } = {}) {
    if (typeof create !== "function") throw new Error("Window factory required");
    this.create = create;
    this.max = max;
    this.windows = [];
    this.lastFocused = null;
  }
  live() {
    this.windows = this.windows.filter((w) => !w.isDestroyed());
    return this.windows;
  }
  count() { return this.live().length; }
  all() { return [...this.live()]; }
  primary() { return this.live()[0] || null; }
  focused() {
    const live = this.live();
    if (this.lastFocused && live.includes(this.lastFocused)) return this.lastFocused;
    return live[live.length - 1] || null;
  }
  has(webContents) { return !!webContents && this.live().some((w) => w.webContents === webContents); }
  contents() { return this.live().map((w) => w.webContents); }
  isLast(window) { const live = this.live(); return live.length === 1 && live[0] === window; }
  open(url, { from = this.focused() } = {}) {
    if (this.count() >= this.max) throw new Error(`At most ${this.max} GLINTEX windows can be open; close one first`);
    const bounds = from && !from.isDestroyed() ? from.getBounds() : null;
    const window = this.create({ url, bounds: bounds ? { ...bounds, x: bounds.x + 32, y: bounds.y + 32 } : null });
    this.windows.push(window);
    window.on("focus", () => { this.lastFocused = window; });
    window.on("closed", () => { this.windows = this.windows.filter((w) => w !== window); if (this.lastFocused === window) this.lastFocused = null; });
    return window;
  }
  broadcast(channel, payload) {
    for (const w of this.live()) w.webContents.send(channel, payload);
  }
}

module.exports = { WindowRegistry, appWindowUrl, MAX_WINDOWS };
