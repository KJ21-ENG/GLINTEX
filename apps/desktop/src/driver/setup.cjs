const fs = require("node:fs/promises");
const { existsSync } = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { promisify } = require("node:util");
const execute = promisify(execFile);

class DriverSetup {
  constructor({ kitDirectory, userData, platform = process.platform, arch = process.arch, run = execute }) {
    Object.assign(this, { kitDirectory, userData, platform, arch, run });
    this.running = false;
  }
  status() {
    const bundled = ["Install.cmd", "Install-ScaleDriver.ps1", "manifest.json", "Run-DriverSetup.ps1"].every(file => existsSync(path.join(this.kitDirectory, file)));
    return {
      bundled,
      available: this.platform === "win32" && this.arch === "x64" && bundled,
      supported: "Windows 10 x64 · BAFO BF-812 / Prolific PL2303GT · USB\\VID_067B&PID_23A3&REV_0305",
      cacheDirectory: path.join(this.userData, "scale-driver", "cache"),
    };
  }
  async install() {
    if (!this.status().available) throw new Error("Bundled scale driver setup requires Windows x64; the helper supports Windows 10 and the listed adapter only.");
    if (this.running) throw new Error("Scale driver setup is already running.");
    this.running = true;
    try {
      const directory = path.join(this.userData, "scale-driver");
      await fs.mkdir(directory, { recursive: true });
      const logPath = path.join(directory, `setup-${Date.now()}-${randomUUID()}.log`);
      const executable = path.win32.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      let exitCode = 0, failureOutput = "";
      try {
        await this.run(executable, ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(this.kitDirectory, "Run-DriverSetup.ps1"), "-KitDirectory", this.kitDirectory, "-CacheDirectory", this.status().cacheDirectory, "-LogPath", logPath, "-Mode", "Install"], { windowsHide: true, maxBuffer: 256 * 1024 });
      } catch (error) {
        exitCode = Number.isInteger(error.code) ? error.code : 1;
        failureOutput = String(error.stderr || error.message || "Driver setup failed");
      }
      const output = await fs.readFile(logPath, "utf8").catch(() => failureOutput);
      return { success: exitCode === 0 || exitCode === 3010, exitCode, restartRequired: exitCode === 3010, logPath, output: output.slice(-16000) };
    } finally { this.running = false; }
  }
}
module.exports = { DriverSetup };
