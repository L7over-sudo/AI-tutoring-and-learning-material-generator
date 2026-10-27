import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import axios from "axios";
import archiver from "archiver";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import { nanoid } from "nanoid";
import { uploadsRoot } from "./fileService.js";
import { configStore } from "../stores/configStore.js";
import { detectConfiguredProxy } from "./proxyDetectService.js";
import { sanitizeFileName } from "../utils/sanitizeFileName.js";
import { logService } from "./logService.js";

const REQUEST_TIMEOUT = 60000;
const MEDIA_TIMEOUT = 180000;
const MAX_MEDIA_BYTES = 500 * 1024 * 1024;
const BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const XHS_NOTE_URL_RE = /xiaohongshu\.com\/(?:explore|discovery\/item|note)\/([a-zA-Z0-9]+)/;
const INITIAL_STATE_RE = /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/;

function buildProxyAgent(config) {
  if (!config?.proxyHost || !config?.proxyPort || config.proxyProtocol === "direct") return null;
  const protocol = config.proxyProtocol === "socks5" ? "socks5" : "http";
  const proxyScheme = protocol === "socks5" ? "socks5h" : "http";
  const proxyUrl = `${proxyScheme}://${config.proxyHost}:${config.proxyPort}`;
  return protocol === "socks5" ? new SocksProxyAgent(proxyUrl) : new HttpsProxyAgent(proxyUrl);
}

function applyProxy(options, config) {
  const agent = buildProxyAgent(config);
  if (agent) {
    options.httpAgent = agent;
    options.httpsAgent = agent;
  }
  options.proxy = false;
  return options;
}

async function getActiveProxyConfig(config) {
  if (config?.proxyHost && config?.proxyPort && config.proxyProtocol !== "direct") return config;
  const detected = await detectConfiguredProxy().catch(() => null);
  return detected ? { ...config, ...detected } : config;
}

function axiosGet(url, config, extra = {}) {
  const options = {
    timeout: REQUEST_TIMEOUT,
    headers: {
      "User-Agent": BROWSER_USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9",
      ...(extra.headers || {})
    },
    maxRedirects: extra.maxRedirects ?? 5,
    validateStatus: (status) => status >= 200 && status < 400,
    ...extra
  };
  applyProxy(options, config);
  return axios.get(url, options);
}

async function axiosGetWithProxyFallback(url, config, extra = {}) {
  const failures = [];
  const activeConfig = await getActiveProxyConfig(config);
  try {
    return await axiosGet(url, activeConfig, extra);
  } catch (error) {
    failures.push(error.message || String(error));
    logService.warn("xhs", `请求失败，尝试自动探测代理重试：${failures[0]}`);
    const detected = await detectConfiguredProxy().catch(() => null);
    if (detected) {
      try {
        return await axiosGet(url, { ...activeConfig, ...detected }, extra);
      } catch (retryError) {
        failures.push(retryError.message || String(retryError));
      }
    }
  }
  throw new Error(`无法访问小红书：${failures.join("；")}`);
}

function extractNoteId(input) {
  const text = String(input || "").trim();
  if (!text) return "";
  const directMatch = text.match(XHS_NOTE_URL_RE);
  if (directMatch) return directMatch[1];
  if (/^[a-zA-Z0-9]{16,}$/.test(text)) return text;
  return "";
}

async function resolveShortLink(url, config) {
  try {
    const response = await axiosGetWithProxyFallback(url, config, { maxRedirects: 0, validateStatus: () => true });
    const location = response.headers?.location || "";
    if (location && XHS_NOTE_URL_RE.test(location)) return location;
  } catch {
    // 短链跳转失败，下面用跟随重定向再试一次
  }
  const followed = await axiosGetWithProxyFallback(url, config, { maxRedirects: 10, validateStatus: () => true });
  const finalUrl = followed.request?.res?.responseUrl || followed.config?.url || "";
  if (XHS_NOTE_URL_RE.test(finalUrl)) return finalUrl;
  return "";
}

async function resolveNoteUrl(input, config) {
  const text = String(input || "").trim();
  // 已经是 explore/discovery/note 完整链接（可能带 xsec_token），直接用
  if (XHS_NOTE_URL_RE.test(text)) return text;
  // 短链或其它 http 链接：跟随重定向拿最终 URL
  if (/xhslink\.com\//i.test(text) || /^https?:\/\//i.test(text)) {
    const finalUrl = await resolveShortLink(text, config);
    if (XHS_NOTE_URL_RE.test(finalUrl)) return finalUrl;
  }
  // 纯 noteId 字符串
  if (/^[a-zA-Z0-9]{16,}$/.test(text)) {
    return `https://www.xiaohongshu.com/explore/${text}`;
  }
  return "";
}

function parseInitialState(html) {
  const match = String(html || "").match(INITIAL_STATE_RE);
  if (!match) return null;
  const raw = match[1].replace(/undefined/g, "null");
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function pickImageBestUrl(imageItem) {
  if (!imageItem) return "";
  if (imageItem.urlDefault) return imageItem.urlDefault;
  const infoList = Array.isArray(imageItem.infoList) ? imageItem.infoList : [];
  const sorted = [...infoList].sort((a, b) => (Number(b?.width) || 0) - (Number(a?.width) || 0));
  return sorted[0]?.url || imageItem.url || "";
}

function pickVideoUrl(video) {
  const streams = video?.media?.stream;
  if (!streams) return "";
  const h264 = Array.isArray(streams.h264) ? streams.h264 : [];
  return h264[0]?.masterUrl || h264[0]?.backupUrls?.[0] || "";
}

function extractNoteMedia(state, noteId) {
  if (!state?.note) return null;
  // 小红书笔记数据存在 note.noteDetailMap[noteId].note（新结构），
  // 旧版本可能是 note.noteDataMap[noteId]，这里两个都兼容。
  const detailMap = state.note.noteDetailMap || state.note.noteDataMap;
  if (!detailMap) return null;
  const entry = detailMap[noteId];
  const note = entry?.note || entry?.noteDataMap?.[noteId]?.note || entry;
  if (!note) return null;

  const title = String(note.title || "").trim();
  const desc = String(note.desc || "").trim();
  const images = [];
  const videos = [];

  const imageList = Array.isArray(note.imageList) ? note.imageList : [];
  for (const item of imageList) {
    const url = pickImageBestUrl(item);
    if (url) images.push(url);
  }

  if (note.video) {
    const videoUrl = pickVideoUrl(note.video);
    if (videoUrl) videos.push(videoUrl);
  }

  if (!images.length && !videos.length) return null;
  return { title, desc, images, videos };
}

function extFromContentType(contentType) {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("png")) return ".png";
  if (type.includes("webp")) return ".webp";
  if (type.includes("mp4")) return ".mp4";
  if (type.includes("video")) return ".mp4";
  return ".jpg";
}

function toPublicUrl(jobId, relativeName) {
  return `/static/converted/${jobId}/${relativeName.split(/[\\/]/).map(encodeURIComponent).join("/")}`;
}

async function downloadMedia(url, config, referer) {
  const options = {
    timeout: MEDIA_TIMEOUT,
    responseType: "arraybuffer",
    maxContentLength: MAX_MEDIA_BYTES,
    maxRedirects: 10,
    headers: {
      "User-Agent": BROWSER_USER_AGENT,
      Referer: referer || "https://www.xiaohongshu.com/",
      Accept: "*/*"
    }
  };
  applyProxy(options, config);
  const response = await axios.get(url, options);
  return { buffer: Buffer.from(response.data), contentType: response.headers?.["content-type"] || "" };
}

async function downloadAllMedia(media, jobDir, config) {
  const noteReferer = "https://www.xiaohongshu.com/";
  const items = [];
  const imageFiles = [];
  const videoFiles = [];

  for (let index = 0; index < media.images.length; index += 1) {
    const url = media.images[index];
    try {
      const { buffer, contentType } = await downloadMedia(url, config, noteReferer);
      const ext = extFromContentType(contentType);
      const name = `图片-${String(index + 1).padStart(2, "0")}${ext}`;
      await fs.writeFile(path.join(jobDir, name), buffer);
      imageFiles.push(name);
      items.push({ type: "image", name });
    } catch (error) {
      logService.warn("xhs", `图片 ${index + 1} 下载失败：${error.message || error}`);
    }
  }

  for (let index = 0; index < media.videos.length; index += 1) {
    const url = media.videos[index];
    try {
      const { buffer, contentType } = await downloadMedia(url, config, noteReferer);
      const ext = extFromContentType(contentType);
      const name = `视频-${String(index + 1).padStart(2, "0")}${ext}`;
      await fs.writeFile(path.join(jobDir, name), buffer);
      videoFiles.push(name);
      items.push({ type: "video", name });
    } catch (error) {
      logService.warn("xhs", `视频 ${index + 1} 下载失败：${error.message || error}`);
    }
  }

  const textContent = [media.title, media.desc].filter(Boolean).join("\n\n");
  if (textContent) {
    await fs.writeFile(path.join(jobDir, "笔记文案.txt"), `﻿${textContent}`, "utf8");
  }

  return { items, imageFiles, videoFiles };
}

async function zipJobDir(jobDir, fileNames, zipName = "作品解析.zip") {
  const zipPath = path.join(jobDir, zipName);
  await new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);
    for (const name of fileNames) {
      archive.file(path.join(jobDir, name), { name });
    }
    archive.finalize();
  });
  return zipPath;
}

export async function parseXhsNote(rawUrl) {
  const config = await configStore.getRaw();

  // 解析出最终的笔记 URL（必须保留 xsec_token 查询参数，否则小红书不返回笔记数据）
  const noteUrl = await resolveNoteUrl(rawUrl, config);
  if (!noteUrl) {
    throw new Error("无法识别小红书笔记链接，请粘贴 xhslink.com 短链或 www.xiaohongshu.com/explore/... 完整链接");
  }
  const noteId = extractNoteId(noteUrl);

  const headers = { "User-Agent": BROWSER_USER_AGENT };
  if (config.xhsCookie) headers.Cookie = String(config.xhsCookie).trim();

  let response;
  try {
    response = await axiosGetWithProxyFallback(noteUrl, config, { headers, maxRedirects: 0 });
  } catch (error) {
    throw new Error(`请求小红书失败：${error.message || error}`);
  }

  const state = parseInitialState(response.data);
  const media = extractNoteMedia(state, noteId);

  if (!media) {
    throw new Error("解析失败，该链接可能不是公开笔记，或分享链接已过期。请重新从小红书点「分享 → 复制链接」获取最新链接后重试");
  }

  const jobId = nanoid();
  const jobDir = path.join(uploadsRoot, "converted", jobId);
  await fs.mkdir(jobDir, { recursive: true });

  const { items, imageFiles, videoFiles } = await downloadAllMedia(media, jobDir, config);

  if (!items.length) {
    throw new Error("已解析出笔记，但所有媒体下载失败，请检查网络或代理后重试");
  }

  const allFiles = [...imageFiles, ...videoFiles, "笔记文案.txt"].filter((name) => name);
  const zipPath = await zipJobDir(jobDir, allFiles, "作品解析.zip");

  const thumbFile = imageFiles[0] || videoFiles[0] || "";
  const publicItems = items.map((item) => ({ ...item, url: toPublicUrl(jobId, item.name) }));

  return {
    jobId,
    title: media.title,
    desc: media.desc,
    imageCount: imageFiles.length,
    videoCount: videoFiles.length,
    thumbUrl: thumbFile ? toPublicUrl(jobId, thumbFile) : "",
    items: publicItems,
    zipName: path.basename(zipPath),
    downloadUrl: `/api/convert/xhs-download/${jobId}`
  };
}
