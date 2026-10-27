import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { nanoid } from "nanoid";
import { uploadsRoot } from "../paths.js";
import { sanitizeFileName } from "../utils/sanitizeFileName.js";

const execFileAsync = promisify(execFile);

function resolvePowerShell() {
  if (process.platform !== "win32") return null;
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  return path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function normalizeRenderedPageText(value = "") {
  return String(value)
    .replace(/[\u0007\u000c]/g, "")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractWordRenderedPages(file) {
  const powerShell = resolvePowerShell();
  if (!powerShell) throw new Error("当前系统无法调用 Microsoft Word 重新分页");
  if (!file?.buffer) throw new Error("缺少 Word 文档内容");

  const jobDir = path.join(uploadsRoot, "presentations", `word-pages-${nanoid()}`);
  await fs.mkdir(jobDir, { recursive: true });
  const inputName = sanitizeFileName(file.originalname || "document.docx");
  const inputPath = path.join(jobDir, inputName);
  const scriptPath = path.join(jobDir, "count-word-pages.ps1");
  const script = `
param([string]$InputPath)
$ErrorActionPreference = "Stop"
$word = $null
$doc = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $word.AutomationSecurity = 3
  $doc = $word.Documents.Open($InputPath, $false, $true, $false)
  $doc.Repaginate()
  $pages = [int]$doc.ComputeStatistics(2)
  Write-Output "__PAGE_COUNT__=$pages"
  for ($pageNumber = 1; $pageNumber -le $pages; $pageNumber++) {
    $currentStartRange = $null
    $nextStartRange = $null
    $pageRange = $null
    try {
      $currentStartRange = $doc.GoTo(1, 1, $pageNumber)
      $start = [int]$currentStartRange.Start
      if ($pageNumber -lt $pages) {
        $nextStartRange = $doc.GoTo(1, 1, $pageNumber + 1)
        $end = [int]$nextStartRange.Start
      } else {
        $end = [int]$doc.Content.End
      }
      if ($end -lt $start) { $end = $start }
      $pageRange = $doc.Range($start, $end)
      $bytes = [System.Text.Encoding]::UTF8.GetBytes([string]$pageRange.Text)
      $encoded = [Convert]::ToBase64String($bytes)
      Write-Output "__PAGE_TEXT__=$pageNumber|$encoded"
    } finally {
      if ($pageRange -ne $null) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($pageRange) | Out-Null }
      if ($nextStartRange -ne $null) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($nextStartRange) | Out-Null }
      if ($currentStartRange -ne $null) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($currentStartRange) | Out-Null }
    }
  }
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
`;

  try {
    await fs.writeFile(inputPath, file.buffer);
    await fs.writeFile(scriptPath, `\uFEFF${script}`, "utf8");
    const result = await execFileAsync(powerShell, [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", scriptPath, "-InputPath", inputPath
    ], {
      windowsHide: true,
      timeout: 180000,
      maxBuffer: 32 * 1024 * 1024
    });
    const stdout = String(result.stdout || "");
    const pageCount = Number(stdout.match(/__PAGE_COUNT__=(\d+)/)?.[1]);
    if (!Number.isFinite(pageCount) || pageCount < 1) throw new Error("Microsoft Word 未返回有效页数");
    const pages = Array.from({ length: pageCount }, () => "");
    for (const match of stdout.matchAll(/^__PAGE_TEXT__=(\d+)\|([A-Za-z0-9+/=]*)$/gm)) {
      const pageIndex = Number(match[1]) - 1;
      if (pageIndex < 0 || pageIndex >= pageCount) continue;
      pages[pageIndex] = normalizeRenderedPageText(Buffer.from(match[2], "base64").toString("utf8"));
    }
    if (pages.every((page) => !page)) throw new Error("Microsoft Word 未返回逐页文字");
    return { pageCount, pages };
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("未找到 Microsoft Word 或 Windows PowerShell");
    if (error?.killed || error?.signal) throw new Error("Microsoft Word 读取页数超时");
    throw new Error(`Microsoft Word 实际页数读取失败：${error.message}`);
  } finally {
    await fs.rm(jobDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function detectWordRenderedPageCount(file) {
  return (await extractWordRenderedPages(file)).pageCount;
}
