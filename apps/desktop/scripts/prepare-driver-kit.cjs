const fs = require("node:fs");
const path = require("node:path");

const KIT_FILES = ["Install.cmd", "Install-ScaleDriver.ps1", "manifest.json", "README.md"];
function prepareDriverKit({
  source = path.resolve(__dirname, "../../../hardware/scale-driver"),
  destination = path.resolve(__dirname, "../build/scale-driver"),
} = {}) {
  // Never recursively copy the source: its ignored cache contains vendor binaries.
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  for (const file of KIT_FILES) fs.copyFileSync(path.join(source, file), path.join(destination, file));
  return destination;
}
if (require.main === module) prepareDriverKit();
module.exports = { prepareDriverKit, KIT_FILES };
