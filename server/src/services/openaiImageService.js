import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import FormData from "form-data";
import sharp from "sharp";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import { mimeFromFile } from "../utils/imageUtils.js";
import { logService } from "./logService.js";
import { configStore } from "../stores/configStore.js";

const workingProxyProtocols = new Map();
const BALANCE_ERROR_MESSAGE = "API \u4F59\u989D\u4E0D\u8DB3\uFF1A\u5F53\u524D\u8D26\u53F7\u4F59\u989D\u6216\u989D\u5EA6\u4E0D\u8DB3\uFF0C\u8BF7\u5145\u503C\u540E\u91CD\u8BD5\uFF0C\u6216\u66F4\u6362\u6709\u4F59\u989D\u7684 API Key\u3002";
const USER_NETWORK_ERROR_MESSAGE = "网络连接不稳定：暂时无法直连 API 服务，请稍后重试，并检查网络、DNS 或防火墙设置。";

function normalizeBaseUrl(baseUrl = "https://api.openai.com/v1") {
  const clean = String(baseUrl || "https://api.openai.com/v1").trim();
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(clean) ? clean : `https://${clean}`;
  return withProtocol.replace(/\/+$/, "");
}

function normalizeApimartBaseUrl(baseUrl = "https://api.apimart.ai/v1") {
  const clean = normalizeBaseUrl(baseUrl || "https://api.apimart.ai/v1");
  return clean.endsWith("/v1") ? clean : `${clean}/v1`;
}

function isBalanceErrorText(text = "", status) {
  const value = String(text || "").toLowerCase();
  return (
    status === 402 ||
    /\u4F59\u989D\u4E0D\u8DB3|\u4F59\u989D\u4E0D(?:\u591F|\u8DB3)|\u989D\u5EA6\u4E0D\u8DB3|\u989D\u5EA6\u5DF2\u7528\u5B8C|\u989D\u5EA6\u8017\u5C3D|\u8D26\u6237\u6B20\u8D39|\u8D26\u53F7\u6B20\u8D39|\u8BF7\u5145\u503C|\u5145\u503C\u540E|\u7528\u91CF\u6216\u8D26\u5355\u4E0A\u9650|\u8D26\u5355\u4E0A\u9650|billing hard limit|insufficient.*(?:balance|quota|credit|fund)|(?:balance|quota|credit|fund).*insufficient|not enough.*(?:balance|quota|credit|fund)|quota.*(?:exceeded|exhausted|reached)|(?:exceeded|exhausted|reached).*quota|credit.*(?:exceeded|exhausted|used up)|payment required|out of credits|no credits/i.test(value)
  );
}
function sanitizeApiText(text = "") {
  return String(text || "")
    .replace(/sk-[^\s"'，。,:;]+/g, "sk-****")
    .slice(0, 800);
}

function safeJson(value, max = 600) {
  try {
    return JSON.stringify(value, (key, item) => (typeof item === "bigint" ? String(item) : item)).slice(0, max);
  } catch {
    return "";
  }
}

function apiValueToText(value, fallback = "") {
  if (value == null || value === "") return fallback;
  if (typeof value === "string") return sanitizeApiText(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Error) return sanitizeApiText(value.message || fallback);
  if (Array.isArray(value)) {
    const parts = value.map((item) => apiValueToText(item)).filter(Boolean);
    return parts.length ? parts.join("；") : fallback;
  }
  if (typeof value === "object") {
    const candidates = [
      value.message,
      value.msg,
      value.detail,
      value.reason,
      value.description,
      value.error_description,
      value.fail_reason,
      value.error?.message,
      value.error?.msg,
      value.error,
      value.data?.message,
      value.data?.msg,
      value.data?.error?.message,
      value.data?.error,
      value.data?.fail_reason
    ];
    const message = candidates.map((item) => apiValueToText(item)).find(Boolean);
    const preview = safeJson(value);
    if (message && preview && !preview.includes(message)) return sanitizeApiText(`${message}；详情：${preview}`);
    return sanitizeApiText(message || preview || fallback);
  }
  return sanitizeApiText(String(value || fallback));
}

function apimartStatus(data) {
  return data?.status || data?.data?.status || data?.state || data?.data?.state;
}

function apimartFailureMessage(data, fallback = "APIMart 返回任务失败") {
  const message = apiValueToText(
    data?.error ||
      data?.data?.error ||
      data?.fail_reason ||
      data?.data?.fail_reason ||
      data?.message ||
      data?.msg ||
      data?.data?.message ||
      data?.data?.msg ||
      data,
    fallback
  );
  return message || fallback;
}
function publicError(error) {
  const status = error?.response?.status;
  const responseData = error?.response?.data;
  const responseMessage =
    responseData?.error?.message ||
    responseData?.message ||
    responseData?.msg ||
    responseData?.error ||
    (typeof responseData === "string" ? responseData : "");
  const fallbackDetail = describeRequestError(error);
  const msg = responseMessage || error?.message || (typeof error === "string" ? error : "") || fallbackDetail || "OpenAI 图像接口调用失败";
  const rawMsg = String(msg);
  const rawDetail = `${rawMsg} ${typeof responseData === "string" ? responseData : responseData ? JSON.stringify(responseData) : ""} ${fallbackDetail}`;
  if (isBalanceErrorText(rawDetail, status)) {
    return BALANCE_ERROR_MESSAGE;
  }
  if (status === 401 || /incorrect api key/i.test(rawMsg)) {
    return "OpenAI 401: API Key 无效，请在 API 设置中重新粘贴新的完整 Key";
  }
  if (/billing hard limit/i.test(rawMsg)) {
    return "OpenAI 400: 当前账号已达到用量或账单上限，请检查 Billing 或更换可用 API Key";
  }
  if (/image_url fetch failed:\s*HTTP 403/i.test(rawMsg)) {
    return "HFSY 无法读取参考图链接（HTTP 403），请重试上传或更换参考图。";
  }
  if (/\bENOENT\b|no such file or directory/i.test(rawMsg)) {
    return "本地参考图文件不存在，请重新导入图片后重试。";
  }
  if (/所有连接方式均失败|ETIMEDOUT|ESOCKETTIMEDOUT|AggregateError|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|TLS|Client network socket disconnected/i.test(rawMsg)) {
    return USER_NETWORK_ERROR_MESSAGE;
  }
  if (/Client network socket disconnected before secure TLS connection was established/i.test(rawMsg)) {
    return USER_NETWORK_ERROR_MESSAGE;
  }
  if (status === 401 || /invalid api key|unauthorized/i.test(rawMsg)) {
    return "API Key 无效，请在 API 设置中重新粘贴 APIMart 控制台创建的完整 Key";
  }
  const safeMsg = rawMsg.replace(/sk-[^\s"'，。,:;]+/g, "sk-****");
  return status ? `OpenAI ${status}: ${safeMsg}` : safeMsg;
}

function describeRequestError(error) {
  if (!error) return "";
  const status = error?.response?.status;
  const data = error?.response?.data;
  const responseText = apiValueToText(data);
  const message = apiValueToText(error?.message || error);
  const combined = status
    ? `HTTP ${status}: ${responseText || message}`
    : `${error?.code ? `${error.code}: ` : ""}${message || safeJson(error)}`;
  return sanitizeApiText(combined).slice(0, 500);
}

function requestErrorText(error) {
  const parts = [
    error?.code,
    error?.errno,
    error?.message,
    error?.cause?.code,
    error?.cause?.message,
    describeRequestError(error)
  ];
  if (Array.isArray(error?.errors)) {
    for (const item of error.errors) {
      parts.push(item?.code, item?.errno, item?.message);
    }
  }
  return parts.map((item) => apiValueToText(item)).filter(Boolean).join(" ");
}

function isRetryableConnectionError(error) {
  return /socket hang up|socket disconnected|TLS|ECONNABORTED|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ESOCKETTIMEDOUT|ENOENT|ENOTFOUND|EAI_AGAIN|fetch failed|Proxy connection|AggregateError|timeout of \d+ms exceeded/i.test(requestErrorText(error));
}

function axiosOptions(config, signal, headers = {}) {
  const options = {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      ...headers
    },
    timeout: Number(config.timeoutMs || 240000),
    signal,
    proxy: false
  };
  if (config.proxyHost && config.proxyPort && config.proxyProtocol !== "direct") {
    const protocol = config.proxyProtocol === "socks5" ? "socks5" : "http";
    const proxyScheme = protocol === "socks5" ? "socks5h" : "http";
    const proxyUrl = `${proxyScheme}://${config.proxyHost}:${config.proxyPort}`;
    const agent = protocol === "socks5" ? new SocksProxyAgent(proxyUrl) : new HttpsProxyAgent(proxyUrl);
    options.httpAgent = agent;
    options.httpsAgent = agent;
  }
  return options;
}

function connectionProtocols(config = {}) {
  if (config.proxyProtocol === "direct" || !config.proxyHost || !config.proxyPort) return ["direct"];

  const proxyKey = `${config.proxyHost}:${config.proxyPort}`;
  const remembered = workingProxyProtocols.get(proxyKey);
  const primary = config.proxyProtocol === "socks5" ? "socks5" : "http";
  const secondary = primary === "socks5" ? "http" : "socks5";
  // A stale local proxy must never make a provider permanently unreachable.
  // Try the configured proxy protocols first, then fall back to a clean direct
  // connection for every provider (including HFSY).
  const fallback = ["direct"];
  if (remembered) return [...new Set([remembered, primary, secondary, ...fallback])];
  return [...new Set([primary, secondary, ...fallback])];
}

function connectionLabel(protocol) {
  if (protocol === "http") return "HTTP 代理";
  if (protocol === "socks5") return "SOCKS5 代理";
  return "直连";
}

async function tryRequestProtocols(config, request, failures) {
  const protocols = connectionProtocols(config);
  const proxyKey = `${config.proxyHost || ""}:${config.proxyPort || ""}`;
  let lastError;

  for (const proxyProtocol of protocols) {
    try {
      const response = await request({ ...config, proxyProtocol });
      if (proxyProtocol !== "direct" && proxyKey !== ":" && workingProxyProtocols.get(proxyKey) !== proxyProtocol) {
        workingProxyProtocols.set(proxyKey, proxyProtocol);
        if (!config.skipConnectionPersistence && config.proxyProtocol !== proxyProtocol) {
          configStore.update({ proxyProtocol }).catch(() => {});
          logService.success("proxy", `已自动切换到可用代理协议：${connectionLabel(proxyProtocol)}`);
        }
      }
      if (proxyProtocol === "direct" && !config.skipConnectionPersistence && config.proxyHost && config.proxyPort) {
        configStore.update({ proxyHost: "", proxyPort: "", proxyProtocol: "direct" }).catch(() => {});
        logService.warn("proxy", `${String(config.provider || "API").toUpperCase()} 本地代理不可用，已自动切换为直连`);
      }
      return response;
    } catch (error) {
      lastError = error;
      failures.push(`${connectionLabel(proxyProtocol)}: ${describeRequestError(error)}`);
      const retryable = isRetryableConnectionError(error);
      if (!retryable) throw error;
    }
  }

  return { lastError };
}

async function axiosRequestWithProxyFallback(config, request) {
  const failures = [];
  const first = await tryRequestProtocols(config, request, failures);
  if (first?.data) return first;

  throw new Error(`所有连接方式均失败：${failures.join("；") || describeRequestError(first.lastError)}`);
}

function isApimartConfig(config) {
  const baseUrl = String(config.baseUrl || "");
  if (baseUrl.includes("hfsyapi.cn")) return false;
  return config.provider === "apimart" || baseUrl.includes("apimart.ai");
}

function isHfsyConfig(config) {
  return config.provider === "hfsy" || String(config.baseUrl || "").includes("hfsyapi.cn");
}

function isLtutuaiConfig(config) {
  return config.provider === "ltutuai" || String(config.baseUrl || "").includes("ltutuai.top");
}

function isTuziConfig(config) {
  return config.provider === "tuzi" || String(config.baseUrl || "").includes("tu-zi.com");
}

const HFSY_MAX_REFERENCE_BYTES = 5 * 1024 * 1024;
const HFSY_REFERENCE_UPLOAD_CACHE_MS = 60 * 60 * 1000;
const hfsyReferenceUploadCache = new Map();

function normalizeHfsyQuality(quality = "1k") {
  const value = String(quality || "1k").toLowerCase();
  return ["2k", "4k"].includes(value) ? value : "1k";
}

function hfsyAspectRatio(size = "1:1") {
  const value = String(size || "1:1").trim();
  const pixelRatios = {
    "1024x1024": "1:1", "2048x2048": "1:1", "2880x2880": "1:1",
    "1040x832": "5:4", "2080x1664": "5:4", "3200x2560": "5:4",
    "720x1280": "9:16", "1152x2048": "9:16", "2160x3840": "9:16",
    "1280x720": "16:9", "2048x1152": "16:9", "3840x2160": "16:9",
    "1024x768": "4:3", "2048x1536": "4:3", "3264x2448": "4:3",
    "1008x672": "3:2", "2016x1344": "3:2", "3504x2336": "3:2", "1536x1024": "3:2",
    "832x1040": "4:5", "1664x2080": "4:5", "2560x3200": "4:5",
    "768x1024": "3:4", "1536x2048": "3:4", "2448x3264": "3:4",
    "672x1008": "2:3", "1344x2016": "2:3", "2336x3504": "2:3", "1024x1536": "2:3",
    "1344x576": "21:9", "2016x864": "21:9", "3696x1584": "21:9"
  };
  const supportedRatios = ["1:1", "5:4", "9:16", "16:9", "4:3", "3:2", "4:5", "3:4", "2:3", "21:9"];
  if (pixelRatios[value]) return pixelRatios[value];
  if (supportedRatios.includes(value)) return value;
  if (["2:1"].includes(value)) return "16:9";
  if (["1:2", "9:21"].includes(value)) return "9:16";
  return "1:1";
}

function mapSizeForHfsy(size = "1:1", quality = "1k") {
  const resolution = normalizeHfsyQuality(quality);
  const ratio = isOriginalSizeLabel(size) ? "3:4" : hfsyAspectRatio(size);
  const sizes = {
    "1k": {
      "1:1": "1024x1024", "5:4": "1040x832", "9:16": "720x1280", "16:9": "1280x720",
      "4:3": "1024x768", "3:2": "1008x672", "4:5": "832x1040", "3:4": "768x1024",
      "2:3": "672x1008", "21:9": "1344x576"
    },
    "2k": {
      "1:1": "2048x2048", "5:4": "2080x1664", "9:16": "1152x2048", "16:9": "2048x1152",
      "4:3": "2048x1536", "3:2": "2016x1344", "4:5": "1664x2080", "3:4": "1536x2048",
      "2:3": "1344x2016", "21:9": "2016x864"
    },
    "4k": {
      "1:1": "2880x2880", "5:4": "3200x2560", "9:16": "2160x3840", "16:9": "3840x2160",
      "4:3": "3264x2448", "3:2": "3504x2336", "4:5": "2560x3200", "3:4": "2448x3264",
      "2:3": "2336x3504", "21:9": "3696x1584"
    }
  };
  return sizes[resolution][ratio];
}

function normalizeHfsyGptImageModel(model = "gpt-image-2") {
  return String(model || "").trim() === "gpt-image-2.5" ? "gpt-image-2.5" : "gpt-image-2";
}

function apimartUploadConfigFrom(config = {}) {
  const profile = config.providerSettings?.apimart || {};
  const apiKey = String(config.providerApiKeys?.apimart || "").trim();
  if (!apiKey) {
    throw new Error("HFSY 参考图需要先上传为图片 URL：请在 API 设置中为 APIMart 保存一个 API Key（APIMart 仅上传参考图，生图仍由 HFSY 完成）");
  }
  return {
    ...config,
    ...profile,
    provider: "apimart",
    apiKey,
    baseUrl: profile.baseUrl || "https://api.apimart.ai/v1",
    // This request borrows APIMart only as HFSY's reference-image uploader.
    // It must not overwrite the user's currently active provider profile.
    skipConnectionPersistence: true
  };
}

async function uploadReferenceImageForHfsy(referenceImagePath, config, signal) {
  const stat = await fs.promises.stat(referenceImagePath);
  if (stat.size > HFSY_MAX_REFERENCE_BYTES) {
    throw new Error(`HFSY 参考图不能超过 5MB，当前文件为 ${(stat.size / 1024 / 1024).toFixed(2)}MB`);
  }
  if (signal?.aborted) throw new Error(signal.reason?.message || "任务已取消");

  const cacheKey = `${referenceImagePath}:${stat.size}:${stat.mtimeMs}`;
  const cached = hfsyReferenceUploadCache.get(cacheKey);
  if (cached?.url && cached.expiresAt > Date.now()) return cached.url;

  let uploadPromise = cached?.promise;
  if (!uploadPromise) {
    const uploadConfig = apimartUploadConfigFrom(config);
    uploadPromise = uploadImageToApimart(referenceImagePath, uploadConfig)
      .then((url) => {
        hfsyReferenceUploadCache.set(cacheKey, {
          url,
          expiresAt: Date.now() + HFSY_REFERENCE_UPLOAD_CACHE_MS
        });
        return url;
      })
      .catch((error) => {
        hfsyReferenceUploadCache.delete(cacheKey);
        throw error;
      });
    hfsyReferenceUploadCache.set(cacheKey, { promise: uploadPromise, expiresAt: 0 });
  }

  const url = await uploadPromise;
  if (signal?.aborted) throw new Error(signal.reason?.message || "任务已取消");
  return url;
}
async function referenceImageAsDataUrl(referenceImagePath) {
  const stat = await fs.promises.stat(referenceImagePath);
  if (stat.size > HFSY_MAX_REFERENCE_BYTES) {
    throw new Error(`HFSY 参考图不能超过 5MB，当前文件为 ${(stat.size / 1024 / 1024).toFixed(2)}MB`);
  }
  const content = await fs.promises.readFile(referenceImagePath, { encoding: "base64" });
  return `data:${mimeFromFile(referenceImagePath)};base64,${content}`;
}

async function referenceImageAsInlineData(referenceImagePath) {
  const dataUrl = await referenceImageAsDataUrl(referenceImagePath);
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/s);
  if (!match) throw new Error("参考图无法转换为 Base64 inlineData");
  return { mimeType: match[1], data: match[2] };
}

export function extractCompatibleImageResult(data) {
  const nanoParts = Array.isArray(data?.candidates)
    ? data.candidates.flatMap((candidate) => candidate?.content?.parts || [])
    : [];
  const containers = [
    ...nanoParts,
    data?.data?.[0],
    data?.data,
    data?.result?.data?.[0],
    data?.result,
    data?.output?.[0],
    data?.output,
    data
  ].filter(Boolean);

  for (const container of containers) {
    if (typeof container === "string") {
      if (/^https?:\/\//i.test(container)) return { url: container };
      continue;
    }
    if (Array.isArray(container)) continue;
    const fileUri = container?.fileData?.fileUri || container?.file_data?.file_uri;
    if (typeof fileUri === "string" && fileUri.trim()) return { url: fileUri.trim() };
    const inlineData = container?.inlineData || container?.inline_data;
    if (typeof inlineData?.data === "string" && inlineData.data.trim()) {
      return { b64Json: inlineData.data.replace(/\s+/g, ""), mimeType: inlineData.mimeType || inlineData.mime_type || "image/png" };
    }
    for (const field of ["b64_data", "b64_json", "image_base64", "base64", "url", "image_url", "imageUrl", "file_url", "download_url"]) {
      let value = container?.[field];
      if (Array.isArray(value)) value = value[0];
      if (typeof value !== "string" || !value.trim()) continue;
      value = value.trim();
      if (/^https?:\/\//i.test(value)) return { url: value };
      const markdownUrl = value.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/i) || value.match(/(https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|webp)(?:\?[^\s"'<>]*)?)/i);
      if (markdownUrl) return { url: markdownUrl[1] };
      const dataUrl = value.match(/^data:([^;,]+);base64,(.+)$/s);
      if (dataUrl) return { b64Json: dataUrl[2], mimeType: dataUrl[1] };
      if (["b64_data", "b64_json", "image_base64", "base64"].includes(field) && value.length > 100) {
        return { b64Json: value.replace(/\s+/g, ""), mimeType: container?.mime_type || "image/png" };
      }
    }
  }

  // Some OpenAI-compatible gateways add one or two wrapper objects around the
  // standard response. Walk only image-related branches so unrelated IDs or
  // status URLs cannot be mistaken for the generated image.
  const queue = [{ value: data, depth: 0 }];
  const visited = new Set();
  const imageBranch = /^(?:data|result|results|output|outputs|image|images|content|parts|response)$/i;
  while (queue.length) {
    const { value, depth } = queue.shift();
    if (!value || typeof value !== "object" || visited.has(value) || depth > 6) continue;
    visited.add(value);
    for (const [key, candidate] of Object.entries(value)) {
      if (["b64_data", "b64_json", "image_base64", "base64"].includes(key) && typeof candidate === "string" && candidate.length > 100) {
        const dataUrl = candidate.match(/^data:([^;,]+);base64,(.+)$/s);
        return { b64Json: (dataUrl?.[2] || candidate).replace(/\s+/g, ""), mimeType: dataUrl?.[1] || value.mime_type || value.mimeType || "image/png" };
      }
      if (["url", "image_url", "imageUrl", "file_url", "download_url", "fileUri"].includes(key)) {
        const url = normalizeImageUrlCandidate(candidate);
        if (typeof url === "string" && /^https?:\/\//i.test(url)) return { url };
        if (typeof url === "string") {
          const dataUrl = url.match(/^data:([^;,]+);base64,(.+)$/s);
          if (dataUrl) return { b64Json: dataUrl[2], mimeType: dataUrl[1] };
        }
      }
      if ((imageBranch.test(key) || Array.isArray(value)) && candidate && typeof candidate === "object") {
        if (Array.isArray(candidate)) candidate.slice(0, 10).forEach((item) => queue.push({ value: item, depth: depth + 1 }));
        else queue.push({ value: candidate, depth: depth + 1 });
      }
    }
  }
  return null;
}

export async function materializeCompatibleImage(data, config, signal, label = "图像接口") {
  const result = extractCompatibleImageResult(data);
  if (result?.b64Json) return { success: true, ...result };
  if (result?.url) {
    const imageResponse = await axiosRequestWithProxyFallback(config, (requestConfig) =>
      axios.get(result.url, {
        ...axiosOptions(requestConfig, signal),
        responseType: "arraybuffer",
        headers: {}
      })
    );
    return {
      success: true,
      b64Json: Buffer.from(imageResponse.data).toString("base64"),
      mimeType: imageResponse.headers?.["content-type"] || "image/png"
    };
  }

  const status = data?.status || data?.data?.status || data?.result?.status;
  const taskId = extractApimartTaskId(data);
  if (["QUEUED", "IN_PROGRESS"].includes(String(status).toUpperCase()) || taskId) {
    throw new Error(`HFSY 返回了异步任务${taskId ? ` ${taskId}` : ""}，但接口说明未提供任务查询地址，请补充状态查询 endpoint`);
  }
  const message = apiValueToText(data?.error || data?.message || data?.msg || data, `${label}未返回图片 URL 或 Base64 数据`);
  throw new Error(`${label}返回异常：${message}`);
}

async function generateImageWithHfsy({ finalPrompt, referenceImagePath, size, quality, config, signal }) {
  const resolvedSize = referenceImagePath && isOriginalSizeLabel(size)
    ? await sizeFromReferenceImage(referenceImagePath)
    : size;
  const payload = {
    model: normalizeHfsyGptImageModel(config.model),
    prompt: finalPrompt,
    size: mapSizeForHfsy(resolvedSize, "1k"),
    n: 1,
    response_format: "b64_json"
  };
  if (referenceImagePath) {
    payload.reference_images = [await uploadReferenceImageForHfsy(referenceImagePath, config, signal)];
  }

  const endpoint = `${normalizeBaseUrl(config.baseUrl)}/images/generations`;
  const response = await axiosRequestWithProxyFallback(config, (requestConfig) =>
    axios.post(endpoint, payload, axiosOptions(requestConfig, signal, { "Content-Type": "application/json" }))
  );
  return materializeCompatibleImage(response.data, config, signal, "HFSY 图像接口");
}

function normalizeHfsyRootUrl(baseUrl) {
  return normalizeBaseUrl(baseUrl).replace(/\/v1(?:beta)?$/i, "");
}

function mapAspectRatioForNanoBanana(size = "1:1") {
  const value = String(size || "1:1").trim();
  const supported = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9", "9:21", "2:1", "1:2"];
  if (supported.includes(value)) return value;
  if (isOriginalSizeLabel(value)) return "3:4";
  return hfsyAspectRatio(value);
}

function isNanoBananaModel(model) {
  return ["nano-banana-2", "nano-banana-pro"].includes(String(model || ""));
}

async function generateImageWithNanoBanana({ finalPrompt, referenceImagePath, size, quality, config, signal }) {
  const resolvedSize = referenceImagePath && isOriginalSizeLabel(size)
    ? await sizeFromReferenceImage(referenceImagePath)
    : size;
  const parts = [{ text: finalPrompt }];
  if (referenceImagePath) {
    parts.push({
      inlineData: await referenceImageAsInlineData(referenceImagePath)
    });
  }

  const payload = {
    contents: [{ parts }],
    generationConfig: {
      imageConfig: {
        imageSize: normalizeHfsyQuality(quality).toUpperCase(),
        aspectRatio: mapAspectRatioForNanoBanana(resolvedSize)
      }
    }
  };
  const model = isNanoBananaModel(config.model) ? config.model : "nano-banana-2";
  const endpoint = `${normalizeHfsyRootUrl(config.baseUrl)}/v1beta/models/${model}:generateContent`;
  const response = await axiosRequestWithProxyFallback(config, (requestConfig) =>
    axios.post(endpoint, payload, axiosOptions(requestConfig, signal, { "Content-Type": "application/json" }))
  );
  return materializeCompatibleImage(response.data, config, signal, "Nano Banana 图像接口");
}

function isOriginalSizeLabel(size) {
  return ["原尺寸", "原图尺寸"].includes(String(size || "").trim());
}

function mapSizeForApimart(size = "1024x1024") {
  if (isOriginalSizeLabel(size)) return "3:4";
  const map = {
    "1024x1024": "1:1",
    "1024x1536": "2:3",
    "1536x1024": "3:2"
  };
  return map[size] || size || "1:1";
}

async function sizeFromReferenceImage(referenceImagePath, fallback = "3:4") {
  try {
    const meta = await sharp(referenceImagePath).metadata();
    const width = Number(meta.width || 0);
    const height = Number(meta.height || 0);
    if (!width || !height) return fallback;
    const ratio = width / height;
    const ratios = [
      ["1:1", 1],
      ["3:2", 3 / 2],
      ["2:3", 2 / 3],
      ["4:3", 4 / 3],
      ["3:4", 3 / 4],
      ["5:4", 5 / 4],
      ["4:5", 4 / 5],
      ["16:9", 16 / 9],
      ["9:16", 9 / 16],
      ["2:1", 2],
      ["1:2", 1 / 2],
      ["21:9", 21 / 9],
      ["9:21", 9 / 21]
    ];
    return ratios.reduce((best, current) => Math.abs(current[1] - ratio) < Math.abs(best[1] - ratio) ? current : best)[0];
  } catch {
    return fallback;
  }
}

function mapResolutionForApimart(quality = "high") {
  if (["1k", "2k", "4k"].includes(String(quality).toLowerCase())) return String(quality).toLowerCase();
  if (quality === "high") return "2k";
  return "1k";
}

function mapSizeForOpenAI(size = "1024x1024") {
  if (isOriginalSizeLabel(size)) return "1024x1536";
  const map = {
    "1:1": "1024x1024",
    "3:2": "1536x1024",
    "2:3": "1024x1536",
    "4:3": "1536x1024",
    "3:4": "1024x1536",
    "5:4": "1536x1024",
    "4:5": "1024x1536",
    "16:9": "1536x1024",
    "9:16": "1024x1536",
    "2:1": "1536x1024",
    "1:2": "1024x1536",
    "21:9": "1536x1024",
    "9:21": "1024x1536"
  };
  return map[size] || size || "1024x1024";
}

function mapQualityForOpenAI(quality = "high") {
  if (quality === "1k") return "medium";
  if (quality === "2k" || quality === "4k") return "high";
  return quality || "high";
}

// 图见（ltutuai.top）按生成图的总像素数分档计费：≤1572864 像素按 1K、
// ≤4194304 按 2K、更高按 4K。mapSizeForOpenAI 只发 1024x1024 / 1536x1024 等
// 小尺寸，无论前端选 1K/2K/4K 都落在 1K 档。这里在 2K/4K 时改发更大像素，
// 让图见按对应档计费并真正输出高清图。尺寸表与 HFSY（同为 gpt-image-2）一致，
// 已验证每个 2K 尺寸 > 1K 阈值、每个 4K 尺寸 > 2K 阈值。
function mapSizeForLtutuai(size = "1:1", quality = "1k") {
  const ratio = isOriginalSizeLabel(size) ? "3:4" : hfsyAspectRatio(size);
  const tier = normalizeHfsyQuality(quality);
  const sizes = {
    "1k": {
      "1:1": "1024x1024", "5:4": "1040x832", "9:16": "720x1280", "16:9": "1280x720",
      "4:3": "1024x768", "3:2": "1008x672", "4:5": "832x1040", "3:4": "768x1024",
      "2:3": "672x1008", "21:9": "1344x576"
    },
    "2k": {
      "1:1": "2048x2048", "5:4": "2080x1664", "9:16": "1152x2048", "16:9": "2048x1152",
      "4:3": "2048x1536", "3:2": "2016x1344", "4:5": "1664x2080", "3:4": "1536x2048",
      "2:3": "1344x2016", "21:9": "2016x864"
    },
    "4k": {
      "1:1": "2880x2880", "5:4": "3200x2560", "9:16": "2160x3840", "16:9": "3840x2160",
      "4:3": "3264x2448", "3:2": "3504x2336", "4:5": "2560x3200", "3:4": "2448x3264",
      "2:3": "2336x3504", "21:9": "3696x1584"
    }
  };
  return sizes[tier][ratio] || sizes[tier]["1:1"];
}

function mapSizeForTuzi(size = "1:1", quality = "1k") {
  // Tuzi accepts the 2K pixel dimensions directly. Keep its established 1K
  // and 4K behaviour unchanged until those tiers are explicitly selected and
  // supported by the provider; only the asserted 2K tier is expanded here.
  return String(quality || "").toLowerCase() === "2k"
    ? mapSizeForLtutuai(size, "2k")
    : mapSizeForOpenAI(size);
}

export function mapSizeForConfiguredProvider(config, size, quality) {
  if (isLtutuaiConfig(config)) return mapSizeForLtutuai(size, quality);
  if (isTuziConfig(config)) return mapSizeForTuzi(size, quality);
  return mapSizeForOpenAI(size);
}

function canvasPromptForSize(size = "") {
  const cleanSize = String(size || "").trim();
  if (!cleanSize || isOriginalSizeLabel(cleanSize)) return "";

  const common = `\n\n画布尺寸硬性要求：最终画面必须严格使用 ${cleanSize} 比例画布。原图已有标题、正文、题目、插图、装饰和边框都必须在这个画布比例内重新排版，不要裁剪任何文字或元素；标题如果原图有就保留并美化原标题，原图没有标题就不要新增标题或标题栏；不要添加原图没有的题目、知识点、答案或学习内容。`;
  if (cleanSize === "3:4") {
    return `${common} 这是较宽的 3:4 竖版，不是 2:3、不是 9:16，也不是 1024x1536 的窄长版。画面主体必须铺满 3:4 画布宽度，不要在左右两侧或上下留下大面积空白补边。`;
  }
  return common;
}

function applyCanvasPrompt(prompt, size) {
  return `${prompt || ""}${canvasPromptForSize(size)}\n\n视觉执行优先级：用户提示词对配色、边框颜色、圆角、线条样式和整体视觉风格拥有最高优先级，必须按用户提示执行。\n\n边框规则：如需使用页面外框、内容框或分隔框，必须使用极细线条，视觉上轻盈克制、低存在感；不要使用粗边框、宽色带边框或厚重描边。`;
}

function isConservativePrompt(prompt = "") {
  return /重绘强度：\s*保守优化|保守优化/.test(String(prompt || ""));
}

function isRedesignPrompt(prompt = "") {
  return /重绘强度：\s*明显重设计|明显重设计/.test(String(prompt || ""));
}

function isDefaultRedrawStrength(redrawStrength = "") {
  return String(redrawStrength || "").trim() === "默认";
}

function buildRedrawPrompt(prompt, size, redrawStrength) {
  if (isDefaultRedrawStrength(redrawStrength)) return String(prompt || "");
  return enrichReferencePrompt(applyCanvasPrompt(prompt, size));
}

function strictReferencePreservationPrompt() {
  return `

原图内容硬性规则：
1. 严格保留参考图中已经存在的文字、题目、知识点、栏目和信息；不得脑补、扩写或续写实际学习内容。
2. 严禁新增参考图没有的题目、例题、算式、答案、知识点、栏目、人物对话和学习提示。
3. 可以增加少量轻量装饰元素，例如边框、分隔线、贴纸角标、底纹和图标；标题如果原图有就保留并美化原标题，原图没有标题就不要新增标题或标题栏。
4. 参考图内容少，输出内容也必须少；参考图空白区域可以做淡背景和轻装饰，但不得填充新题目或新知识点。
5. 如果参考图是封面、目录、说明页或版权页，只能做对应页面的视觉美化，不要改成练习页、知识卡片或讲义页。
6. 练习题页面必须保持学生作答区空白；括号、填空线、横线、方框、表格空格和“答：”后面不要填写任何字符，除非原图已经写有答案。
7. 严禁新增答案、解析、批注、红色手写答案、对错标记或讲解步骤；原图没有答案时，生成图也必须没有答案。
8. 文字必须逐字照抄参考图已有内容，不能把中文当作纹理或装饰重新编造；正文、题目、公式和表格文字必须使用清晰印刷体。
9. 严禁伪中文、乱码、错别字、重复笔画、无意义符号、英文占位符和模糊小字；如果文字太多，宁可减少装饰、放大字号或更接近原版式，也不能让文字不可读。
10. 标题可以适度美化，但正文和题目不要使用艺术字、手写字、粉笔字或过度圆润字体。
13. 背景颜色必须统一：整页使用同一个主背景色或同一套浅色纸张底色，不要出现大块不一致底色、突兀渐变、左右上下色差或脏灰色块。
14. 同级内容分区的背景色必须属于同一色系和同一明度范围；只允许用很轻的透明浅色区分栏目层级，不要每个模块都换不同底色。`;
}

function enrichReferencePrompt(prompt = "") {
  const basePrompt = String(prompt || "");
  const preservation = strictReferencePreservationPrompt();
  if (isConservativePrompt(basePrompt)) {
    return `${basePrompt}${preservation}

保守优化执行方式：优化清晰度、色彩、边框、间距、纸张质感和轻量装饰；标题如果原图有就保留并美化原标题，原图没有标题就不要新增标题或标题栏；不得改变页面用途、不得扩充信息量、不得新增题目答案、不得重新编写正文。`;
  }

  if (isRedesignPrompt(basePrompt)) {
    return `${basePrompt}${preservation}

明显重设计执行方式：只允许重做视觉呈现，例如版式、色彩、留白、分区、边框、图标和字体层级；不得改变页面用途、不得扩充信息量、不得新增或改写题目、答案、解析、知识点、例句、正文段落、标题、小标题、页码、署名或学习提示。原图内容少，生成内容也必须少。`;
  }

  return `${basePrompt}${preservation}

请在不增加原图实际学习内容的前提下重新设计视觉样式。可以优化边框、分隔线、色块、留白和页面层级；标题如果原图有就保留并美化原标题，原图没有标题就不要新增标题或标题栏；不得添加原图没有的题目、答案、知识点或学习提示。`;
}

function applyStoryboardCanvasPrompt(prompt, size) {
  const cleanSize = String(size || "").trim();
  const sizeRule = cleanSize && !isOriginalSizeLabel(cleanSize)
    ? `\n\n画布尺寸硬性要求：最终画面必须严格使用 ${cleanSize} 比例画布。`
    : "";
  return `${prompt || ""}${sizeRule}

分镜输出硬性规则：
1. 画面必须以视觉叙事为主，禁止直接显示文案原句、画面提示词或统一提示词；这些内容只用于理解场景。
2. 允许出现对话框、对话气泡和思考框；出现时，框内应根据分镜文案含义生成简短、自然的内心独白或对白，使用清晰中文，每个框最多 1 至 2 个短句。不得照抄文案原句，不得显示画面提示词或统一提示词。
3. 主要通过人物、动作、表情、环境、道具、光影和构图表达分镜含义，对话框文字只作辅助；除对话框内的简短独白或对白外，不要出现标题、字幕、标语、标签、书本文字、屏幕文字、招牌、Logo 或水印。
4. 配色只遵循用户的统一提示词和单镜提示词，不得自动套用粉色、珊瑚色、浅橙色或其他预设色系；用户要求无色彩时，必须严格使用黑白灰或单色线稿，不得出现任何彩色点缀。`;
}

function enrichPromptForApimart(prompt = "") {
  return `${prompt}

中文文字清晰优先：
1. 尽量保留用户提供的完整正文内容，不要改写成要点摘要。
2. 长正文需要清晰排版，使用足够大的字号、充足行距和留白。
3. 使用黑色或深灰色、清晰印刷体中文，保证手机端可读。
4. 不要生成乱码、错字、糊字、伪中文、重复笔画、无意义符号或英文占位符。
5. 正文、题目、公式和表格文字必须使用清晰印刷体；不要用艺术字、手写字、粉笔字或过度圆润字体重写正文。
6. 正文区域宁可减少装饰、放大字号、保留原版式，也要优先保证文字逐字清楚。
7. 不要添加用户没有要求的新主题、新题目、新知识点或新答案。
9. 整页背景颜色必须一致，同级分区背景保持同一色系和同一明度范围；不要出现大块突兀色差或每个模块换一种底色。`;
}

function applyPresentationCanvasPrompt(prompt, size) {
  const cleanSize = String(size || "16:9").trim() || "16:9";
  return `${prompt || ""}

PPT 画布硬性要求：最终画面必须严格使用 ${cleanSize} 横版比例，所有标题、正文、图表和装饰都要完整落在安全边距内，不得裁切或贴边。页面四周留出一致的投影安全区。`;
}
function buildTextImagePrompt({ sourceText, prompt, storyboard = false, presentation = false, backgroundOnly = false, layoutPrompt = "" }) {
  if (presentation && backgroundOnly && layoutPrompt) {
    return `${layoutPrompt}\n用户指定的视觉风格补充：${prompt || "沿用整套教学绘本风格"}\n风格补充只调整笔触、配色和材质，不得覆盖已确定的场景位置、文字留白区域及无文字要求。`;
  }
  if (presentation && backgroundOnly) {
    // P1 纯背景模式：让模型出"不含任何文字的纯视觉背景"，文字由代码叠文本框
    return `PPT 背景图生成任务。

统一视觉风格要求：
${prompt || "请使用简洁、专业、统一的教学演示风格，温暖明亮的配色，留有适当留白。"}

任务类型：生成一张 16:9 横版的 PPT 纯背景图，用于作为幻灯片底图，上面会由程序叠加可编辑的文字框。

背景图硬性要求：
1. 画面是纯视觉背景：装饰图形、几何色块、柔和渐变、轻插画元素、留白区域，用于衬托即将叠加上去的文字。
2. 严禁在画面中出现任何文字、字母、数字、标题、正文、标签、对话、Logo 或水印。所有文字内容会由程序单独叠加，你只需要画背景。
3. 构图要为文字留出可读区域：主体装饰放在画面四周或角落，中央和左侧大面积留白或用低饱和度浅色，确保后续叠文字不会被背景花纹干扰。
4. 配色与风格参考以下本页内容主题，但不要把内容文字画进去（只借鉴主题的氛围和色调）：
---
${String(sourceText || "").slice(0, 300)}
---
5. 必须是专业 PPT 背景风格，不要做成小红书卡片、练习册、试卷、海报或网页截图。
6. 中文乱码、伪中文一律禁止（既然不画文字就不该出现任何字符）。`;
  }
  if (presentation) {
    return `PPT 统一视觉风格要求：
${prompt || "请使用简洁、专业、统一的教学演示风格。"}

风格提示词使用规则：上面的中间提示词只用于提取配色、字体感、插画、构图、装饰和排版风格。当前任务是根据下方文档文字直接生成 PPT 页面，无需也不得要求用户上传原图。若风格提示词中出现“参考图、原图、重绘、保留原图文字、不要新增文字”等图片重绘前提，必须忽略这些前提，只保留其中可用于 PPT 的视觉风格描述。

任务类型：生成一张可直接作为 PowerPoint 页面使用的 16:9 横版幻灯片。
以下资料是本页需要表达的内容，由你理解后重新组织视觉层级和版式，不要机械照抄成长段落：

---
${sourceText}
---

PPT 页面硬性要求：
1. 根据资料提炼清晰的页面标题、3 至 5 个核心信息，并用图形、图标、结构图、时间线或信息卡片辅助表达。
2. 只保留本页最重要的信息，文字简短、清楚、手机和投影均可读；不要把整段原文塞进页面。
3. 不得编造资料中没有的事实、数字、结论、案例或引用。
4. 必须是专业 PPT 版式，不要做成小红书卡片、练习册、试卷、海报或网页截图。
5. 中文使用清晰印刷体，不要乱码、错字、伪中文、Logo 或水印。
6. 同一套 PPT 各页保持统一的配色、字体层级、边距和视觉风格。`;
  }

  if (storyboard) {
    return `${prompt || ""}

任务类型：以视觉叙事为主、可包含简短对话或内心独白的分镜插图。
以下分镜资料只用于理解人物、动作、情绪、环境和构图，不是需要显示在图片中的文案：

---
${sourceText}
---

要求：
1. 将分镜资料转化为一个有叙事感的视觉场景，以人物、动作、表情、环境和构图为主，不做大段文字排版。
2. 不得直接照抄或摘录分镜文案、文案原句、单镜画面提示和统一提示词；可以根据文案含义重新组织简短的内心独白或自然对白。
3. 可以生成对话框、对话气泡或思考框；出现时应填写与当前场景匹配的简短中文独白或对白，每个框最多 1 至 2 个短句，不要留成无意义的空框。画面中不要出现字幕、标题、标签、Logo 或水印。
4. 用主体、动作、表情、道具、环境、光影和构图传达含义。
5. 画面风格与配色严格遵循用户提示词；未指定配色时使用自然、克制的中性方案，不强制任何预设色系。`;
  }

  return `${prompt}

请基于以下文字/文档内容生成一张适合小红书发布的教辅图片：

---
${sourceText}
---

要求：
1. 尽量保留完整正文内容，做成清晰的学习卡片或教辅笔记页。
2. 不要新增大标题或标题栏；只有原文/文档本身有标题时才保留原标题。页面重点放在正文和题目内容，不要为了装饰额外添加标题。
3. 配色严格遵循用户提示词；用户未指定配色时使用自然、克制的中性方案，不强制粉色、珊瑚色、浅橙色或其他预设色系。
4. 不要凭空添加无关知识点。
5. 如果内容较多，优先保留正文、要点、例题、公式和关键结论；原文已有标题可保留，不要额外编造标题。
6. 不要把长正文改写成要点摘要；正文需要完整保留并清晰排版。
7. 中文必须使用清晰印刷体、足够字号和充足行距，避免乱码、错字、糊字、伪中文和过小文字。
8. 正文、题目、公式和表格文字不要使用艺术字、手写字或粉笔字；装饰必须给文字让路。
10. 页面背景保持统一主色，同级内容区背景保持同一色系和明度。`;
}

function buildFinalTextImagePrompt({ sourceText, prompt, size, storyboard = false, presentation = false, backgroundOnly = false, layoutPrompt = "" }) {
  const basePrompt = buildTextImagePrompt({ sourceText, prompt, storyboard, presentation, backgroundOnly, layoutPrompt });
  if (storyboard) return applyStoryboardCanvasPrompt(basePrompt, size);
  if (presentation && backgroundOnly && layoutPrompt) {
    const cleanSize = String(size || "16:9").trim() || "16:9";
    return `${basePrompt}

PPT 画布硬性要求：最终画面必须严格使用 ${cleanSize} 横版比例，完整覆盖整张画布；所有插画主体和装饰都必须落在各自指定区域内，不得侵占文字保留区域，不得裁切或贴边。`;
  }
  if (presentation) return applyPresentationCanvasPrompt(basePrompt, size);
  return applyCanvasPrompt(basePrompt, size);
}

function buildTextReferencePrompt({ sourceText, prompt }) {
  return `${prompt}

请根据用户输入的提示词，并参考上传的参考图，生成一张新图片。

用户提示词如下，必须作为最高优先级执行：
---
${sourceText}
---

参考图使用规则：
1. 参考图用于理解画面比例、构图、主体关系、色彩、光线、材质、风格和氛围。
2. 不要直接复制参考图中的无关文字、品牌标识、水印、错误内容或个人信息。
3. 如果用户提示词与参考图内容冲突，必须以用户提示词为准。

输出要求：
1. 具体生成什么完全由用户提示词决定，可以是教辅、海报、照片、插画、卡片、封面或其他任意类型。
2. 不要默认生成教辅、知识卡片、学习笔记、标题、公式或题目；只有用户提示词要求时才生成。
3. 不要添加用户提示词没有要求的主题内容。`;
}

function extractApimartTaskId(data) {
  if (typeof data?.data === "string") return data.data;
  return (
    data?.task_id ||
    data?.taskId ||
    data?.id ||
    data?.task?.id ||
    data?.data?.[0]?.task_id ||
    data?.data?.[0]?.taskId ||
    data?.data?.[0]?.id ||
    data?.data?.[0]?.task?.id ||
    data?.data?.task_id ||
    data?.data?.taskId ||
    data?.data?.id ||
    data?.data?.task?.id ||
    data?.result?.task_id ||
    data?.result?.id
  );
}

function extractApimartBusinessError(data) {
  if (!data) return "";
  const status = apimartStatus(data);
  const code = data?.code ?? data?.data?.code;
  const explicitError = apiValueToText(data.error || data.data?.error || data.fail_reason || data.data?.fail_reason);
  const message = apiValueToText(data.message || data.msg || data.data?.message || data.data?.msg);
  const detail = `${explicitError} ${message} ${safeJson(data)}`;
  if (isBalanceErrorText(detail)) return BALANCE_ERROR_MESSAGE;
  if (explicitError) return explicitError;
  if (code != null && Number(code) !== 200 && String(code) !== "0") {
    return message || `APIMart 返回业务错误 code=${code}`;
  }
  if (data.success === false || data.data?.success === false || isTaskFailed(status)) {
    return message || apimartFailureMessage(data);
  }
  return "";
}
function normalizeImageUrlCandidate(item) {
  if (!item) return null;
  if (typeof item === "string") return item;
  if (Array.isArray(item)) return normalizeImageUrlCandidate(item[0]);
  if (item.url) return normalizeImageUrlCandidate(item.url);
  if (item.image_url) return normalizeImageUrlCandidate(item.image_url);
  return null;
}

function extractApimartImageUrl(data) {
  const candidates = [
    data?.image_url,
    data?.url,
    data?.result?.image_url,
    data?.result?.url,
    data?.output?.image_url,
    data?.output?.url,
    data?.data?.[0]?.url,
    data?.data?.[0]?.image_url,
    data?.images?.[0],
    data?.result?.images?.[0],
    data?.output?.images?.[0],
    data?.data?.images?.[0],
    data?.data?.result?.images?.[0],
    data?.data?.result?.image_urls?.[0]
  ];

  for (const item of candidates) {
    const url = normalizeImageUrlCandidate(item);
    if (url) return url;
  }
  return null;
}

function isTaskDone(status = "") {
  return ["success", "succeeded", "completed", "done", "finished", "SUCCESS"].includes(String(status));
}

function isTaskFailed(status = "") {
  return ["failed", "failure", "error", "cancelled", "canceled", "FAILURE"].includes(String(status));
}

async function uploadImageToApimart(referenceImagePath, config, signal) {
  const endpoint = `${normalizeApimartBaseUrl(config.baseUrl)}/uploads/images`;
  const response = await axiosRequestWithProxyFallback(config, (requestConfig) => {
    const form = new FormData();
    // APIMart currently returns a getapib.org object URL that becomes HTTP 403
    // when the multipart filename contains long Chinese text or punctuation.
    // Keep the local path unchanged, but give the uploaded object a short ASCII
    // filename so HFSY can fetch the resulting reference-image URL.
    const extension = path.extname(referenceImagePath).toLowerCase();
    const safeExtension = [".png", ".jpg", ".jpeg", ".webp"].includes(extension) ? extension : ".png";
    form.append("file", fs.createReadStream(referenceImagePath), {
      filename: `reference${safeExtension}`,
      contentType: mimeFromFile(referenceImagePath)
    });
    return axios.post(endpoint, form, axiosOptions(requestConfig, signal, form.getHeaders()));
  });
  const businessError = extractApimartBusinessError(response.data);
  if (businessError) throw new Error(`APIMart 上传图片失败：${businessError}`);
  const url = response.data?.url || response.data?.image_url || response.data?.data?.url || response.data?.data?.image_url;
  if (!url) throw new Error("APIMart 上传图片未返回 URL");
  return url;
}

async function pollApimartTask(taskId, config, signal) {
  const startedAt = Date.now();
  const timeoutMs = Number(config.timeoutMs || 240000);
  const endpoint = `${normalizeApimartBaseUrl(config.baseUrl)}/tasks/${encodeURIComponent(taskId)}`;

  while (Date.now() - startedAt < timeoutMs) {
    if (signal?.aborted) throw new Error(signal.reason?.message || "任务已取消");
    const response = await axiosRequestWithProxyFallback(config, (requestConfig) =>
      axios.get(endpoint, axiosOptions(requestConfig, signal))
    );
    const body = response.data;
    const businessError = extractApimartBusinessError(body);
    if (businessError) throw new Error(`APIMart 图像任务失败：${businessError}`);
    const status = apimartStatus(body);
    const imageUrl = extractApimartImageUrl(body);
    if (imageUrl && (!status || isTaskDone(status))) return imageUrl;
    if (isTaskFailed(status)) throw new Error(`APIMart 图像任务失败：${apimartFailureMessage(body)}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error("APIMart 图像任务查询超时");
}

async function redrawTeachingMaterialWithApimart({ referenceImagePath, prompt, size, quality, redrawStrength, config, signal }) {
  const imageUrl = await uploadImageToApimart(referenceImagePath, config, signal);
  const endpoint = `${normalizeApimartBaseUrl(config.baseUrl)}/images/generations`;
  const resolvedSize = isOriginalSizeLabel(size) ? await sizeFromReferenceImage(referenceImagePath) : size;
  const response = await axiosRequestWithProxyFallback(config, (requestConfig) =>
    axios.post(
      endpoint,
      {
        model: config.model || "gpt-image-2",
        prompt: buildRedrawPrompt(prompt, resolvedSize, redrawStrength),
        image_urls: [imageUrl],
        size: mapSizeForApimart(resolvedSize),
        resolution: mapResolutionForApimart(quality),
        n: 1
      },
      axiosOptions(requestConfig, signal, { "Content-Type": "application/json" })
    )
  );

  const businessError = extractApimartBusinessError(response.data);
  if (businessError) throw new Error(`APIMart 图像接口返回错误：${businessError}`);

  const syncImageUrl = extractApimartImageUrl(response.data);
  if (syncImageUrl) {
    const imageResponse = await axiosRequestWithProxyFallback(config, (requestConfig) =>
      axios.get(syncImageUrl, {
        ...axiosOptions(requestConfig, signal),
        responseType: "arraybuffer",
        headers: {}
      })
    );
    return {
      success: true,
      b64Json: Buffer.from(imageResponse.data).toString("base64"),
      mimeType: imageResponse.headers?.["content-type"] || "image/png"
    };
  }

  const taskId = extractApimartTaskId(response.data);
  if (!taskId) {
    const preview = JSON.stringify(response.data || {}).slice(0, 500).replace(/sk-[^\s"'，。,:;]+/g, "sk-****");
    throw new Error(`APIMart 图像接口未返回任务 ID，返回内容：${preview}`);
  }

  const resultUrl = await pollApimartTask(taskId, config, signal);
  const imageResponse = await axiosRequestWithProxyFallback(config, (requestConfig) =>
    axios.get(resultUrl, {
      ...axiosOptions(requestConfig, signal),
      responseType: "arraybuffer",
      headers: {}
    })
  );

  return {
    success: true,
    b64Json: Buffer.from(imageResponse.data).toString("base64"),
    mimeType: imageResponse.headers?.["content-type"] || "image/png"
  };
}

async function generateTextImageWithApimart({ sourceText, prompt, size, quality, storyboard = false, presentation = false, backgroundOnly = false, layoutPrompt = "", config, signal }) {
  const endpoint = `${normalizeApimartBaseUrl(config.baseUrl)}/images/generations`;
  const response = await axiosRequestWithProxyFallback(config, (requestConfig) =>
    axios.post(
      endpoint,
      {
        model: config.model || "gpt-image-2",
        prompt: storyboard || presentation
          ? buildFinalTextImagePrompt({ sourceText, prompt, size, storyboard, presentation, backgroundOnly, layoutPrompt })
          : enrichPromptForApimart(buildFinalTextImagePrompt({ sourceText, prompt, size, storyboard, presentation, backgroundOnly, layoutPrompt })),
        size: mapSizeForApimart(size),
        resolution: mapResolutionForApimart(quality),
        n: 1
      },
      axiosOptions(requestConfig, signal, { "Content-Type": "application/json" })
    )
  );

  const businessError = extractApimartBusinessError(response.data);
  if (businessError) throw new Error(`APIMart 文生图接口返回错误：${businessError}`);

  const syncImageUrl = extractApimartImageUrl(response.data);
  const taskId = extractApimartTaskId(response.data);
  const resultUrl = syncImageUrl || (taskId ? await pollApimartTask(taskId, config, signal) : null);
  if (!resultUrl) {
    const preview = JSON.stringify(response.data || {}).slice(0, 500).replace(/sk-[^\s"'，。,:;]+/g, "sk-****");
    throw new Error(`APIMart 文生图接口未返回任务 ID 或图片 URL，返回内容：${preview}`);
  }

  const imageResponse = await axiosRequestWithProxyFallback(config, (requestConfig) =>
    axios.get(resultUrl, {
      ...axiosOptions(requestConfig, signal),
      responseType: "arraybuffer",
      headers: {}
    })
  );

  return {
    success: true,
    b64Json: Buffer.from(imageResponse.data).toString("base64"),
    mimeType: imageResponse.headers?.["content-type"] || "image/png"
  };
}

async function generateTextImageWithHfsy({ sourceText, prompt, size, quality, storyboard = false, presentation = false, backgroundOnly = false, layoutPrompt = "", config, signal }) {
  const generate = isNanoBananaModel(config.model) ? generateImageWithNanoBanana : generateImageWithHfsy;
  return generate({
    finalPrompt: buildFinalTextImagePrompt({ sourceText, prompt, size, storyboard, presentation, backgroundOnly, layoutPrompt }),
    size,
    quality,
    config,
    signal
  });
}

async function generateTextReferenceImageWithHfsy({ sourceText, referenceImagePath, prompt, size, quality, config, signal }) {
  const resolvedSize = isOriginalSizeLabel(size) ? await sizeFromReferenceImage(referenceImagePath) : size;
  const generate = isNanoBananaModel(config.model) ? generateImageWithNanoBanana : generateImageWithHfsy;
  return generate({
    finalPrompt: applyCanvasPrompt(buildTextReferencePrompt({ sourceText, prompt }), resolvedSize),
    referenceImagePath,
    size: resolvedSize,
    quality,
    config,
    signal
  });
}

async function redrawTeachingMaterialWithHfsy({ referenceImagePath, prompt, size, quality, redrawStrength, config, signal }) {
  const resolvedSize = isOriginalSizeLabel(size) ? await sizeFromReferenceImage(referenceImagePath) : size;
  const generate = isNanoBananaModel(config.model) ? generateImageWithNanoBanana : generateImageWithHfsy;
  return generate({
    finalPrompt: buildRedrawPrompt(prompt, resolvedSize, redrawStrength),
    referenceImagePath,
    size: resolvedSize,
    quality,
    config,
    signal
  });
}

async function generateTextImageWithOpenAI({ sourceText, prompt, size, quality, storyboard = false, presentation = false, backgroundOnly = false, layoutPrompt = "", config, signal }) {
  const endpoint = `${normalizeBaseUrl(config.baseUrl)}/images/generations`;
  const response = await axios.post(
    endpoint,
    {
      model: config.model || "gpt-image-2",
      prompt: buildFinalTextImagePrompt({ sourceText, prompt, size, storyboard, presentation, backgroundOnly, layoutPrompt }),
      size: mapSizeForConfiguredProvider(config, size, quality),
      quality: mapQualityForOpenAI(quality),
      n: 1
    },
    axiosOptions(config, signal, { "Content-Type": "application/json" })
  );
  return materializeCompatibleImage(response.data, config, signal, "图像接口");
}

async function generateTextReferenceImageWithApimart({ sourceText, mode, referenceImagePath, prompt, size, quality, config, signal }) {
  const imageUrl = await uploadImageToApimart(referenceImagePath, config, signal);
  const endpoint = `${normalizeApimartBaseUrl(config.baseUrl)}/images/generations`;
  const resolvedSize = isOriginalSizeLabel(size) ? await sizeFromReferenceImage(referenceImagePath) : size;
  const finalPrompt = applyCanvasPrompt(buildTextReferencePrompt({ sourceText, prompt, mode }), resolvedSize);
  const response = await axiosRequestWithProxyFallback(config, (requestConfig) =>
    axios.post(
      endpoint,
      {
        model: config.model || "gpt-image-2",
        prompt: finalPrompt,
        image_urls: [imageUrl],
        size: mapSizeForApimart(resolvedSize),
        resolution: mapResolutionForApimart(quality),
        n: 1
      },
      axiosOptions(requestConfig, signal, { "Content-Type": "application/json" })
    )
  );

  const businessError = extractApimartBusinessError(response.data);
  if (businessError) throw new Error(`APIMart 图文参考接口返回错误：${businessError}`);

  const syncImageUrl = extractApimartImageUrl(response.data);
  const taskId = extractApimartTaskId(response.data);
  const resultUrl = syncImageUrl || (taskId ? await pollApimartTask(taskId, config, signal) : null);
  if (!resultUrl) {
    const preview = JSON.stringify(response.data || {}).slice(0, 500).replace(/sk-[^\s"'，。,:;]+/g, "sk-****");
    throw new Error(`APIMart 图文参考接口未返回任务 ID 或图片 URL，返回内容：${preview}`);
  }

  const imageResponse = await axiosRequestWithProxyFallback(config, (requestConfig) =>
    axios.get(resultUrl, {
      ...axiosOptions(requestConfig, signal),
      responseType: "arraybuffer",
      headers: {}
    })
  );

  return {
    success: true,
    b64Json: Buffer.from(imageResponse.data).toString("base64"),
    mimeType: imageResponse.headers?.["content-type"] || "image/png"
  };
}

async function generateTextReferenceImageWithOpenAI({ sourceText, mode, referenceImagePath, prompt, size, quality, config, signal }) {
  const resolvedSize = isOriginalSizeLabel(size) ? await sizeFromReferenceImage(referenceImagePath) : size;
  const form = new FormData();
  form.append("model", config.model || "gpt-image-2");
  form.append("prompt", applyCanvasPrompt(buildTextReferencePrompt({ sourceText, prompt, mode }), resolvedSize));
  form.append("image", fs.createReadStream(referenceImagePath));
  if (resolvedSize) form.append("size", mapSizeForConfiguredProvider(config, resolvedSize, quality));
  if (quality) form.append("quality", mapQualityForOpenAI(quality));

  const endpoint = `${normalizeBaseUrl(config.baseUrl)}/images/edits`;
  const response = await axios.post(endpoint, form, axiosOptions(config, signal, form.getHeaders()));
  return materializeCompatibleImage(response.data, config, signal, "图文参考接口");
}

export async function generateTeachingImageFromText({ sourceText, prompt, size, quality, storyboard = false, presentation = false, backgroundOnly = false, layoutPrompt = "", config, signal }) {
  try {
    if (!config.apiKey) {
      return { success: false, error: "缺少 API Key，请先在 API 设置中填写" };
    }
    if (!sourceText?.trim()) {
      return { success: false, error: "缺少可用于生图的文字内容" };
    }
    if (isApimartConfig(config)) {
      return await generateTextImageWithApimart({ sourceText, prompt, size, quality, storyboard, presentation, backgroundOnly, layoutPrompt, config, signal });
    }
    if (isHfsyConfig(config)) {
      return await generateTextImageWithHfsy({ sourceText, prompt, size, quality, storyboard, presentation, backgroundOnly, layoutPrompt, config, signal });
    }
    return await generateTextImageWithOpenAI({ sourceText, prompt, size, quality, storyboard, presentation, backgroundOnly, layoutPrompt, config, signal });
  } catch (error) {
    return { success: false, error: publicError(error) };
  }
}

export async function generateTeachingImageFromTextAndReference({ sourceText, mode = "prompt-reference", referenceImagePath, prompt, size, quality, config, signal }) {
  try {
    if (!config.apiKey) {
      return { success: false, error: "缺少 API Key，请先在 API 设置中填写" };
    }
    if (!sourceText?.trim()) {
      return { success: false, error: "缺少生成提示词" };
    }
    if (!referenceImagePath) {
      return { success: false, error: "缺少参考图" };
    }
    if (isApimartConfig(config)) {
      return await generateTextReferenceImageWithApimart({ sourceText, mode, referenceImagePath, prompt, size, quality, config, signal });
    }
    if (isHfsyConfig(config)) {
      return await generateTextReferenceImageWithHfsy({ sourceText, referenceImagePath, prompt, size, quality, config, signal });
    }
    return await generateTextReferenceImageWithOpenAI({ sourceText, mode, referenceImagePath, prompt, size, quality, config, signal });
  } catch (error) {
    return { success: false, error: publicError(error) };
  }
}

export async function redrawTeachingMaterial({ referenceImagePath, prompt, size, quality, redrawStrength, config, signal }) {
  try {
    if (!config.apiKey) {
      return { success: false, error: "缺少 OpenAI API Key，请先在 API 设置中填写" };
    }

    const resolvedSize = isOriginalSizeLabel(size) ? await sizeFromReferenceImage(referenceImagePath) : size;

    if (isApimartConfig(config)) {
      return await redrawTeachingMaterialWithApimart({ referenceImagePath, prompt, size: resolvedSize, quality, redrawStrength, config, signal });
    }
    if (isHfsyConfig(config)) {
      return await redrawTeachingMaterialWithHfsy({ referenceImagePath, prompt, size: resolvedSize, quality, redrawStrength, config, signal });
    }

    const form = new FormData();
    form.append("model", config.model || "gpt-image-2");
    form.append("prompt", buildRedrawPrompt(prompt, resolvedSize, redrawStrength));
    form.append("image", fs.createReadStream(referenceImagePath));
    if (resolvedSize) form.append("size", mapSizeForConfiguredProvider(config, resolvedSize, quality));
    if (quality) form.append("quality", mapQualityForOpenAI(quality));

    const endpoint = `${normalizeBaseUrl(config.baseUrl)}/images/edits`;
    const response = await axios.post(endpoint, form, axiosOptions(config, signal, form.getHeaders()));
    return await materializeCompatibleImage(response.data, config, signal, "图像接口");
  } catch (error) {
    return { success: false, error: publicError(error) };
  }
}

export async function testOpenAIConnection(config) {
  if (!config.apiKey) {
    return { success: false, message: "API 连接失败：缺少 API Key" };
  }
  try {
    if (isHfsyConfig(config)) {
      const endpoint = `${normalizeBaseUrl(config.baseUrl)}/models`;
      await axiosRequestWithProxyFallback(config, (requestConfig) =>
        axios.get(endpoint, axiosOptions(requestConfig))
      );
      return { success: true, message: "HFSY API 连接正常" };
    }
    if (isApimartConfig(config)) {
      const baseUrl = normalizeApimartBaseUrl(config.baseUrl);
      try {
        await axiosRequestWithProxyFallback(config, (requestConfig) =>
          axios.get(`${baseUrl}/account/token-balance`, axiosOptions(requestConfig))
        );
      } catch (error) {
        if (error?.response?.status === 404) {
          await axiosRequestWithProxyFallback(config, (requestConfig) =>
            axios.get(`${baseUrl}/models`, axiosOptions(requestConfig))
          );
        } else {
          throw error;
        }
      }
      return { success: true, message: "APIMart API 连接正常" };
    }

    const endpoint = `${normalizeBaseUrl(config.baseUrl)}/models`;
    const response = await axios.get(endpoint, axiosOptions(config));
    const models = response.data?.data || [];
    const exists = models.some((item) => item.id === config.model);
    return {
      success: true,
      message: exists ? "API 连接正常，模型配置存在" : "API 连接正常，但未在模型列表中确认当前图像模型"
    };
  } catch (error) {
    return { success: false, message: `API 连接失败：${publicError(error)}` };
  }
}

export async function testOpenAIConnectionWithProxyFallback(config) {
  const first = await testOpenAIConnection(config);
  if (first.success || !config.proxyHost || !config.proxyPort || config.proxyProtocol === "socks5") {
    return { ...first, config };
  }

  const shouldTrySocks = /代理连接中断|socket disconnected|TLS/i.test(first.message || "");
  if (!shouldTrySocks) return { ...first, config };

  const socksConfig = { ...config, proxyProtocol: "socks5" };
  const second = await testOpenAIConnection(socksConfig);
  return second.success
    ? { ...second, config: socksConfig, detectedProxyProtocol: "socks5" }
    : { ...second, config };
}
