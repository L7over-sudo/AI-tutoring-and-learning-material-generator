const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("licenseApi", {
  activate: (code) => ipcRenderer.invoke("license:activate", code),
  getStatus: () => ipcRenderer.invoke("license:status"),
  quit: () => ipcRenderer.invoke("license:quit")
});
