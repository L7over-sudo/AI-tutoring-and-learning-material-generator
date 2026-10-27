import path from "node:path";
import sharp from "sharp";
import { logService } from "./logService.js";

// Only skip near-white pages. Keep sparse text, page numbers, tables and pictures;
// do not rely on a PDF text layer, which scanned documents may not have.
export async function isBlankPageImage(input) {
  const { data, info } = await sharp(input)
    .flatten({ background: "#ffffff" })
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .toColourspace("srgb")
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let inkPixels = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    if (Math.min(data[offset], data[offset + 1], data[offset + 2]) < 250) {
      // Tolerate only a handful of noise pixels, never a percentage of the page.
      if (++inkPixels > 8) return false;
    }
  }
  return true;
}

export async function filterBlankPages({ jobDir, pages }) {
  const keptPages = [];
  const skippedBlankPages = [];
  for (const [index, page] of pages.entries()) {
    try {
      if (await isBlankPageImage(path.join(jobDir, page))) {
        skippedBlankPages.push(index + 1);
        continue;
      }
    } catch (error) {
      // If detection fails, keep the page so content is never silently lost.
      logService.warn("convert", `第 ${index + 1} 页空白检测失败，已保留：${error.message}`);
    }
    keptPages.push(page);
  }
  return { pages: keptPages, skippedBlankPages };
}
