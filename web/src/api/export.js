import { api } from "./client";

export const exportZip = (data) => api.post("/export/zip", data);
