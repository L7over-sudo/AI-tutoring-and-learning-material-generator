import { nanoid } from "nanoid";
import { taskStore } from "../stores/taskStore.js";
import { configStore } from "../stores/configStore.js";
import { saveOriginalFile } from "../services/fileService.js";
import { logService } from "../services/logService.js";
import { compactSourceText, extractDocumentInfo } from "../services/documentService.js";
import { naturalSort } from "../utils/naturalSort.js";
import { isAllowedImage } from "../utils/imageUtils.js";
import { ok, fail } from "../utils/response.js";

export async function uploadImages(req, res) {
  const inputFiles = req.files || [];
  const config = await configStore.getRaw();
  const requestedMaxBatchCount = Number(req.body.maxBatchCount || config.maxBatchCount || 100);
  const maxBatchCount = Math.min(Math.max(requestedMaxBatchCount, 1), 1000);
  const validFiles = naturalSort(inputFiles.filter(isAllowedImage), (file) => file.originalname).slice(0, maxBatchCount);

  if (!validFiles.length) {
    logService.warn("upload", "没有可处理图片");
    return fail(res, "没有可处理图片");
  }

  const batchId = nanoid();
  const now = new Date().toISOString();
  const folderName = req.body.folderName || "教辅图片";

  const tasks = [];
  for (let i = 0; i < validFiles.length; i += 1) {
    const saved = await saveOriginalFile(validFiles[i], batchId);
    tasks.push({
      id: nanoid(),
      batchId,
      index: i + 1,
      title: saved.originalName,
      originalName: saved.originalName,
      folderName,
      originalPath: saved.relativePath,
      originalUrl: saved.url,
      generatedPath: null,
      generatedUrl: null,
      enhancedPath: null,
      enhancedUrl: null,
      status: "待生成",
      selected: true,
      error: null,
      createdAt: now,
      updatedAt: now
    });
  }

  const batch = {
    id: batchId,
    folderName,
    status: "待生成",
    cancelRequested: false,
    summary: { total: tasks.length, success: 0, failed: 0, running: 0, pending: tasks.length, canceled: 0 },
    createdAt: now,
    updatedAt: now
  };

  await taskStore.addBatch(batch, tasks);
  logService.success("upload", `成功导入 ${tasks.length} 张图片`);
  return ok(res, { batch, tasks }, `成功导入 ${tasks.length} 张图片`);
}

function getDocumentFiles(req) {
  if (req.file) return [req.file];
  if (Array.isArray(req.files)) return req.files;
  return Object.values(req.files || {}).flat();
}

export async function uploadDocument(req, res) {
  const files = getDocumentFiles(req);
  if (!files.length) return fail(res, "请上传文档文件");
  try {
    const docs = [];
    for (const file of files) {
      const info = await extractDocumentInfo(file);
      const text = compactSourceText(info.text);
      if (text) {
        docs.push({
          title: file.originalname,
          text,
          pageCount: Math.max(Number(info.pageCount || 1), 1)
        });
      }
    }

    const text = docs
      .map((doc) => files.length > 1 ? `【${doc.title}】\n${doc.text}` : doc.text)
      .join("\n\n");
    if (!text) return fail(res, "没有从文档中提取到可用文字");
    const pageCount = docs.reduce((total, doc) => total + doc.pageCount, 0);
    const title = docs.length === 1 ? docs[0].title : `${docs.length}个文档`;
    logService.success("upload", `成功提取文档文字：${title}`);
    return ok(res, { text, title, pageCount, documents: docs }, "文档文字提取成功");
  } catch (error) {
    logService.error("upload", error.message);
    return fail(res, error.message);
  }
}
