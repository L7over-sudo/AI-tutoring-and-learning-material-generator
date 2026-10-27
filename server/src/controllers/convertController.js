import path from "node:path";
import fs from "node:fs";
import { convertDocumentToImages, convertImagesToPdf, convertImagesToPpt, convertPdfToWord, stitchImages } from "../services/convertService.js";
import { parseXhsNote } from "../services/xhsParseService.js";
import { logService } from "../services/logService.js";
import { uploadsRoot } from "../services/fileService.js";
import { ok, fail } from "../utils/response.js";

export async function convertDocument(req, res) {
  if (!req.file) return fail(res, "请上传 Word、PDF 或 PPT 文件");
  try {
    const result = await convertDocumentToImages(req.file, req.body || {});
    logService.success("convert", `文档转图片完成：${req.file.originalname}`);
    return ok(res, result, "文档转图片完成");
  } catch (error) {
    logService.error("convert", error.message);
    return fail(res, error.message);
  }
}

export async function convertImages(req, res) {
  const files = req.files || [];
  if (!files.length) return fail(res, "请上传图片文件");
  try {
    const result = await convertImagesToPdf(files, req.body || {});
    logService.success("convert", `图片转 PDF 完成：${files.length} 张`);
    return ok(res, result, "图片转 PDF 完成");
  } catch (error) {
    logService.error("convert", error.message);
    return fail(res, error.message);
  }
}

export async function convertImagesPpt(req, res) {
  const files = req.files || [];
  if (!files.length) return fail(res, "请上传图片文件");
  try {
    const result = await convertImagesToPpt(files, req.body || {});
    logService.success("convert", `图片转 PPT 完成：${files.length} 张`);
    return ok(res, result, "图片转 PPT 完成");
  } catch (error) {
    logService.error("convert", error.message);
    return fail(res, error.message);
  }
}

export async function stitchUploadedImages(req, res) {
  const files = req.files || [];
  if (files.length < 2) return fail(res, "请至少上传 2 张图片");
  try {
    const result = await stitchImages(files, req.body || {});
    logService.success("convert", `图片拼接完成：${files.length} 张`);
    return ok(res, result, "图片拼接完成");
  } catch (error) {
    logService.error("convert", error.message);
    return fail(res, error.message);
  }
}

export async function convertPdfWord(req, res) {
  if (!req.file) return fail(res, "请上传 PDF 文件");
  try {
    const result = await convertPdfToWord(req.file, req.body || {});
    logService.success("convert", `PDF 转 Word 完成：${req.file.originalname}`);
    return ok(res, result, "PDF 转 Word 完成");
  } catch (error) {
    logService.error("convert", error.message);
    return fail(res, error.message);
  }
}

export async function downloadConvertedZip(req, res) {
  const zipPath = path.join(uploadsRoot, "converted", req.params.jobId, "converted-images.zip");
  if (!zipPath.startsWith(uploadsRoot) || !fs.existsSync(zipPath)) return fail(res, "转换 ZIP 不存在", 404);
  return res.download(zipPath, "document-images.zip");
}

export async function downloadConvertedPdf(req, res) {
  const pdfPath = path.join(uploadsRoot, "converted", req.params.jobId, req.params.fileName);
  if (!pdfPath.startsWith(uploadsRoot) || !fs.existsSync(pdfPath)) return fail(res, "PDF 文件不存在", 404);
  return res.download(pdfPath, req.params.fileName || "images.pdf");
}

export async function downloadConvertedPpt(req, res) {
  const pptPath = path.join(uploadsRoot, "converted", req.params.jobId, req.params.fileName);
  if (!pptPath.startsWith(uploadsRoot) || !fs.existsSync(pptPath)) return fail(res, "PPT 文件不存在", 404);
  return res.download(pptPath, req.params.fileName || "images.pptx");
}

export async function downloadConvertedWord(req, res) {
  const wordPath = path.join(uploadsRoot, "converted", req.params.jobId, req.params.fileName);
  if (!wordPath.startsWith(uploadsRoot) || !fs.existsSync(wordPath)) return fail(res, "Word 文件不存在", 404);
  return res.download(wordPath, req.params.fileName || "document.docx");
}

export async function downloadConvertedImage(req, res) {
  const imagePath = path.join(uploadsRoot, "converted", req.params.jobId, req.params.fileName);
  if (!imagePath.startsWith(uploadsRoot) || !fs.existsSync(imagePath)) return fail(res, "拼接图片不存在", 404);
  return res.download(imagePath, req.params.fileName || "图片拼接.png");
}

export async function xhsParseNote(req, res) {
  const url = String(req.body?.url || "").trim();
  if (!url) return fail(res, "请粘贴小红书链接");
  try {
    const result = await parseXhsNote(url);
    logService.success("convert", `作品解析完成：${result.title || url}`);
    return ok(res, result, "作品解析完成");
  } catch (error) {
    logService.error("convert", `作品解析失败：${error.message}`);
    return fail(res, error.message);
  }
}

export async function downloadXhsZip(req, res) {
  const zipPath = path.join(uploadsRoot, "converted", req.params.jobId, "作品解析.zip");
  if (!zipPath.startsWith(uploadsRoot) || !fs.existsSync(zipPath)) return fail(res, "作品解析 ZIP 不存在", 404);
  return res.download(zipPath, "作品解析.zip");
}
