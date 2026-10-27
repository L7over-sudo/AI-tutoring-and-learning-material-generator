import fs from "node:fs";
import fsp from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import axios from "axios";
import sharp from "sharp";
import { taskStore } from "../stores/taskStore.js";
import { configStore } from "../stores/configStore.js";
import { resolveUploadRelative } from "./fileService.js";
import { getSlidePreviewFile } from "./slidePreviewService.js";

const execFileAsync = promisify(execFile);
const COPY_TIMEOUT_MS = 60000;
const XHS_TEMP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../uploads/.xhs-publish");

function openCliEntryCandidates() {
  const candidates = [];
  if (process.env.OPENCLI_NODE_ENTRY) candidates.push(process.env.OPENCLI_NODE_ENTRY);
  for (const directory of String(process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    candidates.push(path.join(directory, "node_modules", "@jackwener", "opencli", "dist", "src", "main.js"));
  }
  return [...new Set(candidates.map(item => path.resolve(item)))];
}

function resolveOpenCliEntry() {
  const entry = openCliEntryCandidates().find(candidate => fs.existsSync(candidate));
  if (!entry) throw new Error("未找到小红书发布组件 OpenCLI，请先安装或配置 OPENCLI_NODE_ENTRY");
  return entry;
}

function cleanTopics(value) {
  const input = Array.isArray(value) ? value : String(value || "").split(/[\s,，#]+/);
  return [...new Set(input.map(item => String(item || "").replace(/^#+/, "").trim()).filter(Boolean))].slice(0, 10);
}

function parseJsonObject(value) {
  const text = String(value || "").replace(/```(?:json)?\s*/gi, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("文案模型没有返回有效 JSON");
  return JSON.parse(text.slice(start, end + 1));
}

function copySourceForTask(task) {
  const slideContent = task?.slidePlan?.content || {};
  const source = task?.sourceText || slideContent.body || "";
  return {
    name: String(task?.folderName || task?.originalName || task?.title || "学习资料").replace(/\.[^.]+$/, ""),
    pageTitle: String(slideContent.title || "").trim(),
    sourceText: String(source || "").trim().slice(0, 1800)
  };
}

export async function generateXhsCopy({ taskIds, titleHint }) {
  const requestedIds = [...new Set((Array.isArray(taskIds) ? taskIds : []).map(String))].slice(0, 9);
  if (!requestedIds.length) throw new Error("请至少选择一张已完成图片");

  const config = await configStore.getRaw();
  const model = config.layoutModel || {};
  if (!model.enabled || !model.apiKey) {
    throw new Error("请先在 API 设置中启用并配置智能排版模型");
  }

  const allTasks = await taskStore.listTasks();
  const byId = new Map(allTasks.map(task => [String(task.id), task]));
  const tasks = requestedIds.map(id => byId.get(id)).filter(Boolean);
  if (tasks.length !== requestedIds.length) throw new Error("部分图片任务已不存在，请刷新后重试");

  const sources = tasks.map(copySourceForTask);
  const prompt = `你是小红书学习资料类笔记编辑。根据下面的资料信息，生成可直接编辑的小红书笔记文案。
资料信息：${JSON.stringify(sources)}
当前标题提示：${String(titleHint || "").trim().slice(0, 80) || "无"}

要求：
1. title 为 12—20 个中文字符，清楚说明资料用途，不能截断半句话。
2. content 为 140—220 个中文字符，分成 3—4 个自然短段；语气真诚实用，说明适合谁以及可怎样使用。
3. 只能把资料信息中明确出现的内容写成事实。不得虚构科目、知识点、页数、配套答案、获取方式、更新计划、系列后续或成绩提升效果。没有 sourceText 时，不得声称资料“包含”“聚焦”某项具体内容，只能依据文件名做稳妥介绍。
4. tags 返回 6—8 个相关话题词，不带 #，不要重复。
5. 不使用夸张承诺、诱导关注/私信/领取或“全网最全”等绝对化表达。
只输出 JSON：{"title":"","content":"","tags":[""]}`;

  try {
    const endpoint = `${String(model.baseUrl || "https://api.deepseek.com/v1").replace(/\/+$/, "")}/chat/completions`;
    const response = await axios.post(endpoint, {
      model: model.model || "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      response_format: { type: "json_object" }
    }, {
      headers: { Authorization: `Bearer ${model.apiKey}`, "Content-Type": "application/json" },
      timeout: COPY_TIMEOUT_MS,
      proxy: false
    });
    const raw = parseJsonObject(response.data?.choices?.[0]?.message?.content);
    const title = String(raw.title || titleHint || sources[0]?.name || "学习资料分享").trim().slice(0, 20);
    const content = String(raw.content || "").trim().slice(0, 1000);
    const tags = cleanTopics(raw.tags).slice(0, 8);
    if (!title || !content) throw new Error("文案模型返回内容不完整，请重试");
    return { title, content, tags };
  } catch (error) {
    const detail = error.response?.data?.error?.message || error.message || "AI 文案生成失败";
    throw new Error(`AI 文案生成失败：${String(detail).slice(0, 300)}`);
  }
}

function normalizeOpenCliError(error) {
  const stdout = String(error?.stdout || "");
  let structuredMessage = "";
  try {
    const parsed = parseJsonObject(stdout);
    structuredMessage = String(parsed?.error?.message || parsed?.message || "");
  } catch {}
  const detail = [structuredMessage, stdout, error?.message, error?.stderr].filter(Boolean).join("\n");
  if (/fileChooserOpened|file input|Image injection failed|upload.*input/i.test(detail)) {
    return new Error("小红书图片上传失败：浏览器原生上传和备用上传通道均未成功，请刷新小红书创作中心后重试");
  }
  if (/login|登录|unauth|认证/i.test(detail)) {
    return new Error("小红书账号尚未登录：请在打开的创作中心完成登录后重试");
  }
  if (/attach product|product.*not found|商品.*(?:找不到|未找到|不可用)|Could not open.*product/i.test(detail)) {
    return new Error("小红书商品挂载失败：请确认商品已在当前店铺上架，并填写完整、唯一的商品名称");
  }
  if (/(?:extension|bridge).*(?:not connected|unavailable|failed)|(?:connect|connection).*(?:refused|failed|closed)|ECONNREFUSED/i.test(detail)) {
    return new Error("小红书发布通道未连接：请打开 Chrome，确认 OpenCLI 扩展已启用并登录小红书创作中心，然后重试");
  }
  return new Error(String(detail || "小红书草稿创建失败").slice(0, 800));
}

async function imageFileForTask(task) {
  if (task.presentation && task.slidePlan?.version === 3) return getSlidePreviewFile(task);
  const relative = task.enhancedPath || task.generatedPath;
  if (!relative) throw new Error(`第 ${task.index} 张图片尚未生成`);
  return resolveUploadRelative(relative);
}

async function cleanupXhsTemp(directory) {
  if (!directory) return;
  const root = `${path.resolve(XHS_TEMP_ROOT)}${path.sep}`;
  const target = path.resolve(directory);
  if (!target.startsWith(root)) return;
  await fsp.rm(target, { recursive: true, force: true });
}

async function prepareXhsImageFiles(files) {
  await fsp.mkdir(XHS_TEMP_ROOT, { recursive: true });
  const directory = await fsp.mkdtemp(path.join(XHS_TEMP_ROOT, "draft-"));
  try {
    const preparedFiles = await Promise.all(files.map(async (file, index) => {
      const output = path.join(directory, `${String(index + 1).padStart(2, "0")}.jpg`);
      await sharp(file)
        .rotate()
        .flatten({ background: "#ffffff" })
        .resize({ width: 1440, height: 1920, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 86, chromaSubsampling: "4:4:4", mozjpeg: true })
        .toFile(output);
      return output;
    }));
    return { directory, files: preparedFiles };
  } catch (error) {
    await cleanupXhsTemp(directory);
    throw new Error(`小红书发布图片处理失败：${error.message}`);
  }
}

export async function publishXhsNote({ taskIds, title, content, topics, productName, draft = true }) {
  const cleanTitle = String(title || "").trim().slice(0, 20);
  const cleanContent = String(content || "").trim().slice(0, 1000);
  const cleanProductName = String(productName || "").trim().slice(0, 120);
  if (!cleanTitle) throw new Error("请填写小红书标题");
  const requestedIds = [...new Set((Array.isArray(taskIds) ? taskIds : []).map(String))].slice(0, 9);
  if (!requestedIds.length) throw new Error("请至少选择一张已完成图片");

  const allTasks = await taskStore.listTasks();
  const byId = new Map(allTasks.map(task => [task.id, task]));
  const tasks = requestedIds.map(id => byId.get(id));
  if (tasks.some(task => !task)) throw new Error("部分待发布图片已经不在任务列表中，请刷新后重试");
  if (tasks.some(task => task.status !== "已完成" || !(task.enhancedPath || task.generatedPath))) {
    throw new Error("只能发布状态为“已完成”的生成图");
  }

  const files = [];
  for (const task of tasks) files.push(await imageFileForTask(task));
  for (const file of files) await fsp.access(file);
  const prepared = await prepareXhsImageFiles(files);
  const cleanTagList = cleanTopics(topics);
  const args = [
    resolveOpenCliEntry(),
    "xiaohongshu", "publish", cleanContent || cleanTitle,
    "--title", cleanTitle,
    "--images", prepared.files.join(","),
    "--draft", String(Boolean(draft)),
    "--window", "foreground",
    "--site-session", "ephemeral",
    "--keep-tab", "false"
  ];
  if (cleanTagList.length) args.push("--topics", cleanTagList.join(","));
  if (cleanProductName) args.push("--product", cleanProductName);
  args.push("-f", "json");

  try {
    const { stdout = "" } = await execFileAsync(process.execPath, args, {
      windowsHide: true,
      timeout: 300000,
      maxBuffer: 4 * 1024 * 1024
    });
    return {
      status: draft ? "draft" : "published",
      imageCount: files.length,
      title: cleanTitle,
      productName: cleanProductName,
      topics: cleanTagList,
      detail: String(stdout).trim().slice(0, 1200)
    };
  } catch (error) {
    throw normalizeOpenCliError(error);
  } finally {
    await cleanupXhsTemp(prepared.directory);
  }
}

export function publishXhsDraft(input) {
  return publishXhsNote({ ...input, draft: true });
}
