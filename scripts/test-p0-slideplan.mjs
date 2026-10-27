// P0 验证脚本：构造多图层 slidePlan，生成 pptx，验证结构
import sharp from "sharp";
import { convertImagesToPpt } from "../server/src/services/convertService.js";
import fs from "node:fs/promises";
import path from "node:path";

const outDir = path.resolve(".tmp-pptx-p0-test");
await fs.mkdir(outDir, { recursive: true });

// 造两张测试图：一张大背景图（16:9），一张小素材图
const bgBuffer = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: { r: 252, g: 248, b: 236 } } })
  .composite([{ input: Buffer.from(`<svg width="1920" height="1080"><circle cx="1600" cy="200" r="120" fill="#FFB84D" opacity="0.5"/><rect x="100" y="900" width="1720" height="6" fill="#FF4F93" opacity="0.4"/></svg>`), top: 0, left: 0 }])
  .png().toBuffer();
const iconBuffer = await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 255, g: 79, b: 147, alpha: 1 } } })
  .composite([{ input: Buffer.from(`<svg width="200" height="200"><text x="100" y="120" font-size="80" text-anchor="middle" fill="white">★</text></svg>`), top: 0, left: 0 }])
  .png().toBuffer();

// 一个多图层 slidePlan：背景图 + 1 个装饰形状 + 1 个小图标 + 3 个多色文本框
const slidePlan = {
  background: { mediaKey: "bg", x: 0, y: 0, cx: 12192000, cy: 6858000, name: "v000" },
  pictures: [
    { mediaKey: "icon", x: 9144000, y: 457200, cx: 914400, cy: 914400, name: "v001" }
  ],
  filledShapes: [
    { x: 548640, y: 457200, cx: 11094720, cy: 5943600, fill: "FFFFFF", alpha: 85000, radius: true, line: "E7E9EE", name: "面板" }
  ],
  textShapes: [
    {
      x: 804672, y: 600000, cx: 10000000, cy: 1000000,
      // 多 run 多色：竞品"同段不同词不同色"的核心
      runs: [
        { text: "开学第一课：", color: "48611A", bold: true, fontSize: 40 },
        { text: "快乐启航", color: "D43E3E", bold: true, fontSize: 40 },
        { text: "，我是小学生啦！", color: "48611A", bold: true, fontSize: 40 }
      ],
      align: "l", name: "t000"
    },
    {
      x: 804672, y: 1800000, cx: 10500000, cy: 800000,
      text: "亲爱的小朋友们，欢迎来到美丽的校园！从今天起，你们就有了一个新的名字——小学生！",
      fontSize: 22, color: "374151", name: "t001"
    },
    {
      x: 10576512, y: 6172200, cx: 914400, cy: 365760,
      text: "1", fontSize: 14, color: "9CA3AF", align: "r", name: "t002"
    }
  ]
};

const mediaMap = { bg: bgBuffer, icon: iconBuffer };

console.log("开始生成多图层 PPTX...");
const result = await convertImagesToPpt([], {
  slidePlans: [slidePlan],
  mediaMap,
  pptName: "p0-多图层测试",
  outputFolder: outDir
});
console.log("生成结果:", result);

// 验证：解压检查结构
const pptxPath = path.join(outDir, result.fileName);
console.log("\n=== 解压验证 ===");
const { execFileSync } = await import("node:child_process");
const inspectDir = path.join(outDir, "inspect");
await fs.rm(inspectDir, { recursive: true, force: true }).catch(() => {});
await fs.mkdir(inspectDir, { recursive: true });
execFileSync("unzip", ["-o", pptxPath, "-d", inspectDir], { stdio: "pipe" });

const slide1 = await fs.readFile(path.join(inspectDir, "ppt/slides/slide1.xml"), "utf8");
const picCount = (slide1.match(/<p:pic>/g) || []).length;
const spCount = (slide1.match(/<p:sp>/g) || []).length;
const runCount = (slide1.match(/<a:r>/g) || []).length;
const mediaFiles = await fs.readdir(path.join(inspectDir, "ppt/media"));

console.log(`slide1: ${picCount} 个图片层, ${spCount} 个形状/文本框层, ${runCount} 个文字 run`);
console.log(`media 目录: ${mediaFiles.length} 个文件 (${mediaFiles.join(", ")})`);
console.log(`contentTypes 检查: ${slide1.includes("r:embed") ? "图片关系正确" : "缺图片关系"}`);
console.log(`多色 run 检查: ${slide1.includes('val="D43E3E"') && slide1.includes('val="48611A"') ? "多色 run 正确" : "缺多色"}`);

// 检查 rels
const rels = await fs.readFile(path.join(inspectDir, "ppt/slides/_rels/slide1.xml.rels"), "utf8");
const imageRels = (rels.match(/\/image\//g) || []).length;
console.log(`slide1 rels: ${imageRels} 个图片 relationship`);

console.log(`\n✅ PPTX 路径: ${pptxPath}`);
console.log("请在 PowerPoint 或 WPS 打开，确认：背景图+图标+面板+3文本框能独立选中编辑，标题三段不同颜色");
