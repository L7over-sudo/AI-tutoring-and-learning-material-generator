import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { uploadsRoot } from "./fileService.js";
import { sanitizeFileName } from "../utils/sanitizeFileName.js";

async function pickOverlay(folder) {
  if (!folder) return null;
  try {
    const files = await fs.readdir(folder);
    const pngs = files.filter((file) => file.toLowerCase().endsWith(".png"));
    if (!pngs.length) return null;
    return path.join(folder, pngs[Math.floor(Math.random() * pngs.length)]);
  } catch {
    return null;
  }
}

export async function enhanceImage({ inputPath, batchId, taskId, originalName, config = {} }) {
  const originality = config.originality || {};
  if (!originality.enabled) return null;

  const outDir = path.join(uploadsRoot, "enhanced", batchId);
  await fs.mkdir(outDir, { recursive: true });
  const clean = sanitizeFileName(originalName);
  const parsed = path.parse(clean);
  const fileName = `${parsed.name}-${String(taskId || Date.now()).slice(0, 6)}.jpg`;
  const outPath = path.join(outDir, fileName);

  let image = sharp(inputPath, { failOn: "none" }).rotate();
  const metadata = await image.metadata();

  const colorShift = Number(originality.colorShift || 0);
  if (colorShift > 0) {
    image = image.modulate({
      brightness: 1 + Math.min(colorShift, 8) / 100,
      saturation: 1 + Math.min(colorShift, 8) / 100,
      hue: Math.min(colorShift, 8)
    });
  }

  const spatial = Number(originality.spatialDistortion || 0);
  if (spatial > 0 && metadata.width && metadata.height) {
    const ratio = 1 + Math.min(spatial, 2) / 100;
    image = image.resize(Math.round(metadata.width * ratio), Math.round(metadata.height * ratio), { fit: "fill" });
  }

  const overlay = await pickOverlay(originality.overlayFolder);
  if (overlay && metadata.width && metadata.height) {
    const opacityMin = Number(originality.minOpacity || 1);
    const opacityMax = Number(originality.maxOpacity || 3);
    const opacity = (opacityMin + Math.random() * Math.max(opacityMax - opacityMin, 0)) / 100;
    const overlayBuffer = await sharp(overlay)
      .resize(metadata.width, metadata.height, { fit: "cover" })
      .ensureAlpha(opacity)
      .png()
      .toBuffer();
    image = image.composite([{ input: overlayBuffer, blend: "over" }]);
  }

  if (originality.cloneExif) {
    image = image.keepExif();
  }

  await image.jpeg({ quality: 96, mozjpeg: true }).toFile(outPath);
  return {
    fullPath: outPath,
    relativePath: `uploads/enhanced/${batchId}/${fileName}`,
    url: `/static/enhanced/${batchId}/${encodeURIComponent(fileName)}`
  };
}
