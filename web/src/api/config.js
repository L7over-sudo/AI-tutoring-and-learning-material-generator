import { api } from "./client";

export const getConfig = () => api.get("/config");
export const saveConfig = (data) => api.post("/config", data);
export const testConfig = (data = {}) => api.post("/config/test", data);
export const getCacheStatus = () => api.get("/config/cache");
export const cleanupCache = () => api.post("/config/cache/cleanup");
export const health = () => api.get("/health");
export const getPromptTemplates = () => api.get("/config/prompt-templates");
export const savePromptTemplate = (data) => api.post("/config/prompt-templates", data);
export const deletePromptTemplates = (ids) => api.delete("/config/prompt-templates", { data: { ids } });
