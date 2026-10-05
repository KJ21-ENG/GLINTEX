const { contextBridge, ipcRenderer } = require("electron");
const call = (operation, payload) =>
  ipcRenderer.invoke("glintex:operation", operation, payload);
contextBridge.exposeInMainWorld(
  "glintexDesktop",
  Object.freeze({
    getController: () => call("controller"),
    settings: {
      get: () => call("settings.get"),
      update: (settings) => call("settings.update", settings),
    },
    server: { status: () => call("server.status") },
    scale: {
      driverSetup: () => call("scale.driverSetup"),
      enumerate: () => call("scale.enumerate"),
      configure: (config) => call("scale.configure", config),
      connect: () => call("scale.connect"),
      disconnect: () => call("scale.disconnect"),
      status: () => call("scale.status"),
      capture: (options = {}) => call("scale.capture", options),
      onStatus: (callback) => {
        if (typeof callback !== "function")
          throw new Error("Callback required");
        const listener = (_event, status) => callback(status);
        ipcRenderer.on("glintex:scale-status", listener);
        return () =>
          ipcRenderer.removeListener("glintex:scale-status", listener);
      },
    },
    printers: {
      enumerate: () => call("printers.enumerate"),
      configure: (profile) => call("printers.configure", profile),
      status: () => call("printers.status"),
      submit: (job) => call("printers.submit", job),
      getJob: (id) => call("printers.getJob", id),
      listJobs: () => call("printers.listJobs"),
      reprint: (id) => call("printers.reprint", id),
    },
  }),
);
