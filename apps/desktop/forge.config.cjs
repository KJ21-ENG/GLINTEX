const path = require("node:path");
module.exports = {
  packagerConfig: {
    asar: true,
    executableName: "GLINTEX",
    icon: path.join(__dirname, "assets", "icon"),
    appBundleId: "in.glintex.desktop",
    appCopyright: "GLINTEX",
    ignore: [/^\/test($|\/)/, /^\/out($|\/)/, /^\/scripts($|\/)/],
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "GLINTEX",
        authors: "GLINTEX",
        description: "GLINTEX factory workstation",
        setupExe: `GLINTEX-${require("./package.json").version}-x64-Setup.exe`,
        setupIcon: path.join(__dirname, "assets", "icon.ico"),
        noMsi: true,
        // Signing is opt-in only with a legitimately provisioned Windows certificate.
        ...(process.env.GLINTEX_SIGN_CERT_FILE
          ? {
              certificateFile: process.env.GLINTEX_SIGN_CERT_FILE,
              certificatePassword: process.env.GLINTEX_SIGN_CERT_PASSWORD,
            }
          : {}),
      },
    },
  ],
  plugins: [{ name: "@electron-forge/plugin-auto-unpack-natives", config: {} }],
};
