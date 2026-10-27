import pLimit from "p-limit";
import sharp from "sharp";
import { taskStore } from "../stores/taskStore.js";
import { configStore } from "../stores/configStore.js";
import { logService } from "./logService.js";
import { generateTeachingImageFromText, generateTeachingImageFromTextAndReference, redrawTeachingMaterial } from "./openaiImageService.js";
import { enhanceImage } from "./enhancementService.js";
import { resolveUploadRelative, saveGeneratedImage, saveOriginalFile } from "./fileService.js";
import { purgeAllUploadsCache } from "./cacheCleanupService.js";
import { withTimeoutAndRetry } from "../utils/retry.js";

const runningBatches = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DEFAULT_TIMEOUT_MS = 240000;
const APIMART_MIN_TIMEOUT_MS = 240000;
const STABLE_CONCURRENCY_LIMIT = 100;

function summarize(tasks) {
  return {
    total: tasks.length,
    success: tasks.filter((task) => task.status === "已完成").length,
    failed: tasks.filter((task) => task.status === "失败").length,
    running: tasks.filter((task) => task.status === "生成中").length,
    pending: tasks.filter((task) => task.status === "待生成").length,
    canceled: tasks.filter((task) => task.status === "已取消").length
  };
}

function normalizeConcurrency(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 100;
  return Math.min(Math.max(number, 1), 100);
}

function needsStableNetworkMode(config = {}) {
  return Boolean(config.proxyHost && config.proxyPort) || config.provider === "apimart" || String(config.baseUrl || "").includes("apimart.ai");
}

function effectiveConcurrency(requested, config) {
  const normalized = normalizeConcurrency(requested);
  return needsStableNetworkMode(config) ? Math.min(normalized, STABLE_CONCURRENCY_LIMIT) : normalized;
}

function isOriginalSizeLabel(size) {
  return ["原尺寸", "原图尺寸"].includes(String(size || "").trim());
}

async function outputSizeForTask(task, size) {
  if (!isOriginalSizeLabel(size) || !task.originalPath) return size;

  try {
    const meta = await sharp(resolveUploadRelative(task.originalPath)).metadata();
    const width = Math.round(Number(meta.width || 0));
    const height = Math.round(Number(meta.height || 0));
    if (width > 0 && height > 0) return `${width}x${height}`;
  } catch (error) {
    logService.warn("batch", `读取原图尺寸失败，按接口返回尺寸保存：${task.originalName}，${error.message}`);
  }

  return size;
}

function normalizeTimeoutMs(value, fallback = DEFAULT_TIMEOUT_MS) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.max(number, 10000);
}

function staggerDelay(index, concurrency, stableMode) {
  if (!stableMode && concurrency <= 5) return 0;
  if (stableMode && concurrency <= 1) return 0;
  const step = stableMode ? 600 : 350;
  const max = stableMode ? 3000 : 6000;
  return Math.min(index * step, max);
}

async function updateBatchProgress(batchId) {
  const { tasks } = await taskStore.getBatch(batchId);
  await taskStore.updateBatch(batchId, { summary: summarize(tasks) });
}

function batchFinishResult(summary, canceled) {
  if (canceled) {
    return { status: "已停止", level: "warn", message: "批量生成已停止" };
  }
  if (summary.failed > 0) {
    return {
      status: "失败",
      level: "error",
      message: `批量生成结束：成功 ${summary.success}，失败 ${summary.failed}`
    };
  }
  return {
    status: "已完成",
    level: "success",
    message: `批量生成完成：成功 ${summary.success}`
  };
}

async function runOneTask(task, options, config, controller) {
  if (controller.signal.aborted) {
    await taskStore.updateTask(task.id, { status: "已取消" });
    return;
  }

  await taskStore.updateTask(task.id, { status: "生成中", error: null });
  logService.info("batch", `开始生成：${task.originalName}`);

  try {
    const taskOptions = { ...(task.generationOptions || {}), ...options };
    if (task.presentation) {
      taskOptions.presentation = true;
      taskOptions.size = "16:9";
    }
    const isApimart = config.provider === "apimart" || String(config.baseUrl || "").includes("apimart.ai");
    const timeoutMs = isApimart
      ? Math.max(normalizeTimeoutMs(taskOptions.timeoutMs ?? config.timeoutMs, APIMART_MIN_TIMEOUT_MS), APIMART_MIN_TIMEOUT_MS)
      : normalizeTimeoutMs(taskOptions.timeoutMs ?? config.timeoutMs, DEFAULT_TIMEOUT_MS);
    const result = await withTimeoutAndRetry(
      async (signal) => {
        let data;
        if (task.sourceType === "composite") {
          // P1：只生纯背景图（不含文字），文字由代码在导出时叠文本框
          data = await generateTeachingImageFromText({
            sourceText: task.sourceText,
            prompt: taskOptions.prompt,
            storyboard: false,
            presentation: true,
            backgroundOnly: true,
            layoutPrompt: task.layoutPrompt || "",
            size: taskOptions.size,
            quality: taskOptions.quality,
            config: { ...config, timeoutMs },
            signal
          });
        } else if (task.sourceType === "text") {
          data = await generateTeachingImageFromText({
            sourceText: task.sourceText,
            prompt: taskOptions.prompt,
            storyboard: Boolean(task.storyboard),
            presentation: Boolean(task.presentation || taskOptions.presentation),
            size: taskOptions.size,
            quality: taskOptions.quality,
            config: { ...config, timeoutMs },
            signal
          });
        } else if (task.sourceType === "text-reference") {
          data = await generateTeachingImageFromTextAndReference({
            sourceText: task.sourceText,
            mode: task.mode,
            referenceImagePath: resolveUploadRelative(task.originalPath),
            prompt: taskOptions.prompt,
            size: taskOptions.size,
            quality: taskOptions.quality,
            config: { ...config, timeoutMs },
            signal
          });
        } else {
          data = await redrawTeachingMaterial({
            referenceImagePath: resolveUploadRelative(task.originalPath),
            prompt: taskOptions.prompt,
            size: taskOptions.size,
            quality: taskOptions.quality,
            redrawStrength: taskOptions.redrawStrength,
            config: { ...config, timeoutMs },
            signal
          });
        }
        if (!data.success) throw new Error(data.error);
        return data;
      },
      timeoutMs,
      Number(taskOptions.maxRetries ?? config.maxRetries ?? 2),
      Number(taskOptions.retryDelay ?? config.retryDelay ?? 10000),
      logService,
      controller.signal
    );

    const outputSize = await outputSizeForTask(task, taskOptions.size);

    const generated = await saveGeneratedImage({
      batchId: task.batchId,
      taskId: task.id,
      originalName: task.originalName || `${task.title || "text-image"}.png`,
      b64Json: result.b64Json,
      mimeType: result.mimeType,
      size: outputSize,
      quality: taskOptions.quality
    });

    let enhanced = null;
    if (taskOptions.enhancementEnabled) {
      try {
        enhanced = await enhanceImage({
        inputPath: generated.fullPath,
        batchId: task.batchId,
        taskId: task.id,
        originalName: task.originalName,
          config: { ...config, originality: { ...config.originality, enabled: true } }
        });
      } catch (error) {
        logService.warn("enhancement", `图片差异化增强失败，保留生成图：${task.originalName}，${error.message}`);
      }
    }

    await taskStore.updateTask(task.id, {
      status: "已完成",
      generatedPath: generated.relativePath,
      generatedUrl: generated.url,
      enhancedPath: enhanced?.relativePath || null,
      enhancedUrl: enhanced?.url || null,
      error: null
    });
    logService.success("batch", `生成完成：${task.originalName}`);
  } catch (error) {
    const canceled = controller.signal.aborted;
    await taskStore.updateTask(task.id, {
      status: canceled ? "已取消" : "失败",
      error: canceled ? "任务已取消" : error.message
    });
    logService[canceled ? "warn" : "error"]("batch", `${canceled ? "已取消" : "生成失败"}：${task.originalName}，${error.message}`);
  } finally {
    await updateBatchProgress(task.batchId);
  }
}


function finishRunnerIfIdle(batchId, runner) {
  if (runner.activeGroups > 0 || runner.finishing) return;
  runner.finishing = true;
  Promise.resolve().then(async () => {
    runningBatches.delete(batchId);
    const { tasks: latest } = await taskStore.getBatch(batchId);
    const canceled = runner.controller.signal.aborted;
    const summary = summarize(latest);
    const finish = batchFinishResult(summary, canceled);
    await taskStore.updateBatch(batchId, {
      status: finish.status,
      cancelRequested: false,
      summary
    });
    logService[finish.level]("batch", finish.message);
  }).catch(async (error) => {
    runningBatches.delete(batchId);
    await taskStore.updateBatch(batchId, { status: "失败", cancelRequested: false });
    logService.error("batch", `批量任务收尾失败：${error?.message || error}`);
  });
}

function startTaskGroup({ batchId, selected, options, runner }) {
  runner.activeGroups += 1;
  selected.forEach((task) => runner.queuedTaskIds.add(task.id));

  Promise.allSettled(
    selected.map((task, index) =>
      runner.limit(async () => {
        const waitMs = staggerDelay(index, runner.concurrency, runner.stableMode);
        if (waitMs) await sleep(waitMs);
        if (runner.controller.signal.aborted) {
          await taskStore.updateTask(task.id, { status: "已取消", error: "任务已取消" });
          runner.queuedTaskIds.delete(task.id);
          return;
        }
        try {
          await runOneTask(task, options, runner.config, runner.controller);
        } finally {
          runner.queuedTaskIds.delete(task.id);
        }
      })
    )
  ).then(async () => {
    runner.activeGroups -= 1;
    finishRunnerIfIdle(batchId, runner);
  }).catch(async (error) => {
    runner.activeGroups -= 1;
    await taskStore.updateBatch(batchId, { status: "失败", cancelRequested: false });
    logService.error("batch", `批量任务执行失败：${error?.message || error}`);
    finishRunnerIfIdle(batchId, runner);
  });
}
export const batchService = {
  async generate(options) {
    const { batchId, taskIds = [] } = options;
    const { batch, tasks } = await taskStore.getBatch(batchId);
    if (!batch) return { success: false, message: "批次不存在" };

    const selected = tasks.filter((task) => {
      const inIds = !taskIds.length || taskIds.includes(task.id);
      return inIds && ["待生成", "失败", "已取消"].includes(task.status);
    });
    if (!selected.length) return { success: false, message: "没有可生成的任务" };

    const config = await configStore.getRaw();
    if (!config.apiKey) {
      return { success: false, message: "请先在 API 设置中填写 OpenAI API Key" };
    }

    const existing = runningBatches.get(batchId);
    if (existing?.controller) existing.controller.abort(new Error("开始新的批量生成"));

    const controller = new AbortController();
    const requestedConcurrency = normalizeConcurrency(options.maxConcurrency || config.maxConcurrency || 100);
    const stableMode = needsStableNetworkMode(config);
    const concurrency = effectiveConcurrency(requestedConcurrency, config);
    const runner = {
      controller,
      config,
      limit: pLimit(concurrency),
      concurrency,
      stableMode,
      activeGroups: 0,
      finishing: false,
      queuedTaskIds: new Set()
    };
    runningBatches.set(batchId, runner);
    await taskStore.updateBatch(batchId, { status: "生成中", cancelRequested: false });

    logService.info(
      "batch",
      stableMode && requestedConcurrency !== concurrency
        ? `开始批量生成，共 ${selected.length} 张，设置并发 ${requestedConcurrency}，稳定保护后实际并发 ${concurrency}`
        : `开始批量生成，共 ${selected.length} 张，并发 ${concurrency}`
    );

    startTaskGroup({ batchId, selected, options, runner });
    return { success: true, message: "已开始生成" };
  },
  async appendGenerate(options) {
    const { batchId, taskIds = [] } = options;
    const runner = runningBatches.get(batchId);
    if (!runner || runner.controller.signal.aborted) {
      return this.generate(options);
    }

    const { batch, tasks } = await taskStore.getBatch(batchId);
    if (!batch) return { success: false, message: "批次不存在" };

    const requested = tasks.filter((task) => {
      const inIds = !taskIds.length || taskIds.includes(task.id);
      return inIds && ["待生成", "失败", "已取消"].includes(task.status);
    });
    const selected = requested.filter((task) => !runner.queuedTaskIds.has(task.id));
    if (!selected.length) {
      if (requested.length) return { success: true, message: "勾选任务已在当前生成队列中" };
      return { success: false, message: "没有可追加的任务" };
    }

    await taskStore.updateBatch(batchId, { status: "生成中", cancelRequested: false });
    logService.info("batch", `已追加 ${selected.length} 张到当前生成队列`);
    startTaskGroup({ batchId, selected, options, runner });
    return { success: true, message: `已追加 ${selected.length} 张到当前生成队列` };
  },
  async generateTextBatch({ title = "文字生图", sourceText, count = 1, generationOptions = {} }) {
    const now = new Date().toISOString();
    const { nanoid } = await import("nanoid");
    const batchId = nanoid();
    const config = await configStore.getRaw();
    const maxBatchCount = Math.min(Math.max(Number(config.maxBatchCount || 100), 1), 1000);
    const safeCount = Math.min(Math.max(Number(count) || 1, 1), maxBatchCount);
    const tasks = Array.from({ length: safeCount }, (_, index) => ({
      id: nanoid(),
      batchId,
      index: index + 1,
      title: safeCount > 1 ? `${title}-${index + 1}` : title,
      originalName: `${safeCount > 1 ? `${title}-${index + 1}` : title}.png`,
      folderName: title,
      originalPath: null,
      originalUrl: null,
      sourceType: "text",
      sourceText,
      generatedPath: null,
      generatedUrl: null,
      enhancedPath: null,
      enhancedUrl: null,
      status: "待生成",
      selected: true,
      error: null,
      createdAt: now,
      updatedAt: now
    }));
    const batch = {
      id: batchId,
      folderName: title,
      sourceType: "text",
      status: "待生成",
      cancelRequested: false,
      summary: { total: tasks.length, success: 0, failed: 0, running: 0, pending: tasks.length, canceled: 0 },
      createdAt: now,
      updatedAt: now
    };
    await taskStore.addBatch(batch, tasks);
    logService.success("text-image", `成功创建 ${tasks.length} 个文字/文档生图任务`);
    return { success: true, batch, tasks, message: "已创建文字/文档任务，请点击 AI 教辅绘制开始生成" };
  },
  async generateStoryboardBatch({ title = "文案分镜", scenes = [], generationOptions = {} }) {
    const cleanScenes = (Array.isArray(scenes) ? scenes : [])
      .map((scene) => ({
        narration: String(scene?.narration || "").trim(),
        prompt: String(scene?.prompt || "").trim()
      }))
      .filter((scene) => scene.narration);
    if (!cleanScenes.length) return { success: false, message: "没有可生成的分镜文案" };

    const config = await configStore.getRaw();
    const maxBatchCount = Math.min(Math.max(Number(config.maxBatchCount || 100), 1), 1000);
    if (cleanScenes.length > maxBatchCount) {
      return { success: false, message: `当前设置一次最多创建 ${maxBatchCount} 个任务` };
    }

    const now = new Date().toISOString();
    const { nanoid } = await import("nanoid");
    const batchId = nanoid();
    const cleanTitle = String(title || "文案分镜").trim().slice(0, 80) || "文案分镜";
    const numberWidth = Math.max(2, String(cleanScenes.length).length);
    const tasks = cleanScenes.map((scene, index) => {
      const sceneNumber = String(index + 1).padStart(numberWidth, "0");
      const sceneTitle = `${cleanTitle}-分镜${sceneNumber}`;
      return {
        id: nanoid(),
        batchId,
        index: index + 1,
        title: sceneTitle,
        originalName: `${sceneTitle}.png`,
        folderName: cleanTitle,
        originalPath: null,
        originalUrl: null,
        sourceType: "text",
        storyboard: true,
        storyboardText: scene.narration,
        sourceText: scene.prompt ? `分镜文案：${scene.narration}\n\n单镜画面提示：${scene.prompt}` : scene.narration,
        generationOptions,
        generatedPath: null,
        generatedUrl: null,
        enhancedPath: null,
        enhancedUrl: null,
        status: "待生成",
        selected: true,
        error: null,
        createdAt: now,
        updatedAt: now
      };
    });
    const batch = {
      id: batchId,
      folderName: cleanTitle,
      sourceType: "storyboard",
      generationOptions,
      status: "待生成",
      cancelRequested: false,
      summary: { total: tasks.length, success: 0, failed: 0, running: 0, pending: tasks.length, canceled: 0 },
      createdAt: now,
      updatedAt: now
    };

    await taskStore.addBatch(batch, tasks);
    logService.success("storyboard", `成功创建 ${tasks.length} 个文案分镜任务`);
    return { success: true, batch, tasks, message: `已创建 ${tasks.length} 个文案分镜任务` };
  },
  async generateTextReferenceBatch({ title = "图文生成", sourceText, count = 1, referenceImage, generationOptions = {} }) {
    const now = new Date().toISOString();
    const { nanoid } = await import("nanoid");
    const batchId = nanoid();
    const config = await configStore.getRaw();
    const maxBatchCount = Math.min(Math.max(Number(config.maxBatchCount || 100), 1), 1000);
    const safeCount = Math.min(Math.max(Number(count) || 1, 1), maxBatchCount);
    const referenceMode = "prompt-reference";
    const cleanTitle = String(title || "图文生成").trim() || "图文生成";
    const saved = await saveOriginalFile(referenceImage, batchId);

    const tasks = Array.from({ length: safeCount }, (_, index) => ({
      id: nanoid(),
      batchId,
      index: index + 1,
      title: safeCount > 1 ? `${cleanTitle}-${index + 1}` : cleanTitle,
      originalName: safeCount > 1 ? `${cleanTitle}-${index + 1}.png` : `${cleanTitle}.png`,
      folderName: cleanTitle,
      originalPath: saved.relativePath,
      originalUrl: saved.url,
      sourceType: "text-reference",
      mode: referenceMode,
      sourceText,
      generationOptions,
      generatedPath: null,
      generatedUrl: null,
      enhancedPath: null,
      enhancedUrl: null,
      status: "待生成",
      selected: true,
      error: null,
      createdAt: now,
      updatedAt: now
    }));
    const batch = {
      id: batchId,
      folderName: cleanTitle,
      sourceType: "text-reference",
      mode: referenceMode,
      generationOptions,
      status: "待生成",
      cancelRequested: false,
      summary: { total: tasks.length, success: 0, failed: 0, running: 0, pending: tasks.length, canceled: 0 },
      createdAt: now,
      updatedAt: now
    };
    await taskStore.addBatch(batch, tasks);
    logService.success("text-reference-image", `成功创建 ${tasks.length} 个图文参考生成任务`);
    return { success: true, batch, tasks, message: "已创建图文参考生成任务" };
  },
  async createFollowUpTask({ taskId, prompt, generationOptions = {} }) {
    const allTasks = await taskStore.listTasks();
    const source = allTasks.find((task) => task.id === taskId);
    if (!source) return { success: false, message: "原任务不存在" };
    if (source.sourceType !== "text-reference") return { success: false, message: "继续修改仅支持图文生图任务" };

    const basePath = source.enhancedPath || source.generatedPath;
    const baseUrl = source.enhancedUrl || source.generatedUrl;
    if (!basePath || !baseUrl) return { success: false, message: "当前任务还没有生成图" };

    const { batch, tasks } = await taskStore.getBatch(source.batchId);
    if (!batch) return { success: false, message: "批次不存在" };

    const now = new Date().toISOString();
    const { nanoid } = await import("nanoid");
    const nextIndex = tasks.reduce((max, task) => Math.max(max, Number(task.index || 0)), 0) + 1;
    const baseTitle = source.title || source.originalName?.replace(/\.[^.]+$/, "") || "继续修改";
    const title = `${baseTitle}-继续修改`;
    const task = {
      id: nanoid(),
      batchId: source.batchId,
      index: nextIndex,
      title,
      originalName: `${title}.png`,
      folderName: source.folderName || batch.folderName || "图文生成",
      originalPath: basePath,
      originalUrl: baseUrl,
      sourceType: "text-reference",
      mode: "prompt-reference",
      sourceText: String(prompt || "").trim(),
      generationOptions,
      parentTaskId: source.id,
      generatedPath: null,
      generatedUrl: null,
      enhancedPath: null,
      enhancedUrl: null,
      status: "待生成",
      selected: true,
      error: null,
      createdAt: now,
      updatedAt: now
    };

    await taskStore.addTask(task);
    const latestTasks = [...tasks, task];
    const summary = summarize(latestTasks);
    const updatedBatch = await taskStore.updateBatch(source.batchId, { summary });
    logService.success("follow-up", `已创建继续修改任务：${task.originalName}`);
    return { success: true, batch: updatedBatch, task, message: "已创建继续修改任务" };
  },
  async cancel(batchId) {
    const runner = runningBatches.get(batchId);
    await taskStore.updateBatch(batchId, { cancelRequested: true, status: "停止中" });
    if (runner?.controller) runner.controller.abort(new Error("用户请求停止"));
    await taskStore.updateTasks(batchId, (task) =>
      ["待生成", "生成中"].includes(task.status) ? { ...task, status: "已取消", error: "任务已取消" } : task
    );
    await updateBatchProgress(batchId);
    await taskStore.updateBatch(batchId, { status: "已停止", cancelRequested: false });
    logService.warn("batch", "已请求停止，正在结束当前任务");
    return { success: true, message: "已请求停止，正在结束当前任务" };
  },
  async regenerateTask(batchId, taskId, options = {}) {
    const { batch, tasks } = await taskStore.getBatch(batchId);
    if (!batch) return { success: false, message: "批次不存在" };
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return { success: false, message: "任务不存在" };
    if (task.status !== "已完成" || !(task.enhancedUrl || task.generatedUrl)) return { success: false, message: "只有已完成的生成图才能重新生成" };

    await taskStore.updateTask(taskId, {
      status: "待生成",
      generatedPath: null,
      generatedUrl: null,
      enhancedPath: null,
      enhancedUrl: null,
      error: null
    });
    await updateBatchProgress(batchId);
    logService.info("batch", `重新生成：${task.originalName}`);
    return runningBatches.has(batchId)
      ? this.appendGenerate({ ...options, batchId, taskIds: [taskId] })
      : this.generate({ ...options, batchId, taskIds: [taskId] });
  },
  async retryFailed(batchId, options = {}) {
    const { tasks } = await taskStore.getBatch(batchId);
    const failed = tasks.filter((task) => task.status === "失败");
    if (!failed.length) return { success: false, message: "没有失败项可重试" };
    await taskStore.updateTasks(batchId, (task) =>
      task.status === "失败" ? { ...task, status: "待生成", error: null } : task
    );
    const retryOptions = { ...options, batchId, taskIds: failed.map((task) => task.id) };
    const runner = runningBatches.get(batchId);
    return runner && !runner.controller.signal.aborted
      ? this.appendGenerate(retryOptions)
      : this.generate(retryOptions);
  },
  async clearHistory() {
    for (const runner of runningBatches.values()) {
      runner.controller?.abort(new Error("页面刷新清空历史任务"));
    }
    runningBatches.clear();
    await taskStore.clearAll();
    const cacheSummary = await purgeAllUploadsCache();
    const freedMb = Math.round(cacheSummary.removedBytes / 1024 / 1024);
    const message = cacheSummary.removedFiles
      ? `已清空历史处理任务，并清理 ${cacheSummary.removedFiles} 个缓存文件（释放 ${freedMb} MB）`
      : "已清空历史处理任务";
    logService.info("batch", message);
    return { success: true, message };
  },
  summarize
};
