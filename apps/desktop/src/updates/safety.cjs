function updateBlockReason({ scale = {}, driverRunning, nativeOperations = 0, apiRequests = 0, printJobs = [] }) {
  if (scale.isConnected || ["connecting", "connected", "reconnecting"].includes(scale.status)) return "Disconnect the scale and finish all captures before closing for an update.";
  if (driverRunning) return "Wait for scale driver setup to finish before updating.";
  if (nativeOperations || apiRequests) return "A capture, save, server request or workstation operation is still running. Wait for it to finish.";
  if (printJobs.some(job => !["submitted", "failed", "outcome uncertain"].includes(job.state))) return "Wait for all GLINTEX print jobs to finish submission before updating.";
  return null;
}
module.exports = { updateBlockReason };
