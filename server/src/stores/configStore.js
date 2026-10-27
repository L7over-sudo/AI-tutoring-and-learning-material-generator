import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "../paths.js";

const configPath = path.join(dataDir, "config.json");

const DEFAULT_PROVIDER = "hfsy";
const API_PROVIDER_PRESETS = {
  apimart: {
    baseUrl: "https://api.apimart.ai/v1",
    model: "gpt-image-2",
    proxyHost: "",
    proxyPort: "",
    proxyProtocol: "direct"
  },
  hfsy: {
    baseUrl: "https://www.hfsyapi.cn/v1",
    model: "gpt-image-2",
    proxyHost: "",
    proxyPort: "",
    proxyProtocol: "direct"
  },
  ltutuai: {
    baseUrl: "https://ltutuai.top/api/v1",
    model: "gpt-image-2",
    proxyHost: "",
    proxyPort: "",
    proxyProtocol: "direct",
    pricing: { "1k": "0.03", "2k": "0.04", "4k": "0.06" }
  },
  tuzi: {
    baseUrl: "https://api.tu-zi.com/v1",
    model: "gpt-image-2",
    proxyHost: "",
    proxyPort: "",
    proxyProtocol: "direct"
  }
};
const PROVIDER_PROFILE_FIELDS = ["baseUrl", "model", "proxyHost", "proxyPort", "proxyProtocol"];
const XHS_API_ENVIRONMENTS = new Set(["sandbox", "production"]);

function normalizeProvider(value) {
  return API_PROVIDER_PRESETS[value] ? value : DEFAULT_PROVIDER;
}

function inferProviderFromBaseUrl(value) {
  const baseUrl = String(value || "").toLowerCase();
  if (baseUrl.includes("hfsyapi.cn")) return "hfsy";
  if (baseUrl.includes("apimart.ai")) return "apimart";
  if (baseUrl.includes("ltutuai.top")) return "ltutuai";
  if (baseUrl.includes("tu-zi.com")) return "tuzi";
  return "";
}

const defaultProvider = normalizeProvider(process.env.API_PROVIDER || DEFAULT_PROVIDER);
const defaultProviderSettings = buildProviderSettings();

const defaultConfig = {
  provider: defaultProvider,
  apiKey: process.env.OPENAI_API_KEY || "",
  providerApiKeys: Object.keys(API_PROVIDER_PRESETS).reduce((keys, provider) => {
    keys[provider] = provider === defaultProvider ? process.env.OPENAI_API_KEY || "" : "";
    return keys;
  }, {}),
  baseUrl: process.env.OPENAI_BASE_URL || API_PROVIDER_PRESETS[defaultProvider].baseUrl,
  model: process.env.OPENAI_IMAGE_MODEL || API_PROVIDER_PRESETS[defaultProvider].model,
  proxyHost: API_PROVIDER_PRESETS[defaultProvider].proxyHost,
  proxyPort: API_PROVIDER_PRESETS[defaultProvider].proxyPort,
  proxyProtocol: API_PROVIDER_PRESETS[defaultProvider].proxyProtocol,
  providerSettings: defaultProviderSettings,
  defaultQuality: "high",
  defaultSize: "1024x1024",
  maxBatchCount: 1000,
  maxConcurrency: 100,
  timeoutMs: 240000,
  maxRetries: 2,
  retryDelay: 10000,
  cacheCleanupEnabled: false,
  cacheRetentionDays: 30,
  // P2：版面规划文本模型（DeepSeek 默认，OpenAI 兼容 /chat/completions）
  layoutModel: {
    enabled: false,
    apiKey: process.env.LAYOUT_API_KEY || "",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat"
  },
  xhsOfficialApi: {
    environment: process.env.XHS_API_ENVIRONMENT === "production" ? "production" : "sandbox",
    appKey: process.env.XHS_APP_KEY || "",
    appSecret: process.env.XHS_APP_SECRET || ""
  },
  originality: {
    enabled: false,
    overlayFolder: "",
    minOpacity: 1,
    maxOpacity: 3,
    overlayCount: 1,
    spatialDistortion: 0,
    colorShift: 0,
    cloneExif: false
  }
};

function getProviderPreset(provider) {
  return API_PROVIDER_PRESETS[normalizeProvider(provider)];
}

function pickProviderProfile(source = {}) {
  return PROVIDER_PROFILE_FIELDS.reduce((profile, field) => {
    if (source[field] !== undefined) {
      profile[field] = source[field];
    }
    return profile;
  }, {});
}

function buildProviderSettings(input = {}, activeProvider = defaultProvider) {
  const rawSettings = input.providerSettings || {};
  const settings = Object.keys(API_PROVIDER_PRESETS).reduce((result, provider) => {
    result[provider] = {
      ...getProviderPreset(provider),
      ...(rawSettings[provider] || {})
    };
    return result;
  }, {});

  const provider = normalizeProvider(activeProvider);
  settings[provider] = {
    ...settings[provider],
    ...pickProviderProfile(input)
  };
  return settings;
}

async function ensure() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(configPath);
  } catch {
    await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2), "utf8");
  }
}

function maskKey(apiKey = "") {
  if (!apiKey) return "";
  if (apiKey.length <= 8) return "sk-****";
  return `${apiKey.slice(0, 3)}****${apiKey.slice(-4)}`;
}

function maskCredential(value = "") {
  const credential = String(value || "");
  if (!credential) return "";
  if (credential.length <= 8) return "****";
  return `${credential.slice(0, 4)}****${credential.slice(-4)}`;
}

function normalizeXhsOfficialApi(input = {}, fallback = defaultConfig.xhsOfficialApi) {
  const environment = XHS_API_ENVIRONMENTS.has(input.environment)
    ? input.environment
    : fallback.environment;
  return {
    environment,
    appKey: String(input.appKey ?? fallback.appKey ?? "").trim(),
    appSecret: String(input.appSecret ?? fallback.appSecret ?? "").trim()
  };
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(text)) return true;
  if (["false", "0", "no", "off", ""].includes(text)) return false;
  return fallback;
}

function normalizeBaseUrl(value, provider) {
  let text = String(value || "").trim();
  if (!text) {
    text = API_PROVIDER_PRESETS[normalizeProvider(provider)].baseUrl;
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    text = `https://${text}`;
  }
  return text.replace(/\/+$/, "");
}

function normalizeProviderProfile(profile, provider) {
  const normalizedProvider = normalizeProvider(provider);
  const preset = getProviderPreset(provider);
  const otherProviderPresetUrls = Object.entries(API_PROVIDER_PRESETS)
    .filter(([name]) => name !== normalizedProvider)
    .map(([, value]) => value.baseUrl);
  const baseUrl = otherProviderPresetUrls.includes(profile?.baseUrl) ? preset.baseUrl : profile?.baseUrl || preset.baseUrl;
  return {
    ...preset,
    ...(profile || {}),
    baseUrl: normalizeBaseUrl(baseUrl, provider),
    model: profile?.model || preset.model,
    proxyHost: profile?.proxyHost ?? preset.proxyHost,
    proxyPort: profile?.proxyPort ?? preset.proxyPort,
    proxyProtocol: profile?.proxyProtocol || preset.proxyProtocol
  };
}

export const configStore = {
  async getRaw() {
    await ensure();
    const content = (await fs.readFile(configPath, "utf8")).replace(/^\uFEFF/, "");
    const data = JSON.parse(content);
    const merged = {
      ...defaultConfig,
      ...data,
      originality: { ...defaultConfig.originality, ...(data.originality || {}) },
      layoutModel: { ...defaultConfig.layoutModel, ...(data.layoutModel || {}) },
      xhsOfficialApi: normalizeXhsOfficialApi(data.xhsOfficialApi || {})
    };
    delete merged.textModel;
    merged.cacheCleanupEnabled = normalizeBoolean(merged.cacheCleanupEnabled, defaultConfig.cacheCleanupEnabled);
    const inferredProvider = inferProviderFromBaseUrl(merged.baseUrl);
    if (!data.provider || (inferredProvider && inferredProvider !== data.provider)) {
      merged.provider = inferredProvider || (String(merged.baseUrl || "").includes("apimart.ai") ? "apimart" : "hfsy");
    }
    merged.provider = normalizeProvider(merged.provider);
    merged.providerApiKeys = Object.keys(API_PROVIDER_PRESETS).reduce((keys, provider) => {
      keys[provider] = String(data.providerApiKeys?.[provider] || "").trim();
      return keys;
    }, {});
    if (merged.apiKey && !merged.providerApiKeys[merged.provider]) {
      merged.providerApiKeys[merged.provider] = merged.apiKey;
    }
    merged.apiKey = merged.providerApiKeys[merged.provider] || "";
    merged.providerSettings = buildProviderSettings(merged, merged.provider);
    Object.keys(merged.providerSettings).forEach((provider) => {
      merged.providerSettings[provider] = normalizeProviderProfile(merged.providerSettings[provider], provider);
    });
    const activeProfile = merged.providerSettings[merged.provider];
    merged.baseUrl = activeProfile.baseUrl;
    merged.model = activeProfile.model;
    merged.proxyHost = activeProfile.proxyHost;
    merged.proxyPort = activeProfile.proxyPort;
    merged.proxyProtocol = activeProfile.proxyProtocol;
    return merged;
  },
  async getPublic() {
    const config = await this.getRaw();
    const { providerApiKeys, ...publicConfig } = config;
    const providerKeyStatus = Object.keys(API_PROVIDER_PRESETS).reduce((status, provider) => {
      const apiKey = providerApiKeys[provider] || "";
      status[provider] = { apiKey: maskKey(apiKey), hasApiKey: Boolean(apiKey) };
      return status;
    }, {});
    const providerPricing = Object.keys(API_PROVIDER_PRESETS).reduce((pricing, provider) => {
      const presetPricing = API_PROVIDER_PRESETS[provider].pricing;
      if (presetPricing) pricing[provider] = presetPricing;
      return pricing;
    }, {});
    return {
      ...publicConfig,
      apiKey: maskKey(config.apiKey),
      hasApiKey: Boolean(config.apiKey),
      xhsOfficialApi: {
        environment: config.xhsOfficialApi.environment,
        appKey: maskCredential(config.xhsOfficialApi.appKey),
        appSecret: maskCredential(config.xhsOfficialApi.appSecret),
        hasAppKey: Boolean(config.xhsOfficialApi.appKey),
        hasAppSecret: Boolean(config.xhsOfficialApi.appSecret)
      },
      providerKeyStatus,
      providerPricing
    };
  },
  async update(input) {
    const current = await this.getRaw();
    const nextApiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : input.apiKey;
    const nextProvider = normalizeProvider(input.provider || current.provider);
    const providerApiKeys = { ...current.providerApiKeys };
    if (nextApiKey && !nextApiKey.includes("****")) {
      providerApiKeys[nextProvider] = nextApiKey;
    }
    const providerSettings = buildProviderSettings({ ...current, providerSettings: input.providerSettings || current.providerSettings }, current.provider);
    providerSettings[nextProvider] = {
      ...providerSettings[nextProvider],
      ...pickProviderProfile(input)
    };
    Object.keys(providerSettings).forEach((provider) => {
      providerSettings[provider] = normalizeProviderProfile(providerSettings[provider], provider);
    });
    const activeProfile = providerSettings[nextProvider];
    const incomingXhs = input.xhsOfficialApi || {};
    const currentXhs = current.xhsOfficialApi || defaultConfig.xhsOfficialApi;
    const nextXhs = normalizeXhsOfficialApi({
      ...currentXhs,
      environment: incomingXhs.environment,
      appKey: incomingXhs.appKey && !String(incomingXhs.appKey).includes("****")
        ? incomingXhs.appKey
        : currentXhs.appKey,
      appSecret: incomingXhs.appSecret && !String(incomingXhs.appSecret).includes("****")
        ? incomingXhs.appSecret
        : currentXhs.appSecret
    }, currentXhs);
    const next = {
      ...current,
      ...input,
      provider: nextProvider,
      providerSettings,
      providerApiKeys,
      apiKey: providerApiKeys[nextProvider] || "",
      baseUrl: activeProfile.baseUrl,
      model: activeProfile.model,
      proxyHost: activeProfile.proxyHost,
      proxyPort: activeProfile.proxyPort,
      proxyProtocol: activeProfile.proxyProtocol,
      maxBatchCount: clampNumber(input.maxBatchCount, current.maxBatchCount || defaultConfig.maxBatchCount, 1, 1000),
      maxConcurrency: clampNumber(input.maxConcurrency, current.maxConcurrency || defaultConfig.maxConcurrency, 1, 100),
      cacheCleanupEnabled: normalizeBoolean(input.cacheCleanupEnabled, current.cacheCleanupEnabled),
      cacheRetentionDays: clampNumber(input.cacheRetentionDays, current.cacheRetentionDays || defaultConfig.cacheRetentionDays, 1, 3650),
      layoutModel: { ...current.layoutModel, ...(input.layoutModel || {}) },
      xhsOfficialApi: nextXhs,
      originality: { ...current.originality, ...(input.originality || {}) }
    };
    delete next.textModel;
    await fs.writeFile(configPath, JSON.stringify(next, null, 2), "utf8");
    return this.getPublic();
  }
};
