const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  checkForSoftwareUpdate: () => ipcRenderer.invoke("software-update:check"),
  downloadAndInstallUpdate: () => ipcRenderer.invoke("software-update:download-and-install"),
});
