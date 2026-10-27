import { api } from "./client";

export const recentLogs = () => api.get("/logs/recent");
export const clearUiLogs = () => api.post("/logs/clear-ui");
