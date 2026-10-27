import { EMU_PER_PX, fitSlideText, validateIllustratedPlan } from "./slideTypography.js";

export const COMPOSITIONS = ["scene-left", "scene-right", "steps", "comparison", "story-grid", "scene-top", "text-focus", "text-dense"];
export const ILLUSTRATION_STYLE = "温暖清新的教学绘本插画，细腻水彩与清晰线稿，自然日光、米白底、森林绿和少量珊瑚红、蓝色点缀。场景和人物年龄符合文档内容，人物动作明确，色彩与线条在整套课件中一致。";
const color = (value, fallback) => /^[0-9A-Fa-f]{6}$/.test(String(value || "")) ? value : fallback;

export function sanitizeVisualStylePrompt(value = "") {
  const compact = String(value || "").replace(/\r/g, "\n").replace(/\n{2,}/g, "\n").trim();
  if (!compact) return ILLUSTRATION_STYLE;
  const forbidden = /原图|重绘|文字|标题|正文|栏目|卡片|边框|气泡|版式|构图|位置|尺寸|比例|新增|允许|禁止|不要|表格|模块/u;
  const styleSignal = /风格|配色|色彩|笔触|材质|光线|氛围|绘本|插画|水彩|手绘|线稿|扁平|3D|明亮|温暖|清新|柔和|人物|校园|童趣/u;
  const candidates = compact.split(/\n+/).map((line) => line.trim()).filter((line) =>
    line.length >= 2 && line.length <= 100 && styleSignal.test(line) && !forbidden.test(line)
  );
  const selected = candidates.join("；").slice(0, 240);
  return selected || ILLUSTRATION_STYLE;
}

// Source units are authoritative: models assign IDs, never rewrite or truncate body text.
export function sourceUnits(content) {
  const result = [];
  for (const [lineIndex, line] of String(content.body || "").split(/\n+/).entries()) {
    const sentences = line.split(/(?<=[。！？；])/u).map((text) => text.trim()).filter(Boolean);
    const pieces = [];
    let buffer = "";
    for (const sentence of sentences) {
      if (buffer && buffer.length + sentence.length > 180) { pieces.push(buffer); buffer = sentence; }
      else buffer += sentence;
    }
    if (buffer) pieces.push(buffer);
    pieces.forEach((text, pieceIndex) => result.push({
      id: result.length + 1,
      text,
      paragraphStart: lineIndex > 0 && pieceIndex === 0
    }));
  }
  return result;
}

function joinSourceUnits(units) {
  return units.map((unit, index) => `${index > 0 && unit.paragraphStart ? "\n" : ""}${unit.text}`).join("");
}

export function compactConciseText(value, maxChars = 92) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  const sentences = text.match(/[^。！？；]+[。！？；]?/gu) || [text];
  let result = "";
  for (const sentence of sentences) {
    if ((result + sentence).length > maxChars) break;
    result += sentence;
  }
  if (result.length >= Math.floor(maxChars * 0.68)) return result.replace(/[，、：\s]+$/u, "");
  const candidate = Array.from(text).slice(0, Math.max(1, maxChars - 1)).join("");
  const punctuationCut = Math.max(candidate.lastIndexOf("，"), candidate.lastIndexOf("、"), candidate.lastIndexOf("；"));
  const cut = punctuationCut >= Math.floor(maxChars * 0.72) ? candidate.slice(0, punctuationCut) : candidate;
  return `${cut.replace(/[，、：；。！？\s]+$/u, "")}。`;
}

export function compactConciseLayout(layout, maxTotal = 285) {
  const blocks = Array.isArray(layout?.blocks) ? layout.blocks : [];
  if (!blocks.length) return layout;
  const perBlock = blocks.length === 1
    ? Math.min(260, maxTotal)
    : blocks.length === 2
      ? Math.min(145, Math.floor(maxTotal / 2))
      : Math.min(94, Math.floor(maxTotal / blocks.length));
  return {
    ...layout,
    blocks: blocks.map(block => ({ ...block, body: compactConciseText(block.body, perBlock) }))
  };
}

export function paginateIllustratedContent(content, limit = 280) {
  const units = sourceUnits(content);
  const chunks = [];
  let body = "";
  for (const unit of units) {
    // Extremely long unpunctuated paragraphs still get carried into continuation pages.
    const chars = Array.from(unit.text);
    for (let offset = 0; offset < chars.length; offset += limit) {
      const text = chars.slice(offset, offset + limit).join("");
      if (body && body.length + text.length + 1 > limit) { chunks.push(body); body = ""; }
      body = body ? `${body}${unit.paragraphStart ? "\n" : ""}${text}` : text;
    }
  }
  if (body || !chunks.length) chunks.push(body);
  return chunks.map((text, i) => ({ ...content, title: i ? `${content.title}（续${i + 1}）` : content.title, body: text }));
}

function selectComposition(content, index, ignoreDensity = false) {
  const text = `${content.title}\n${content.body}`;
  if (!ignoreDensity && String(content.body || "").length > 440) return "text-dense";
  if (!ignoreDensity && String(content.body || "").length > 260) return "text-focus";
  if (/步骤|流程|先.{1,20}再|第一步|第二步|整理书包|第[一二三四五12345][个步]/.test(text)) return "steps";
  if (/对比|区别|可以.*不可以|应该.*不应该|正确.*错误|优点.*缺点/.test(text.replace(/\n/g, ""))) return "comparison";
  if (sourceUnits(content).length >= 5) return index % 2 ? "story-grid" : "scene-right";
  return ["scene-left", "scene-right", "scene-top"][index % 3];
}

function splitIntoGroups(units, count) {
  const groups = Array.from({ length: Math.min(count, Math.max(units.length, 1)) }, () => []);
  const target = Math.ceil(units.reduce((sum, u) => sum + u.text.length, 0) / groups.length);
  let index = 0;
  for (const unit of units) {
    if (index < groups.length - 1 && groups[index].length && groups[index].reduce((sum, u) => sum + u.text.length, 0) >= target) index++;
    groups[index].push(unit);
  }
  return groups.filter(g => g.length);
}

function splitIntoParagraphColumns(units) {
  const paragraphs = [];
  for (const unit of units) {
    if (!paragraphs.length || unit.paragraphStart) paragraphs.push([]);
    paragraphs[paragraphs.length - 1].push(unit);
  }
  if (paragraphs.length < 2) return splitIntoGroups(units, 2);
  const lengths = paragraphs.map((paragraph) => paragraph.reduce((sum, unit) => sum + unit.text.length, 0));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const structuralCut = paragraphs.findIndex((paragraph, index) => {
    if (index === 0) return false;
    const before = lengths.slice(0, index).reduce((sum, length) => sum + length, 0);
    return before / total >= 0.3 && before / total <= 0.75 && /^[一二三四五六七八九十百千]+[、.．]/.test(paragraph[0]?.text || "");
  });
  if (structuralCut > 0) return [paragraphs.slice(0, structuralCut).flat(), paragraphs.slice(structuralCut).flat()];
  let used = 0;
  let bestCut = 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < paragraphs.length - 1; index += 1) {
    used += lengths[index];
    const distance = Math.abs(total / 2 - used);
    if (distance < bestDistance) { bestDistance = distance; bestCut = index + 1; }
  }
  return [paragraphs.slice(0, bestCut).flat(), paragraphs.slice(bestCut).flat()].filter((group) => group.length);
}

export function normalizeIllustratedLayout(raw, content, index = 0, context = {}) {
  const concise = context.textMode === "concise";
  let composition = COMPOSITIONS.includes(raw?.composition) ? raw.composition : selectComposition(content, index, concise);
  if (!concise && String(content.body || "").length > 440) composition = "text-dense";
  else if (!concise && String(content.body || "").length > 260) composition = "text-focus";
  // Adjacent scenes may be mirrored without changing the semantics of steps/comparisons.
  if (composition === context.previousComposition && ["scene-left", "scene-right"].includes(composition)) {
    composition = composition === "scene-left" ? "scene-right" : "scene-left";
  }
  const units = sourceUnits(content);
  const maxBlocks = composition === "text-dense" ? 2 : composition === "text-focus" ? 1 : composition === "steps" ? 3 : composition === "story-grid" ? (concise ? 3 : 4) : composition === "comparison" || composition === "scene-top" ? 2 : 3;
  let groups = [];
  const proposed = Array.isArray(raw?.blocks) ? raw.blocks.map((block) => ({
    ...block,
    sourceIds: Array.isArray(block?.sourceIds)
      ? block.sourceIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
      : []
  })) : [];
  const ids = proposed.flatMap(b => Array.isArray(b.sourceIds) ? b.sourceIds : []);
  const valid = proposed.length > 0 && proposed.length <= maxBlocks && ids.length === units.length &&
    new Set(ids).size === units.length && units.every(u => ids.includes(u.id)) && proposed.every(b => b.sourceIds?.length);
  let repairedConciseIds = false;
  if (valid) {
    // Restore original order even if model IDs are shuffled.
    groups = proposed.map(b => ({ ...b, units: units.filter(u => b.sourceIds.includes(u.id)) }))
      .sort((a, b) => a.units[0].id - b.units[0].id);
    const restoredIds = groups.flatMap(b => b.units.map(u => u.id));
    if (restoredIds.some((id, i) => id !== units[i].id)) groups = [];
  } else if (concise && proposed.length > 0 && proposed.length <= maxBlocks &&
    proposed.every((block) => String(block?.displayText || "").trim())) {
    // The planner occasionally returns good concise copy but misses or stringifies one
    // source id. Keep the copy and rebuild a complete, ordered source mapping locally.
    // The untouched source remains in sourceBody/presentationContent.originalBody.
    groups = splitIntoGroups(units, proposed.length).map((groupUnits, groupIndex) => ({
      ...proposed[groupIndex],
      units: groupUnits
    }));
    repairedConciseIds = true;
  }
  if (composition === "text-dense" && !concise) {
    const proposedScenes = proposed.map((block) => block?.scene).filter(Boolean).join("；");
    groups = splitIntoParagraphColumns(units).map((groupUnits, groupIndex) => ({
      units: groupUnits,
      heading: "",
      scene: groupIndex === 0 ? proposedScenes : ""
    }));
  } else if (!groups.length) groups = splitIntoGroups(units, Math.min(maxBlocks, composition.startsWith("scene-") ? 2 : maxBlocks)).map(u => ({ units: u }));
  if (!groups.length) groups = [{ units: [] }];
  // A single AI request cannot reliably register several independent scenes to
  // several small masks. For three concise ideas, use one complete hero scene
  // and one continuous editorial text field, mirrored on adjacent pages.
  if (concise && groups.length === 3 && ["scene-left", "scene-right", "story-grid"].includes(composition)) {
    composition = index % 2 ? "scene-left" : "scene-right";
  }
  // The model may classify and group content, but the visible title remains source-authored.
  const title = String(content.title || raw?.title || "学习与成长").trim();
  const requestedHighlight = String(raw?.highlightPhrase || "").trim();
  const fallbackHighlight = title.length >= 8
    ? (title.includes("：") ? title.split("：").slice(1).join("：").slice(0, 8) : Array.from(title).slice(-4).join(""))
    : "";
  const highlightPhrase = title.includes(requestedHighlight) && requestedHighlight.length >= 2 ? requestedHighlight : fallbackHighlight;
  const blocks = groups.map((group, i) => ({
    heading: String(group.heading || (composition === "text-dense" ? "" : groups.length > 1 ? `${composition === "steps" ? "步骤" : "学习要点"} ${i + 1}` : "")).trim(),
    body: concise && String(group.displayText || "").trim() ? String(group.displayText).trim() : joinSourceUnits(group.units),
    sourceIds: group.units.map(u => u.id),
    scene: String(group.scene || `围绕“${content.title}”，描绘以下内容所对应的人物、动作、物品及环境：${group.units.map(u => u.text).join("；")}`).trim()
  }));
  return {
    version: 3, composition, template: composition, title, blocks,
    titleColor: color(raw?.titleColor, "365B32"), accentColor: color(raw?.accentColor, "D95446"), highlightPhrase,
    visualStyle: sanitizeVisualStylePrompt(raw?.visualStyle || context.stylePrompt || ILLUSTRATION_STYLE),
    fallback: Boolean(raw?.fallback || (!valid && !repairedConciseIds)),
    sourceBody: content.body || ""
  };
}

const emu = v => Math.round(v * EMU_PER_PX);
function textShape(name, text, rect, size, colorValue, bold = false, extra = {}) {
  return fitSlideText({ name, text, x: emu(rect.x), y: emu(rect.y), cx: emu(rect.w), cy: emu(rect.h),
    fontSize: size, minFontSize: size >= 32 ? 30 : size >= 22 ? 20 : 18,
    color: colorValue, bold, margin: 0, anchor: "t", zOrder: 5, ...extra });
}

function titleTextShape(layout, rect) {
  const title = String(layout.title || "");
  const phrase = String(layout.highlightPhrase || "");
  const index = phrase ? title.indexOf(phrase) : -1;
  const runs = index >= 0 ? [
    { text: title.slice(0, index), color: layout.titleColor, bold: true },
    { text: phrase, color: layout.accentColor, bold: true },
    { text: title.slice(index + phrase.length), color: layout.titleColor, bold: true }
  ].filter(run => run.text) : [{ text: title, color: layout.titleColor, bold: true }];
  return fitSlideText({ name: "页面标题", runs, text: title, x: emu(rect.x), y: emu(rect.y), cx: emu(rect.w), cy: emu(rect.h),
    fontSize: 42, minFontSize: 34, color: layout.titleColor, bold: true, margin: 0,
    anchor: "t", zOrder: 5, singleLine: title.length <= 24, lineHeight: 1.06 });
}

export function buildIllustratedSlidePlan(layout, { bgMediaKey, pageNumber = 1 } = {}) {
  const plan = { version: 3, composition: layout.composition,
    background: { mediaKey: bgMediaKey, x: 0, y: 0, cx: emu(1600), cy: emu(900), name: "场景插画" },
    filledShapes: [], pictures: [], textShapes: [], sceneRegions: [] };
  const titleRect = layout.composition === "text-dense" ? { x: 80, y: 20, w: 1060, h: 150 } : { x: 80, y: 20, w: 1440, h: 150 };
  plan.textShapes.push(titleTextShape(layout, titleRect));
  const blocks = layout.blocks;
  const addScene = (rect, scene) => plan.sceneRegions.push({ ...rect, scene });
  const addTextPanel = (rect, i) => {
    const x = Math.max(24, rect.x - 18);
    const y = Math.max(160, rect.y - 12);
    const right = Math.min(1576, rect.x + rect.w + 18);
    const bottom = Math.min(830, rect.y + rect.h + 10);
    plan.filledShapes.push({
      name: `内容${i + 1}固定文字面板`,
      x: emu(x), y: emu(y), cx: emu(right - x), cy: emu(bottom - y),
      fill: "FFFEF9", alpha: 94000, radius: true,
      line: i % 2 ? layout.accentColor : layout.titleColor, zOrder: 2
    });
  };
  const addBlock = (block, rect, i, bodySize = 18, bodyExtra = {}) => {
    const { panel = true, ...textExtra } = bodyExtra;
    if (panel) addTextPanel(rect, i);
    let y = rect.y;
    if (block.heading) {
      plan.textShapes.push(textShape(`内容${i + 1}标题`, block.heading, { ...rect, h: 54 }, 23, i % 2 ? layout.accentColor : layout.titleColor, true, { singleLine: true }));
      y += 64;
    }
    if (block.body) plan.textShapes.push(textShape(`内容${i + 1}正文`, block.body, { x: rect.x, y, w: rect.w, h: rect.h - (y - rect.y) }, bodySize, "29342C", false, textExtra));
  };
  const addRule = (x, y, w) => plan.filledShapes.push({ name: "细分隔线", x: emu(x), y: emu(y), cx: emu(w), cy: emu(2), fill: "D4DEC9", alpha: 100000, zOrder: 2 });
  if (layout.composition === "text-dense") {
    addScene({ x: 1200, y: 25, w: 320, h: 135 }, blocks.map(b => b.scene).filter(Boolean).join("\n"));
    const columnWidth = 680;
    blocks.forEach((block, index) => {
      addBlock(block, { x: 80 + index * 760, y: 185, w: columnWidth, h: 625 }, index, 16, { minFontSize: 14, lineHeight: 1.18 });
    });
    const bodyIndexes = plan.textShapes.map((shape, index) => /正文$/.test(shape.name) ? index : -1).filter((index) => index >= 0);
    const commonSize = Math.min(...bodyIndexes.map((index) => plan.textShapes[index].fontSize));
    for (const index of bodyIndexes) {
      if (plan.textShapes[index].fontSize !== commonSize) {
        plan.textShapes[index] = fitSlideText({ ...plan.textShapes[index], fontSize: commonSize, minFontSize: commonSize });
      }
    }
  } else if (layout.composition === "text-focus") {
    addScene({ x: 1080, y: 180, w: 440, h: 640 }, blocks.map(b => b.scene).filter(Boolean).join("\n"));
    addBlock(blocks[0], { x: 80, y: 185, w: 920, h: 625 }, 0, 18, { minFontSize: 16, lineHeight: 1.22 });
  } else if (["scene-left", "scene-right"].includes(layout.composition)) {
    const left = layout.composition === "scene-left";
    addScene(
      { x: left ? 60 : 850, y: 180, w: 690, h: 640 },
      `在同一个连续空间中自然表现这些内容：${blocks.map(b => b.scene).filter(Boolean).join("；同时表现：")}。只保留一个主视角，不拆成多个画面。`
    );
    const textX = left ? 820 : 80;
    plan.filledShapes.push({
      name: "内容统一固定文字面板",
      x: emu(textX - 24), y: emu(174), cx: emu(728), cy: emu(650),
      fill: "FFFCF3", alpha: 94000, radius: true, zOrder: 2
    });
    plan.filledShapes.push({
      name: "内容区强调色边",
      x: emu(textX - 24), y: emu(214), cx: emu(7), cy: emu(190),
      fill: layout.accentColor, alpha: 100000, radius: true, zOrder: 3
    });
    let y = 192;
    const total = blocks.reduce((sum, b) => sum + b.body.length + (b.heading ? 72 : 0), 0) || 1;
    blocks.forEach((b, i) => {
      const h = 620 * (b.body.length + (b.heading ? 72 : 0)) / total;
      addBlock(b, { x: textX, y, w: 664, h: Math.max(h - 22, 112) }, i, 17, { minFontSize: 15, lineHeight: 1.3, panel: false });
      y += h;
      if (i < blocks.length - 1) addRule(textX, y - 11, 610);
    });
  } else if (layout.composition === "steps") {
    const h = 660 / blocks.length;
    blocks.forEach((b, i) => {
      const y = 170 + h * i;
      plan.textShapes.push(textShape(`步骤序号${i + 1}`, String(i + 1).padStart(2, "0"), { x: 70, y: y + 10, w: 80, h: 65 }, 30, layout.accentColor, true, { minFontSize: 30 }));
      addBlock(b, { x: 180, y: y + 8, w: 750, h: h - 25 }, i);
      addScene({ x: 1010, y: y + 4, w: 510, h: h - 25 }, b.scene);
      if (i < blocks.length - 1) addRule(80, y + h - 8, 1440);
    });
  } else if (layout.composition === "comparison" || layout.composition === "scene-top") {
    const topScene = layout.composition === "scene-top";
    const bodyMax = Math.max(...blocks.map(b => b.body.length));
    const sceneH = bodyMax > 110 ? 265 : 335;
    if (topScene) addScene({ x: 80, y: 170, w: 1440, h: sceneH }, blocks.map(b => b.scene).join("\n"));
    blocks.forEach((b, i) => {
      const w = (1440 - (blocks.length - 1) * 60) / blocks.length;
      const x = 80 + i * (w + 60);
      if (!topScene) addScene({ x, y: 170, w, h: sceneH }, b.scene);
      addBlock(b, { x, y: 200 + sceneH, w, h: 625 - sceneH }, i);
    });
  } else if (blocks.length === 3) {
    // Defensive fallback for externally supplied plans that bypassed layout
    // normalization: keep a single complete scene and continuous text field.
    addScene({ x: 850, y: 180, w: 690, h: 640 }, blocks.map(block => block.scene).join("\n"));
    plan.filledShapes.push({ name: "内容统一固定文字面板", x: emu(56), y: emu(174), cx: emu(728), cy: emu(650), fill: "FFFCF3", alpha: 94000, radius: true, zOrder: 2 });
    let y = 192;
    const total = blocks.reduce((sum, block) => sum + block.body.length + (block.heading ? 72 : 0), 0) || 1;
    blocks.forEach((block, i) => {
      const h = 620 * (block.body.length + (block.heading ? 72 : 0)) / total;
      addBlock(block, { x: 80, y, w: 664, h: Math.max(h - 22, 112) }, i, 17, { minFontSize: 15, lineHeight: 1.3, panel: false });
      y += h;
      if (i < blocks.length - 1) addRule(80, y - 11, 610);
    });
  } else {
    const rows = Math.ceil(blocks.length / 2);
    const h = 650 / rows;
    blocks.forEach((b, i) => {
      const x = 70 + (i % 2) * 770;
      const y = 175 + Math.floor(i / 2) * h;
      // Four-module fallback uses the compact type scale and generous inner
      // gutter seen in the reference deck. Text never reaches the image seam.
      addBlock(b, { x, y: y + 5, w: 310, h: h - 30 }, i, 15, { minFontSize: 14, lineHeight: 1.2 });
      addScene({ x: x + 350, y, w: 370, h: h - 30 }, b.scene);
    });
  }
  plan.textShapes.push(textShape("页码", String(pageNumber), { x: 1460, y: 857, w: 65, h: 28 }, 12, "73806E", false, { minFontSize: 12 }));
  return validateIllustratedPlan(plan);
}

export function compileIllustratedLayout(layout, options) {
  try { return { layout, slidePlan: buildIllustratedSlidePlan(layout, options) }; }
  catch (error) {
    // Repair a too-dense arrangement without discarding any source text.
    const repaired = { ...layout, composition: "scene-right", template: "scene-right",
      blocks: [{ heading: "", body: layout.blocks.map(b => b.body).join("\n"), scene: layout.blocks.map(b => b.scene).join("\n") }],
      repairNote: "已调整为宽文字区以完整保留正文" };
    return { layout: repaired, slidePlan: buildIllustratedSlidePlan(repaired, options) };
  }
}

export function buildIllustratedBackgroundPrompt(layout, plan) {
  const rect = r => `左${(r.x / 16).toFixed(1)}%、上${(r.y / 9).toFixed(1)}%、宽${(r.w / 16).toFixed(1)}%、高${(r.h / 9).toFixed(1)}%`;
  const fullBleedDirections = plan.sceneRegions.map((region, index) => {
    const side = region.x + region.w <= 800 ? "左侧" : region.x >= 800 ? "右侧" : "中央";
    return `${index + 1}. ${side}插画区的四条边和四个角都必须由教室、墙面、窗景、地面、植物或其他环境画面连续覆盖，不能露出白色画布或浅色空条。`;
  }).join("\n");
  const sceneDirection = plan.sceneRegions.length === 1
    ? "本页只绘制一个连贯完整的主场景，禁止拆成漫画分镜、九宫格、拼贴画或多个小画面。主场景要有清楚的空间关系、一个视觉焦点和完整人物。人物与主体保留安全距离，但环境必须延展并铺满插画区。\n"
    : "多个场景必须沿阅读顺序清晰区分，但保持同一空间、光线和人物造型语言。\n";
  return `教学绘本课件整页插画构图，16:9。主题：${layout.title}\n统一风格：${layout.visualStyle}\n` +
    `以下是已经确定的版面，坐标从画布左上角起，以宽高百分比计。不是概念草图，请输出完成度高的正式课件插画底图。\n` +
    `硬性版式规则：参考优秀儿童教学绘本课件，把校园、树木、草地、教室、纸张或木牌自然延伸为整页环境。可以用柔和水彩纸面、浅色内容底纹和手绘边缘承接文字留白，但禁止现代UI卡片、按钮、标签页、表格、虚线占位框和规则化后台面板。程序会另行绘制全部文字。\n` +
    sceneDirection +
    `插画区域（人物、动作、道具必须围绕内容；场景只在这些区域内出现；人物、脸部和关键动作与四边至少保留8%的安全距离，这个安全距离只约束人物，不代表留白；教室、墙面、窗景、地面、植物和光影必须一直延伸到区域四边并完全铺满；禁止白色竖边、白色横边、白色外框、相框、纸张底、留白条、画中画和圆角卡片）：\n` +
    plan.sceneRegions.map((r, i) => `${i + 1}. ${rect(r)}；${r.scene}`).join("\n") +
    `\n插画满框检查：\n${fullBleedDirections}\n生成完成前必须检查插画区四边；只要出现连续白边或空白带，就继续用相邻环境补画直至完全覆盖，不能把带白边的版本作为最终结果。` +
    `\n文字保留区域（这些区域连同四周2%的缓冲必须保持干净、浅暖色和高可读性；允许非常淡的纸张纹理及区域边缘的少量花草装饰，但禁止人物、主体物品、深色纹理和框线进入）：\n` +
    plan.textShapes.map(s => `${s.name}：${rect({ x: s.x / EMU_PER_PX, y: s.y / EMU_PER_PX, w: s.cx / EMU_PER_PX, h: s.cy / EMU_PER_PX })}`).join("\n") +
    `\n整页画面应像一本完成度高的儿童教学绘本：有一个明确主视觉，其他场景沿阅读顺序展开；画面在各区域之间连续衔接，边缘可有树叶、花草、校园或教室细节，不留大面积无意义空白。禁止任何文字、字母、数字、伪文字、Logo、水印、坐标线和版式标记。不要把上述规划说明画到图上。`;
}
