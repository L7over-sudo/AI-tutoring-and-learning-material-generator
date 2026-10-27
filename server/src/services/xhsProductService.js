import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";
import { taskStore } from "../stores/taskStore.js";
import { resolveUploadRelative } from "./fileService.js";
import { getSlidePreviewFile } from "./slidePreviewService.js";

const execFileAsync = promisify(execFile);
const SERVICE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ADAPTER_SOURCE = path.resolve(SERVICE_DIR, "../opencli/xhsProductPublishAdapter.js");
const ADAPTER_TARGET = path.join(os.homedir(), ".opencli", "clis", "xiaohongshu", "product-publish.js");
const TEMP_ROOT = path.resolve(SERVICE_DIR, "../../uploads/.xhs-product");
const MAX_IMAGES = 10;

function resolveOpenCliEntry() {
  const candidates = [];
  if (process.env.OPENCLI_NODE_ENTRY) candidates.push(process.env.OPENCLI_NODE_ENTRY);
  for (const directory of String(process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    candidates.push(path.join(directory, "node_modules", "@jackwener", "opencli", "dist", "src", "main.js"));
  }
  const entry = [...new Set(candidates.map((item) => path.resolve(item)))].find((candidate) => fs.existsSync(candidate));
  if (!entry) throw new Error("未找到小红书商品发布组件 OpenCLI，请先安装或配置 OPENCLI_NODE_ENTRY");
  return entry;
}

function text(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeAmount(value) {
  const amount = String(value ?? "").trim();
  if (!/^\d+(?:[.]\d{1,2})?$/.test(amount) || Number(amount) <= 0) throw new Error("商品售价必须是大于 0 的金额，最多保留两位小数");
  return Number(amount).toFixed(2);
}

function normalizeStock(value) {
  const stock = String(value ?? "").trim();
  if (!/^\d+$/.test(stock) || Number(stock) < 1) throw new Error("商品库存必须是大于 0 的整数");
  return String(Number(stock));
}

function parseStructuredMessage(value) {
  const raw = String(value || "").replace(/```(?:json)?\s*/gi, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) return "";
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return String(parsed?.error?.message || parsed?.message || "");
  } catch {
    return "";
  }
}

function normalizeProductError(error) {
  const stdout = String(error?.stdout || "");
  const detail = [parseStructuredMessage(stdout), stdout, error?.stderr, error?.message].filter(Boolean).join("\n");
  if (/not logged in|login|登录|unauth|认证/i.test(detail)) {
    return new Error("小红书商家后台尚未登录：请在 Chrome 打开千帆并完成登录后重试");
  }
  if (/category template|existing product|Template category|商品.*模板/i.test(detail)) {
    return new Error("没有找到可复用的电子资源商品模板：请先确认店铺中至少有一个“课件/教案/手抄报”商品");
  }
  if (/timed out|TIMEOUT/i.test(detail)) {
    return new Error("小红书千帆页面处理超时：请保持千帆窗口开启、关闭遮挡弹窗后重试");
  }
  if (/Browser connection dropped|(?:extension|bridge).*(?:not connected|unavailable|failed)|(?:connect|connection).*(?:refused|failed|closed|dropped)|ECONNREFUSED/i.test(detail)) {
    return new Error("小红书浏览器连接中断：OpenCLI 自动化页面已释放，请保持 Chrome 开启后重试");
  }
  if (/setFileInput|file upload|material picker|Uploaded image|image.*(?:mismatch|upload)|CDP/i.test(detail)) {
    return new Error("小红书商品图片处理失败：请保持千帆页面开启并关闭遮挡弹窗后重试；软件已自动启用旧版扩展兼容上传");
  }
  if (/form is incomplete|form.*changed|Could not fill|Could not find visible action/i.test(detail)) {
    return new Error("小红书商品发布页面结构已变化或有弹窗遮挡，请刷新千帆商品发布页后重试");
  }
  return new Error(String(detail || "小红书商品上架失败").slice(0, 1000));
}

async function imageFileForTask(task) {
  if (task.presentation && task.slidePlan?.version === 3) return getSlidePreviewFile(task);
  const relative = task.enhancedPath || task.generatedPath;
  if (!relative) throw new Error(`第 ${task.index} 张图片尚未生成`);
  return resolveUploadRelative(relative);
}

async function cleanupTemp(directory) {
  if (!directory) return;
  const root = `${path.resolve(TEMP_ROOT)}${path.sep}`;
  const target = path.resolve(directory);
  if (target.startsWith(root)) await fsp.rm(target, { recursive: true, force: true });
}

async function prepareImages(files) {
  await fsp.mkdir(TEMP_ROOT, { recursive: true });
  const directory = await fsp.mkdtemp(path.join(TEMP_ROOT, "product-"));
  try {
    const stamp = Date.now().toString(36);
    const outputs = [];
    for (let index = 0; index < files.length; index += 1) {
      const output = path.join(directory, `xhs-${stamp}-${String(index + 1).padStart(2, "0")}.jpg`);
      await sharp(files[index])
        .rotate()
        .flatten({ background: "#ffffff" })
        .resize({ width: 1200, height: 1600, fit: "contain", background: "#ffffff" })
        .jpeg({ quality: 86, chromaSubsampling: "4:2:0", mozjpeg: true })
        .toFile(output);
      const stats = await fsp.stat(output);
      if (stats.size > 3 * 1024 * 1024) throw new Error(`第 ${index + 1} 张商品图压缩后仍超过 3MB`);
      outputs.push(output);
    }
    return { directory, files: outputs };
  } catch (error) {
    await cleanupTemp(directory);
    throw new Error(`商品图片处理失败：${error.message}`);
  }
}

export async function ensureXhsProductAdapter() {
  const source = await fsp.readFile(ADAPTER_SOURCE, "utf8");
  let current = "";
  try {
    current = await fsp.readFile(ADAPTER_TARGET, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (current !== source) {
    await fsp.mkdir(path.dirname(ADAPTER_TARGET), { recursive: true });
    await fsp.writeFile(ADAPTER_TARGET, source, "utf8");
  }
  return ADAPTER_TARGET;
}

export async function createXhsProduct(input = {}) {
  const title = text(input.title, 60);
  const shortTitle = text(input.shortTitle, 24);
  const deliveryLink = text(input.deliveryLink, 200);
  const deliveryContent = text(input.deliveryContent, 200);
  const description = text(input.description, 500);
  const articleNo = text(input.articleNo, 60);
  const action = input.action === "submit" ? "submit" : "draft";
  const uploadCheck = input.uploadCheck === true;
  if (!title) throw new Error("请填写商品标题");
  if (!shortTitle) throw new Error("请填写导购短标题");
  if (!deliveryLink) throw new Error("请填写自动发货网盘链接");
  if (!deliveryContent) throw new Error("请填写自动发货内容说明");
  const price = normalizeAmount(input.price);
  const stock = normalizeStock(input.stock);
  const requestedIds = [...new Set((Array.isArray(input.taskIds) ? input.taskIds : []).map(String))].slice(0, MAX_IMAGES);
  if (!requestedIds.length) throw new Error("请至少选择一张已完成图片作为商品图");

  const allTasks = await taskStore.listTasks();
  const byId = new Map(allTasks.map((task) => [String(task.id), task]));
  const tasks = requestedIds.map((id) => byId.get(id));
  if (tasks.some((task) => !task)) throw new Error("部分商品图片任务已不存在，请刷新后重试");
  if (tasks.some((task) => task.status !== "已完成" || !(task.enhancedPath || task.generatedPath))) {
    throw new Error("只能使用状态为“已完成”的生成图上架商品");
  }

  const sourceFiles = [];
  for (const task of tasks) sourceFiles.push(await imageFileForTask(task));
  for (const file of sourceFiles) await fsp.access(file);
  const prepared = await prepareImages(sourceFiles);
  await ensureXhsProductAdapter();
  const args = [
    resolveOpenCliEntry(),
    "xiaohongshu", "product-publish",
    "--title", title,
    "--short-title", shortTitle,
    "--images", prepared.files.join(","),
    "--price", price,
    "--stock", stock,
    "--delivery-link", deliveryLink,
    "--delivery-content", deliveryContent,
    "--description", description,
    "--article-no", articleNo,
    "--submit", String(action === "submit"),
    "--upload-check", String(uploadCheck),
    "--window", "foreground",
    "--site-session", "ephemeral",
    "--keep-tab", "false",
    "-f", "json"
  ];

  try {
    const { stdout = "" } = await execFileAsync(process.execPath, args, {
      windowsHide: true,
      timeout: 10 * 60 * 1000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, OPENCLI_BROWSER_COMMAND_TIMEOUT: "480" }
    });
    return {
      status: uploadCheck ? "checked" : action === "submit" ? "submitted" : "draft",
      imageCount: prepared.files.length,
      title,
      price,
      stock,
      detail: String(stdout).trim().slice(0, 1600)
    };
  } catch (error) {
    const normalized = normalizeProductError(error);
    normalized.diagnostic = [error?.stdout, error?.stderr, error?.message].filter(Boolean).join("\n").slice(0, 6000);
    throw normalized;
  } finally {
    await cleanupTemp(prepared.directory);
  }
}
