const fs = require("node:fs/promises");
const path = require("node:path");
const { DEFAULT_SCALE_SETTINGS } = require("./scale/protocol.cjs");
class SettingsStore {
  constructor(directory) {
    this.directory = directory;
    this.file = path.join(directory, "workstation.json");
    this.data = { schemaVersion: 1, startAtLogin: false };
    this.pending = Promise.resolve();
  }
  async load() {
    await fs.mkdir(this.directory, { recursive: true });
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (parsed.schemaVersion !== 1)
        throw new Error("Unsupported workstation settings version");
      this.data = parsed;
    } catch (e) {
      if (e.code !== "ENOENT")
        throw new Error(
          "Workstation settings are unreadable. Preserve the file and use the troubleshooting guide.",
        );
    }
    // Migrate only the old non-capturing placeholder. Working profiles retain
    // their operator-selected protocol, units, scaling and serial settings.
    if (!this.data.scaleDefaultsVersion) {
      if (!this.data.scale || this.data.scale.profileId === "unknown") {
        await this.set("scale", {
          path: "",
          ...this.data.scale,
          ...DEFAULT_SCALE_SETTINGS,
        });
      }
      await this.set("scaleDefaultsVersion", 1);
    }
    return this;
  }
  get(key) {
    return structuredClone(key ? this.data[key] : this.data);
  }
  async set(key, value) {
    if (!["scale", "printer", "startAtLogin", "scaleDefaultsVersion"].includes(key))
      throw new Error("Unknown setting");
    const copied = structuredClone(value);
    this.pending = this.pending
      .catch(() => {})
      .then(async () => {
        const next = { ...this.data, [key]: copied };
        const temp = this.file + ".tmp";
        await fs.writeFile(temp, JSON.stringify(next, null, 2), {
          mode: 0o600,
        });
        const handle = await fs.open(temp, "r+");
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
        await fs.rename(temp, this.file);
        // A failed write must not silently activate an unpersisted device choice.
        this.data = next;
      });
    await this.pending;
  }
}
module.exports = { SettingsStore };
