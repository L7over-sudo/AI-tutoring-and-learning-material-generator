// P1 模板库：定义教育场景 PPT 版式模板，每套把文档内容（title/body）分配到预设坐标的图层槽位。
// 输出符合 P0 slidePlan schema 的结构（background + pictures + textShapes + filledShapes）。
// 所有坐标用 EMU（画布 12192000×6858000，即 16:9）。

const CANVAS_W = 12192000;
const CANVAS_H = 6858000;
const MARGIN_X = 804672;   // 左右边距 ~0.84 inch
const MARGIN_Y = 548640;   // 上下边距
const CONTENT_W = CANVAS_W - MARGIN_X * 2;
const TEXT_MARGIN = 140000; // 文本框内边距 ~0.146 inch / 14px，避免文字贴边
// 文本框默认垂直居中（anchor:"mid"），短文字不贴顶、长文字不贴底；页码文本框单独保持顶对齐贴角。

// 字号自适应：根据文字长度选合适字号（PT，转 OOXML 时 ×100）
function titleFontSize(text) {
  const len = String(text || "").length;
  if (len > 42) return 26;
  if (len > 26) return 30;
  return 34;
}
function bodyFontSize(text) {
  const len = String(text || "").length;
  if (len > 1100) return 13;
  if (len > 800) return 15;
  if (len > 520) return 17;
  if (len > 280) return 19;
  if (len > 120) return 20;
  return 22;
}

// 把正文按行切成 N 个要点（用于卡片/分栏）
function splitPoints(body, count) {
  const lines = String(body || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return Array.from({ length: count }, () => "");
  if (lines.length >= count) {
    // 合并多余行到最后一栏
    const result = lines.slice(0, count - 1);
    result.push(lines.slice(count - 1).join("\n"));
    return result;
  }
  // 行数不足，按长度均分
  const text = lines.join("\n");
  const chunkLen = Math.ceil(text.length / count);
  return Array.from({ length: count }, (_, i) => text.slice(i * chunkLen, (i + 1) * chunkLen).trim());
}

// ============ 模板 1：封面页 ============
function coverSlidePlan({ title, body, bgMediaKey, pageNumber }) {
  const titleSize = titleFontSize(title);
  return {
    background: { mediaKey: bgMediaKey, x: 0, y: 0, cx: CANVAS_W, cy: CANVAS_H, name: "v000" },
    filledShapes: [
      // 半透明白色衬底，让标题可读
      { x: MARGIN_X, y: 2400000, cx: CONTENT_W, cy: 1800000, fill: "FFFFFF", alpha: 80000, radius: true, name: "面板" }
    ],
    textShapes: [
      { x: MARGIN_X + 200000, y: 2700000, cx: CONTENT_W - 400000, cy: 900000, text: title, fontSize: titleSize + 6, color: "1F2937", bold: true, align: "ctr", anchor: "mid", margin: TEXT_MARGIN, name: "t000" },
      { x: MARGIN_X + 200000, y: 3700000, cx: CONTENT_W - 400000, cy: 600000, text: String(body || "").split("\n")[0] || "", fontSize: 20, color: "6B7280", align: "ctr", anchor: "mid", margin: TEXT_MARGIN, name: "t001" }
    ]
  };
}

// ============ 模板 2：图文左右页（左图右文） ============
function imageLeftSlidePlan({ title, body, bgMediaKey, pageNumber }) {
  const titleSize = titleFontSize(title);
  const bodySize = bodyFontSize(body);
  const leftPanelW = 4200000;
  return {
    background: { mediaKey: bgMediaKey, x: 0, y: 0, cx: CANVAS_W, cy: CANVAS_H, name: "v000" },
    filledShapes: [
      // 左侧白色卡片放图（图由 AI 背景提供，这里只放半透明衬底）
      { x: MARGIN_X, y: MARGIN_Y, cx: leftPanelW, cy: CANVAS_H - MARGIN_Y * 2, fill: "FFFFFF", alpha: 90000, radius: true, name: "左卡片" },
      // 右侧文字区衬底
      { x: MARGIN_X + leftPanelW + 200000, y: MARGIN_Y, cx: CONTENT_W - leftPanelW - 200000, cy: CANVAS_H - MARGIN_Y * 2, fill: "FFFFFF", alpha: 85000, radius: true, name: "右面板" }
    ],
    textShapes: [
      { x: MARGIN_X + leftPanelW + 400000, y: MARGIN_Y + 200000, cx: CONTENT_W - leftPanelW - 600000, cy: 900000, text: title, fontSize: titleSize, color: "1F2937", bold: true, anchor: "mid", margin: TEXT_MARGIN, name: "t000" },
      { x: MARGIN_X + leftPanelW + 400000, y: MARGIN_Y + 1300000, cx: CONTENT_W - leftPanelW - 600000, cy: CANVAS_H - MARGIN_Y * 2 - 1400000, text: body, fontSize: bodySize, color: "374151", anchor: "mid", margin: TEXT_MARGIN, name: "t001" },
      { x: CANVAS_W - MARGIN_X - 600000, y: CANVAS_H - 500000, cx: 500000, cy: 300000, text: String(pageNumber || ""), fontSize: 12, color: "9CA3AF", align: "r", anchor: "t", margin: 0, name: "t002" }
    ]
  };
}

// ============ 模板 3：三栏卡片页（支持 2–4 张自适应） ============
function threeColumnSlidePlan({ title, body, bgMediaKey, pageNumber, cardCount }) {
  const titleSize = titleFontSize(title);
  // 卡片张数由调用方按实际要点数传入（夹在 2–4，默认 3），不再写死 3 张导致第 4 点丢失
  const nonEmptyLines = String(body || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const n = Math.min(4, Math.max(2, cardCount || nonEmptyLines.length || 3));
  const points = splitPoints(body, n);
  const gap = 360000;
  const cardW = Math.floor((CONTENT_W - gap * (n - 1)) / n);
  const cardY = 1700000;
  const cardH = 4200000;
  const bodySize = 18;
  const filledShapes = [];
  const textShapes = [];
  // 标题
  textShapes.push({ x: MARGIN_X, y: MARGIN_Y, cx: CONTENT_W, cy: 800000, text: title, fontSize: titleSize, color: "1F2937", bold: true, anchor: "mid", margin: TEXT_MARGIN, name: "t000" });
  // n 张卡片（2–4）
  const colors = ["FF4F93", "60A5FA", "2ECC71", "F59E0B"];
  for (let i = 0; i < n; i += 1) {
    const cardX = MARGIN_X + i * (cardW + gap);
    filledShapes.push({ x: cardX, y: cardY, cx: cardW, cy: cardH, fill: "FFFFFF", alpha: 90000, radius: true, line: "E7E9EE", name: `卡片${i + 1}` });
    // 卡片顶部色条
    filledShapes.push({ x: cardX + 200000, y: cardY + 200000, cx: cardW - 400000, cy: 80000, fill: colors[i], radius: true, name: `色条${i + 1}` });
    textShapes.push({ x: cardX + 200000, y: cardY + 400000, cx: cardW - 400000, cy: cardH - 600000, text: points[i], fontSize: bodySize, color: "374151", anchor: "mid", margin: TEXT_MARGIN, name: `t${i + 1}` });
  }
  // 页码
  textShapes.push({ x: CANVAS_W - MARGIN_X - 600000, y: CANVAS_H - 500000, cx: 500000, cy: 300000, text: String(pageNumber || ""), fontSize: 12, color: "9CA3AF", align: "r", anchor: "t", margin: 0, name: "t9" });
  return {
    background: { mediaKey: bgMediaKey, x: 0, y: 0, cx: CANVAS_W, cy: CANVAS_H, name: "v000" },
    filledShapes,
    textShapes
  };
}

// ============ 模板 4：纯文字章节页（标题居中大字） ============
function sectionSlidePlan({ title, body, bgMediaKey, pageNumber }) {
  const titleSize = title.length > 20 ? 36 : 44;
  return {
    background: { mediaKey: bgMediaKey, x: 0, y: 0, cx: CANVAS_W, cy: CANVAS_H, name: "v000" },
    filledShapes: [
      // 顶部色条装饰
      { x: CANVAS_W / 2 - 600000, y: 2600000, cx: 1200000, cy: 100000, fill: "FF4F93", radius: true, name: "色条" }
    ],
    textShapes: [
      { x: MARGIN_X, y: 2800000, cx: CONTENT_W, cy: 1200000, text: title, fontSize: titleSize, color: "1F2937", bold: true, align: "ctr", anchor: "mid", margin: TEXT_MARGIN, name: "t000" },
      { x: MARGIN_X + 1000000, y: 4100000, cx: CONTENT_W - 2000000, cy: 800000, text: String(body || "").split("\n")[0] || "", fontSize: 20, color: "6B7280", align: "ctr", anchor: "mid", margin: TEXT_MARGIN, name: "t001" },
      { x: CANVAS_W - MARGIN_X - 600000, y: CANVAS_H - 500000, cx: 500000, cy: 300000, text: String(pageNumber || ""), fontSize: 12, color: "9CA3AF", align: "r", anchor: "t", margin: 0, name: "t002" }
    ]
  };
}

// ============ 模板注册表 ============
export const TEMPLATES = {
  cover: { name: "封面页", build: coverSlidePlan },
  imageLeft: { name: "图文左右", build: imageLeftSlidePlan },
  threeColumn: { name: "三栏卡片", build: threeColumnSlidePlan },
  section: { name: "章节页", build: sectionSlidePlan }
};

// 按页内容结构选模板（与页码无关）：只有正文几乎为空、只是一句主题/副标题时才选 cover。
export function pickTemplate(index, pageCount, pageContent) {
  const body = String(pageContent?.body || "");
  const lines = body.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  // 真正的封面：第1页且正文极短（≤30字）且没有多行要点
  const isLikelyCover = index === 0 && body.length <= 30 && lines.length <= 1;
  if (isLikelyCover) return "cover";
  // 有 3 行以上要点 → 三栏卡片；极短/章节标题 → 章节页；其余 → 图文左右
  if (lines.length >= 3) return "threeColumn";
  if (body.length <= 20) return "section";
  return "imageLeft";
}

// 给一页内容生成 slidePlan（统一入口）
export function buildSlidePlanForPage(templateKey, pageContent, { bgMediaKey, pageNumber, cardCount } = {}) {
  const tpl = TEMPLATES[templateKey] || TEMPLATES.imageLeft;
  return tpl.build({ ...pageContent, bgMediaKey, pageNumber, cardCount });
}

// P2：根据 LLM 规划结果生成 slidePlan（支持多色标题 runs + 小素材图层）
export function buildSlidePlanFromLayout(layout, { bgMediaKey, pageNumber, assetMediaKeys = [] } = {}) {
  const templateKey = TEMPLATES[layout.template] ? layout.template : "imageLeft";
  // 用 layout 的文字数据构造 pageContent；threeColumn 保留实际要点数 cardCount，避免丢第 4 点
  const points = Array.isArray(layout.points) ? layout.points : [];
  const pageContent = {
    title: layout.title || "",
    body: layout.template === "threeColumn" ? points.join("\n") : layout.body || "",
    cardCount: layout.template === "threeColumn" ? points.length || 3 : undefined
  };
  const basePlan = buildSlidePlanForPage(templateKey, pageContent, { bgMediaKey, pageNumber, cardCount: pageContent.cardCount });

  // 多色标题 runs：替换第一个文本框（标题框）为带 runs 的版本
  if (Array.isArray(layout.runs) && layout.runs.length > 1) {
    const titleShape = basePlan.textShapes.find((s) => s.name === "t000");
    if (titleShape) {
      titleShape.runs = layout.runs.map((r) => ({ text: r.text, color: r.color, bold: true, fontSize: titleFontSize(layout.title) }));
      delete titleShape.text;
    }
  }
  // 标题单色（用 layout 的 titleColor 覆盖默认色）
  if (layout.titleColor && layout.titleColor !== "1F2937") {
    const titleShape = basePlan.textShapes.find((s) => s.name === "t000");
    if (titleShape && !titleShape.runs) titleShape.color = layout.titleColor;
  }

  // 小素材图层：在版面右上角/角落摆放（简单固定位置，避免坐标翻车）
  const assetPositions = [
    { x: 10500000, y: 400000, cx: 800000, cy: 800000 },   // 右上
    { x: 900000, y: 5700000, cx: 700000, cy: 700000 },     // 左下
    { x: 10800000, y: 5700000, cx: 700000, cy: 700000 }    // 右下
  ];
  if (Array.isArray(layout.assets) && layout.assets.length > 0) {
    basePlan.pictures = basePlan.pictures || [];
    layout.assets.slice(0, 3).forEach((asset, i) => {
      const pos = assetPositions[i % assetPositions.length];
      const mediaKey = assetMediaKeys[i];
      if (mediaKey) {
        basePlan.pictures.push({ mediaKey, x: pos.x, y: pos.y, cx: pos.cx, cy: pos.cy, name: `asset-${i}`, zOrder: 4 });
      }
    });
  }
  return basePlan;
}
