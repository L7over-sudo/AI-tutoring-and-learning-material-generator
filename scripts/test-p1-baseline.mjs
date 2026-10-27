// P1 基线验证：确认 P0 改动后，老的"一页一图"路径仍正常工作
import sharp from "sharp";
import { convertImagesToPpt } from "../server/src/services/convertService.js";
import fs from "node:fs/promises";
import path from "node:path";

const outDir = path.resolve(".tmp-pptx-p1-baseline");
await fs.mkdir(outDir, { recursive: true });

// 造一张测试图，走老路径（不传 slidePlans）
const imgBuffer = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: { r: 100, g: 150, b: 200 } } }).png().toBuffer();
const files = [{ originalname: "test.png", buffer: imgBuffer }];

console.log("跑老路径（一页一图，不传 slidePlans）...");
const result = await convertImagesToPpt(files, { pptName: "p1-基线-老路径", outputFolder: outDir });
console.log("老路径结果:", { fileName: result.fileName, slideCount: result.slideCount });

// 解压验证
const { execFileSync } = await import("node:child_process");
const inspectDir = path.join(outDir, "inspect");
await fs.rm(inspectDir, { recursive: true, force: true }).catch(() => {});
await fs.mkdir(inspectDir, { recursive: true });
execFileSync("unzip", ["-o", path.join(outDir, result.fileName), "-d", inspectDir], { stdio: "pipe" });
const slide1 = await fs.readFile(path.join(inspectDir, "ppt/slides/slide1.xml"), "utf8");
const picCount = (slide1.match(/<p:pic>/g) || []).length;
const mediaFiles = await fs.readdir(path.join(inspectDir, "ppt/media"));
console.log(`老路径 slide1: ${picCount} 个图片层（应为1）, media: ${mediaFiles.length} 个文件（应为1）`);
console.log(picCount === 1 && mediaFiles.length === 1 ? "✅ 老路径未退化，P0 改动安全" : "❌ 老路径异常");
