import { configStore } from "../stores/configStore.js";
import { testOpenAIConnectionWithProxyFallback } from "./openaiImageService.js";
import { refreshCacheCleanupSchedule } from "./cacheCleanupService.js";

export const configService = {
  async getPublic() {
    return configStore.getPublic();
  },

  async update(data) {
    // Saving a key must not silently replace a working direct connection just
    // because a local proxy port happens to be open. Requests detect a proxy
    // only after an actual direct-connection failure.
    const config = await configStore.update({ ...data });
    refreshCacheCleanupSchedule();
    return { config, autoProxy: null };
  },

  async test(data = {}) {
    const savedConfig = await configStore.getRaw();
    const input = { ...data };
    const inputApiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : input.apiKey;
    if (!inputApiKey || String(inputApiKey).includes("****")) {
      const provider = input.provider || savedConfig.provider;
      input.apiKey = savedConfig.providerApiKeys?.[provider] || "";
    } else {
      input.apiKey = inputApiKey;
    }

    const config = { ...savedConfig, ...input };

    const result = await testOpenAIConnectionWithProxyFallback(config);
    if (result.detectedProxyProtocol) {
      await configStore.update({ proxyProtocol: result.detectedProxyProtocol });
      logService.success("config", `已自动识别代理协议：${result.detectedProxyProtocol}`);
    }
    return { success: result.success, message: result.message, config: await configStore.getPublic() };
  }
};
