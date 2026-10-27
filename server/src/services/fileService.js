import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { runtimeRoot, uploadsRoot } from "../paths.js";
import { extensionFromMime } from "../utils/imageUtils.js";
import { sanitizeFileName } from "../utils/sanitizeFileName.js";

export const serverRoot = runtimeRoot;
export { uploadsRoot };

export async function ensureUploadDirs() {
  await Promise.all([
    fs.mkdir(path.join(uploadsRoot, "original"), { recursive: true }),
    fs.mkdir(path.join(uploadsRoot, "generated"), { recursive: true }),
    fs.mkdir(path.join(uploadsRoot, "enhanced"), { recursive: true }),
    fs.mkdir(path.join(uploadsRoot, "exports"), { recursive: true }),
    fs.mkdir(path.join(uploadsRoot, "converted"), { recursive: true }),
    fs.mkdir(path.join(uploadsRoot, "presentations"), { recursive: true })
  ]);
}

export async function saveOriginalFile(file, batchId) {
  await ensureUploadDirs();
  const dir = path.join(uploadsRoot, "original", batchId);
  await fs.mkdir(dir, { recursive: true });
  const cleanName = sanitizeFileName(file.originalname);
  const finalName = `${nanoid(6)}-${cleanName}`;
  const fullPath = path.join(dir, finalName);
  await fs.writeFile(fullPath, file.buffer);
  return {
    fileName: finalName,
    originalName: cleanName,
    relativePath: `uploads/original/${batchId}/${finalName}`,
    url: `/static/original/${batchId}/${encodeURIComponent(finalName)}`
  };
}

const RATIO_BASE_DIMENSIONS = {
  "1:1": [1024, 1024],
  "3:2": [1536, 1024],
  "2:3": [1024, 1536],
  "4:3": [1448, 1086],
  "3:4": [1086, 1448],
  "5:4": [1448, 1158],
  "4:5": [1158, 1448],
  "16:9": [1536, 864],
  "9:16": [864, 1536],
  "2:1": [1536, 768],
  "1:2": [768, 1536],
  "21:9": [1536, 658],
  "9:21": [658, 1536]
};

const QUALITY_LONG_EDGE = {
  "1k": null,
  "2k": 2048,
  "4k": 4096
};

function isOriginalSizeLabel(size) {
  return ["原尺寸", "原图尺寸"].includes(String(size || "").trim());
}

function parseTargetDimensions(size, quality = "1k") {
  const rawSize = String(size || "").trim();
  if (!rawSize || isOriginalSizeLabel(rawSize)) return null;

  const pixelMatch = rawSize.match(/^(\d+)x(\d+)$/i);
  if (pixelMatch) {
    return [Number(pixelMatch[1]), Number(pixelMatch[2])];
  }

  const base = RATIO_BASE_DIMENSIONS[rawSize];
  if (!base) return null;
  const longEdge = QUALITY_LONG_EDGE[String(quality || "1k").toLowerCase()];
  if (!longEdge) return base;

  const scale = longEdge / Math.max(...base);
  return base.map((value) => Math.round(value * scale));
}

async function normalizeGeneratedImage(buffer, { size, quality, mimeType }) {
  const dimensions = parseTargetDimensions(size, quality);
  if (!dimensions) return buffer;

  const image = sharp(buffer, { failOn: "none" });
  const meta = await image.metadata();
  if (meta.width === dimensions[0] && meta.height === dimensions[1]) return buffer;

  const resized = image.resize({
    width: dimensions[0],
    height: dimensions[1],
    fit: "contain",
    background: { r: 255, g: 255, b: 255, alpha: 1 }
  });

  if (mimeType.includes("webp")) return resized.webp().toBuffer();
  if (mimeType.includes("png")) return resized.png().toBuffer();
  return resized.jpeg({ quality: 95 }).toBuffer();
}

export async function saveGeneratedImage({ batchId, taskId, originalName, b64Json, mimeType = "image/jpeg", size, quality }) {
  await ensureUploadDirs();
  const dir = path.join(uploadsRoot, "generated", batchId);
  await fs.mkdir(dir, { recursive: true });
  const clean = sanitizeFileName(originalName);
  const base = path.parse(clean).name;
  const ext = extensionFromMime(mimeType);
  const fileName = `${base}-${String(taskId || nanoid(6)).slice(0, 6)}${ext}`;
  const fullPath = path.join(dir, fileName);
  const sourceBuffer = Buffer.from(b64Json, "base64");
  const outputBuffer = await normalizeGeneratedImage(sourceBuffer, { size, quality, mimeType });
  await fs.writeFile(fullPath, outputBuffer);
  return {
    fileName,
    fullPath,
    relativePath: `uploads/generated/${batchId}/${fileName}`,
    url: `/static/generated/${batchId}/${encodeURIComponent(fileName)}`
  };
}

export function ensureUniqueZipName(existingNames, fileName) {
  const parsed = path.parse(sanitizeFileName(fileName));
  let candidate = `${parsed.name}${parsed.ext}`;
  let index = 2;
  while (existingNames.has(candidate)) {
    candidate = `${parsed.name}-${index}${parsed.ext}`;
    index += 1;
  }
  existingNames.add(candidate);
  return candidate;
}

export function resolveUploadRelative(relativePath) {
  const stripped = String(relativePath || "").replace(/^uploads[\\/]/, "");
  const full = path.resolve(uploadsRoot, stripped);
  if (!full.startsWith(uploadsRoot)) throw new Error("非法文件路径");
  return full;
}
