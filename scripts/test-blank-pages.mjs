import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import JSZip from "jszip";

// Isolate fixtures and conversion output from the user's task data.
const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "teaching-blank-pages-"));
process.env.APP_DATA_DIR = testRoot;
const { isBlankPageImage, filterBlankPages } = await import("../server/src/services/blankPageService.js");
const { convertDocumentToImages, convertImagesToPdf } = await import("../server/src/services/convertService.js");
const { uploadsRoot } = await import("../server/src/paths.js");

async function page(markup = "", format = "png") {
  return sharp(Buffer.from(`<svg width="800" height="1100" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="1100" fill="white"/>${markup}</svg>`))
    .toFormat(format).toBuffer();
}

const blank = await page();
for (const format of ["png", "jpeg", "webp"]) {
  assert.equal(await isBlankPageImage(await page("", format)), true, `${format}: blank page`);
}
assert.equal(await isBlankPageImage(await sharp({ create: {
  width: 800, height: 1100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 }
} }).png().toBuffer()), true, "transparent background is blank");
assert.equal(await isBlankPageImage(await page('<rect x="10" y="10" width="1" height="1"/>')), true, "isolated noise is blank");

const title = await page('<text x="80" y="100" font-size="24">Study Guide</text>');
const footer = await page('<text x="400" y="1070" font-size="12">1</text>');
const table = await page('<path d="M80 300H720V700H80Z M80 500H720 M400 300V700" fill="none" stroke="#cccccc"/>');
const illustration = await page('<circle cx="400" cy="550" r="120" fill="#ffdddd"/>');
const faint = await page('<text x="80" y="100" font-size="24" fill="#f8f8f8">Faint text</text>');
for (const [name, buffer] of Object.entries({ title, footer, table, illustration, faint })) {
  assert.equal(await isBlankPageImage(buffer), false, `${name} must be kept`);
}
console.log("PASS: blank, transparency, noise, sparse text, page number, table, illustration, faint text");

await fs.writeFile(path.join(testRoot, "blank.png"), blank);
await fs.writeFile(path.join(testRoot, "title.png"), title);
const filtered = await filterBlankPages({ jobDir: testRoot, pages: ["blank.png", "title.png", "unreadable.png"] });
assert.deepEqual(filtered.pages, ["title.png", "unreadable.png"]);
assert.deepEqual(filtered.skippedBlankPages, [1]);
assert.ok(await fs.stat(path.join(testRoot, "blank.png")), "filtering does not delete source files");

// Use image-only PDF pages to prove that a missing text layer does not mean blank.
const pdf = await convertImagesToPdf([title, blank, illustration, footer].map((buffer, index) => ({
  originalname: `page-${index + 1}.png`, buffer
})), { resolution: "1k", preserveOrder: true, pdfName: "mixed-pages" });
const pdfBuffer = await fs.readFile(path.join(uploadsRoot, "converted", pdf.jobId, pdf.fileName));
const documentFile = { originalname: "mixed-pages.pdf", buffer: pdfBuffer };
const result = await convertDocumentToImages(documentFile, { skipBlankPages: "true", resolution: "1k", separateFolder: true });
assert.equal(result.totalPageCount, 4);
assert.deepEqual(result.skippedBlankPages, [2]);
assert.equal(result.skippedBlankPageCount, 1);
assert.deepEqual(result.pages.map((p) => p.index), [1, 3, 4], "original page numbers and order are preserved");
const outputDir = path.join(uploadsRoot, "converted", result.jobId);
assert.deepEqual(await fs.readFile(path.join(outputDir, result.originalFile.name)), pdfBuffer, "original document is unchanged");
const zip = await JSZip.loadAsync(await fs.readFile(path.join(outputDir, "converted-images.zip")));
assert.equal(Object.values(zip.files).filter((f) => !f.dir && f.name.endsWith(".png")).length, 3);
assert.ok(zip.file(`原文件/${documentFile.originalname}`), "ZIP retains original document");
console.log("PASS: image-only PDF filters blank page, preserves order, original file and ZIP contents");

const unfiltered = await convertDocumentToImages(documentFile, { resolution: "1k", skipBlankPages: "false" });
assert.equal(unfiltered.pages.length, 4, "ordinary format conversion keeps all pages");
assert.equal(unfiltered.skippedBlankPageCount, 0);
const emptyFile = { originalname: "empty.txt", buffer: Buffer.from(" \n\t ") };
const empty = await convertDocumentToImages(emptyFile, { resolution: "1k", skipBlankPages: true });
assert.equal(empty.totalPageCount, 1);
assert.equal(empty.pages.length, 0);
assert.equal(empty.skippedBlankPageCount, 1);
assert.ok(empty.originalFile.url);
console.log("PASS: opt-out and all-blank document; no generation API calls made");
console.log(`Test artifacts: ${testRoot}`);
