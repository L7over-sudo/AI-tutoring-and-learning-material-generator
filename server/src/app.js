import "./env.js";
import path from "node:path";
import express from "express";
import cors from "cors";
import uploadRoutes from "./routes/upload.routes.js";
import taskRoutes from "./routes/task.routes.js";
import configRoutes from "./routes/config.routes.js";
import exportRoutes from "./routes/export.routes.js";
import logRoutes from "./routes/log.routes.js";
import convertRoutes from "./routes/convert.routes.js";
import presentationRoutes from "./routes/presentation.routes.js";
import xhsPublishRoutes from "./routes/xhsPublish.routes.js";
import { ensureUploadDirs, uploadsRoot } from "./services/fileService.js";
import { startCacheCleanup } from "./services/cacheCleanupService.js";
import { logService } from "./services/logService.js";
import { taskStore } from "./stores/taskStore.js";
import { fail } from "./utils/response.js";

await ensureUploadDirs();
try {
  await taskStore.reconcileInterruptedRunningTasks();
} catch (error) {
  logService.warn("app", `启动任务状态收尾失败，服务继续启动：${error?.message || error}`);
}
startCacheCleanup();

process.on("unhandledRejection", (reason) => {
  logService.error("app", `未处理的异步错误：${reason?.stack || reason?.message || reason}`);
});

process.on("uncaughtException", (error) => {
  logService.error("app", `未捕获异常：${error?.stack || error?.message || error}`);
});

const app = express();
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || undefined;
const webDistDir = process.env.WEB_DIST_DIR || "";

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/static", express.static(uploadsRoot, {
  fallthrough: false,
  setHeaders(res) {
    res.setHeader("X-Content-Type-Options", "nosniff");
  }
}));

app.get("/api/health", (req, res) => res.json({
  success: true,
  message: "后端连接正常",
  convertFallback: "use-rendered-pages-on-poppler-warning",
  uploadFileLimit: 1000
}));
app.use("/api/upload", uploadRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/config", configRoutes);
app.use("/api/export", exportRoutes);
app.use("/api/logs", logRoutes);
app.use("/api/convert", convertRoutes);
app.use("/api/presentations", presentationRoutes);
app.use("/api/xhs-publish", xhsPublishRoutes);

if (webDistDir) {
  app.use(express.static(webDistDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/static")) return next();
    return res.sendFile(path.join(webDistDir, "index.html"));
  });
}

app.use((error, req, res, next) => {
  const isDocumentConvert = req.originalUrl?.startsWith("/api/convert/document-to-images");
  const message = error?.code === "LIMIT_FILE_SIZE"
    ? isDocumentConvert ? "Word、PDF、PPT 单文件不能超过 200MB" : "单文件不能超过 20MB"
    : error?.code === "LIMIT_FILE_COUNT"
      ? "单次最多支持 1000 个文件"
      : error?.message || "服务器处理失败";
  logService.error("app", message);
  return fail(res, message, 500);
});

app.listen(port, host, () => {
  logService.success("app", `服务已启动：http://localhost:${port}`);
});
