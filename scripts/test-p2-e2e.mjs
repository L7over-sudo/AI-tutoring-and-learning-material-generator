// P2 端到端验证：模拟 LLM 规划结果，验证多色标题+小素材图层能正确拼进 PPTX
import sharp from "sharp";
import { convertImagesToPpt } from "../server/src/services/convertService.js";
import { buildSlidePlanFromLayout } from "../server/src/services/templateRegistry.js";
import fs from "node:fs/promises";
import path from "node:path";

const outDir = path.resolve(".tmp-pptx-p2-e2e");
await fs.mkdir(outDir, { recursive: true });

// 模拟 DeepSeek 返回的 LLM 规划结果（3 页，含多色标题和小素材）
const layouts = [
  {
    template: "cover",
    title: "开学第一课：快乐启航",
    subtitle: "欢迎新同学",
    body: "",
    points: [],
    titleColor: "1F2937",
    // 多色标题：竞品那种"开学第一课："绿 + "快乐启航"红
    runs: [
      { text: "开学第一课：", color: "48611A" },
      { text: "快乐启航", color: "D43E3E" }
    ],
    assets: [{ name: "星星", prompt: "一颗黄色五角星图标，白底，扁平风格" }]
  },
  {
    template: "threeColumn",
    title: "认识三件宝贝",
    subtitle: "",
    body: "",
    points: ["安全：保护我们不受伤害", "礼貌：做个有礼貌的好孩子", "勤奋：好好学习天天向上"],
    titleColor: "1F2937",
    runs: [],
    assets: [
      { name: "安全帽", prompt: "一个橙色安全帽图标，白底" },
      { name: "笑脸", prompt: "一个笑脸表情图标，白底" },
      { name: "书本", prompt: "一本打开的书本图标，白底" }
    ]
  },
  {
    template: "imageLeft",
    title: "课堂小约定",
    subtitle: "",
    body: "小眼睛看老师，小耳朵听讲课，小腰板挺直啦，发言先举手。这些好习惯会让我们学习更高效。",
    points: [],
    titleColor: "1F2937",
    runs: [],
    assets: [{ name: "铅笔", prompt: "一支铅笔图标，白底，手绘风格" }]
  }
];

// 造背景图 + 小素材图（模拟 AI 输出）
const bgColors = [[252, 248, 236], [255, 245, 230], [240, 248, 255]];
const assetColors = [[255, 200, 50], [255, 120, 60], [100, 200, 100], [80, 150, 220], [200, 150, 80]];
let assetIdx = 0;
const slidePlans = [];
const mediaMap = {};
for (const [i, layout] of layouts.entries()) {
  const [r, g, b] = bgColors[i];
  const bg = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: { r, g, b } } })
    .composite([{ input: Buffer.from(`<svg width="1920" height="1080"><circle cx="1700" cy="${150 + i * 20}" r="${90 + i * 10}" fill="#FFB84D" opacity="0.4"/></svg>`), top: 0, left: 0 }]).png().toBuffer();
  mediaMap[`bg-${i}`] = bg;
  const assetMediaKeys = [];
  for (const asset of layout.assets) {
    const key = `asset-${i}-${assetIdx}`;
    assetMediaKeys.push(key);
    const [ar, ag, ab] = assetColors[assetIdx % assetColors.length];
    // 小素材用带白色底的方形图模拟
    mediaMap[key] = await sharp({ create: { width: 400, height: 400, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
      .composite([{ input: Buffer.from(`<svg width="400" height="400"><circle cx="200" cy="200" r="120" fill="rgb(${ar},${ag},${ab})"/></svg>`), top: 0, left: 0 }]).png().toBuffer();
    assetIdx += 1;
  }
  const plan = buildSlidePlanFromLayout(layout, { bgMediaKey: `bg-${i}`, pageNumber: i + 1, assetMediaKeys });
  slidePlans.push(plan);
  console.log(`第${i + 1}页: 模板=${layout.template}, 素材数=${layout.assets.length}, 多色标题=${layout.runs.length > 0 ? "有" : "无"}`);
}

console.log("\n生成 P2 多图层 PPTX...");
const result = await convertImagesToPpt([], { slidePlans, mediaMap, pptName: "p2-完整版测试", outputFolder: outDir });
console.log("结果:", result.fileName, "页数:", result.slideCount);

// 解压验证
const { execFileSync } = await import("node:child_process");
const inspectDir = path.join(outDir, "inspect");
await fs.rm(inspectDir, { recursive: true, force: true }).catch(() => {});
await fs.mkdir(inspectDir, { recursive: true });
execFileSync("unzip", ["-o", path.join(outDir, result.fileName), "-d", inspectDir], { stdio: "pipe" });

for (let i = 1; i <= layouts.length; i += 1) {
  const slide = await fs.readFile(path.join(inspectDir, `ppt/slides/slide${i}.xml`), "utf8");
  const pic = (slide.match(/<p:pic>/g) || []).length;
  const sp = (slide.match(/<p:sp>/g) || []).length;
  const multiColor = slide.includes('val="D43E3E"') && slide.includes('val="48611A"');
  console.log(`slide${i}: ${pic} 图层(背景+素材), ${sp} 形状/文本框 ${i === 1 ? (multiColor ? "多色标题✓" : "无多色") : ""}`);
}
const mediaFiles = await fs.readdir(path.join(inspectDir, "ppt/media"));
console.log(`\nmedia: ${mediaFiles.length} 个文件（3背景+5小素材，应为8）`);

console.log(`\n✅ P2 完整版 PPTX: ${path.join(outDir, result.fileName)}`);
console.log("打开看：封面有彩色标题+星星，三栏卡片有3个素材图标，图文页有铅笔");
