import { defineStore } from "pinia";
import { ElMessage } from "element-plus";
import { appendGenerateTasks, cancelBatch, clearTaskHistory, createStoryboardBatch, deleteTask, followUpTask, generateTasks, generateTextImage, generateTextReferenceImage, getBatchTasks, listBatches, regenerateTask, retryFailed } from "../api/task";
import { uploadDocument, uploadImages } from "../api/upload";
import { exportZip } from "../api/export";
import { exportDocumentPpt, getPptExportStatus } from "../api/presentation";

const RUNNABLE_STATUSES = ["待生成", "失败", "已取消"];
const OPERATION_SETTINGS_KEY = "aiTeachingLatestOperationSettingsV1";
let operationPersistenceStarted = false;

function loadOperationSettings() {
  try {
    return JSON.parse(localStorage.getItem(OPERATION_SETTINGS_KEY) || "{}");
  } catch {
    localStorage.removeItem(OPERATION_SETTINGS_KEY);
    return {};
  }
}

function saveOperationSettings(state) {
  const generationForm = state.generationForm || {};
  localStorage.setItem(OPERATION_SETTINGS_KEY, JSON.stringify({
    generationForm: {
      promptTemplate: generationForm.promptTemplate,
      prompt: generationForm.prompt,
      redrawStrength: generationForm.redrawStrength,
      size: generationForm.size,
      quality: generationForm.quality,
      enhancementEnabled: generationForm.enhancementEnabled
    },
    textImageForm: {
      title: state.textImageForm?.title,
      count: state.textImageForm?.count
    },
    filters: state.filters
  }));
}

function isBatchActivelyGenerating(batch) {
  return batch?.status === "生成中" && !batch?.cancelRequested;
}

function normalizeTaskForBatch(task, batch) {
  if (["已停止", "已取消"].includes(batch?.status) && ["生成中", "待生成"].includes(task.status)) {
    return { ...task, status: "已取消", error: task.error || "任务已取消" };
  }
  return task;
}

export const promptTemplates = {
  "小红书教辅重设计": `请根据参考图片重新制作一张适合小红书发布的教辅图片。

核心要求：

1. 尽量保留标题、正文、栏目名、关键词、题目编号、公式和核心知识点。
2. 不要把长正文改写成要点摘要；正文需要完整保留并清晰排版。
3. 重新设计视觉样式，不要照搬原图的页眉、边框、装饰条、背景、品牌标识和整体版式。
4. 可以重新组织标题区、信息条、题号样式、分隔线、表格边框、留白和色块层级。
5. 使用白色底、粉色/珊瑚色/浅橙色点缀，画面清晰柔和，适合手机端阅读。
6. 版式要像小红书学习笔记/教辅卡片，而不是原图扫描件。

文字清晰要求：
1. 中文使用清晰印刷体，黑色或深灰色，避免花体小字。
2. 正文区域需要足够字号、行距和留白，优先保证可读性。
3. 不要生成乱码、错字、糊字；正文内容不要擅自删减或摘要化。

风格要求：
整体更精致、更现代，有轻微手帐感和清爽排版感。

注意：
AI 生成内容可能存在文字错误，生成后需要人工复核。`,
  "教辅清晰重绘": `请按照参考图片重新绘制教辅内容。

核心要求：

1. 优先保留标题、正文、栏目名、公式、表格、标注和核心知识点。
2. 不要把长正文改写成要点摘要；正文需要完整保留并清晰排版。
3. 不要添加无关元素，不要删除原有核心内容。
4. 色彩明亮，对比度适中，适合小红书手机端阅读。
5. 中文必须清晰可读，使用印刷体、足够字号和充足行距，避免乱码、错字、糊字。

风格要求：
整体画面干净、清晰、柔和，适合教辅知识图发布。

注意：
AI 生成内容可能存在文字错误，生成后需要人工复核。`,
  "高清讲义版式": `请把参考图片重制为高清讲义版式。

要求保留题目、表格、公式和主要标注，优化文字清晰度、行距、表格线和页面留白。
整体风格干净、规整、专业，适合打印或作为小红书学习资料发布。
不要添加无关内容，生成后需要人工复核文字。`,
  "粉色笔记风": `请把参考图片重新设计成粉色系小红书学习笔记图片。

保留原图的题目内容和知识点，但重新设计题号、提示标签、分隔线、色块和页面留白。
不要新增大标题或标题栏；只有原图本身有标题时才保留原标题。页面重点放在正文和题目内容，不要为了装饰额外添加标题。
风格温柔、清晰、现代，白底为主，搭配粉色、浅橙色和少量红色重点标记。
不要照搬原图版式，不要添加无关内容，生成后需要人工复核文字。`
};

const PROMPT_REFERENCE_PROMPT = `请根据用户输入的提示词和上传的参考图生成一张新图片。

核心规则：
1. 用户输入的提示词是最高优先级，具体生成什么必须以提示词为准。
2. 参考图用于理解画面比例、构图、主体关系、色彩、光线、材质、风格和氛围。
3. 不要默认生成教辅、知识卡片、学习笔记或任何固定类型；只有用户提示词要求时才生成。
4. 不要直接复制参考图中的无关文字、品牌标识、水印、错误内容或个人信息。
5. 如果提示词与参考图冲突，以提示词为准。`;

const FOLLOW_UP_PROMPT = `请基于当前图片继续修改，并生成一张新图片。

核心规则：
1. 用户这次输入的追问/修改要求是最高优先级。
2. 当前图片作为修改基础，未提到的主体、构图、风格和信息尽量保持不变。
3. 只修改用户明确要求调整的部分。
4. 不要凭空添加用户没有要求的新主题、新文字、新知识点或新元素。
5. 如果用户要求大幅重做，则按用户要求执行。`;

function quickTextReferenceOptions({ size = "3:4", quality = "1k" } = {}) {
  return {
    prompt: PROMPT_REFERENCE_PROMPT,
    mode: "prompt-reference",
    redrawStrength: "默认",
    size,
    quality,
    maxConcurrency: 100,
    timeoutMs: 240000,
    maxRetries: 2,
    retryDelay: 10000,
    enhancementEnabled: false
  };
}

function followUpOptions({ size = "3:4", quality = "2k" } = {}) {
  return {
    prompt: FOLLOW_UP_PROMPT,
    mode: "prompt-reference",
    redrawStrength: "继续修改",
    size,
    quality,
    maxConcurrency: 100,
    timeoutMs: 240000,
    maxRetries: 2,
    retryDelay: 10000,
    enhancementEnabled: false
  };
}

export const useTaskStore = defineStore("tasks", {
  state: () => {
    const saved = loadOperationSettings();
    return ({
    batch: null,
    tasks: [],
    currentIndex: 0,
    uploading: false,
    generating: false,
    startingGeneration: false,
    exporting: false,
    poller: null,
    pptExportPoller: null,
    pptExportFailCount: 0,
    pptDownloadUrl: null,
    filters: Array.isArray(saved.filters) && saved.filters.length ? saved.filters : ["待生成", "生成中", "已完成", "失败", "已取消", "已跳过"],
    generationForm: {
      promptTemplate: "粉色笔记风",
      prompt: "",
      redrawStrength: "默认",
      size: "3:4",
      quality: "1k",
      maxConcurrency: 100,
      timeoutMs: 240000,
      maxRetries: 2,
      retryDelay: 10000,
      enhancementEnabled: false,
      ...(saved.generationForm || {})
    },
    textImageForm: {
      title: "图文生成",
      sourceText: "",
      count: 1,
      documentName: "",
      ...(saved.textImageForm || {})
    }
  });
  },
  getters: {
    currentTask: (state) => state.tasks[state.currentIndex] || null,
    visibleTasks: (state) => state.tasks.filter((task) => state.filters.includes(task.status)),
    selectedTaskIds: (state) => state.tasks.filter((task) => task.selected).map((task) => task.id),
    isActivelyGenerating: (state) => Boolean(
      state.startingGeneration
      || isBatchActivelyGenerating(state.batch)
      || state.tasks.some((task) => task.status === "生成中")
    ),
    summary: (state) => ({
      total: state.tasks.length,
      success: state.tasks.filter((task) => task.status === "已完成").length,
      failed: state.tasks.filter((task) => task.status === "失败").length,
      running: state.tasks.filter((task) => task.status === "生成中").length
    }),
    activeGenerationOptions: (state) => {
      if (state.batch?.sourceType === "text-reference" && state.batch?.generationOptions) {
        return state.batch.generationOptions;
      }
      if (state.batch?.sourceType === "presentation") {
        const snapshot = state.batch?.generationOptions || {};
        return {
          ...state.generationForm,
          ...snapshot,
          prompt: snapshot.prompt ?? state.generationForm.prompt,
          promptTemplate: snapshot.promptTemplate ?? state.generationForm.promptTemplate,
          presentation: true,
          size: "16:9"
        };
      }
      return state.generationForm;
    },
    progress: (state) => {
      if (!state.tasks.length) return 0;
      const done = state.tasks.filter((task) => ["已完成", "失败", "已取消", "已跳过"].includes(task.status)).length;
      return Math.round((done / state.tasks.length) * 100);
    }
  },
  actions: {
    enableOperationPersistence() {
      if (operationPersistenceStarted) return;
      operationPersistenceStarted = true;
      this.$subscribe((_mutation, state) => saveOperationSettings(state), { detached: true });
      saveOperationSettings(this.$state);
    },
    setTasks(batch, tasks) {
      const selectedById = new Map(this.tasks.map((task) => [task.id, Boolean(task.selected)]));
      const currentTaskId = this.currentTask?.id;
      this.batch = batch;
      if (batch?.sourceType === "presentation" && batch?.generationOptions) {
        if (typeof batch.generationOptions.prompt === "string") this.generationForm.prompt = batch.generationOptions.prompt;
        if (batch.generationOptions.promptTemplate) this.generationForm.promptTemplate = batch.generationOptions.promptTemplate;
      }
      this.tasks = tasks.map((task) => {
        const normalized = normalizeTaskForBatch(task, batch);
        return {
          ...normalized,
          selected: selectedById.has(task.id) ? selectedById.get(task.id) : Boolean(task.selected)
        };
      });
      const currentIndex = currentTaskId ? this.tasks.findIndex((task) => task.id === currentTaskId) : -1;
      if (currentIndex >= 0) {
        this.currentIndex = currentIndex;
      } else if (this.currentIndex >= tasks.length) {
        this.currentIndex = 0;
      }
      // A newly created batch contains pending tasks only. Do not carry the
      // loading state over from the previously viewed/generated batch.
      this.generating = isBatchActivelyGenerating(batch)
        || this.tasks.some((task) => task.status === "生成中");
      if (!this.generating && !this.startingGeneration) this.stopPolling();
    },
    setCurrentTask(taskId) {
      const index = this.tasks.findIndex((task) => task.id === taskId);
      if (index >= 0) this.currentIndex = index;
    },
    applyConfig(config) {
      if (!config) return;
      this.generationForm.maxConcurrency = Number(config.maxConcurrency || 100);
      this.generationForm.timeoutMs = Number(config.timeoutMs || 240000);
      this.generationForm.maxRetries = Number(config.maxRetries ?? 2);
      this.generationForm.retryDelay = Number(config.retryDelay || 10000);
      this.generationForm.enhancementEnabled = Boolean(config.originality?.enabled);
    },
    async upload(files, folderName, options = {}) {
      this.uploading = true;
      try {
        const res = await uploadImages(files, folderName, options);
        this.setTasks(res.data.batch, res.data.tasks);
        ElMessage.success(`✅ 成功导入 ${res.data.tasks.length} 张图片`);
        return true;
      } catch (error) {
        ElMessage.warning(error.response?.data?.message || "⚠️ 没有可处理图片");
        return false;
      } finally {
        this.uploading = false;
      }
    },
    async extractDocument(file) {
      const files = Array.isArray(file) ? file : [file];
      const res = await uploadDocument(files);
      this.textImageForm.sourceText = res.data.text;
      this.textImageForm.documentName = res.data.title;
      this.textImageForm.count = Math.min(Math.max(Number(res.data.pageCount || 1), 1), 1000);
      if (!this.textImageForm.title || this.textImageForm.title === "图文生成" || this.textImageForm.title === "小红书教辅卡片") {
        this.textImageForm.title = res.data.title?.replace(/\.[^.]+$/, "") || "文档生图";
      }
      ElMessage.success(`📄 已读取 ${files.length} 个文档，默认生成 ${this.textImageForm.count} 张`);
    },
    async generateFromText() {
      if (!this.textImageForm.sourceText?.trim()) return ElMessage.warning("请先输入文字或上传文档");
      try {
        const res = await generateTextImage({
          title: this.textImageForm.title || "文字生图",
          sourceText: this.textImageForm.sourceText,
          count: this.textImageForm.count,
          generationOptions: this.generationForm
        });
        this.setTasks(res.data.batch, res.data.tasks);
        ElMessage.success("📝 已创建文字/文档任务，请点击底部 AI 教辅绘制开始生成");
        return true;
      } catch (error) {
        ElMessage.warning(error.response?.data?.message || "文字/文档生图启动失败");
        return false;
      }
    },
    async createStoryboard({ title = "文案分镜", scenes = [], autoStart = false } = {}) {
      if (!scenes.length) {
        ElMessage.warning("请至少选择一个包含文案的分镜");
        return false;
      }
      try {
        const generationOptions = { ...this.generationForm };
        const res = await createStoryboardBatch({ title, scenes, generationOptions });
        this.setTasks(res.data.batch, res.data.tasks);
        const taskIds = res.data.tasks.map((task) => task.id);
        if (taskIds.length) this.setCurrentTask(taskIds[0]);

        if (!autoStart) {
          ElMessage.success(`🎬 已将 ${taskIds.length} 个分镜加入任务列表`);
          return true;
        }

        this.generating = true;
        try {
          await generateTasks({ batchId: res.data.batch.id, taskIds, ...generationOptions });
          ElMessage.success(`🎨 ${taskIds.length} 个分镜已加入任务并开始生成`);
          this.startPolling();
          await this.refresh();
        } catch (error) {
          this.generating = false;
          ElMessage.warning(`分镜已加入任务，但生成未启动：${error.response?.data?.message || error.message || "请检查 API 设置"}`);
        }
        return true;
      } catch (error) {
        ElMessage.warning(error.response?.data?.message || "分镜任务创建失败");
        return false;
      }
    },
    async generateFromTextReference({ referenceImage, size, quality } = {}) {
      if (!this.textImageForm.sourceText?.trim()) return ElMessage.warning("请先输入提示词或上传文档");
      if (!referenceImage) return ElMessage.warning("请先上传一张参考图");
      const generationOptions = quickTextReferenceOptions({ size, quality });
      this.generating = true;
      try {
        const res = await generateTextReferenceImage({
          title: this.textImageForm.title || "图文生成",
          mode: "prompt-reference",
          sourceText: this.textImageForm.sourceText,
          count: this.textImageForm.count,
          referenceImage,
          generationOptions
        });
        this.setTasks(res.data.batch, res.data.tasks);
        const taskIds = res.data.tasks.map((task) => task.id);
        if (taskIds.length) this.setCurrentTask(taskIds[0]);
        await generateTasks({ batchId: res.data.batch.id, taskIds, ...generationOptions });
        ElMessage.success("图文参考生成已开始");
        this.startPolling();
        await this.refresh();
        return true;
      } catch (error) {
        this.generating = false;
        ElMessage.warning(error.response?.data?.message || "图文参考生成启动失败");
        return false;
      }
    },
    async followUpCurrentTask(prompt) {
      const source = this.currentTask;
      const cleanPrompt = String(prompt || "").trim();
      if (!source?.id) return ElMessage.warning("请先选择一张已生成图片");
      if (source.sourceType !== "text-reference") return ElMessage.warning("继续修改仅支持图文生图任务");
      if (!(source.enhancedUrl || source.generatedUrl)) return ElMessage.warning("当前任务还没有生成图");
      if (!cleanPrompt) return ElMessage.warning("请输入新的追问提示词");

      const generationOptions = followUpOptions({
        size: this.batch?.generationOptions?.size || this.generationForm.size || "3:4",
        quality: this.batch?.generationOptions?.quality || this.generationForm.quality || "2k"
      });
      this.generating = true;
      try {
        ElMessage.info("正在创建继续修改任务...");
        const res = await followUpTask(source.id, {
          prompt: cleanPrompt,
          generationOptions
        });
        await this.refresh();
        const nextTask = res.data.task;
        if (!nextTask?.id) throw new Error("继续修改任务创建失败");
        if (nextTask?.id) this.setCurrentTask(nextTask.id);
        await generateTasks({ batchId: res.data.batch.id, taskIds: [nextTask.id], ...generationOptions });
        ElMessage.success("继续修改已开始");
        this.startPolling();
        await this.refresh();
        return true;
      } catch (error) {
        const shouldFallback = [404, 405].includes(Number(error.response?.status));
        if (!shouldFallback) {
          this.generating = false;
          ElMessage.warning(error.response?.data?.message || error.message || "继续修改启动失败");
          return false;
        }
        try {
          ElMessage.warning("后端继续修改接口未生效，正在使用兼容方式重试");
          const imageUrl = source.enhancedUrl || source.generatedUrl;
          const imageResponse = await fetch(imageUrl);
          if (!imageResponse.ok) throw new Error("当前生成图读取失败");
          const blob = await imageResponse.blob();
          const fileName = `${source.title || "继续修改"}.png`;
          const referenceImage = new File([blob], fileName, { type: blob.type || "image/png" });
          const res = await generateTextReferenceImage({
            title: `${source.title || "图文生成"}-继续修改`,
            mode: "prompt-reference",
            sourceText: cleanPrompt,
            count: 1,
            referenceImage,
            generationOptions
          });
          this.setTasks(res.data.batch, res.data.tasks);
          const nextTask = res.data.tasks?.[0];
          if (!nextTask?.id) throw new Error("兼容方式任务创建失败");
          this.setCurrentTask(nextTask.id);
          await generateTasks({ batchId: res.data.batch.id, taskIds: [nextTask.id], ...generationOptions });
          ElMessage.success("继续修改已开始");
          this.startPolling();
          await this.refresh();
          return true;
        } catch (fallbackError) {
          this.generating = false;
          ElMessage.warning(fallbackError.response?.data?.message || fallbackError.message || "继续修改启动失败");
          return false;
        }
      }
    },
    async refresh() {
      if (!this.batch?.id) return;
      const res = await getBatchTasks(this.batch.id);
      this.setTasks(res.data.batch, res.data.tasks);
      this.generating = isBatchActivelyGenerating(this.batch);
      if (!this.generating) this.stopPolling();
    },
    async loadLatest() {
      if (this.batch?.id) return;
      try {
        const res = await listBatches();
        const latest = res.data.batches?.[0];
        if (!latest?.id) return;
        this.batch = latest;
        await this.refresh();
        if (this.generating) this.startPolling();
      } catch {
        // No saved batch yet.
      }
    },
    async clearHistory() {
      this.clearLocal();
      try {
        const res = await clearTaskHistory();
        ElMessage.success(res?.data?.message || "🧹 已清空任务并清理缓存");
      } catch {
        // The workspace can still start clean locally if the backend is not ready yet.
      }
    },
    async clearHistoryOnRefresh() {
      await this.clearHistory();
    },
    startPolling() {
      this.stopPolling();
      this.poller = window.setInterval(() => this.refresh(), 2000);
    },
    stopPolling() {
      if (this.poller) window.clearInterval(this.poller);
      this.poller = null;
    },
    async generate() {
      if (!this.batch?.id) return ElMessage.warning("请先导入图片");
      const runnableTaskIds = this.tasks
        .filter((task) => task.selected && RUNNABLE_STATUSES.includes(task.status))
        .map((task) => task.id);
      if (!runnableTaskIds.length) return ElMessage.warning("请先勾选待生成、失败或已取消的图片");
      this.setCurrentTask(runnableTaskIds[0]);
      this.startingGeneration = true;
      this.generating = true;
      try {
        await generateTasks({ batchId: this.batch.id, taskIds: runnableTaskIds, ...this.activeGenerationOptions });
        const message = this.batch?.sourceType === "text-reference"
          ? "图文生图已继续生成"
          : this.batch?.sourceType === "presentation"
            ? "📊 PPT 页面已开始生成，可在任务列表逐页预览"
            : "🎨 AI 教辅绘制已开始";
        ElMessage.success(message);
        this.startPolling();
        return this.refresh();
      } catch (error) {
        this.generating = false;
        ElMessage.warning(error.response?.data?.message || "生成启动失败");
      } finally {
        this.startingGeneration = false;
      }
    },
    async appendGenerate() {
      if (!this.batch?.id) return ElMessage.warning("请先导入图片");
      if (!this.isActivelyGenerating) return ElMessage.warning("当前没有正在生成的任务");
      const runnableTaskIds = this.tasks
        .filter((task) => task.selected && RUNNABLE_STATUSES.includes(task.status))
        .map((task) => task.id);
      if (!runnableTaskIds.length) return ElMessage.warning("请勾选待生成、失败或已取消的图片");
      try {
        await appendGenerateTasks({ batchId: this.batch.id, taskIds: runnableTaskIds, ...this.activeGenerationOptions });
        ElMessage.success(`已追加 ${runnableTaskIds.length} 张到当前队列`);
        this.startPolling();
        await this.refresh();
        return true;
      } catch (error) {
        const message = error.response?.data?.message || (error.response?.status === 404 ? "追加生成接口未生效，请重启后端服务后再试" : error.message) || "追加生成失败";
        ElMessage.warning(message);
        return false;
      }
    },
    async cancel() {
      if (!this.batch?.id) return;
      const batchId = this.batch.id;
      this.generating = false;
      this.stopPolling();
      this.batch = { ...this.batch, status: "已停止", cancelRequested: false };
      this.tasks = this.tasks.map((task) => normalizeTaskForBatch(task, this.batch));
      try {
        await cancelBatch(batchId);
        ElMessage.info("⏹️ 已停止生成");
        await this.refresh();
      } catch (error) {
        ElMessage.warning(error.response?.data?.message || "停止生成失败，请刷新后重试");
      } finally {
        this.generating = false;
        this.stopPolling();
      }
    },
    async regenerate(task = this.currentTask) {
      if (!task?.id || !task?.batchId) return ElMessage.warning("请先选择一张图片");
      if (task.status !== "已完成" || !(task.enhancedUrl || task.generatedUrl)) return ElMessage.warning("只有已完成的生成图才能重新生成");
      this.setCurrentTask(task.id);
      this.generating = true;
      try {
        await regenerateTask(task.batchId, task.id, this.activeGenerationOptions);
        ElMessage.success("已开始重新生成当前图片");
        this.startPolling();
        return this.refresh();
      } catch (error) {
        this.generating = false;
        ElMessage.warning(error.response?.data?.message || "重新生成启动失败");
        return false;
      }
    },
    async retryFailed() {
      if (!this.batch?.id) return;
      const wasGenerating = this.generating;
      try {
        this.generating = true;
        await retryFailed(this.batch.id, this.activeGenerationOptions);
        ElMessage.success(wasGenerating ? "🔁 失败项已加入当前生成队列" : "🔁 已开始重试失败项");
        this.startPolling();
        await this.refresh();
      } catch (error) {
        this.generating = isBatchActivelyGenerating(this.batch);
        ElMessage.warning(error.response?.data?.message || error.message || "重试失败项启动失败");
      }
    },
    async remove(task) {
      await deleteTask(task.batchId, task.id);
      await this.refresh();
    },
    async exportZip() {
      if (!this.batch?.id) return ElMessage.warning("请先导入图片");
      this.exporting = true;
      try {
        const res = await exportZip({ batchId: this.batch.id, onlyCompleted: true, useEnhancedIfExists: true });
        ElMessage.success("✅ 导出成功，正在下载 ZIP");
        window.location.href = res.data.downloadUrl;
      } catch (error) {
        ElMessage.warning(error.response?.data?.message || "⚠️ 没有可导出的图片");
      } finally {
        this.exporting = false;
      }
    },
    async exportPpt() {
      if (!this.batch?.id) return ElMessage.warning("请先创建 PPT 页面任务");
      if (this.exporting) return;
      this.exporting = true;
      this.pptExportFailCount = 0;
      this.pptDownloadUrl = null;
      try {
        // 启动后台导出：服务端同步校验后立刻返回，真正的图标生成+打包在后台跑
        await exportDocumentPpt(this.batch.id, {
          pptName: this.batch.presentationName || this.batch.folderName
        });
        ElMessage.info("⏳ PPT 正在导出（首次需生成小素材图，稍候）");
        this.startPptExportPolling();
      } catch (error) {
        this.exporting = false;
        // 同步校验失败会走这里（页面没生成完等），给出准确提示
        ElMessage.warning(error.response?.data?.message || "PPT 导出启动失败");
      }
    },
    startPptExportPolling() {
      this.stopPptExportPolling();
      this.pptExportPoller = window.setInterval(() => this.pollPptExport(), 2500);
      void this.pollPptExport();
    },
    stopPptExportPolling() {
      if (this.pptExportPoller) window.clearInterval(this.pptExportPoller);
      this.pptExportPoller = null;
    },
    async pollPptExport() {
      const batchId = this.batch?.id;
      if (!batchId || !this.exporting) return;
      try {
        const res = await getPptExportStatus(batchId);
        const status = res.data?.pptExport;
        if (!status) return;
        // 成功拿到状态（任何状态），重置连续失败计数
        this.pptExportFailCount = 0;
        if (status.status === "done" && status.downloadUrl) {
          this.exporting = false;
          this.stopPptExportPolling();
          // 暴露手动下载兜底链接：即使 window.location.href 自动下载失败，用户也能点链接下载
          this.pptDownloadUrl = status.downloadUrl;
          ElMessage.success("✅ 可编辑 PPT 已生成，正在下载");
          window.location.href = status.downloadUrl;
        } else if (status.status === "failed") {
          this.exporting = false;
          this.stopPptExportPolling();
          ElMessage.error(status.error || "PPT 导出失败，请重试");
        }
        // running / idle：继续轮询
      } catch (error) {
        // 单次轮询失败（瞬时网络抖动）容忍，连续多次失败才判定后端掉线并明确报错，
        // 不再像旧版那样无限静默吞错让用户面对无休止的"⏳"。
        this.pptExportFailCount += 1;
        if (this.pptExportFailCount >= 3) {
          this.exporting = false;
          this.stopPptExportPolling();
          this.pptExportFailCount = 0;
          ElMessage.error("导出状态查询失败，请确认后端服务是否正在运行后重试");
        }
      }
    },
    async exportCurrent() {
      return this.batch?.sourceType === "presentation" ? this.exportPpt() : this.exportZip();
    },
    prev() {
      if (this.currentIndex > 0) this.currentIndex -= 1;
    },
    next() {
      if (this.currentIndex < this.tasks.length - 1) this.currentIndex += 1;
    },
    clearLocal() {
      this.batch = null;
      this.tasks = [];
      this.currentIndex = 0;
      this.pptExportFailCount = 0;
      this.pptDownloadUrl = null;
      this.stopPolling();
      this.stopPptExportPolling();
    }
  }
});
