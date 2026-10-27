// P1 端到端链路验证：模拟文档 → buildSlidePlans → task → 导出，确认 slidePlan 串联正确
// 不调真实生图 API（用假背景图模拟），只验证数据流和导出拼装
import sharp from "sharp";
import { convertImagesToPpt } from "../server/src/services/convertService.js";
import { buildSlidePlanForPage, pickTemplate } from "../server/src/services/templateRegistry.js";
import fs from "node:fs/promises";
import path from "node:path";

const outDir = path.resolve(".tmp-pptx-p1-e2e");
await fs.mkdir(outDir, { recursive: true });

// 模拟文档提取出的 4 页内容（模拟 presentationService 的 buildEditableSlideContent 输出）
const title = "开学第一课";
const pages = [
  { title: "开学第一课：快乐启航", body: "亲爱的小朋友们，欢迎来到美丽的校园！" },
  { title: "认识三件宝贝", body: "安全\n礼貌\n勤奋\n这三件宝贝会伴随我们整个小学生活，每天都要记得它们哦。" },
  { title: "课堂小约定", body: "小眼睛看老师，小耳朵听讲课，小腰板挺直啦，发言先举手。" },
  { title: "第二章 校园安全", body: "校园安全知多少" }
];

// 模拟 buildSlidePlans 逻辑（跟 presentationService 里一致）
const plans = pages.map((pageContent, index) => {
  const templateKey = pickTemplate(index, pages.length, pageContent);
  const slidePlan = buildSlidePlanForPage(templateKey, pageContent, { bgMediaKey: `bg-${index}`, pageNumber: index + 1 });
  return { templateKey, slidePlan, pageContent };
});

// 模拟导出：每页用假背景图（实际是 AI 生成的纯背景，这里用 sharp 造不同色调的图模拟）
const slidePlans = [];
const mediaMap = {};
for (const [index, plan] of plans.entries()) {
  const hues = [[252, 248, 236], [255, 245, 230], [240, 248, 255], [255, 240, 245]];
  const [r, g, b] = hues[index % hues.length];
  const bgBuffer = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: { r, g, b } } })
    .composite([{ input: Buffer.from(`<svg width="1920" height="1080"><circle cx="${1600 + index * 30}" cy="200" r="${80 + index * 10}" fill="#FFB84D" opacity="0.4"/></svg>`), top: 0, left: 0 }])
    .png().toBuffer();
  mediaMap[`bg-${index}`] = bgBuffer;
  // 对齐 mediaKey（跟 exportPresentationBatch 一致）
  plan.slidePlan.background.mediaKey = `bg-${index}`;
  slidePlans.push(plan.slidePlan);
  console.log(`第${index + 1}页: 模板=${plan.templateKey}, 标题="${plan.pageContent.title}"`);
}

console.log("\n模拟导出多图层 PPTX...");
const result = await convertImagesToPpt([], { slidePlans, mediaMap, pptName: "p1-端到端测试", outputFolder: outDir });
console.log("导出结果:", { fileName: result.fileName, slideCount: result.slideCount });

// 验证每页文字确实进了文本框（不是图片）
const { execFileSync } = await import("node:child_process");
const inspectDir = path.join(outDir, "inspect");
await fs.rm(inspectDir, { recursive: true, force: true }).catch(() => {});
await fs.mkdir(inspectDir, { recursive: true });
execFileSync("unzip", ["-o", path.join(outDir, result.fileName), "-d", inspectDir], { stdio: "pipe" });

for (let i = 1; i <= pages.length; i += 1) {
  const slide = await fs.readFile(path.join(inspectDir, `ppt/slides/slide${i}.xml`), "utf8");
  const hasTitle = slide.includes(pages[i - 1].title.split("：")[0]) || slide.includes(pages[i - 1].title.slice(0, 6));
  const hasText = slide.includes("<a:t>") && slide.includes("</a:t>");
  console.log(`slide${i}: ${hasText ? "有真文本框✓" : "无文本框✗"} ${hasTitle ? "标题在文本框✓" : "标题未匹配"}`);
}
const mediaFiles = await fs.readdir(path.join(inspectDir, "ppt/media"));
console.log(`\nmedia: ${mediaFiles.length} 个文件（4 页各 1 张背景，应为 4）`);

console.log(`\n✅ 端到端 PPTX: ${path.join(outDir, result.fileName)}`);
console.log("这模拟了从文档到多图层可编辑 PPT 的完整数据流（背景用假图，真实运行时是 AI 出的纯背景）");
