import path from "node:path";
import fs from "node:fs";
import { taskStore } from "../stores/taskStore.js";
import { createZip } from "../services/exportService.js";
import { uploadsRoot } from "../services/fileService.js";
import { logService } from "../services/logService.js";
import { ok, fail } from "../utils/response.js";

export async function exportZip(req, res) {
  const { batchId, onlyCompleted = true, useEnhancedIfExists = true } = req.body || {};
  const { batch, tasks } = await taskStore.getBatch(batchId);
  if (!batch) return fail(res, "批次不存在", 404);
  const result = await createZip({ batchId, tasks, onlyCompleted, useEnhancedIfExists });
  if (!result.success) return fail(res, result.message);
  logService.success("export", "导出 ZIP 成功");
  return ok(res, { downloadUrl: result.downloadUrl }, "导出成功，正在下载 ZIP");
}

export async function downloadZip(req, res) {
  const zipPath = path.join(uploadsRoot, "exports", req.params.batchId, "export.zip");
  if (!zipPath.startsWith(uploadsRoot) || !fs.existsSync(zipPath)) return fail(res, "ZIP 文件不存在", 404);
  return res.download(zipPath, "小红书教辅图片.zip");
}
