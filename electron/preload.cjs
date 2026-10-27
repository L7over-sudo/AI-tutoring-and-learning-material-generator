const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("xhsDownload", {
  // 解析结果传给主进程，由主进程弹文件夹选择框并写入文件
  // payload: { items: [{name, url}], title, desc }
  // 返回: { success, savedCount, folder, failed: [name] }
  downloadToFolder: (payload) => ipcRenderer.invoke("xhs:download-to-folder", payload),
  isDesktop: true
});

contextBridge.exposeInMainWorld("xhsPublish", {
  prepareAndOpen: (payload) => ipcRenderer.invoke("xhs:prepare-publish", payload),
  onStatus: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("xhs:publish-status", listener);
    return () => ipcRenderer.removeListener("xhs:publish-status", listener);
  },
  isDesktop: true
});

contextBridge.exposeInMainWorld("license", {
  getStatus: () => ipcRenderer.invoke("license:status"),
  onStatus: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("license:changed", listener);
    return () => ipcRenderer.removeListener("license:changed", listener);
  }
});
