import { api } from "./client";

export function createDocumentPptTasks(file, options = {}) {
  const form = new FormData();
  form.append("file", file);
  form.append("pptName", options.pptName || "文档演示");
  form.append("stylePrompt", options.stylePrompt || "");
  form.append("promptTemplate", options.promptTemplate || "");
  form.append("textMode", options.textMode || "concise");
  form.append("pageDensity", options.pageDensity || "balanced");
  return api.post("/presentations/tasks", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: options.timeout || 1800000,
    signal: options.signal,
    onUploadProgress: options.onUploadProgress
  });
}

// 启动导出（后台任务）：只做同步校验后立刻返回，耗时的图标生成+打包在后台跑。
export function exportDocumentPpt(batchId, options = {}) {
  return api.post(`/presentations/export/${batchId}`, options, { timeout: 60000 });
}

// 轮询导出状态：{ pptExport: { status: "running"|"done"|"failed"|"idle", downloadUrl, fileName, error } }
export function getPptExportStatus(batchId) {
  return api.get(`/presentations/export/${batchId}/status`, { timeout: 60000 });
}
