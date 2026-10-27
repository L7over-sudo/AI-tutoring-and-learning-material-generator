import fs from "node:fs/promises";
import path from "node:path";
import { uploadsRoot } from "../paths.js";
import { taskStore } from "../stores/taskStore.js";
import { configStore } from "../stores/configStore.js";
import { logService } from "./logService.js";

const CACHE_DIRECTORIES = ["original", "generated", "enhanced", "exports", "converted", "presentations"];
const TERMINAL_TASK_STATUSES = new Set(["已完成", "失败", "已取消"]);
const DEFAULT_RETENTION_DAYS = 30;
const CLEANUP_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

let cleanupTimer = null;
let cleanupRunning = false;

function normalizeRelativePath(value) {
  return String(value || "")
    .replace(/^[\\/]+/, "")
    .replace(/\\/g, "/")
    .replace(/^uploads\//, "");
}

function isWithinUploadsRoot(targetPath) {
  const relative = path.relative(uploadsRoot, targetPath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isProtectedPath(relativePath, protectedPaths, protectedPrefixes) {
  if (protectedPaths.has(relativePath)) return true;
  return [...protectedPrefixes].some((prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`));
}

async function getProtectedScopes() {
  try {
    const tasks = await taskStore.listTasks();
    const protectedPaths = new Set();
    const protectedPrefixes = new Set();

    for (const task of tasks) {
      if (TERMINAL_TASK_STATUSES.has(String(task.status || ""))) continue;

      for (const field of ["originalPath", "generatedPath", "enhancedPath"]) {
        const relativePath = normalizeRelativePath(task[field]);
        if (relativePath) protectedPaths.add(relativePath);
      }

      if (task.batchId) {
        for (const directory of ["original", "generated", "enhanced", "exports"]) {
          protectedPrefixes.add(`${directory}/${String(task.batchId)}`);
        }
      }
    }

    return { protectedPaths, protectedPrefixes };
  } catch (error) {
    logService.warn("cleanup", `读取任务引用失败，本次跳过缓存清理：${error.message}`);
    return null;
  }
}

async function inspectDirectory(directory, cutoffMs, scopes, summary) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (!isWithinUploadsRoot(fullPath) || entry.isSymbolicLink()) continue;

    if (entry.isDirectory()) {
      await inspectDirectory(fullPath, cutoffMs, scopes, summary);
      continue;
    }
    if (!entry.isFile()) continue;

    const stat = await fs.stat(fullPath);
    const relativePath = path.relative(uploadsRoot, fullPath).split(path.sep).join("/");
    const protectedFile = isProtectedPath(relativePath, scopes.protectedPaths, scopes.protectedPrefixes);
    summary.totalFiles += 1;
    summary.totalBytes += stat.size;
    if (protectedFile) {
      summary.protectedFiles += 1;
      summary.protectedBytes += stat.size;
    } else if (stat.mtimeMs < cutoffMs) {
      summary.cleanableFiles += 1;
      summary.cleanableBytes += stat.size;
    }
  }
}

export async function inspectUploadsCache(retentionDays = DEFAULT_RETENTION_DAYS) {
  const days = Math.min(Math.max(Number(retentionDays) || DEFAULT_RETENTION_DAYS, 1), 3650);
  const scopes = await getProtectedScopes();
  const summary = {
    skipped: !scopes,
    retentionDays: days,
    totalFiles: 0,
    totalBytes: 0,
    protectedFiles: 0,
    protectedBytes: 0,
    cleanableFiles: 0,
    cleanableBytes: 0
  };
  if (!scopes) return summary;

  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  for (const directory of CACHE_DIRECTORIES) {
    await inspectDirectory(path.join(uploadsRoot, directory), cutoffMs, scopes, summary);
  }
  return summary;
}

async function cleanDirectory(directory, cutoffMs, scopes, summary, removeEmpty = true) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (!isWithinUploadsRoot(fullPath) || entry.isSymbolicLink()) continue;

    const relativePath = path.relative(uploadsRoot, fullPath).split(path.sep).join("/");
    if (isProtectedPath(relativePath, scopes.protectedPaths, scopes.protectedPrefixes)) continue;

    if (entry.isDirectory()) {
      await cleanDirectory(fullPath, cutoffMs, scopes, summary);
      try {
        const remaining = await fs.readdir(fullPath);
        const stat = await fs.stat(fullPath);
        if (!remaining.length && removeEmpty && stat.mtimeMs < cutoffMs) {
          // Node 24+: fs.rm throws EISDIR on a directory even when empty unless
          // recursive:true is set. The dir is already emptied above, so this is safe.
          await fs.rm(fullPath, { recursive: true, force: true });
          summary.removedDirectories += 1;
        }
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      continue;
    }

    if (!entry.isFile()) continue;
    const stat = await fs.stat(fullPath);
    if (stat.mtimeMs >= cutoffMs) continue;

    // recursive:true guards against Dirent misclassifying a directory as a file
    // on some Windows/unicode paths — without it fs.rm throws EISDIR.
    await fs.rm(fullPath, { recursive: true, force: true });
    summary.removedFiles += 1;
    summary.removedBytes += stat.size;
  }
}

export async function cleanupExpiredUploads(retentionDays = DEFAULT_RETENTION_DAYS) {
  const days = Math.min(Math.max(Number(retentionDays) || DEFAULT_RETENTION_DAYS, 1), 3650);
  const scopes = await getProtectedScopes();
  if (!scopes) return { skipped: true, removedFiles: 0, removedDirectories: 0, removedBytes: 0 };

  const summary = { skipped: false, removedFiles: 0, removedDirectories: 0, removedBytes: 0 };
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

  for (const directory of CACHE_DIRECTORIES) {
    await cleanDirectory(path.join(uploadsRoot, directory), cutoffMs, scopes, summary, false);
  }

  if (summary.removedFiles || summary.removedDirectories) {
    logService.info(
      "cleanup",
      `缓存清理完成：删除 ${summary.removedFiles} 个文件、${summary.removedDirectories} 个空目录，释放 ${Math.round(summary.removedBytes / 1024 / 1024)} MB（保留 ${days} 天）`
    );
  } else {
    logService.info("cleanup", `缓存检查完成：没有超过 ${days} 天的可清理文件`);
  }

  return summary;
}

async function purgeDirectory(directory, summary) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (!isWithinUploadsRoot(fullPath) || entry.isSymbolicLink()) continue;

    if (entry.isDirectory()) {
      await purgeDirectory(fullPath, summary);
      try {
        const remaining = await fs.readdir(fullPath);
        if (!remaining.length) {
          // Node 24+: fs.rm throws EISDIR on a directory even when empty unless
          // recursive:true is set. The dir is already emptied above, so this is safe.
          await fs.rm(fullPath, { recursive: true, force: true });
          summary.removedDirectories += 1;
        }
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      continue;
    }

    if (!entry.isFile()) continue;
    const stat = await fs.stat(fullPath);
    await fs.rm(fullPath, { recursive: true, force: true });
    summary.removedFiles += 1;
    summary.removedBytes += stat.size;
  }
}

export async function purgeAllUploadsCache() {
  const summary = { removedFiles: 0, removedDirectories: 0, removedBytes: 0 };

  for (const directory of CACHE_DIRECTORIES) {
    await purgeDirectory(path.join(uploadsRoot, directory), summary);
  }

  if (summary.removedFiles || summary.removedDirectories) {
    logService.info(
      "cleanup",
      `已随清空任务清理缓存：删除 ${summary.removedFiles} 个文件、${summary.removedDirectories} 个空目录，释放 ${Math.round(summary.removedBytes / 1024 / 1024)} MB`
    );
  } else {
    logService.info("cleanup", "清空任务时没有可清理的缓存文件");
  }

  return summary;
}

async function runScheduledCleanup() {
  if (cleanupRunning) return;
  cleanupRunning = true;
  try {
    const config = await configStore.getRaw();
    if (config.cacheCleanupEnabled) {
      await cleanupExpiredUploads(config.cacheRetentionDays);
    }
  } catch (error) {
    logService.error("cleanup", `缓存清理失败：${error.message}`);
  } finally {
    cleanupRunning = false;
  }
}

function scheduleNextCleanup() {
  cleanupTimer = setTimeout(async () => {
    await runScheduledCleanup();
    scheduleNextCleanup();
  }, CLEANUP_CHECK_INTERVAL_MS);
  cleanupTimer.unref?.();
}

export function refreshCacheCleanupSchedule() {
  if (!cleanupTimer) return;
  clearTimeout(cleanupTimer);
  cleanupTimer = null;
  void runScheduledCleanup().finally(scheduleNextCleanup);
}

export function startCacheCleanup() {
  if (cleanupTimer) return () => {};

  void runScheduledCleanup().finally(scheduleNextCleanup);
  return () => {
    if (cleanupTimer) clearTimeout(cleanupTimer);
    cleanupTimer = null;
  };
}
