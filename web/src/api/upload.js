import { api } from "./client";

export function uploadImages(files, folderName = "", options = {}) {
  const form = new FormData();
  files.forEach((file) => form.append("files", file));
  if (folderName) form.append("folderName", folderName);
  if (options.maxBatchCount) form.append("maxBatchCount", String(options.maxBatchCount));
  return api.post("/upload/images", form, {
    headers: { "Content-Type": "multipart/form-data" },
    onUploadProgress: options.onUploadProgress
  });
}

export function uploadDocument(file) {
  const form = new FormData();
  const files = Array.isArray(file) ? file : [file];
  files.forEach((item) => form.append("files", item));
  return api.post("/upload/document", form, { headers: { "Content-Type": "multipart/form-data" } });
}
