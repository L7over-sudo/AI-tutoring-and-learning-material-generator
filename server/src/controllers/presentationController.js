import { createDocumentPresentationTasks, startPptExport, getPptExportStatus } from "../services/presentationService.js";
import { logService } from "../services/logService.js";
import { ok, fail } from "../utils/response.js";
import { taskStore } from "../stores/taskStore.js";
import { getSlidePreviewFile } from "../services/slidePreviewService.js";

export async function getPresentationPreview(req, res) {
  try {
    const tasks = await taskStore.listTasks();
    const task = tasks.find(item => item.id === req.params.taskId && item.presentation);
    if (!task) return fail(res, "PPT 页面不存在", 404);
    const file = await getSlidePreviewFile(task);
    res.setHeader("Cache-Control", "no-cache");
    return res.sendFile(file);
  } catch (error) {
    return fail(res, `完整预览暂不可用：${error.message}`);
  }
}

export async function createPresentationTasks(req, res) {
  if (!req.file) return fail(res, "请上传 Word、PDF、TXT 或 Markdown 文档");
  try {
    const result = await createDocumentPresentationTasks(req.file, req.body || {});
    logService.success("presentation", `已创建 ${result.pageCount} 个 PPT 页面任务：${req.file.originalname}`);
    return ok(res, result, "PPT 页面已加入任务列表");
  } catch (error) {
    logService.error("presentation", error.message);
    return fail(res, error.message);
  }
}

export async function exportPresentation(req, res) {
  try {
    const result = await startPptExport(req.params.batchId, req.body || {});
    return ok(res, result, result.started ? "PPT 导出已开始，稍候自动下载" : "PPT 正在导出中");
  } catch (error) {
    logService.error("presentation", error.message);
    return fail(res, error.message);
  }
}

export async function getPptExport(req, res) {
  try {
    const result = await getPptExportStatus(req.params.batchId);
    return ok(res, result, "ok");
  } catch (error) {
    return fail(res, error.message);
  }
}
