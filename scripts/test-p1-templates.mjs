// P1 模板验证：用模板库生成 4 页多图层 PPTX，确认各模板版式正确
import sharp from "sharp";
import { convertImagesToPpt } from "../server/src/services/convertService.js";
import { buildSlidePlanForPage, pickTemplate } from "../server/src/services/templateRegistry.js";
import fs from "node:fs/promises";
import path from "node:path";

const outDir = path.resolve(".tmp-pptx-p1-templates");
await fs.mkdir(outDir, { recursive: true });

// 造一个统一风格的背景图（米色底 + 装饰圆）
const bgBuffer = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: { r: 252, g: 248, b: 236 } } })
  .composite([{ input: Buffer.from(`<svg width="1920" height="1080"><circle cx="1700" cy="150" r="100" fill="#FFB84D" opacity="0.4"/><circle cx="200" cy="950" r="140" fill="#FF4F93" opacity="0.3"/></svg>`), top: 0, left: 0 }])
  .png().toBuffer();

// 4 页内容
const pages = [
  { title: "开学第一课：快乐启航", body: "亲爱的小朋友们，欢迎来到美丽的校园！" },
  { title: "认识三件宝贝", body: "安全\n礼貌\n勤奋\n这三件宝贝会伴随我们整个小学生活，每天都要记得它们哦。" },
  { title: "课堂小约定", body: "小眼睛看老师，小耳朵听讲课，小腰板挺直啦。" },
  { title: "第二章", body: "校园安全知多少" }
];

const slidePlans = pages.map((pageContent, index) => {
  const tplKey = pickTemplate(index, pages.length, pageContent);
  console.log(`第${index + 1}页 → 模板: ${tplKey}`);
  return buildSlidePlanForPage(tplKey, pageContent, { bgMediaKey: "bg", pageNumber: index + 1 });
});

const mediaMap = { bg: bgBuffer };

console.log("\n生成 4 页模板 PPTX...");
const result = await convertImagesToPpt([], { slidePlans, mediaMap, pptName: "p1-模板测试", outputFolder: outDir });
console.log("结果:", result.fileName, "页数:", result.slideCount);

// 解压验证每页结构
const { execFileSync } = await import("node:child_process");
const inspectDir = path.join(outDir, "inspect");
await fs.rm(inspectDir, { recursive: true, force: true }).catch(() => {});
await fs.mkdir(inspectDir, { recursive: true });
execFileSync("unzip", ["-o", path.join(outDir, result.fileName), "-d", inspectDir], { stdio: "pipe" });

for (let i = 1; i <= 4; i += 1) {
  const slide = await fs.readFile(path.join(inspectDir, `ppt/slides/slide${i}.xml`), "utf8");
  const pic = (slide.match(/<p:pic>/g) || []).length;
  const sp = (slide.match(/<p:sp>/g) || []).length;
  console.log(`slide${i}: ${pic} 图层, ${sp} 形状/文本框`);
}
const mediaFiles = await fs.readdir(path.join(inspectDir, "ppt/media"));
console.log(`media: ${mediaFiles.length} 个文件（4页共享1张背景，应为1）`);

console.log(`\n✅ PPTX: ${path.join(outDir, result.fileName)}`);
console.log("打开看看 4 种版式：封面/三栏卡片/图文左右/章节页");
