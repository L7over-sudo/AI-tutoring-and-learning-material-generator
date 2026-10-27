import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { nanoid } from "nanoid";
import { compactSourceText, extractDocumentInfo } from "./documentService.js";
import { convertImagesToPpt } from "./convertService.js";
import { resolveUploadRelative } from "./fileService.js";
import { uploadsRoot } from "../paths.js";
import { taskStore } from "../stores/taskStore.js";
import { sanitizeFileName } from "../utils/sanitizeFileName.js";
import { logService } from "./logService.js";
import { extractWordRenderedPages } from "./wordPageCountService.js";
import { compileIllustratedLayout, buildIllustratedBackgroundPrompt, compactConciseLayout, sourceUnits } from "./illustratedLayoutService.js";
import { validateIllustratedPlan } from "./slideTypography.js";
import { planPageLayout } from "./layoutPlannerService.js";
import { configStore } from "../stores/configStore.js";
import { generateTeachingImageFromText } from "./openaiImageService.js";
import { maskIllustratedBackground } from "./slidePreviewService.js";

const SUPPORTED_EXTENSIONS = new Set([".pdf", ".docx", ".txt", ".md"]);
const MAX_PAGE_COUNT = 1000;
const MAX_SOURCE_CHARS = 500000;

function cleanText(value = "") {
  return String(value)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    // Keep underscores: worksheets often use them as answer/self-rating blanks.
    .replace(/[*`~]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]+([，。！？；：、）”’])/gu, "$1")
    .replace(/([（“‘])[ \t]+/gu, "$1")
    .replace(/([，。！？；：、])[ \t]+(?=[\p{Script=Han}“‘])/gu, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizePageCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) throw new Error("无法读取文档页数");
  const pageCount = Math.round(number);
  if (pageCount > MAX_PAGE_COUNT) throw new Error(`文档共 ${pageCount} 页，单次最多支持 ${MAX_PAGE_COUNT} 页`);
  return pageCount;
}

function normalizePresentationName(value, fallback = "文档演示") {
  const requested = String(value || fallback).replace(/\.pptx?$/i, "").trim() || fallback;
  return path.parse(sanitizeFileName(`${requested}.pptx`)).name || "文档演示";
}

function documentTitle(sourceText, fallbackTitle) {
  const firstUsefulLine = cleanText(sourceText)
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length >= 2 && line.length <= 60);
  return firstUsefulLine || cleanText(fallbackTitle) || "文档主题演示";
}

function splitSourceIntoPages(sourceText, pageCount) {
  const text = cleanText(compactSourceText(sourceText, MAX_SOURCE_CHARS));
  return Array.from({ length: pageCount }, (_, index) => {
    const start = Math.floor((text.length * index) / pageCount);
    const end = Math.floor((text.length * (index + 1)) / pageCount);
    return text.slice(start, end).trim() || "本页没有可提取的文字，请保持与整套 PPT 一致的版式并适当留白。";
  });
}

// 按语义板块切分：识别章节/板块/中文序号标题，把每个板块作为一页，不再死跟 Word 页数。
// 两级标题识别：A级结构标题（第N编章节周/板块N/部分N/中文序号一二三）高精度；A 级不足时用空行段落兜底。
// 关键防误判：纯阿拉伯数字序号（1. 2. …）多为习题题干，默认不当标题；仅当该行 ≤18 字且无习题标记（： ____ ？）时才认作标题。
function splitSourceIntoSectionSlides(sourceText) {
  const text = cleanText(compactSourceText(sourceText, MAX_SOURCE_CHARS));
  if (!text) return { pages: [], source: "section" };
  const lines = text.split("\n").map((l) => l.trim());

  // A 级：结构标题
  const aLevelRe = /^(第[0-9一二三四五六七八九十]+[编章节周部分]|板块\s*[0-9]+|部分[0-9一二三四五六七八九十]+)/;
  const cnOrdinalRe = /^[一二三四五六七八九十百千]+[、.．](?![0-9])/;
  // 阿拉伯数字序号：多为习题题干/清单条目，默认不当标题；仅当孤立短行且无习题标记时才认作标题
  const arabicRe = /^\d+[、.．]/;
  const exerciseMarkerRe = /[：:____？?]/

  // 第一遍：标记每个标题行的索引
  const headingIdx = [];
  lines.forEach((line, i) => {
    if (!line) return;
    if (aLevelRe.test(line) || cnOrdinalRe.test(line)) {
      headingIdx.push(i);
    } else if (arabicRe.test(line) && line.length <= 18 && !exerciseMarkerRe.test(line)) {
      // 连续编号行（1. 2. 3. …）是清单/题干，不当标题——只有孤立的单行才认作小标题
      const prevLine = lines.slice(0, i).reverse().find((l) => l);
      const nextLine = lines.slice(i + 1).find((l) => l);
      const prevIsArabic = prevLine && arabicRe.test(prevLine);
      const nextIsArabic = nextLine && arabicRe.test(nextLine);
      if (!prevIsArabic && !nextIsArabic) headingIdx.push(i);
    }
  });

  // 聚合板块：标题行 + 后续非标题行
  let sections = [];
  if (headingIdx.length >= 2) {
    const intro = lines.slice(0, headingIdx[0]).filter(Boolean).join("\n");
    if (intro) sections.push(intro);
    for (let k = 0; k < headingIdx.length; k += 1) {
      const start = headingIdx[k];
      const end = k + 1 < headingIdx.length ? headingIdx[k + 1] : lines.length;
      const block = lines.slice(start, end).filter(Boolean).join("\n").trim();
      if (block) sections.push(block);
    }
  } else {
    // B 级兜底：按空行段落切
    const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    // 把 <40 字的小段并入下一段
    sections = [];
    for (const p of paras) {
      if (!sections.length || sections[sections.length - 1].length >= 40) {
        sections.push(p);
      } else {
        sections[sections.length - 1] += "\n" + p;
      }
    }
  }

  // 板块合并：≤40 字的小板块并入上一个板块，避免一页只放一个小标题（如"三、英语核心词汇"8字）
  const merged = [];
  for (const s of sections) {
    if (s.length <= 40 && merged.length) {
      merged[merged.length - 1] += "\n" + s;
    } else {
      merged.push(s);
    }
  }

  // 板块拆分：>600 字按句号切到多个 ≤600 字子页
  let pages = [];
  for (const s of merged) {
    if (s.length <= 600) { pages.push(s); continue; }
    const sentences = s.split(/(?<=[。！？\n])/).map((x) => x.trim()).filter(Boolean);
    let buf = "";
    for (const sen of sentences) {
      if ((buf + sen).length > 600 && buf) { pages.push(buf); buf = sen; }
      else { buf = buf ? buf + sen : sen; }
    }
    if (buf) pages.push(buf);
  }

  if (!pages.length) pages.push(text);
  return { pages, source: "section" };
}

function buildEditableSlideContent(pageText, index, fallbackTitle) {
  const cleaned = cleanText(pageText);
  const lines = cleaned.split("\n").map((line) => line.trim()).filter(Boolean);
  const firstLine = lines[0] || "";
  const structuralTitleRe = /^(第[0-9一二三四五六七八九十]+[编章节部分]|板块\s*[0-9]+|部分[0-9一二三四五六七八九十]+|[一二三四五六七八九十百千]+[、.．])/;
  const structuralTitleIndex = lines.findIndex((line) => line.length <= 60 && structuralTitleRe.test(line));
  const firstLineIsTitle = firstLine.length >= 2 && firstLine.length <= 60 && (index === 0 || structuralTitleRe.test(firstLine));
  const titleLineIndex = firstLineIsTitle ? 0 : structuralTitleIndex;
  const title = titleLineIndex >= 0
    ? lines[titleLineIndex]
    : index === 0
      ? cleanText(fallbackTitle) || "文档主题演示"
      : `${cleanText(fallbackTitle) || "文档主题演示"} · 第 ${index + 1} 页`;
  const bodyLines = lines.filter((_, lineIndex) => lineIndex !== titleLineIndex);
  return {
    title,
    body: bodyLines.join("\n") || (firstLine !== title ? firstLine : ""),
    backgroundIsTextFree: true
  };
}

export async function buildSlidePlans(sourceText, sourcePages, fallbackTitle, pageCount, layoutModel, stylePrompt = "", pageDensity = "balanced", textMode = "preserve") {
  const title = documentTitle(sourceText, fallbackTitle);
  const extracted = Array.isArray(sourcePages) && sourcePages.length
    ? sourcePages : splitSourceIntoSectionSlides(sourceText).pages;
  const densityLimit = textMode === "concise" || pageDensity === "preserve" ? Number.POSITIVE_INFINITY : pageDensity === "spacious" ? 280 : 420;
  const queue = extracted.flatMap((chunk, index) => {
    const content = { ...buildEditableSlideContent(cleanText(chunk), index, title), sourcePageNumber: index + 1 };
    return splitContentForComfort({ ...content, baseTitle: content.title }, densityLimit);
  });
  normalizePageCount(queue.length);

  const accepted = [];
  // Character limits are only a first pass. Every page is measured against its actual
  // composition; if it is still dense, split it and plan both halves again.
  while (queue.length) {
    const content = queue.shift();
    const index = accepted.length;
    const proposed = await planPageLayout(content, index, index + queue.length + 1, title, layoutModel, {
      previousComposition: accepted[index - 1]?.layout?.composition, stylePrompt, textMode
    });
    const comfortable = textMode === "concise" ? compactConciseLayout(proposed, 250) : proposed;
    try {
      compileIllustratedLayout(comfortable, { bgMediaKey: `measure-${index}`, pageNumber: index + 1 });
      accepted.push({ content, layout: comfortable });
    } catch (error) {
      if (textMode === "concise") {
        const compacted = compactConciseLayout({
          ...comfortable,
          composition: index % 2 ? "scene-left" : "scene-right"
        }, 220);
        compileIllustratedLayout(compacted, { bgMediaKey: `measure-${index}`, pageNumber: index + 1 });
        accepted.push({ content, layout: compacted });
        logService.info("presentation", `第${index + 1}页文字已压缩适配原页，未增加续页`);
        continue;
      }
      const parts = splitContentForMeasuredLayout(content);
      if (!parts) throw error;
      queue.unshift(...parts);
      normalizePageCount(accepted.length + queue.length);
      logService.info("presentation", `第${index + 1}页文字较多，已按实际版面继续拆为续页`);
    }
  }

  // Renumber continuation titles after adaptive splitting, then build the final plans.
  const continuationCounts = new Map();
  return accepted.map(({ content, layout }, index) => {
    const sourcePageNumber = content.sourcePageNumber || index + 1;
    const baseTitle = content.baseTitle || content.title;
    const continuationKey = `${sourcePageNumber}|${baseTitle}`;
    const continuationIndex = (continuationCounts.get(continuationKey) || 0) + 1;
    continuationCounts.set(continuationKey, continuationIndex);
    const finalTitle = continuationIndex === 1 ? baseTitle : `${baseTitle}（续${continuationIndex}）`;
    const finalLayout = { ...layout, title: finalTitle };
    const { slidePlan } = compileIllustratedLayout(finalLayout, { bgMediaKey: `bg-${index}`, pageNumber: index + 1 });
    const displayBody = finalLayout.blocks.map((block) => block.body).filter(Boolean).join("\n");
    const finalContent = {
      ...content,
      title: finalTitle,
      body: textMode === "concise" ? displayBody : content.body,
      originalBody: content.body,
      textMode
    };
    return {
      presentationContent: finalContent, layout: finalLayout, slidePlan, templateKey: finalLayout.composition,
      backgroundSourceText: `${finalContent.title}\n${finalContent.body}`,
      layoutPrompt: buildIllustratedBackgroundPrompt(finalLayout, slidePlan), assetPrompts: []
    };
  });
}

function splitContentForComfort(content, limit) {
  if (!Number.isFinite(limit)) return [content];
  const queue = [content];
  const result = [];
  while (queue.length) {
    const current = queue.shift();
    if (String(current.body || "").length <= limit) { result.push(current); continue; }
    const parts = splitContentAtSectionBoundary(current) || splitContentForMeasuredLayout(current);
    if (!parts) { result.push(current); continue; }
    queue.unshift(...parts);
  }
  return result;
}

function splitContentAtSectionBoundary(content) {
  const lines = String(content.body || "").split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const structuralRe = /^[一二三四五六七八九十百千]+[、.．]/;
  const total = lines.reduce((sum, line) => sum + line.length, 0);
  let used = 0;
  const candidates = [];
  for (let index = 1; index < lines.length; index += 1) {
    used += lines[index - 1].length;
    const ratio = used / Math.max(total, 1);
    if (ratio >= 0.25 && ratio <= 0.8 && structuralRe.test(lines[index])) {
      candidates.push({ index, distance: Math.abs(0.5 - ratio) });
    }
  }
  if (!candidates.length) return null;
  const cut = candidates.sort((a, b) => a.distance - b.distance)[0].index;
  const sectionTitle = lines[cut];
  const left = lines.slice(0, cut).join("\n");
  const right = lines.slice(cut + 1).join("\n");
  if (!left || !right) return null;
  return [
    { ...content, body: left },
    { ...content, title: sectionTitle, baseTitle: sectionTitle, body: right }
  ];
}

function splitContentForMeasuredLayout(content) {
  const units = sourceUnits(content);
  let left = "";
  let right = "";
  if (units.length > 1) {
    const total = units.reduce((sum, unit) => sum + unit.text.length, 0);
    let used = 0;
    let cut = 1;
    for (let index = 0; index < units.length - 1; index += 1) {
      used += units[index].text.length;
      cut = index + 1;
      if (used >= total / 2) break;
    }
    const joinUnits = (list) => list.map((unit, index) => `${index > 0 && unit.paragraphStart ? "\n" : ""}${unit.text}`).join("");
    left = joinUnits(units.slice(0, cut));
    right = joinUnits(units.slice(cut));
  } else {
    const chars = Array.from(String(content.body || ""));
    if (chars.length < 2) return null;
    const cut = Math.ceil(chars.length / 2);
    left = chars.slice(0, cut).join("");
    right = chars.slice(cut).join("");
  }
  if (!left.trim() || !right.trim()) return null;
  const baseTitle = content.baseTitle || content.title;
  return [
    { ...content, baseTitle, title: baseTitle, body: left.trim() },
    { ...content, baseTitle, title: baseTitle, body: right.trim() }
  ];
}

function emptySummary(total) {
  return { total, success: 0, failed: 0, running: 0, pending: total, canceled: 0 };
}

// 小素材图标磁盘缓存：把生成结果按提示词哈希存盘，重复导出时命中缓存直接读，
// 避免每次导出都串行重跑 ~10 个图标（这是旧版导出要 7 分钟的元凶）。
const ASSET_CACHE_DIR = path.join(uploadsRoot, "presentations", "asset-cache");
const ASSET_CACHE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function assetCacheKey(batchId, index, mediaKey, prompt) {
  const hash = crypto.createHash("sha256")
    .update(`${index}|${mediaKey}|${String(prompt || "")}`)
    .digest("hex")
    .slice(0, 24);
  return path.join(ASSET_CACHE_DIR, `${batchId}`, `${hash}.png`);
}

async function readCachedAsset(file) {
  try {
    const stat = await fs.stat(file);
    if (Date.now() - stat.mtimeMs > ASSET_CACHE_RETENTION_MS) return null;
    return await fs.readFile(file);
  } catch {
    return null;
  }
}

async function writeCachedAsset(file, buffer) {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}-${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(temp, buffer);
    await fs.rename(temp, file);
  } catch (error) {
    logService.warn("presentation", `小素材缓存写入失败：${error.message}`);
  }
}

// 批量取小素材：未命中的并行生成（最多 4 路并发），命中直接读盘。
const ASSET_CONCURRENCY = 4;

async function resolveAssetIcons(batchId, index, assetPrompts, config) {
  const results = new Array(assetPrompts.length);
  let cursor = 0;

  async function worker() {
    while (cursor < assetPrompts.length) {
      const i = cursor;
      cursor += 1;
      const asset = assetPrompts[i];
      const cacheFile = assetCacheKey(batchId, index, asset.mediaKey, asset.prompt);
      const cached = await readCachedAsset(cacheFile);
      if (cached) {
        results[i] = { asset, buffer: cached };
        continue;
      }
      try {
        const result = await generateTeachingImageFromText({
          sourceText: asset.prompt,
          prompt: "单个简洁图标，白色或透明背景，扁平或手绘风格，居中，教育主题",
          presentation: false,
          size: "1024x1024",
          quality: "low",
          config: { ...config, timeoutMs: 240000 },
          signal: AbortSignal.timeout?.(120000)
        });
        if (result?.success && result.b64Json) {
          const buffer = Buffer.from(result.b64Json, "base64");
          await writeCachedAsset(cacheFile, buffer);
          results[i] = { asset, buffer };
        } else {
          logService.warn("presentation", `小素材生成失败（${asset.name}）：${result?.error || "未知错误"}，跳过该素材`);
          results[i] = { asset, buffer: null };
        }
      } catch (error) {
        logService.warn("presentation", `小素材生成异常（${asset.name}）：${error.message}，跳过该素材`);
        results[i] = { asset, buffer: null };
      }
    }
  }

  const workerCount = Math.min(ASSET_CONCURRENCY, assetPrompts.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export async function createDocumentPresentationTasks(file, options = {}) {
  const ext = path.extname(file?.originalname || "").toLowerCase();
  if (!file?.buffer) throw new Error("请上传文档文件");
  if (!SUPPORTED_EXTENSIONS.has(ext)) throw new Error("仅支持 pdf、docx、txt、md 文档");

  const info = await extractDocumentInfo(file);
  let documentPages = Array.isArray(info.pages) && info.pages.some((page) => String(page || "").trim()) ? info.pages : null;
  if (ext === ".docx") {
    try {
      // Word's rendered page breaks are authoritative for PPT page count.
      const rendered = await extractWordRenderedPages(file);
      info.pages = rendered.pages;
      info.pageCount = rendered.pageCount;
      info.pageCountSource = "word-rendered-pages";
      documentPages = rendered.pages;
    } catch (error) {
      logService.warn("presentation", `${error.message}，改用文档内容自动分页`);
    }
  }
  if (!String(info.text || "").trim()) {
    throw new Error("文档没有可提取的文字内容；扫描版 PDF 请先进行 OCR");
  }

  if (!documentPages) {
    try {
      const sectionResult = splitSourceIntoSectionSlides(info.text);
      if (sectionResult.pages.length) {
        documentPages = sectionResult.pages;
        info.pageCountSource = "section-split-fallback";
      }
    } catch (error) {
      logService.warn("presentation", `板块切分失败：${error.message}，回退自动分页`);
    }
  }

  let requestedPageCount;
  if (documentPages) requestedPageCount = normalizePageCount(documentPages.length);
  else {
    info.pageCount = info.estimatedPageCount || info.pageCount;
    info.pageCountSource = info.pageCountSource || "auto-pagination";
    requestedPageCount = normalizePageCount(info.pageCount);
  }
  const fallbackTitle = path.parse(file.originalname || "文档").name;
  const presentationName = normalizePresentationName(options.pptName, fallbackTitle);
  // P2：读取版面规划模型配置，传给 buildSlidePlans 做 LLM 规划
  const config = await configStore.getRaw();
  const layoutModel = config.layoutModel || null;
  const pageDensity = ["preserve", "balanced", "spacious"].includes(options.pageDensity) ? options.pageDensity : "balanced";
  const textMode = options.textMode === "preserve" ? "preserve" : "concise";
  const plans = await buildSlidePlans(info.text, documentPages, fallbackTitle, requestedPageCount, layoutModel, options.stylePrompt || "", pageDensity, textMode);
  const batchId = nanoid();
  const now = new Date().toISOString();
  const numberWidth = Math.max(2, String(plans.length).length);
  // The prompt selected in the shared prompt panel is the single visual-style
  // source for both layout planning and image generation. Snapshot it so later
  // template changes cannot make an already planned deck visually inconsistent.
  const generationOptions = {
    presentation: true,
    size: "16:9",
    pageDensity,
    textMode,
    prompt: String(options.stylePrompt || "").trim(),
    promptTemplate: String(options.promptTemplate || "").trim()
  };
  const tasks = plans.map((plan, index) => {
    const pageNumber = String(index + 1).padStart(numberWidth, "0");
    const title = `${presentationName}-第${pageNumber}页`;
    return {
      id: nanoid(), batchId, index: index + 1, title,
      originalName: `${title}.png`, folderName: presentationName,
      originalPath: null, originalUrl: null,
      // P1 composite：走多图层路径，生纯背景图 + 代码叠文本框
      sourceType: "composite", presentation: true,
      sourceText: plan.backgroundSourceText,
      layoutPrompt: plan.layoutPrompt,
      presentationContent: plan.presentationContent,
      templateKey: plan.templateKey,
      slidePlan: plan.slidePlan,
      layout: plan.layout,
      assetPrompts: plan.assetPrompts || [],
      generationOptions,
      generatedPath: null, generatedUrl: null, enhancedPath: null, enhancedUrl: null,
      status: "待生成", selected: true, error: null, createdAt: now, updatedAt: now
    };
  });
  const batch = {
    id: batchId, folderName: presentationName, presentationName, requestedPageCount,
    pageCountSource: info.pageCountSource || "document-pages",
    sourceType: "presentation", generationOptions,
    status: "待生成", cancelRequested: false, summary: emptySummary(tasks.length),
    createdAt: now, updatedAt: now
  };

  await taskStore.addBatch(batch, tasks);
  return {
    batch, tasks, pageCount: tasks.length, requestedPageCount, presentationName,
    pageCountSource: info.pageCountSource || "document-pages"
  };
}

export async function exportPresentationBatch(batchId, options = {}) {
  const { batch, tasks } = await validatePresentationBatch(batchId);
  return buildPptResult({ batch, tasks }, options);
}

// 后台导出任务登记表：batchId -> { startedAt }。用于去重（同批不并发两次）和
// 让前端轮询到"运行中"状态。真正的产物状态落在 batch.pptExport（taskStore）里。
const activeExports = new Map();

async function validatePresentationBatch(batchId) {
  const { batch, tasks } = await taskStore.getBatch(batchId);
  if (!batch) throw new Error("PPT 任务不存在");
  if (batch.sourceType !== "presentation") throw new Error("当前任务不是文档生 PPT 任务");
  if (!tasks.length) throw new Error("PPT 任务中没有页面");
  const unavailable = tasks.filter((task) => task.status !== "已完成" || !(task.enhancedPath || task.generatedPath));
  if (unavailable.length) throw new Error(`还有 ${unavailable.length} 页未成功生成，请全部生成完成后再导出 PPT`);
  return { batch, tasks };
}

async function buildPptResult({ batch, tasks }, options) {
  const requestedName = normalizePresentationName(options.pptName, batch.presentationName || batch.folderName);

  // P1 composite 路径：每页背景图 + slidePlan 拼多图层可编辑 PPTX
  const hasSlidePlans = tasks.some((task) => task.slidePlan);
  if (hasSlidePlans) {
    const config = await configStore.getRaw();
    const slidePlans = [];
    const mediaMap = {};
    for (const [index, task] of tasks.entries()) {
      const mediaKey = `bg-${index}`;
      // 把 slidePlan 里的背景 mediaKey 对齐到本页实际 key
      const plan = structuredClone(task.slidePlan);
      if (plan?.version === 3) validateIllustratedPlan(plan);
      if (plan.background) plan.background.mediaKey = mediaKey;
      const bgBuffer = await fs.readFile(resolveUploadRelative(task.enhancedPath || task.generatedPath));
      mediaMap[mediaKey] = plan?.version === 3 ? await maskIllustratedBackground(bgBuffer, plan) : bgBuffer;

      // P2：小素材图（并行 + 磁盘缓存），塞进 mediaMap
      const assetPrompts = Array.isArray(task.assetPrompts) ? task.assetPrompts : [];
      if (assetPrompts.length) {
        const resolved = await resolveAssetIcons(batch.id, index, assetPrompts, config);
        for (const { asset, buffer } of resolved) {
          if (buffer) mediaMap[asset.mediaKey] = buffer;
        }
      }
      slidePlans.push(plan);
    }
    const result = await convertImagesToPpt([], {
      slidePlans,
      mediaMap,
      pptName: requestedName,
      outputFolder: options.outputFolder,
      preserveOrder: true
    });
    return { ...result, batchId: batch.id, exportMode: "composite", presentationName: batch.presentationName || batch.folderName };
  }

  // 老路径回退：一页一图
  const files = await Promise.all(tasks.map(async (task, index) => ({
    originalname: `slide-${String(index + 1).padStart(3, "0")}.png`,
    buffer: await fs.readFile(resolveUploadRelative(task.enhancedPath || task.generatedPath))
  })));
  const result = await convertImagesToPpt(files, {
    pptName: requestedName,
    outputFolder: options.outputFolder,
    preserveOrder: true
  });
  return { ...result, batchId: batch.id, exportMode: "original", presentationName: batch.presentationName || batch.folderName };
}

// 启动 PPT 导出：同步做完校验（错误立刻抛回前端），再把耗时的图标生成 + 打包
// 放到后台异步跑，立即返回。前端轮询 getPptExportStatus 直到 done/failed。
export async function startPptExport(batchId, options = {}) {
  // 同步校验：把"页面没生成完"之类的错误当场返回，而不是等后台
  const { batch, tasks } = await validatePresentationBatch(batchId);

  // 同批已有导出在跑：直接返回 running，避免重复生成图标
  if (activeExports.has(batchId)) {
    return { started: false, status: "running" };
  }

  const startedAt = new Date().toISOString();
  activeExports.set(batchId, { startedAt });
  await taskStore.updateBatch(batchId, {
    pptExport: { status: "running", startedAt, finishedAt: null, error: null, downloadUrl: null, fileName: null }
  });

  // 后台真正执行，不阻塞 HTTP 响应
  (async () => {
    try {
      const result = await buildPptResult({ batch, tasks }, options);
      await taskStore.updateBatch(batchId, {
        pptExport: {
          status: "done",
          startedAt,
          finishedAt: new Date().toISOString(),
          error: null,
          downloadUrl: result.downloadUrl,
          fileName: result.fileName,
          exportMode: result.exportMode,
          slideCount: result.slideCount
        }
      });
      logService.success("presentation", `PPT 导出完成：${result.fileName}`);
    } catch (error) {
      await taskStore.updateBatch(batchId, {
        pptExport: {
          status: "failed",
          startedAt,
          finishedAt: new Date().toISOString(),
          error: error.message,
          downloadUrl: null,
          fileName: null
        }
      });
      logService.error("presentation", `PPT 导出失败：${error.message}`);
    } finally {
      activeExports.delete(batchId);
    }
  })();

  return { started: true, status: "running" };
}

// 查询导出状态。内存里在跑优先；否则读落盘状态；若落盘是 running 但没有对应
// 内存任务，说明服务重启把导出打断了，报成 failed 让前端可重试。
export async function getPptExportStatus(batchId) {
  const { batch } = await taskStore.getBatch(batchId);
  if (!batch) throw new Error("PPT 任务不存在");

  const active = activeExports.get(batchId);
  if (active) return { pptExport: { status: "running", startedAt: active.startedAt, error: null } };

  const persisted = batch.pptExport;
  if (!persisted) return { pptExport: { status: "idle" } };
  if (persisted.status === "running") {
    return { pptExport: { ...persisted, status: "failed", error: "导出被中断（服务可能已重启），请重新点击导出" } };
  }
  return { pptExport: persisted };
}
