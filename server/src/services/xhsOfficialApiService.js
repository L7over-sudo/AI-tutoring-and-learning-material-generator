import crypto from "node:crypto";
import axios from "axios";
import { configStore } from "../stores/configStore.js";

const API_HOSTS = {
  sandbox: "http://flssandbox.xiaohongshu.com",
  production: "https://ark.xiaohongshu.com"
};

function usableCredential(value) {
  const text = String(value || "").trim();
  return text && !text.includes("****") ? text : "";
}

export function signXhsOfficialRequest({ pathname, query = {}, appKey, appSecret, timestamp }) {
  const pairs = {
    ...Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined && value !== null)),
    "app-key": appKey,
    timestamp: String(timestamp)
  };
  const parameterString = Object.keys(pairs)
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((key) => `${key}=${pairs[key]}`)
    .join("&");
  return crypto.createHash("md5").update(`${pathname}?${parameterString}${appSecret}`, "utf8").digest("hex");
}

async function resolveSettings(input = {}) {
  const saved = (await configStore.getRaw()).xhsOfficialApi || {};
  const environment = input.environment === "production" || input.environment === "sandbox"
    ? input.environment
    : saved.environment || "sandbox";
  return {
    environment,
    baseUrl: API_HOSTS[environment],
    appKey: usableCredential(input.appKey) || saved.appKey || "",
    appSecret: usableCredential(input.appSecret) || saved.appSecret || ""
  };
}

function apiErrorMessage(response) {
  const data = response?.data;
  const detail = typeof data === "object" && data
    ? data.error_msg || data.message || data.error || ""
    : "";
  if (response?.status === 401) return "小红书官方 API 拒绝认证：请确认 App Key 属于当前环境";
  if (response?.status === 403) return "小红书官方 API 签名校验失败：请确认 App Secret 与 App Key 配套";
  if (response?.status === 404) return "官方商品接口路径不可用：当前账号可能使用新版接口，请从开放平台下载该应用对应的最新文档";
  return `小红书官方 API 返回异常（HTTP ${response?.status || "未知"}）${detail ? `：${detail}` : ""}`;
}

export async function testXhsOfficialApiConnection(input = {}) {
  const settings = await resolveSettings(input);
  if (!settings.appKey || !settings.appSecret) {
    throw new Error("尚未配置小红书官方 App Key 和 App Secret；请先在开放平台申请自用型应用并获取凭据");
  }

  const pathname = "/ark/open_api/v1/items/lite";
  const query = { page_no: 1, page_size: 1 };
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signXhsOfficialRequest({
    pathname,
    query,
    appKey: settings.appKey,
    appSecret: settings.appSecret,
    timestamp
  });

  let response;
  try {
    response = await axios.get(`${settings.baseUrl}${pathname}`, {
      params: query,
      headers: {
        "app-key": settings.appKey,
        timestamp: String(timestamp),
        sign,
        "content-type": "application/json;charset=utf-8"
      },
      timeout: 15000,
      maxRedirects: 0,
      validateStatus: () => true
    });
  } catch (error) {
    throw new Error(`无法连接小红书官方 API：${error?.message || error}`);
  }

  if (response.status !== 200) throw new Error(apiErrorMessage(response));
  if (!response.data || typeof response.data !== "object") {
    throw new Error("小红书官方 API 返回的不是 JSON 数据，请确认应用对应的接口版本");
  }
  if (response.data.success === false || response.data.error_code) {
    throw new Error(`小红书官方 API 校验失败：${response.data.error_msg || response.data.error_code || "未知错误"}`);
  }

  const hits = Array.isArray(response.data?.data?.hits) ? response.data.data.hits : [];
  return {
    connected: true,
    environment: settings.environment,
    host: settings.baseUrl,
    readableProducts: hits.length,
    message: `小红书官方 API 已接通（${settings.environment === "production" ? "正式环境" : "沙箱环境"}）`
  };
}
