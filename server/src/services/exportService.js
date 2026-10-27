import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";
import { ensureUniqueZipName, resolveUploadRelative, uploadsRoot } from "./fileService.js";
import { sanitizeFileName } from "../utils/sanitizeFileName.js";

export async function createZip({ batchId, tasks, onlyCompleted = true, useEnhancedIfExists = true }) {
  const exportDir = path.join(uploadsRoot, "exports", batchId);
  await fsp.mkdir(exportDir, { recursive: true });
  const zipPath = path.join(exportDir, "export.zip");

  const files = tasks.filter((task) => {
    if (onlyCompleted && task.status !== "已完成") return false;
    return useEnhancedIfExists ? task.enhancedPath || task.generatedPath : task.generatedPath;
  });

  if (!files.length) {
    return { success: false, message: "没有可导出的图片" };
  }

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);

    const usedNames = new Set();
    for (const task of files) {
      const relative = useEnhancedIfExists && task.enhancedPath ? task.enhancedPath : task.generatedPath;
      const full = resolveUploadRelative(relative);
      const folder = sanitizeFileName(task.folderName || "images").replace(/\.[^.]+$/, "");
      const fileName = sanitizeFileName(task.originalName || task.title);
      const zipName = `${folder}/${ensureUniqueZipName(usedNames, fileName)}`;
      archive.file(full, { name: zipName });
    }
    archive.finalize();
  });

  return {
    success: true,
    zipPath,
    downloadUrl: `/api/export/download/${batchId}`
  };
}
