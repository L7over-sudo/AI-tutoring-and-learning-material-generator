import fs from "node:fs/promises";
import { createWriteStream, existsSync } from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import archiver from "archiver";
import sharp from "sharp";
import { nanoid } from "nanoid";
import { extractDocumentText } from "./documentService.js";
import { logService } from "./logService.js";
import { uploadsRoot } from "./fileService.js";
import { naturalSort } from "../utils/naturalSort.js";
import { sanitizeFileName } from "../utils/sanitizeFileName.js";
import { filterBlankPages } from "./blankPageService.js";

const execFileAsync = promisify(execFile);
const imageFormats = new Set(["png", "jpeg", "webp"]);
const imageExts = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const windowsComSpec = process.env.ComSpec || "cmd.exe";
const uploadFileCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
const resolutionPresets = {
  "1k": { dpi: 120, scale: 1 },
  "2k": { dpi: 180, scale: 2 },
  "4k": { dpi: 300, scale: 4 }
};
const maxPpt4kImageBytes = 5 * 1024 * 1024;

function uploadedFileSortKey(file) {
  return String(file?.originalname || file?.filename || "");
}

function sortUploadedFiles(files = []) {
  return [...files].sort((a, b) => uploadFileCollator.compare(uploadedFileSortKey(a), uploadedFileSortKey(b)));
}

function shouldPreserveUploadOrder(options = {}) {
  return options.preserveOrder === true || String(options.preserveOrder || "").toLowerCase() === "true";
}

function normalizeImageFormat(format = "png") {
  const clean = String(format || "png").toLowerCase();
  if (clean === "jpg") return "jpeg";
  return imageFormats.has(clean) ? clean : "png";
}

function imageExtension(format) {
  return format === "jpeg" ? "jpg" : format;
}

function normalizeQuality(value) {
  return Math.min(Math.max(Number(value) || 92, 60), 100);
}

function normalizeResolution(value) {
  const clean = String(value || "2k").toLowerCase();
  return resolutionPresets[clean] ? clean : "2k";
}

function normalizeDpi(options = {}) {
  if (options.resolution) return resolutionPresets[normalizeResolution(options.resolution)].dpi;
  return Math.min(Math.max(Number(options.dpi) || 180, 72), 300);
}

function toPublicUrl(jobId, relativeName) {
  return `/static/converted/${jobId}/${relativeName.split(/[\\/]/).map(encodeURIComponent).join("/")}`;
}

function toZipPath(relativeName) {
  return relativeName.split(path.sep).join("/");
}

function pageRelative(jobDir, fullPath) {
  return path.relative(jobDir, fullPath).split(path.sep).join("/");
}

function quoteCmdArg(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function findExistingPath(paths) {
  return paths.find((item) => item && existsSync(item));
}

function findOnPath(names) {
  const pathEntries = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    for (const name of names) {
      const candidate = path.join(entry, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function hasNonAscii(value = "") {
  return /[^\x00-\x7F]/.test(String(value));
}

function resolvePdfToPpmCommand() {
  if (process.platform !== "win32") return "pdftoppm";
  const configured = String(process.env.PDFTOPPM_PATH || "").trim();
  if (configured && existsSync(configured)) return configured;

  const runtimeRoot = path.join(process.env.USERPROFILE || "", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies");
  const pathMatch = findOnPath(["pdftoppm.exe", "pdftoppm.cmd"]);
  const pathDerived = pathMatch
    ? findExistingPath([
      path.resolve(path.dirname(pathMatch), "..", "native", "poppler", "Library", "bin", "pdftoppm.exe"),
      path.resolve(path.dirname(pathMatch), "..", "Library", "bin", "pdftoppm.exe")
    ])
    : null;

  return findExistingPath([
    pathDerived,
    path.join(runtimeRoot, "native", "poppler", "Library", "bin", "pdftoppm.exe"),
    findOnPath(["pdftoppm.exe", "pdftoppm.cmd"])
  ]) || "pdftoppm.exe";
}

function resolvePopplerRoot(command) {
  if (process.platform !== "win32") return null;
  const commandPath = path.isAbsolute(command) ? command : findOnPath([command]);
  if (!commandPath) return null;
  return path.resolve(path.dirname(commandPath), "..", "..");
}

function popplerCommandFromRoot(root) {
  return path.join(root, "Library", "bin", "pdftoppm.exe");
}

function popplerDataFromRoot(root) {
  return path.join(root, "share", "poppler", "nameToUnicode", "Bulgarian");
}

function popplerAsciiCacheRoots() {
  const driveRoot = path.parse(process.cwd()).root;
  return [
    process.env.POPPLER_ASCII_CACHE,
    driveRoot ? path.join(driveRoot, "iwen-poppler-runtime") : null,
    process.env.ProgramData ? path.join(process.env.ProgramData, "iwen-poppler-runtime") : null,
    "C:\\Windows\\Temp\\iwen-poppler-runtime"
  ].filter(Boolean);
}

async function preparePdfToPpmCommand(command) {
  if (process.platform !== "win32") return command;

  const commandPath = path.isAbsolute(command) ? command : findOnPath([command]) || command;
  const sourceRoot = resolvePopplerRoot(commandPath);
  if (!sourceRoot || !hasNonAscii(sourceRoot)) return commandPath;
  if (!existsSync(popplerCommandFromRoot(sourceRoot))) return commandPath;

  for (const targetRoot of popplerAsciiCacheRoots()) {
    if (hasNonAscii(targetRoot)) continue;
    const targetCommand = popplerCommandFromRoot(targetRoot);
    try {
      const cacheReady = existsSync(targetCommand) && existsSync(popplerDataFromRoot(targetRoot));
      if (!cacheReady) {
        await fs.rm(targetRoot, { recursive: true, force: true }).catch(() => {});
        await fs.mkdir(path.dirname(targetRoot), { recursive: true });
        await fs.cp(sourceRoot, targetRoot, { recursive: true });
      }
      if (existsSync(targetCommand)) return targetCommand;
    } catch {
      // Try the next plain-ASCII location.
    }
  }

  return commandPath;
}

function resolvePopplerEnv(command) {
  if (process.platform !== "win32") return {};
  const root = resolvePopplerRoot(command);
  if (!root) return {};

  const dataDir = findExistingPath([
    process.env.POPPLER_DATADIR,
    path.join(root, "share", "poppler"),
    path.join(root, "Library", "share", "poppler")
  ]);
  const fontConfigFile = findExistingPath([
    process.env.FONTCONFIG_FILE,
    path.join(root, "Library", "etc", "fonts", "fonts.conf"),
    path.join(root, "etc", "fonts", "fonts.conf")
  ]);
  const fontConfigPath = findExistingPath([
    process.env.FONTCONFIG_PATH,
    path.join(root, "Library", "etc", "fonts"),
    path.join(root, "etc", "fonts")
  ]);

  return {
    ...(dataDir ? { POPPLER_DATADIR: dataDir } : {}),
    ...(fontConfigFile ? { FONTCONFIG_FILE: fontConfigFile } : {}),
    ...(fontConfigPath ? { FONTCONFIG_PATH: fontConfigPath } : {})
  };
}

function resolveOfficeCommand() {
  const configured = String(process.env.SOFFICE_PATH || process.env.LIBREOFFICE_PATH || "").trim();
  if (configured && existsSync(configured)) return configured;

  if (process.platform === "win32") {
    return findExistingPath([
      findOnPath(["soffice.exe", "libreoffice.exe"]),
      "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
      "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe"
    ]);
  }

  return findOnPath(["soffice", "libreoffice"]);
}

function resolvePowerShellCommand() {
  if (process.platform !== "win32") return null;
  return findExistingPath([
    findOnPath(["powershell.exe", "pwsh.exe"]),
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
  ]);
}

async function runCommandStreaming(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const { timeout, ...spawnOptions } = options;
    const child = spawn(command, args, {
      ...spawnOptions,
      stdio: ["ignore", "ignore", "pipe"]
    });
    const stderrChunks = [];
    let stderrLength = 0;
    let timedOut = false;
    const maxStderrPreview = 6000;
    const timer = timeout
      ? setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeout)
      : null;

    child.stderr?.on("data", (chunk) => {
      stderrLength += chunk.length;
      if (stderrLength <= maxStderrPreview) {
        stderrChunks.push(chunk);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      if (code === 0) {
        resolve({ stdout: "", stderr });
        return;
      }
      const error = new Error(`${timedOut ? "Command timed out" : "Command failed"}: ${command} ${args.join(" ")}${stderr ? `\n${stderr}` : ""}`);
      error.code = code;
      error.timedOut = timedOut;
      error.stderr = stderr;
      reject(error);
    });
  });
}

async function runCommand(command, args, options = {}) {
  try {
    if (options.stream) {
      const { stream, ...streamOptions } = options;
      return await runCommandStreaming(command, args, streamOptions);
    }
    if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
      const commandLine = [quoteCmdArg(command), ...args.map(quoteCmdArg)].join(" ");
      return await execFileAsync(windowsComSpec, ["/d", "/c", commandLine], options);
    }
    return await execFileAsync(command, args, options);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`未找到转换工具：${command}，请确认已安装并加入 PATH`);
    }
    if (error?.code === "EINVAL") {
      throw new Error(`转换工具启动失败：${command}，请检查文件路径或工具安装状态`);
    }
    throw error;
  }
}

function escapeXml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapText(text, maxChars = 35) {
  const lines = [];
  for (const paragraph of String(text).split(/\n+/)) {
    let current = "";
    for (const char of paragraph.trim()) {
      current += char;
      if (current.length >= maxChars) {
        lines.push(current);
        current = "";
      }
    }
    if (current) lines.push(current);
    lines.push("");
  }
  return lines;
}

function applyOutputFormat(instance, format, quality) {
  if (format === "jpeg") return instance.jpeg({ quality, mozjpeg: true });
  if (format === "webp") return instance.webp({ quality });
  return instance.png();
}

function uniqueDescending(values) {
  return [...new Set(values.map((value) => Math.round(value)).filter((value) => value > 0))]
    .sort((a, b) => b - a);
}

async function encodeImageBufferWithinLimit({ sourceBuffer, format, quality, maxBytes }) {
  if (!maxBytes) return applyOutputFormat(sharp(sourceBuffer), format, quality).toBuffer();
  if (format === "png" && sourceBuffer.length <= maxBytes) return sourceBuffer;

  const sourceMetadata = await sharp(sourceBuffer).metadata();
  const originalWidth = sourceMetadata.width || 1;
  const qualitySteps = uniqueDescending([quality, 92, 88, 84, 80, 76, 72, 68, 64, 60, 55, 50, 45, 40, 35, 30, 25, 20])
    .filter((value) => value <= quality);
  const pngColourSteps = [256, 192, 128, 96, 64, 48, 32, 24, 16, 12, 8, 4, 2];
  const widthScales = [1, 0.96, 0.92, 0.88, 0.84, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15, 0.1, 0.08, 0.06, 0.05];
  let smallestBuffer = null;

  for (const scale of widthScales) {
    const width = scale === 1 ? null : Math.max(1, Math.round(originalWidth * scale));
    const createPipeline = () => {
      const pipeline = sharp(sourceBuffer).rotate();
      return width ? pipeline.resize({ width, withoutEnlargement: true }) : pipeline;
    };
    const attempts = format === "png" ? pngColourSteps : qualitySteps;

    for (const value of attempts) {
      let buffer;
      if (format === "jpeg") {
        buffer = await createPipeline().jpeg({ quality: value, mozjpeg: true }).toBuffer();
      } else if (format === "webp") {
        buffer = await createPipeline().webp({ quality: value, effort: 6 }).toBuffer();
      } else {
        buffer = await createPipeline().png({
          compressionLevel: 9,
          adaptiveFiltering: true,
          palette: true,
          colours: value,
          dither: value >= 32 ? 0.8 : 0.4
        }).toBuffer();
      }

      if (!smallestBuffer || buffer.length < smallestBuffer.length) smallestBuffer = buffer;
      if (buffer.length <= maxBytes) return buffer;
    }
  }

  if (smallestBuffer?.length <= maxBytes) return smallestBuffer;
  throw new Error(`图片压缩后仍超过 ${Math.round(maxBytes / 1024 / 1024)}MB，请改用 JPG 或 WebP 格式`);
}

async function encodeImageWithinLimit({ sourcePath, format, quality, maxBytes }) {
  return encodeImageBufferWithinLimit({
    sourceBuffer: await fs.readFile(sourcePath),
    format,
    quality,
    maxBytes
  });
}

function normalizeWordText(text = "") {
  return String(text)
    .replace(/\r/g, "")
    .replace(/\f/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function wordParagraphXml(text = "") {
  const lines = String(text || "").split("\n");
  const runs = lines.map((line, index) => {
    const breakXml = index ? "<w:br/>" : "";
    return `${breakXml}<w:t xml:space="preserve">${escapeXml(line || " ")}</w:t>`;
  }).join("");
  return `<w:p><w:r>${runs}</w:r></w:p>`;
}

function wordDocumentXml(text = "") {
  const paragraphs = normalizeWordText(text)
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
  const body = (paragraphs.length ? paragraphs : ["未能从 PDF 中提取到可编辑文字。"]).map(wordParagraphXml).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body>
</w:document>`;
}

async function writeDocx({ docxPath, text, title }) {
  await new Promise((resolve, reject) => {
    const output = createWriteStream(docxPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);

    archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`, { name: "[Content_Types].xml" });
    archive.append(relsXml([
      { id: "rId1", type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument", target: "word/document.xml" },
      { id: "rId2", type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", target: "docProps/core.xml" },
      { id: "rId3", type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties", target: "docProps/app.xml" }
    ]), { name: "_rels/.rels" });
    archive.append(relsXml([]), { name: "word/_rels/document.xml.rels" });
    archive.append(wordDocumentXml(text), { name: "word/document.xml" });
    archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escapeXml(title || "PDF转Word")}</dc:title><dc:creator>AI Teaching Image Web</dc:creator></cp:coreProperties>`, { name: "docProps/core.xml" });
    archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>AI Teaching Image Web</Application></Properties>`, { name: "docProps/app.xml" });

    archive.finalize();
  });
}

async function renderTextPages({ text, jobDir, outDir, baseName, imageFormat, quality, resolution }) {
  const lines = wrapText(text || "");
  const pageLines = 38;
  const pages = [];
  const ext = imageExtension(imageFormat);
  const scale = resolutionPresets[normalizeResolution(resolution)].scale;
  const width = 1240 * scale;
  const height = 1754 * scale;
  const textX = 92 * scale;
  const lineStartY = 104 * scale;
  const lineGap = 38 * scale;
  const textSize = 24 * scale;

  for (let pageIndex = 0; pageIndex < Math.max(1, Math.ceil(lines.length / pageLines)); pageIndex += 1) {
    const slice = lines.slice(pageIndex * pageLines, (pageIndex + 1) * pageLines);
    const tspans = slice
      .map((line, index) => `<tspan x="${textX}" y="${lineStartY + index * lineGap}">${escapeXml(line)}</tspan>`)
      .join("");
    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${width}" height="${height}" fill="#ffffff"/>
        <text font-size="${textSize}" font-family="Microsoft YaHei, Arial" fill="#111111">${tspans}</text>
      </svg>`;
    const fileName = `${baseName}-${pageIndex + 1}.${ext}`;
    const fullPath = path.join(outDir, fileName);
    await applyOutputFormat(sharp(Buffer.from(svg)), imageFormat, quality).toFile(fullPath);
    pages.push(pageRelative(jobDir, fullPath));
  }

  return pages;
}

async function zipPages({ jobDir, pages, extraFiles = [], zipName = "converted-images.zip" }) {
  const zipPath = path.join(jobDir, "converted-images.zip");
  await new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);
    for (const page of pages) {
      archive.file(path.join(jobDir, page), { name: toZipPath(page) });
    }
    for (const file of extraFiles) {
      archive.file(path.join(jobDir, file.relativeName), { name: toZipPath(file.zipName || file.relativeName) });
    }
    archive.finalize();
  });
  return zipPath;
}

async function copyResultsToOutputFolder({ jobDir, pages, zipPath, outputFolder, extraFiles = [] }) {
  const targetRoot = String(outputFolder || "").trim();
  if (!targetRoot) return null;

  const resolvedRoot = path.resolve(targetRoot);
  await fs.mkdir(resolvedRoot, { recursive: true });

  for (const page of pages) {
    const targetPath = path.join(resolvedRoot, page);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(path.join(jobDir, page), targetPath);
  }

  for (const file of extraFiles) {
    const targetPath = path.join(resolvedRoot, file.relativeName);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(path.join(jobDir, file.relativeName), targetPath);
  }

  const targetZip = path.join(resolvedRoot, path.basename(zipPath));
  await fs.copyFile(zipPath, targetZip);
  return resolvedRoot;
}

async function listRenderedPdfPages(outDir, baseName) {
  const files = await fs.readdir(outDir).catch(() => []);
  return naturalSort(files.filter((item) =>
    item.endsWith(".png") &&
    (item.startsWith(`${baseName}-page-`) || item.includes("-page-"))
  ));
}

async function isHeaderFooterOnlyPage(filePath) {
  const { data, info } = await sharp(filePath)
    .greyscale()
    .resize({ width: 220, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const totalPixels = info.width * info.height;
  const topLimit = info.height * 0.18;
  const bottomLimit = info.height * 0.84;
  let ink = 0;
  let bodyInk = 0;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const value = data[y * info.width + x];
      if (value >= 245) continue;
      ink += 1;
      if (y >= topLimit && y <= bottomLimit) bodyInk += 1;
    }
  }

  if (!ink) return true;
  const inkRatio = ink / totalPixels;
  const bodyInkRatio = bodyInk / totalPixels;
  const bodyShare = bodyInk / ink;
  return inkRatio < 0.008 && bodyInkRatio < 0.0025 && bodyShare < 0.45;
}

async function renderPdfWithPdfJs({ inputPath, outDir, baseName, dpi }) {
  const canvasModule = await import("@napi-rs/canvas");
  globalThis.DOMMatrix ||= canvasModule.DOMMatrix;
  globalThis.ImageData ||= canvasModule.ImageData;
  globalThis.Path2D ||= canvasModule.Path2D;

  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await fs.readFile(inputPath));
  const loadingTask = getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: false,
    verbosity: 0
  });
  const document = await loadingTask.promise;
  const scale = Number(dpi) / 72;

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = canvasModule.createCanvas(
        Math.max(1, Math.ceil(viewport.width)),
        Math.max(1, Math.ceil(viewport.height))
      );
      const canvasContext = canvas.getContext("2d");
      await page.render({
        canvas,
        canvasContext,
        viewport,
        background: "rgb(255,255,255)"
      }).promise;
      const outputPath = path.join(outDir, `${baseName}-page-${pageNumber}.png`);
      await fs.writeFile(outputPath, await canvas.encode("png"));
      page.cleanup();
    }
  } finally {
    await document.destroy();
  }
}

async function convertPdfPathToImages({ inputPath, jobDir, outDir, baseName, imageFormat, quality, dpi, maxImageBytes = null }) {
  const prefix = path.join(outDir, `${baseName}-page`);
  const command = await preparePdfToPpmCommand(resolvePdfToPpmCommand());
  try {
    await runCommand(command, ["-png", "-r", dpi, inputPath, prefix], {
      env: {
        ...process.env,
        ...resolvePopplerEnv(command)
      },
      stream: true,
      windowsHide: true,
      timeout: 600000
    });
  } catch (error) {
    let rendered = await listRenderedPdfPages(outDir, baseName);
    if (!rendered.length) {
      try {
        await renderPdfWithPdfJs({ inputPath, outDir, baseName, dpi });
        rendered = await listRenderedPdfPages(outDir, baseName);
      } catch (fallbackError) {
        throw new Error(`PDF 转图片失败：${fallbackError.message || error.message}`);
      }
    }
  }

  const rendered = await listRenderedPdfPages(outDir, baseName);
  const pages = [];
  const ext = imageExtension(imageFormat);

  for (const fileName of rendered) {
    const sourcePath = path.join(outDir, fileName);
    const targetPath = path.join(outDir, `${baseName}-${pages.length + 1}.${ext}`);
    if (imageFormat === "png" && !maxImageBytes) {
      await fs.rename(sourcePath, targetPath);
    } else {
      const outputBuffer = await encodeImageWithinLimit({
        sourcePath,
        format: imageFormat,
        quality,
        maxBytes: maxImageBytes
      });
      await fs.writeFile(targetPath, outputBuffer);
      await fs.unlink(sourcePath);
    }
    pages.push(pageRelative(jobDir, targetPath));
  }

  return pages;
}

async function convertPdfToImages({ file, jobDir, outDir, baseName, imageFormat, quality, dpi }) {
  const inputPath = path.join(jobDir, `${baseName}.pdf`);
  await fs.writeFile(inputPath, file.buffer);
  return convertPdfPathToImages({ inputPath, jobDir, outDir, baseName, imageFormat, quality, dpi });
}

async function convertOfficeToPdf({ file, jobDir, baseName, ext }) {
  const officeCommand = resolveOfficeCommand();
  const inputPath = path.join(jobDir, `${baseName}${ext}`);
  await fs.writeFile(inputPath, file.buffer);
  const expectedPath = path.join(jobDir, `${baseName}.pdf`);

  if (!officeCommand) {
    return [".ppt", ".pptx"].includes(ext)
      ? convertPresentationToPdfWithPowerPoint({ inputPath, outputPath: expectedPath, jobDir })
      : convertOfficeToPdfWithWord({ inputPath, outputPath: expectedPath, jobDir });
  }

  const profileDir = path.join(jobDir, "lo-profile");
  await fs.mkdir(profileDir, { recursive: true });

  const args = [
    "--headless",
    "--nologo",
    "--nofirststartwizard",
    "--norestore",
    `-env:UserInstallation=file:///${profileDir.replace(/\\/g, "/")}`,
    "--convert-to",
    "pdf",
    "--outdir",
    jobDir,
    inputPath
  ];

  try {
    await runCommand(officeCommand, args, {
      windowsHide: true,
      timeout: 180000
    });
  } catch (error) {
    throw new Error(`Office 原格式转 PDF 失败：${error.message}`);
  }

  if (existsSync(expectedPath)) return expectedPath;

  const files = await fs.readdir(jobDir);
  const generatedPdf = files.find((item) => item.toLowerCase().endsWith(".pdf"));
  if (generatedPdf) return path.join(jobDir, generatedPdf);
  throw new Error("Office 原格式转 PDF 未生成文件，请检查文件是否损坏或 LibreOffice 是否可用");
}

async function convertPresentationToPdfWithPowerPoint({ inputPath, outputPath, jobDir }) {
  const powerShell = resolvePowerShellCommand();
  if (!powerShell) {
    throw new Error("PPT 转图片需要安装 Microsoft PowerPoint 或 LibreOffice");
  }

  const scriptPath = path.join(jobDir, "powerpoint-to-pdf.ps1");
  const script = `
param(
  [string]$InputPath,
  [string]$OutputPath
)
$ErrorActionPreference = "Stop"
$converted = $false
$errors = @()
foreach ($progId in @("PowerPoint.Application", "KWPP.Application")) {
  $application = $null
  $presentation = $null
  try {
    $application = New-Object -ComObject $progId
    $presentation = $application.Presentations.Open($InputPath, -1, 0, 0)
    $presentation.SaveAs($OutputPath, 32)
    Write-Output "__PPT_CONVERTER__=$progId"
    $converted = $true
  } catch {
    $errors += "$progId : $($_.Exception.Message)"
  } finally {
    if ($presentation -ne $null) {
      $presentation.Close()
      [System.Runtime.InteropServices.Marshal]::ReleaseComObject($presentation) | Out-Null
    }
    if ($application -ne $null) {
      $application.Quit()
      [System.Runtime.InteropServices.Marshal]::ReleaseComObject($application) | Out-Null
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
  }
  if ($converted) { break }
}
if (-not $converted) {
  throw ($errors -join " | ")
}
`;
  await fs.writeFile(scriptPath, `\uFEFF${script}`, "utf8");

  try {
    await runCommand(powerShell, [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-InputPath",
      inputPath,
      "-OutputPath",
      outputPath
    ], {
      windowsHide: true,
      timeout: 300000
    });
  } catch (error) {
    throw new Error(`Microsoft PowerPoint 和 WPS 均无法读取该 PPT：${error.message}`);
  }

  if (existsSync(outputPath)) return outputPath;
  throw new Error("PPT 未生成 PDF，请检查 Microsoft PowerPoint 或 WPS 是否可用");
}

async function convertOfficeToPdfWithWord({ inputPath, outputPath, jobDir }) {
  const powerShell = resolvePowerShellCommand();
  if (!powerShell) {
    throw new Error("Word 转图片需要安装 LibreOffice，或安装 Microsoft Word，才能保留原 Word 格式");
  }

  const scriptPath = path.join(jobDir, "word-to-pdf.ps1");
  const script = `
param(
  [string]$InputPath,
  [string]$OutputPath
)
$ErrorActionPreference = "Stop"
$converted = $false
$errors = @()
foreach ($progId in @("Word.Application", "KWPS.Application")) {
  $word = $null
  $doc = $null
  try {
    $word = New-Object -ComObject $progId
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $doc = $word.Documents.Open($InputPath, $false, $true)
    if ($progId -eq "Word.Application") {
      $doc.ExportAsFixedFormat($OutputPath, 17)
    } else {
      $doc.SaveAs([ref]$OutputPath, [ref]17)
    }
    Write-Output "__WORD_CONVERTER__=$progId"
    $converted = $true
  } catch {
    $errors += "$progId : $($_.Exception.Message)"
  } finally {
    if ($doc -ne $null) {
      $doc.Close($false) | Out-Null
      [System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc) | Out-Null
    }
    if ($word -ne $null) {
      $word.Quit() | Out-Null
      [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
  }
  if ($converted) { break }
}
if (-not $converted) {
  throw ($errors -join " | ")
}
`;
  await fs.writeFile(scriptPath, `\uFEFF${script}`, "utf8");

  try {
    await runCommand(powerShell, [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-InputPath",
      inputPath,
      "-OutputPath",
      outputPath
    ], {
      windowsHide: true,
      timeout: 180000
    });
  } catch (error) {
    throw new Error(`Word 原格式转 PDF 失败（Microsoft Word 与 WPS 均无法打开该文档）：${error.message}`);
  }

  if (existsSync(outputPath)) return outputPath;
  throw new Error("Word 原格式转 PDF 未生成文件，请检查文档是否损坏，或 Microsoft Word / WPS 是否可用");
}

export async function convertDocumentToImages(file, options = {}) {
  const ext = path.extname(file.originalname || "").toLowerCase();
  const baseName = sanitizeFileName(path.parse(file.originalname || "document").name).replace(/\.[^.]+$/, "");
  const originalFileName = sanitizeFileName(file.originalname || `${baseName || "document"}${ext || ""}`);
  const jobId = nanoid();
  const jobDir = path.join(uploadsRoot, "converted", jobId);
  await fs.mkdir(jobDir, { recursive: true });
  const originalPath = path.join(jobDir, originalFileName);
  await fs.writeFile(originalPath, file.buffer);
  const imageFormat = normalizeImageFormat(options.imageFormat || options.format);
  const quality = normalizeQuality(options.quality);
  const resolution = normalizeResolution(options.resolution);
  const dpi = String(normalizeDpi(options));
  const outDir = options.separateFolder === "true" || options.separateFolder === true
    ? path.join(jobDir, baseName)
    : jobDir;
  await fs.mkdir(outDir, { recursive: true });

  let pages = [];
  if (ext === ".pdf") {
    pages = await convertPdfToImages({ file, jobDir, outDir, baseName, imageFormat, quality, dpi });
  } else if ([".doc", ".docx", ".ppt", ".pptx"].includes(ext)) {
    try {
      const pdfPath = await convertOfficeToPdf({ file, jobDir, baseName, ext });
      pages = await convertPdfPathToImages({
        inputPath: pdfPath,
        jobDir,
        outDir,
        baseName,
        imageFormat,
        quality,
        dpi,
        maxImageBytes: [".ppt", ".pptx"].includes(ext) && resolution === "4k" ? maxPpt4kImageBytes : null
      });
    } catch (officeError) {
      // .ppt/.pptx 不适合纯文本渲染，保持原抛错
      if (![".doc", ".docx"].includes(ext)) throw officeError;
      // Word/WPS COM 都打不开（如含 stylesWithEffects.xml 的 docx）且无 LibreOffice 时，
      // 用 mammoth 提取文字走纯文本渲染，避免转换直接报错中断。
      logService.warn("convert", `Office 转 PDF 失败（${officeError.message}），改用文字提取渲染`);
      const text = await extractDocumentText(file);
      if (!String(text).trim()) throw officeError; // 连文字都提不出来，保留原错误
      pages = await renderTextPages({ text, jobDir, outDir, baseName, imageFormat, quality, resolution });
    }
  } else if ([".txt", ".md"].includes(ext)) {
    const text = await extractDocumentText(file);
    pages = await renderTextPages({ text, jobDir, outDir, baseName, imageFormat, quality, resolution });
  } else {
    throw new Error("仅支持 pdf、doc、docx、ppt、pptx、txt、md");
  }

  if (!pages.length) throw new Error("没有生成可用图片");
  const totalPageCount = pages.length;
  const pageIndexes = new Map(pages.map((page, index) => [page, index + 1]));
  let skippedBlankPages = [];
  if (options.skipBlankPages === true || options.skipBlankPages === "true") {
    ({ pages, skippedBlankPages } = await filterBlankPages({ jobDir, pages }));
    if (skippedBlankPages.length) {
      logService.info("convert", `已跳过 ${skippedBlankPages.length} 张空白页，保留 ${pages.length} 张内容页`);
    }
  }
  const originalFile = {
    name: originalFileName,
    relativeName: originalFileName,
    url: toPublicUrl(jobId, originalFileName)
  };
  const zipPath = await zipPages({
    jobDir,
    pages,
    extraFiles: [{ relativeName: originalFileName, zipName: `原文件/${originalFileName}` }]
  });
  const outputFolder = await copyResultsToOutputFolder({
    jobDir,
    pages,
    zipPath,
    outputFolder: options.outputFolder,
    extraFiles: [{ relativeName: originalFileName }]
  });
  return {
    jobId,
    originalFile,
    totalPageCount,
    skippedBlankPages,
    skippedBlankPageCount: skippedBlankPages.length,
    pages: pages.map((page) => ({
      index: pageIndexes.get(page),
      name: page,
      url: toPublicUrl(jobId, page)
    })),
    downloadUrl: `/api/convert/download/${jobId}`,
    outputFolder
  };
}

function pdfEscape(text = "") {
  return String(text).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function createPdfObject(parts) {
  return Buffer.concat(parts.map((part) => Buffer.isBuffer(part) ? part : Buffer.from(String(part), "binary")));
}

function buildImagePdf(pages) {
  const objects = [];
  const addObject = (body) => {
    objects.push(body);
    return objects.length;
  };

  const catalogId = addObject("");
  const pagesId = addObject("");
  const pageIds = [];

  for (const [index, page] of pages.entries()) {
    const imageId = addObject(createPdfObject([
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.buffer.length} >>\nstream\n`,
      page.buffer,
      "\nendstream"
    ]));
    const pageWidth = Math.max(1, page.width * 72 / page.dpi);
    const pageHeight = Math.max(1, page.height * 72 / page.dpi);
    const content = `q\n${pageWidth.toFixed(2)} 0 0 ${pageHeight.toFixed(2)} 0 0 cm\n/Im${index + 1} Do\nQ`;
    const contentId = addObject(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /XObject << /Im${index + 1} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  const chunks = [Buffer.from("%PDF-1.4\n", "binary")];
  const offsets = [0];
  for (const [index, body] of objects.entries()) {
    offsets.push(chunks.reduce((total, chunk) => total + chunk.length, 0));
    chunks.push(createPdfObject([`${index + 1} 0 obj\n`, body, "\nendobj\n"]));
  }

  const xrefOffset = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const xref = [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info << /Title (${pdfEscape("图片转PDF")}) >> >>`,
    "startxref",
    String(xrefOffset),
    "%%EOF"
  ].join("\n");
  chunks.push(Buffer.from(xref, "binary"));
  return Buffer.concat(chunks);
}

function normalizeOfficeFileName(name, fallback, ext) {
  const cleanBase = sanitizeFileName(name || fallback).replace(/\.[^.]+$/, "") || fallback;
  return `${cleanBase}.${ext}`;
}

export async function convertImagesToPdf(files, options = {}) {
  const filteredFiles = [...(files || [])].filter((file) => imageExts.has(path.extname(file.originalname || "").toLowerCase()));
  const sourceFiles = shouldPreserveUploadOrder(options) ? filteredFiles : sortUploadedFiles(filteredFiles);
  if (!sourceFiles.length) throw new Error("请上传 jpg、png 或 webp 图片");

  const jobId = nanoid();
  const jobDir = path.join(uploadsRoot, "converted", jobId);
  await fs.mkdir(jobDir, { recursive: true });

  const dpi = normalizeDpi(options);
  const pages = [];

  for (const file of sourceFiles) {
    const image = sharp(file.buffer).rotate().flatten({ background: "#ffffff" });
    const metadata = await image.metadata();
    const width = metadata.width || 1240;
    const height = metadata.height || 1754;
    const buffer = await image.jpeg({ quality: normalizeQuality(options.quality), mozjpeg: true }).toBuffer();
    pages.push({ width, height, dpi, buffer });
  }

  const pdfBuffer = buildImagePdf(pages);
  const pdfName = normalizeOfficeFileName(options.pdfName || options.fileName, "images", "pdf");
  const pdfPath = path.join(jobDir, pdfName);
  await fs.writeFile(pdfPath, pdfBuffer);

  const outputFolder = String(options.outputFolder || "").trim();
  let savedOutputFolder = null;
  if (outputFolder) {
    savedOutputFolder = path.resolve(outputFolder);
    await fs.mkdir(savedOutputFolder, { recursive: true });
    await fs.copyFile(pdfPath, path.join(savedOutputFolder, pdfName));
  }

  return {
    jobId,
    fileName: pdfName,
    pageCount: pages.length,
    pdfUrl: toPublicUrl(jobId, pdfName),
    downloadUrl: `/api/convert/pdf/${jobId}/${encodeURIComponent(pdfName)}`,
    outputFolder: savedOutputFolder
  };
}

function relsXml(relationships) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships
    .map((item) => `<Relationship Id="${item.id}" Type="${item.type}" Target="${item.target}"/>`)
    .join("")}</Relationships>`;
}

function presentationXml(slideCount) {
  const slideIds = Array.from({ length: slideCount }, (_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>${slideIds}</p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000" type="wide"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;
}

function contentTypesXml(slideCount, imageCount) {
  const slides = Array.from({ length: slideCount }, (_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("");
  const images = Array.from({ length: imageCount }, (_, index) => `<Override PartName="/ppt/media/image${index + 1}.png" ContentType="image/png"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${images}
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  ${slides}
</Types>`;
}

function emptySlideTreeXml() {
  return `<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`;
}

function xmlText(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function textShapeXml({ id, name, x, y, cx, cy, text, runs, lines, lineHeightPt, fontSize, color = "273142", bold = false, align = "l", anchor = "t", margin = 0, wrap = "square" }) {
  // 支持两种入参：runs（多 run 多色，竞品"同段不同词不同色"的核心）或 text（单字符串，向后兼容）
  const paragraphRuns = (paragraphs) => {
    const list = Array.isArray(runs) && runs.length ? runs : [{ text: paragraphs.join("\n"), color, bold, fontSize }];
    return list.filter((run) => String(run.text ?? "") !== "");
  };
  const paragraphs = String(text ?? "").split(/\n+/).filter(Boolean);
  // 多 run 模式：把所有 runs 当作一个段落的连续片段（runs 之间不换行，整体作为一个 a:p）
  const hasMultiRun = Array.isArray(runs) && runs.length > 0;
  const runSize = (run) => Math.round((run.fontSize || fontSize || 18) * 100);
  const renderRun = (run) => `<a:r><a:rPr lang="zh-CN" sz="${runSize(run)}" b="${run.bold ?? bold ? 1 : 0}" dirty="0"><a:solidFill><a:srgbClr val="${run.color || color}"/></a:solidFill><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/></a:rPr><a:t>${xmlText(run.text ?? "")}</a:t></a:r>`;
  let paragraphXml;
  if (Array.isArray(lines)) {
    // Shared measured line breaks keep the live preview and editable PPT in sync.
    paragraphXml = lines.map(line => `<a:p><a:pPr algn="${align}"><a:lnSpc><a:spcPts val="${Math.round(lineHeightPt * 100)}"/></a:lnSpc><a:spcAft><a:spcPts val="0"/></a:spcAft></a:pPr>${line.map(renderRun).join("")}<a:endParaRPr lang="zh-CN" sz="${runSize({ fontSize })}"/></a:p>`).join("");
  } else if (hasMultiRun) {
    const rendered = paragraphRuns(runs).map(renderRun).join("");
    paragraphXml = `<a:p>
        <a:pPr algn="${align}"><a:lnSpc><a:spcPct val="115000"/></a:lnSpc><a:spcAft><a:spcPts val="650"/></a:spcAft></a:pPr>
        ${rendered}
        <a:endParaRPr lang="zh-CN" sz="${runSize({ fontSize })}"><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/></a:endParaRPr>
      </a:p>`;
  } else {
    paragraphXml = (paragraphs.length ? paragraphs : [""]).map((paragraph) => `<a:p>
        <a:pPr algn="${align}"><a:lnSpc><a:spcPct val="115000"/></a:lnSpc><a:spcAft><a:spcPts val="650"/></a:spcAft></a:pPr>
        <a:r><a:rPr lang="zh-CN" sz="${Math.round(fontSize * 100)}" b="${bold ? 1 : 0}" dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/></a:rPr><a:t>${xmlText(paragraph)}</a:t></a:r>
        <a:endParaRPr lang="zh-CN" sz="${Math.round(fontSize * 100)}"><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/></a:endParaRPr>
      </a:p>`).join("");
  }
  return `<p:sp>
      <p:nvSpPr><p:cNvPr id="${id}" name="${xmlText(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr>
      <p:txBody><a:bodyPr wrap="${wrap}" vertOverflow="clip" horzOverflow="clip" lIns="${margin}" tIns="${margin}" rIns="${margin}" bIns="${margin}" anchor="${anchor}"/><a:lstStyle/>${paragraphXml}</p:txBody>
    </p:sp>`;
}

function filledShapeXml({ id, name, x, y, cx, cy, fill, alpha = 100000, radius = false, line = null }) {
  const lineXml = line
    ? `<a:ln w="12700"><a:solidFill><a:srgbClr val="${line}"/></a:solidFill></a:ln>`
    : `<a:ln><a:noFill/></a:ln>`;
  return `<p:sp>
      <p:nvSpPr><p:cNvPr id="${id}" name="${xmlText(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="${radius ? "roundRect" : "rect"}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${fill}"><a:alpha val="${alpha}"/></a:srgbClr></a:solidFill>${lineXml}</p:spPr>
      <p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>
    </p:sp>`;
}

function splitBodyColumns(text = "") {
  const normalized = String(text || "").trim();
  if (normalized.length <= 650) return [normalized];
  const units = normalized.split(/\n+/).flatMap((line) => {
    if (line.length <= 180) return [line];
    return line.split(/(?<=[。！？；])/).filter(Boolean);
  });
  const target = Math.ceil(normalized.length / 2);
  const columns = [[], []];
  let currentLength = 0;
  for (const unit of units) {
    const columnIndex = currentLength < target ? 0 : 1;
    columns[columnIndex].push(unit);
    currentLength += unit.length;
  }
  return columns.map((column) => column.join("\n").trim()).filter(Boolean);
}

function editableSlideElementsXml(index, editableSlide) {
  const title = String(editableSlide?.title || `第 ${index} 页`).trim();
  const body = String(editableSlide?.body || "").trim();
  const columns = splitBodyColumns(body);
  const titleSize = title.length > 42 ? 26 : title.length > 26 ? 30 : 34;
  const bodySize = body.length > 1100 ? 14 : body.length > 800 ? 16 : body.length > 520 ? 18 : body.length > 280 ? 20 : 23;
  const panel = filledShapeXml({ id: 3, name: "可编辑内容面板", x: 548640, y: 457200, cx: 11094720, cy: 5943600, fill: "FFFFFF", alpha: 97000, radius: true, line: "E7E9EE" });
  const accent = filledShapeXml({ id: 4, name: "可编辑标题色条", x: 804672, y: 731520, cx: 109728, cy: 822960, fill: "FF4F93", radius: true });
  const titleShape = textShapeXml({ id: 5, name: "可编辑标题", x: 1060704, y: 704088, cx: 10149840, cy: 914400, text: title, fontSize: titleSize, color: "1F2937", bold: true });
  let bodyShapes = "";
  if (columns.length <= 1) {
    bodyShapes = textShapeXml({ id: 6, name: "可编辑正文", x: 1060704, y: 1737360, cx: 10058400, cy: 4206240, text: columns[0] || "", fontSize: bodySize, color: "374151" });
  } else {
    bodyShapes = [
      textShapeXml({ id: 6, name: "可编辑正文左栏", x: 1060704, y: 1737360, cx: 4846320, cy: 4206240, text: columns[0], fontSize: bodySize, color: "374151" }),
      filledShapeXml({ id: 7, name: "可编辑分栏线", x: 6050280, y: 1846800, cx: 18288, cy: 3916680, fill: "E5E7EB" }),
      textShapeXml({ id: 8, name: "可编辑正文右栏", x: 6318504, y: 1737360, cx: 4846320, cy: 4206240, text: columns[1], fontSize: bodySize, color: "374151" })
    ].join("");
  }
  const pageNumber = textShapeXml({ id: 9, name: "可编辑页码", x: 10576512, y: 6172200, cx: 914400, cy: 365760, text: String(index), fontSize: 12, color: "9CA3AF", align: "r" });
  return `${panel}${accent}${titleShape}${bodyShapes}${pageNumber}`;
}

// ===== slidePlan 多图层拼装（P0 地基）=====
// slidePlan 描述一页的所有图层，统一 EMU 坐标（画布 12192000×6858000）：
// {
//   background: { mediaKey, x, y, cx, cy, name } | null,
//   pictures:   [{ mediaKey, x, y, cx, cy, name, zOrder }],
//   textShapes: [{ x, y, cx, cy, runs:[{text,color,bold,fontSize}], text, fontSize, color, bold, align, anchor, name, zOrder, margin, wrap }],
//   filledShapes:[{ x, y, cx, cy, fill, alpha, radius, line, name, zOrder }]
// }
// mediaMap: { mediaKey: Buffer }，跨页共享同一张 media（去重）。
const SLIDE_WIDTH_EMU = 12192000;
const SLIDE_HEIGHT_EMU = 6858000;

function emuToPt(value) {
  return Math.round(value / 9525); // 1 pt = 9525 EMU（PowerPoint COM 用 Point 单位，画布 960×540）
}

function sortedLayers(slidePlan) {
  const layers = [];
  if (slidePlan.background) {
    layers.push({ kind: "pic", ...slidePlan.background, zOrder: slidePlan.background.zOrder ?? 0 });
  }
  for (const pic of slidePlan.pictures || []) layers.push({ kind: "pic", ...pic, zOrder: pic.zOrder ?? 1 });
  for (const sp of slidePlan.filledShapes || []) layers.push({ kind: "filled", ...sp, zOrder: sp.zOrder ?? 2 });
  for (const ts of slidePlan.textShapes || []) layers.push({ kind: "text", ...ts, zOrder: ts.zOrder ?? 3 });
  return layers.sort((a, b) => (a.zOrder ?? 0) - (b.zOrder ?? 0));
}

function picXml(id, layer, rId, name) {
  const safeName = xmlText(layer.name || name || `图片 ${id}`);
  return `<p:pic>
      <p:nvPicPr><p:cNvPr id="${id}" name="${safeName}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
      <p:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
      <p:spPr><a:xfrm><a:off x="${layer.x}" y="${layer.y}"/><a:ext cx="${layer.cx}" cy="${layer.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
    </p:pic>`;
}

function renderSlidePlanXml(slidePlan, idCounter, rels) {
  // rels: Map<mediaKey, rId>，本 slide 用到的图片 relationship（调用方负责按顺序分配 rId）
  const layers = sortedLayers(slidePlan);
  const parts = [];
  for (const layer of layers) {
    idCounter.value += 1;
    const id = idCounter.value;
    if (layer.kind === "pic") {
      const rId = rels.get(layer.mediaKey);
      parts.push(picXml(id, layer, rId, layer.name));
    } else if (layer.kind === "filled") {
      parts.push(filledShapeXml({ id, name: layer.name || "形状", x: layer.x, y: layer.y, cx: layer.cx, cy: layer.cy, fill: layer.fill || "FFFFFF", alpha: layer.alpha ?? 100000, radius: Boolean(layer.radius), line: layer.line ?? null }));
    } else if (layer.kind === "text") {
      parts.push(textShapeXml({ id, name: layer.name || "文本框", x: layer.x, y: layer.y, cx: layer.cx, cy: layer.cy, text: layer.text, runs: layer.runs, lines: layer.lines, lineHeightPt: layer.lineHeightPt, fontSize: layer.fontSize, color: layer.color, bold: layer.bold, align: layer.align || "l", anchor: layer.anchor || "mid", margin: layer.margin ?? 140000, wrap: layer.wrap || "square" }));
    }
  }
  return parts.join("");
}



function slideXml(index, image, slideWidth, slideHeight, editableSlide = null) {
  const widthRatio = slideWidth / image.width;
  const heightRatio = slideHeight / image.height;
  const ratio = Math.min(widthRatio, heightRatio);
  const cx = Math.round(image.width * ratio);
  const cy = Math.round(image.height * ratio);
  const x = Math.round((slideWidth - cx) / 2);
  const y = Math.round((slideHeight - cy) / 2);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  ${emptySlideTreeXml()}
    <p:pic>
      <p:nvPicPr><p:cNvPr id="2" name="图片 ${index}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
      <p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
      <p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
    </p:pic>
    ${editableSlide ? editableSlideElementsXml(index, editableSlide) : ""}
  </p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function slidePlanSlideXml(slidePlan, idCounter, rels) {
  const body = renderSlidePlanXml(slidePlan, idCounter, rels);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  ${emptySlideTreeXml()}
    ${body}
  </p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

async function writePptx({ pptxPath, images, editableSlides = [], slidePlans, mediaMap }) {
  // 两条路径：传了 slidePlans+mediaMap 走多图层；否则走旧的"一页一图+可选写死文本框"。
  const useSlidePlan = Array.isArray(slidePlans) && slidePlans.length > 0 && mediaMap;
  const slideCount = useSlidePlan ? slidePlans.length : images.length;
  const slideWidth = 12192000;
  const slideHeight = 6858000;

  // 多图层路径：建立 mediaKey→imageN.png 去重映射，按实际 media 总数生成 contentTypes
  let mediaFiles = []; // [{ name: "imageN.png", buffer }]
  let mediaKeyToName = new Map();
  if (useSlidePlan) {
    let mediaIndex = 0;
    for (const plan of slidePlans) {
      const allPics = [plan.background, ...(plan.pictures || [])].filter(Boolean);
      for (const pic of allPics) {
        if (!pic.mediaKey || mediaKeyToName.has(pic.mediaKey)) continue;
        mediaIndex += 1;
        const name = `image${mediaIndex}.png`;
        mediaKeyToName.set(pic.mediaKey, name);
        const buf = mediaMap[pic.mediaKey];
        if (buf) mediaFiles.push({ name, buffer: buf });
      }
    }
  } else {
    mediaFiles = images.map((image, index) => ({ name: `image${index + 1}.png`, buffer: image.buffer }));
  }

  await new Promise((resolve, reject) => {
    const output = createWriteStream(pptxPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);

    archive.append(contentTypesXml(slideCount, mediaFiles.length), { name: "[Content_Types].xml" });
    archive.append(relsXml([
      { id: "rId1", type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument", target: "ppt/presentation.xml" },
      { id: "rId2", type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", target: "docProps/core.xml" },
      { id: "rId3", type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties", target: "docProps/app.xml" }
    ]), { name: "_rels/.rels" });
    archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>图片转PPT</dc:title><dc:creator>AI Teaching Image Web</dc:creator></cp:coreProperties>`, { name: "docProps/core.xml" });
    archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>AI Teaching Image Web</Application><Slides>${slideCount}</Slides></Properties>`, { name: "docProps/app.xml" });

    archive.append(presentationXml(slideCount), { name: "ppt/presentation.xml" });
    archive.append(relsXml([
      { id: "rId1", type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster", target: "slideMasters/slideMaster1.xml" },
      ...Array.from({ length: slideCount }, (_, index) => ({
        id: `rId${index + 2}`,
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide",
        target: `slides/slide${index + 1}.xml`
      }))
    ]), { name: "ppt/_rels/presentation.xml.rels" });
    archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">${emptySlideTreeXml()}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles/></p:sldMaster>`, { name: "ppt/slideMasters/slideMaster1.xml" });
    archive.append(relsXml([
      { id: "rId1", type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout", target: "../slideLayouts/slideLayout1.xml" },
      { id: "rId2", type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme", target: "../theme/theme1.xml" }
    ]), { name: "ppt/slideMasters/_rels/slideMaster1.xml.rels" });
    archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">${emptySlideTreeXml()}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`, { name: "ppt/slideLayouts/slideLayout1.xml" });
    archive.append(relsXml([
      { id: "rId1", type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster", target: "../slideMasters/slideMaster1.xml" }
    ]), { name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels" });
    archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="AI Teaching"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F8FAFC"/></a:lt2><a:accent1><a:srgbClr val="FF4F93"/></a:accent1><a:accent2><a:srgbClr val="2ECC71"/></a:accent2><a:accent3><a:srgbClr val="FFB84D"/></a:accent3><a:accent4><a:srgbClr val="60A5FA"/></a:accent4><a:accent5><a:srgbClr val="A78BFA"/></a:accent5><a:accent6><a:srgbClr val="F87171"/></a:accent6><a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Microsoft YaHei"/></a:majorFont><a:minorFont><a:latin typeface="Microsoft YaHei"/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`, { name: "ppt/theme/theme1.xml" });

    if (useSlidePlan) {
      slidePlans.forEach((plan, index) => {
        // 为本 slide 收集用到的 mediaKey 并分配 rId（rId1 给 layout，rId2+ 给图片）
        const allPics = [plan.background, ...(plan.pictures || [])].filter(Boolean);
        const relsList = [{ id: "rId1", type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout", target: "../slideLayouts/slideLayout1.xml" }];
        const rels = new Map();
        let relIdx = 1;
        for (const pic of allPics) {
          if (!pic.mediaKey || rels.has(pic.mediaKey)) continue;
          relIdx += 1;
          const rId = `rId${relIdx}`;
          rels.set(pic.mediaKey, rId);
          relsList.push({ id: rId, type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image", target: `../media/${mediaKeyToName.get(pic.mediaKey)}` });
        }
        const idCounter = { value: 1 };
        archive.append(slidePlanSlideXml(plan, idCounter, rels), { name: `ppt/slides/slide${index + 1}.xml` });
        archive.append(relsXml(relsList), { name: `ppt/slides/_rels/slide${index + 1}.xml.rels` });
      });
    } else {
      images.forEach((image, index) => {
        archive.append(slideXml(index + 1, image, slideWidth, slideHeight, editableSlides[index] || null), { name: `ppt/slides/slide${index + 1}.xml` });
        archive.append(relsXml([
          { id: "rId1", type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image", target: `../media/image${index + 1}.png` },
        { id: "rId2", type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout", target: "../slideLayouts/slideLayout1.xml" }
      ]), { name: `ppt/slides/_rels/slide${index + 1}.xml.rels` });
      });
    }

    // media 文件统一写入（两条路径共用，mediaFiles 已按路径构造好）
    for (const media of mediaFiles) {
      archive.append(media.buffer, { name: `ppt/media/${media.name}` });
    }

    archive.finalize();
  });
}

async function writePptxWithPowerPoint({ pptxPath, images, editableSlides = [], jobDir }) {
  if (process.platform !== "win32") return false;
  const powerShell = resolvePowerShellCommand();
  if (!powerShell) return false;

  const nativeDir = path.join(jobDir, `powerpoint-native-${nanoid()}`);
  const dataPath = path.join(nativeDir, "slides.json");
  const scriptPath = path.join(nativeDir, "create-presentation.ps1");
  await fs.mkdir(nativeDir, { recursive: true });

  try {
    const slides = [];
    for (const [index, image] of images.entries()) {
      const imagePath = path.join(nativeDir, `slide-${String(index + 1).padStart(4, "0")}.png`);
      await fs.writeFile(imagePath, image.buffer);
      const editableSlide = editableSlides[index] || null;
      const title = String(editableSlide?.title || `第 ${index + 1} 页`).trim();
      const body = String(editableSlide?.body || "").trim();
      slides.push({
        imagePath,
        editable: Boolean(editableSlide),
        title,
        columns: splitBodyColumns(body),
        titleSize: title.length > 42 ? 26 : title.length > 26 ? 30 : 34,
        bodySize: body.length > 1100 ? 14 : body.length > 800 ? 16 : body.length > 520 ? 18 : body.length > 280 ? 20 : 23,
        pageNumber: index + 1
      });
    }
    await fs.writeFile(dataPath, JSON.stringify({ slides }), "utf8");

    const script = `
param(
  [string]$DataPath,
  [string]$OutputPath
)
$ErrorActionPreference = "Stop"

function To-OfficeColor([int]$Red, [int]$Green, [int]$Blue) {
  return $Red + ($Green * 256) + ($Blue * 65536)
}

function Add-EditableTextBox($Slide, [string]$Name, [single]$Left, [single]$Top, [single]$Width, [single]$Height, [string]$Text, [single]$FontSize, [bool]$Bold, [int]$Color, [int]$Alignment) {
  $shape = $Slide.Shapes.AddTextbox(1, $Left, $Top, $Width, $Height)
  $shape.Name = $Name
  $shape.TextFrame.WordWrap = -1
  $shape.TextFrame.AutoSize = 0
  $shape.TextFrame.MarginLeft = 0
  $shape.TextFrame.MarginRight = 0
  $shape.TextFrame.MarginTop = 0
  $shape.TextFrame.MarginBottom = 0
  $shape.TextFrame.TextRange.Text = $Text
  $shape.TextFrame.TextRange.Font.Name = "Microsoft YaHei"
  $shape.TextFrame.TextRange.Font.NameFarEast = "Microsoft YaHei"
  $shape.TextFrame.TextRange.Font.Size = $FontSize
  $shape.TextFrame.TextRange.Font.Bold = $(if ($Bold) { -1 } else { 0 })
  $shape.TextFrame.TextRange.Font.Color.RGB = $Color
  $shape.TextFrame.TextRange.ParagraphFormat.Alignment = $Alignment
  return $shape
}

$data = Get-Content -LiteralPath $DataPath -Raw -Encoding UTF8 | ConvertFrom-Json
$powerPoint = $null
$presentation = $null
try {
  $powerPoint = New-Object -ComObject PowerPoint.Application
  $presentation = $powerPoint.Presentations.Add(0)
  $presentation.PageSetup.SlideWidth = 960
  $presentation.PageSetup.SlideHeight = 540
  $index = 0
  foreach ($item in $data.slides) {
    $index++
    $slide = $presentation.Slides.Add($index, 12)
    $picture = $slide.Shapes.AddPicture([string]$item.imagePath, 0, -1, 0, 0, 960, 540)
    $picture.Name = "AI 视觉背景"

    if ([bool]$item.editable) {
      $panel = $slide.Shapes.AddShape(5, 43.2, 36, 873.6, 468)
      $panel.Name = "可编辑内容面板"
      $panel.Fill.Solid()
      $panel.Fill.ForeColor.RGB = To-OfficeColor 255 255 255
      $panel.Fill.Transparency = 0.03
      $panel.Line.ForeColor.RGB = To-OfficeColor 231 233 238
      $panel.Line.Weight = 1

      $accent = $slide.Shapes.AddShape(5, 63.36, 57.6, 8.64, 64.8)
      $accent.Name = "可编辑标题色条"
      $accent.Fill.Solid()
      $accent.Fill.ForeColor.RGB = To-OfficeColor 255 79 147
      $accent.Line.Visible = 0

      $title = Add-EditableTextBox $slide "可编辑标题" 83.52 55.44 799.2 72 ([string]$item.title) ([single]$item.titleSize) $true (To-OfficeColor 31 41 55) 1
      [Runtime.InteropServices.Marshal]::ReleaseComObject($title) | Out-Null

      $columns = @($item.columns)
      if ($columns.Count -le 1) {
        $bodyText = if ($columns.Count) { [string]$columns[0] } else { "" }
        $body = Add-EditableTextBox $slide "可编辑正文" 83.52 136.8 792 331.2 $bodyText ([single]$item.bodySize) $false (To-OfficeColor 55 65 81) 1
        [Runtime.InteropServices.Marshal]::ReleaseComObject($body) | Out-Null
      } else {
        $leftBody = Add-EditableTextBox $slide "可编辑正文左栏" 83.52 136.8 381.6 331.2 ([string]$columns[0]) ([single]$item.bodySize) $false (To-OfficeColor 55 65 81) 1
        $divider = $slide.Shapes.AddShape(1, 476.4, 145.44, 1.44, 308.4)
        $divider.Name = "可编辑分栏线"
        $divider.Fill.Solid()
        $divider.Fill.ForeColor.RGB = To-OfficeColor 229 231 235
        $divider.Line.Visible = 0
        $rightBody = Add-EditableTextBox $slide "可编辑正文右栏" 497.52 136.8 381.6 331.2 ([string]$columns[1]) ([single]$item.bodySize) $false (To-OfficeColor 55 65 81) 1
        [Runtime.InteropServices.Marshal]::ReleaseComObject($leftBody) | Out-Null
        [Runtime.InteropServices.Marshal]::ReleaseComObject($rightBody) | Out-Null
      }

      $pageNumber = Add-EditableTextBox $slide "可编辑页码" 832.8 486 72 24 ([string]$item.pageNumber) 12 $false (To-OfficeColor 156 163 175) 3
      [Runtime.InteropServices.Marshal]::ReleaseComObject($pageNumber) | Out-Null
    }
  }
  $presentation.SaveAs($OutputPath, 24)
} finally {
  if ($presentation -ne $null) {
    $presentation.Close()
    [Runtime.InteropServices.Marshal]::ReleaseComObject($presentation) | Out-Null
  }
  if ($powerPoint -ne $null) {
    $powerPoint.Quit()
    [Runtime.InteropServices.Marshal]::ReleaseComObject($powerPoint) | Out-Null
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
`;
    await fs.writeFile(scriptPath, `\uFEFF${script}`, "utf8");
    await runCommand(powerShell, [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-DataPath",
      dataPath,
      "-OutputPath",
      pptxPath
    ], {
      windowsHide: true,
      timeout: 600000,
      maxBuffer: 8 * 1024 * 1024
    });
    if (!existsSync(pptxPath)) throw new Error("Microsoft PowerPoint 未生成 PPT 文件");
    return true;
  } finally {
    await fs.rm(nativeDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function convertImagesToPpt(files, options = {}) {
  const useSlidePlan = Array.isArray(options.slidePlans) && options.slidePlans.length > 0 && options.mediaMap;

  // 多图层路径：slidePlans + mediaMap 直接拼装，不走 COM（COM 多图层改造在后续阶段）
  if (useSlidePlan) {
    const jobId = nanoid();
    const jobDir = path.join(uploadsRoot, "converted", jobId);
    await fs.mkdir(jobDir, { recursive: true });
    const pptName = normalizeOfficeFileName(options.pptName || options.fileName, "images", "pptx");
    const pptPath = path.join(jobDir, pptName);
    await writePptx({ pptxPath: pptPath, images: [], editableSlides: [], slidePlans: options.slidePlans, mediaMap: options.mediaMap });

    const outputFolder = String(options.outputFolder || "").trim();
    let savedOutputFolder = null;
    if (outputFolder) {
      savedOutputFolder = path.resolve(outputFolder);
      await fs.mkdir(savedOutputFolder, { recursive: true });
      await fs.copyFile(pptPath, path.join(savedOutputFolder, pptName));
    }
    return {
      jobId,
      fileName: pptName,
      slideCount: options.slidePlans.length,
      pptUrl: toPublicUrl(jobId, pptName),
      downloadUrl: `/api/convert/ppt/${jobId}/${encodeURIComponent(pptName)}`,
      outputFolder: savedOutputFolder
    };
  }

  const filteredFiles = [...(files || [])].filter((file) => imageExts.has(path.extname(file.originalname || "").toLowerCase()));
  const sourceFiles = shouldPreserveUploadOrder(options) ? filteredFiles : sortUploadedFiles(filteredFiles);
  if (!sourceFiles.length) throw new Error("请上传 jpg、png 或 webp 图片");

  const jobId = nanoid();
  const jobDir = path.join(uploadsRoot, "converted", jobId);
  await fs.mkdir(jobDir, { recursive: true });

  const images = [];
  for (const [index, file] of sourceFiles.entries()) {
    const image = sharp(file.buffer).rotate();
    const metadata = await image.metadata();
    const width = metadata.width || 1240;
    const height = metadata.height || 1754;
    const normalizedBuffer = await image.png().toBuffer();
    const editableSlide = options.editableSlides?.[index];
    const buffer = editableSlide && editableSlide.backgroundIsTextFree === false
      ? await sharp(normalizedBuffer).blur(24).modulate({ brightness: 1.08, saturation: 0.8 }).png().toBuffer()
      : normalizedBuffer;
    images.push({ width, height, buffer });
  }

  const pptName = normalizeOfficeFileName(options.pptName || options.fileName, "images", "pptx");
  const pptPath = path.join(jobDir, pptName);
  const nativePptCreated = await writePptxWithPowerPoint({
    pptxPath: pptPath,
    images,
    editableSlides: options.editableSlides || [],
    jobDir
  });
  if (!nativePptCreated) {
    await writePptx({ pptxPath: pptPath, images, editableSlides: options.editableSlides || [] });
  }

  const outputFolder = String(options.outputFolder || "").trim();
  let savedOutputFolder = null;
  if (outputFolder) {
    savedOutputFolder = path.resolve(outputFolder);
    await fs.mkdir(savedOutputFolder, { recursive: true });
    await fs.copyFile(pptPath, path.join(savedOutputFolder, pptName));
  }

  return {
    jobId,
    fileName: pptName,
    slideCount: images.length,
    pptUrl: toPublicUrl(jobId, pptName),
    downloadUrl: `/api/convert/ppt/${jobId}/${encodeURIComponent(pptName)}`,
    outputFolder: savedOutputFolder
  };
}

function normalizeStitchDirection(value) {
  return String(value || "vertical").toLowerCase() === "horizontal" ? "horizontal" : "vertical";
}

function normalizeStitchAlign(value) {
  const clean = String(value || "center").toLowerCase();
  return ["start", "center", "end"].includes(clean) ? clean : "center";
}

function normalizeStitchRatio(value) {
  return String(value || "auto").toLowerCase() === "3:4" ? "3:4" : "auto";
}

function normalizeStitchNumber(value, fallback, min, max) {
  const number = Number(value);
  return Math.min(Math.max(Number.isFinite(number) ? Math.round(number) : fallback, min), max);
}

function normalizeHexColor(value = "#ffffff") {
  const clean = String(value || "#ffffff").trim();
  return /^#[0-9a-f]{6}$/i.test(clean) ? clean : "#ffffff";
}

function stitchOffset(available, align) {
  if (align === "start") return 0;
  if (align === "end") return available;
  return Math.round(available / 2);
}

async function prepareStitchImages(files, direction, normalizeSize) {
  const prepared = [];
  for (const file of files) {
    const buffer = await sharp(file.buffer, { limitInputPixels: false }).rotate().png().toBuffer();
    const metadata = await sharp(buffer).metadata();
    prepared.push({
      name: file.originalname,
      buffer,
      width: metadata.width || 1,
      height: metadata.height || 1
    });
  }

  if (!normalizeSize || prepared.length < 2) return prepared;
  if (direction === "vertical") {
    const targetWidth = Math.max(...prepared.map((item) => item.width));
    return Promise.all(prepared.map(async (item) => {
      if (item.width === targetWidth) return item;
      const buffer = await sharp(item.buffer, { limitInputPixels: false }).rotate().resize({ width: targetWidth }).png().toBuffer();
      const metadata = await sharp(buffer).metadata();
      return { ...item, buffer, width: metadata.width || targetWidth, height: metadata.height || item.height };
    }));
  }

  const targetHeight = Math.max(...prepared.map((item) => item.height));
  return Promise.all(prepared.map(async (item) => {
    if (item.height === targetHeight) return item;
    const buffer = await sharp(item.buffer, { limitInputPixels: false }).rotate().resize({ height: targetHeight }).png().toBuffer();
    const metadata = await sharp(buffer).metadata();
    return { ...item, buffer, width: metadata.width || item.width, height: metadata.height || targetHeight };
  }));
}

function calculateStitchScale(width, height) {
  const maxDimension = 30000;
  const maxPixels = 200_000_000;
  return Math.min(1, maxDimension / width, maxDimension / height, Math.sqrt(maxPixels / (width * height)));
}

async function prepareThreeFourStitch(prepared, direction, gap, padding) {
  const count = prepared.length;
  if (direction === "vertical") {
    const sourceWidth = Math.max(...prepared.map((item) => item.width));
    const canvasWidth = Math.max(3, Math.ceil((sourceWidth + padding * 2) / 3) * 3);
    const contentWidth = canvasWidth - padding * 2;
    const canvasHeight = canvasWidth / 3 * 4;
    const usableHeight = canvasHeight - padding * 2;
    const actualGap = count > 1 ? Math.min(gap, Math.max(0, Math.floor((usableHeight - count) / (count - 1)))) : 0;
    const imageHeight = usableHeight - actualGap * (count - 1);
    const baseHeight = Math.max(1, Math.floor(imageHeight / count));
    let remainder = Math.max(0, imageHeight - baseHeight * count);
    const images = [];
    for (const item of prepared) {
      const height = baseHeight + (remainder > 0 ? 1 : 0);
      remainder = Math.max(0, remainder - 1);
      const buffer = await sharp(item.buffer, { limitInputPixels: false })
        .resize({ width: contentWidth, height, fit: "cover", position: "centre" })
        .png()
        .toBuffer();
      images.push({ ...item, buffer, width: contentWidth, height });
    }
    return { prepared: images, gap: actualGap };
  }

  const sourceHeight = Math.max(...prepared.map((item) => item.height));
  const canvasHeight = Math.max(4, Math.ceil((sourceHeight + padding * 2) / 4) * 4);
  const contentHeight = canvasHeight - padding * 2;
  const canvasWidth = canvasHeight / 4 * 3;
  const usableWidth = canvasWidth - padding * 2;
  if (usableWidth < count) throw new Error("3:4 横向拼接的外边距过大，请减小外边距");
  const actualGap = count > 1 ? Math.min(gap, Math.max(0, Math.floor((usableWidth - count) / (count - 1)))) : 0;
  const imageWidth = usableWidth - actualGap * (count - 1);
  const baseWidth = Math.max(1, Math.floor(imageWidth / count));
  let remainder = Math.max(0, imageWidth - baseWidth * count);
  const images = [];
  for (const item of prepared) {
    const width = baseWidth + (remainder > 0 ? 1 : 0);
    remainder = Math.max(0, remainder - 1);
    const buffer = await sharp(item.buffer, { limitInputPixels: false })
      .resize({ width, height: contentHeight, fit: "cover", position: "centre" })
      .png()
      .toBuffer();
    images.push({ ...item, buffer, width, height: contentHeight });
  }
  return { prepared: images, gap: actualGap };
}

export async function stitchImages(files, options = {}) {
  const filteredFiles = [...(files || [])].filter((file) => imageExts.has(path.extname(file.originalname || "").toLowerCase()));
  const sourceFiles = shouldPreserveUploadOrder(options) ? filteredFiles : sortUploadedFiles(filteredFiles);
  if (sourceFiles.length < 2) throw new Error("请至少上传 2 张图片");

  const direction = normalizeStitchDirection(options.direction);
  const align = normalizeStitchAlign(options.align);
  const ratio = normalizeStitchRatio(options.ratio);
  let gap = normalizeStitchNumber(options.gap, 0, 0, 200);
  let padding = normalizeStitchNumber(options.padding, 0, 0, 200);
  const normalizeSize = options.normalizeSize !== false && String(options.normalizeSize).toLowerCase() !== "false";
  const background = normalizeHexColor(options.background);
  const imageFormat = normalizeImageFormat(options.imageFormat || options.format);
  const quality = normalizeQuality(options.quality);
  let prepared = await prepareStitchImages(sourceFiles, direction, normalizeSize);
  if (ratio === "3:4") {
    gap = 0;
    padding = 0;
    const threeFour = await prepareThreeFourStitch(prepared, direction, gap, padding);
    prepared = threeFour.prepared;
    gap = threeFour.gap;
  }

  let contentWidth = direction === "vertical"
    ? Math.max(...prepared.map((item) => item.width))
    : prepared.reduce((sum, item) => sum + item.width, 0) + gap * (prepared.length - 1);
  let contentHeight = direction === "vertical"
    ? prepared.reduce((sum, item) => sum + item.height, 0) + gap * (prepared.length - 1)
    : Math.max(...prepared.map((item) => item.height));
  let baseCanvasWidth = contentWidth + padding * 2;
  let baseCanvasHeight = contentHeight + padding * 2;
  const scale = calculateStitchScale(baseCanvasWidth, baseCanvasHeight);

  if (scale < 1) {
    prepared = await Promise.all(prepared.map(async (item) => {
      const width = Math.max(1, Math.round(item.width * scale));
      const height = Math.max(1, Math.round(item.height * scale));
      const buffer = await sharp(item.buffer, { limitInputPixels: false }).rotate().resize({ width, height, fit: "fill" }).png().toBuffer();
      return { ...item, buffer, width, height };
    }));
    contentWidth = direction === "vertical"
      ? Math.max(...prepared.map((item) => item.width))
      : prepared.reduce((sum, item) => sum + item.width, 0) + Math.round(gap * scale) * (prepared.length - 1);
    contentHeight = direction === "vertical"
      ? prepared.reduce((sum, item) => sum + item.height, 0) + Math.round(gap * scale) * (prepared.length - 1)
      : Math.max(...prepared.map((item) => item.height));
    baseCanvasWidth = contentWidth + Math.round(padding * scale) * 2;
    baseCanvasHeight = contentHeight + Math.round(padding * scale) * 2;
  }

  const actualGap = scale < 1 ? Math.round(gap * scale) : gap;
  const actualPadding = scale < 1 ? Math.round(padding * scale) : padding;
  const composites = [];
  let cursor = actualPadding;
  for (const item of prepared) {
    const input = await sharp(item.buffer, { limitInputPixels: false }).rotate().png().toBuffer();
    if (direction === "vertical") {
      composites.push({ input, left: actualPadding + stitchOffset(contentWidth - item.width, align), top: cursor });
      cursor += item.height + actualGap;
    } else {
      composites.push({ input, left: cursor, top: actualPadding + stitchOffset(contentHeight - item.height, align) });
      cursor += item.width + actualGap;
    }
  }

  const jobId = nanoid();
  const jobDir = path.join(uploadsRoot, "converted", jobId);
  await fs.mkdir(jobDir, { recursive: true });
  const ext = imageExtension(imageFormat);
  const requestedBaseName = path.parse(sanitizeFileName(String(options.fileName || "图片拼接").replace(/\.(png|jpe?g|webp)$/i, ""))).name || "图片拼接";
  const fileName = `${requestedBaseName}.${ext}`;
  const outputPath = path.join(jobDir, fileName);
  const composedBuffer = await sharp({
    create: {
      width: baseCanvasWidth,
      height: baseCanvasHeight,
      channels: 4,
      background
    }
  }).composite(composites).png().toBuffer();
  const outputBuffer = await encodeImageBufferWithinLimit({
    sourceBuffer: composedBuffer,
    format: imageFormat,
    quality,
    maxBytes: 5 * 1024 * 1024
  });
  await fs.writeFile(outputPath, outputBuffer);
  const outputMetadata = await sharp(outputBuffer, { limitInputPixels: false }).metadata();
  const outputBox = {
    width: outputMetadata.width || baseCanvasWidth,
    height: outputMetadata.height || baseCanvasHeight
  };

  let savedOutputFolder = null;
  const outputFolder = String(options.outputFolder || "").trim();
  if (outputFolder) {
    savedOutputFolder = path.resolve(outputFolder);
    await fs.mkdir(savedOutputFolder, { recursive: true });
    await fs.copyFile(outputPath, path.join(savedOutputFolder, fileName));
  }

  const stat = await fs.stat(outputPath);
  return {
    jobId,
    fileName,
    width: outputBox.width,
    height: outputBox.height,
    ratio,
    imageCount: prepared.length,
    size: stat.size,
    scaled: scale < 1,
    imageUrl: toPublicUrl(jobId, fileName),
    downloadUrl: `/api/convert/image/${jobId}/${encodeURIComponent(fileName)}`,
    outputFolder: savedOutputFolder
  };
}

export async function convertPdfToWord(file, options = {}) {
  const ext = path.extname(file.originalname || "").toLowerCase();
  if (ext !== ".pdf") throw new Error("请上传 PDF 文件");

  const jobId = nanoid();
  const jobDir = path.join(uploadsRoot, "converted", jobId);
  await fs.mkdir(jobDir, { recursive: true });

  const baseName = sanitizeFileName(path.parse(file.originalname || "document").name) || "document";
  const sourcePdfName = normalizeOfficeFileName(file.originalname, baseName, "pdf");
  const sourcePdfPath = path.join(jobDir, sourcePdfName);
  await fs.writeFile(sourcePdfPath, file.buffer);

  const text = await extractDocumentText(file);
  const docxName = normalizeOfficeFileName(options.wordName || options.fileName || baseName, baseName, "docx");
  const docxPath = path.join(jobDir, docxName);
  await writeDocx({ docxPath, text, title: baseName });

  const outputFolder = String(options.outputFolder || "").trim();
  let savedOutputFolder = null;
  if (outputFolder) {
    savedOutputFolder = path.resolve(outputFolder);
    await fs.mkdir(savedOutputFolder, { recursive: true });
    await fs.copyFile(docxPath, path.join(savedOutputFolder, docxName));
  }

  return {
    jobId,
    fileName: docxName,
    wordUrl: toPublicUrl(jobId, docxName),
    downloadUrl: `/api/convert/word/${jobId}/${encodeURIComponent(docxName)}`,
    outputFolder: savedOutputFolder
  };
}
