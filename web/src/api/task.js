import { api } from "./client";

export const listBatches = () => api.get("/tasks");
export const clearTaskHistory = () => api.delete("/tasks/history");
export const getBatchTasks = (batchId) => api.get(`/tasks/${batchId}`);
export const generateTasks = (data) => api.post("/tasks/generate", data);
export const appendGenerateTasks = (data) => api.post("/tasks/append-generate", data);
export const generateTextImage = (data) => api.post("/tasks/text-image", data);
export const createStoryboardBatch = (data) => api.post("/tasks/storyboard", data);
export function generateTextReferenceImage(data) {
  const form = new FormData();
  form.append("title", data.title || "图文参考生成");
  form.append("mode", data.mode || "text-reference");
  form.append("sourceText", data.sourceText || "");
  form.append("count", String(data.count || 1));
  form.append("referenceImage", data.referenceImage);
  form.append("generationOptions", JSON.stringify(data.generationOptions || {}));
  return api.post("/tasks/text-reference-image", form, {
    headers: { "Content-Type": "multipart/form-data" }
  });
}
export const followUpTask = (taskId, data) => api.post(`/tasks/${taskId}/follow-up`, data);
export const cancelBatch = (batchId) => api.post(`/tasks/${batchId}/cancel`);
export const retryFailed = (batchId, data) => api.post(`/tasks/${batchId}/retry-failed`, data);
export const regenerateTask = (batchId, taskId, data) => api.post(`/tasks/${batchId}/${taskId}/regenerate`, data);
export const deleteTask = (batchId, taskId) => api.delete(`/tasks/${batchId}/${taskId}`);
