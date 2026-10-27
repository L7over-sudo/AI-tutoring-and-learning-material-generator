import path from "node:path";
import mammoth from "mammoth";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import JSZip from "jszip";

const TEXT_EXTENSIONS = new Set([".txt", ".md"]);
const TEXT_CHARS_PER_PAGE = 1200;

function estimateTextPageCount(text = "") {
  const normalizedLength = String(text).replace(/\s/g, "").length;
  return Math.max(1, Math.ceil(normalizedLength / TEXT_CHARS_PER_PAGE));
}

async function docxSavedPageCount(buffer) {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const appXml = await zip.file("docProps/app.xml")?.async("string");
    const savedPages = Number(appXml?.match(/<Pages>(\d+)<\/Pages>/i)?.[1]);
    if (Number.isFinite(savedPages) && savedPages > 0) return savedPages;

    const documentXml = await zip.file("word/document.xml")?.async("string");
    const renderedBreaks = documentXml?.match(/<w:lastRenderedPageBreak\b[^>]*\/?\s*>/g)?.length || 0;
    if (renderedBreaks) return renderedBreaks + 1;
    const explicitBreaks = documentXml?.match(/<w:br\b[^>]*w:type=["']page["'][^>]*\/?\s*>/g)?.length || 0;
    if (explicitBreaks) return explicitBreaks + 1;
  } catch {
    // Fall back to text pagination for documents without saved layout metadata.
  }
  return null;
}

async function extractPdfPageText(pageData) {
  const content = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
  let lastY = null;
  let text = "";
  for (const item of content.items || []) {
    const currentY = item.transform?.[5];
    text += lastY === null || currentY === lastY ? String(item.str || "") : `\n${item.str || ""}`;
    lastY = currentY;
  }
  return text.trim();
}

export async function extractDocumentInfo(file) {
  const ext = path.extname(file.originalname || "").toLowerCase();

  if (TEXT_EXTENSIONS.has(ext)) {
    const text = file.buffer.toString("utf8");
    return { text, pageCount: estimateTextPageCount(text), pageCountSource: "auto-pagination" };
  }

  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    const text = result.value || "";
    const savedPageCount = await docxSavedPageCount(file.buffer);
    const estimatedPageCount = estimateTextPageCount(text);
    return {
      text,
      pageCount: savedPageCount || estimatedPageCount,
      savedPageCount,
      estimatedPageCount,
      pageCountSource: savedPageCount ? "saved-metadata" : "auto-pagination"
    };
  }

  if (ext === ".pdf") {
    const pages = [];
    const result = await pdfParse(file.buffer, {
      pagerender: async (pageData) => {
        const pageText = await extractPdfPageText(pageData);
        pages.push(pageText);
        return pageText;
      }
    });
    return {
      text: result.text || pages.join("\n\n"),
      pages,
      pageCount: Number(result.numpages || result.numrender || pages.length || 1) || 1,
      pageCountSource: "document"
    };
  }

  throw new Error("暂不支持该文档格式，请上传 txt、md、docx 或 pdf");
}

export async function extractDocumentText(file) {
  const info = await extractDocumentInfo(file);
  return info.text;
}

export function compactSourceText(text = "", maxLength = 12000) {
  return String(text)
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, maxLength);
}
