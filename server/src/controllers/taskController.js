import { taskStore } from "../stores/taskStore.js";
import { batchService } from "../services/batchService.js";
import { isAllowedImage } from "../utils/imageUtils.js";
import { ok, fail } from "../utils/response.js";

export async function listBatches(req, res) {
  const batches = await taskStore.listBatches();
  const sorted = [...batches].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  return ok(res, { batches: sorted });
}

export async function getBatchTasks(req, res) {
  const data = await taskStore.getBatch(req.params.batchId);
  if (!data.batch) return fail(res, "批次不存在", 404);
  return ok(res, data);
}

export async function generateTasks(req, res) {
  const result = await batchService.generate(req.body || {});
  return result.success ? ok(res, {}, result.message) : fail(res, result.message);
}


export async function appendGenerateTasks(req, res) {
  const result = await batchService.appendGenerate(req.body || {});
  return result.success ? ok(res, {}, result.message) : fail(res, result.message);
}
export async function generateFromText(req, res) {
  const { title, sourceText, count, generationOptions } = req.body || {};
  if (!sourceText?.trim()) return fail(res, "请输入文字内容或上传文档");
  const result = await batchService.generateTextBatch({ title, sourceText, count, generationOptions });
  return result.success ? ok(res, { batch: result.batch, tasks: result.tasks }, result.message) : fail(res, result.message);
}

export async function createStoryboard(req, res) {
  const { title, scenes, generationOptions } = req.body || {};
  if (!Array.isArray(scenes) || !scenes.length) return fail(res, "请至少添加一个分镜");
  const result = await batchService.generateStoryboardBatch({
    title,
    scenes,
    generationOptions: generationOptions || {}
  });
  return result.success ? ok(res, { batch: result.batch, tasks: result.tasks }, result.message) : fail(res, result.message);
}

export async function generateFromTextReference(req, res) {
  const { title, sourceText, count } = req.body || {};
  const mode = "prompt-reference";
  if (!sourceText?.trim()) return fail(res, "请输入生成提示词");
  if (!req.file) return fail(res, "请上传一张参考图");
  if (!isAllowedImage(req.file)) return fail(res, "参考图只支持 jpg / jpeg / png / webp");

  let generationOptions = {};
  try {
    generationOptions = req.body?.generationOptions ? JSON.parse(req.body.generationOptions) : {};
  } catch {
    return fail(res, "生成参数格式不正确");
  }

  const result = await batchService.generateTextReferenceBatch({
    title,
    mode,
    sourceText,
    count,
    referenceImage: req.file,
    generationOptions
  });
  return result.success ? ok(res, { batch: result.batch, tasks: result.tasks }, result.message) : fail(res, result.message);
}

export async function createFollowUpTask(req, res) {
  const { prompt, generationOptions } = req.body || {};
  if (!prompt?.trim()) return fail(res, "请输入继续修改的提示词");
  const result = await batchService.createFollowUpTask({
    taskId: req.params.taskId,
    prompt,
    generationOptions: generationOptions || {}
  });
  return result.success ? ok(res, { batch: result.batch, task: result.task }, result.message) : fail(res, result.message);
}

export async function cancelBatch(req, res) {
  const result = await batchService.cancel(req.params.batchId);
  return ok(res, {}, result.message);
}


export async function regenerateTask(req, res) {
  const result = await batchService.regenerateTask(req.params.batchId, req.params.taskId, req.body || {});
  return result.success ? ok(res, {}, result.message) : fail(res, result.message);
}
export async function retryFailed(req, res) {
  const result = await batchService.retryFailed(req.params.batchId, req.body || {});
  return result.success ? ok(res, {}, result.message) : fail(res, result.message);
}

export async function clearHistory(req, res) {
  const result = await batchService.clearHistory();
  return ok(res, {}, result.message);
}

export async function deleteTask(req, res) {
  await taskStore.deleteTask(req.params.taskId);
  return ok(res, {}, "已删除任务");
}
