import { api } from "./client";

export function convertDocumentToImages(file, options = {}) {
  const form = new FormData();
  form.append("file", file);
  form.append("resolution", options.resolution || "2k");
  form.append("imageFormat", options.imageFormat || "png");
  form.append("quality", String(options.quality || 92));
  form.append("separateFolder", String(Boolean(options.separateFolder)));
  form.append("skipBlankPages", String(options.skipBlankPages === true));
  if (options.outputFolder) form.append("outputFolder", options.outputFolder);
  return api.post("/convert/document-to-images", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: options.timeout || 1800000,
    signal: options.signal,
    onUploadProgress: options.onUploadProgress
  });
}

export function convertImagesToPdf(files, options = {}) {
  const form = new FormData();
  for (const file of files) {
    form.append("files", file);
  }
  form.append("resolution", options.resolution || "2k");
  form.append("quality", String(options.quality || 92));
  form.append("pdfName", options.pdfName || "images");
  form.append("preserveOrder", String(options.preserveOrder !== false));
  if (options.outputFolder) form.append("outputFolder", options.outputFolder);
  return api.post("/convert/images-to-pdf", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 180000,
    signal: options.signal
  });
}

export function convertImagesToPpt(files, options = {}) {
  const form = new FormData();
  for (const file of files) {
    form.append("files", file);
  }
  form.append("pptName", options.pptName || options.fileName || "images");
  form.append("preserveOrder", String(options.preserveOrder !== false));
  if (options.outputFolder) form.append("outputFolder", options.outputFolder);
  return api.post("/convert/images-to-ppt", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 180000,
    signal: options.signal
  });
}

export function stitchImages(files, options = {}) {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  form.append("direction", options.direction || "vertical");
  form.append("align", options.align || "center");
  form.append("ratio", options.ratio || "auto");
  form.append("gap", String(options.gap ?? 0));
  form.append("padding", String(options.padding ?? 0));
  form.append("background", options.background || "#ffffff");
  form.append("normalizeSize", String(options.normalizeSize !== false));
  form.append("imageFormat", options.imageFormat || "png");
  form.append("quality", String(options.quality || 92));
  form.append("fileName", options.fileName || "图片拼接");
  if (options.outputFolder) form.append("outputFolder", options.outputFolder);
  return api.post("/convert/images-stitch", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 600000,
    signal: options.signal,
    onUploadProgress: options.onUploadProgress
  });
}

export function convertPdfToWord(file, options = {}) {
  const form = new FormData();
  form.append("file", file);
  form.append("wordName", options.wordName || options.fileName || "document");
  if (options.outputFolder) form.append("outputFolder", options.outputFolder);
  return api.post("/convert/pdf-to-word", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 180000,
    signal: options.signal
  });
}

export function parseXhsNote(url, options = {}) {
  return api.post("/convert/xhs-parse", { url }, {
    timeout: 180000,
    signal: options.signal
  });
}
