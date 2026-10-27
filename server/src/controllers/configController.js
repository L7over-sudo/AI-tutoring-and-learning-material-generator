import { configService } from "../services/configService.js";
import { cleanupExpiredUploads, inspectUploadsCache } from "../services/cacheCleanupService.js";
import { promptTemplateStore } from "../stores/promptTemplateStore.js";
import { configStore } from "../stores/configStore.js";
import { ok, fail } from "../utils/response.js";

export async function getConfig(req, res) {
  return ok(res, { config: await configService.getPublic() });
}

export async function saveConfig(req, res) {
  const proxyPort = req.body?.proxyPort;
  if (proxyPort && !/^\d+$/.test(String(proxyPort))) {
    return fail(res, "代理端口请填写数字，例如 7897。API Key 需要填写在 API Key 输入框里。");
  }
  const proxyProtocol = req.body?.proxyProtocol;
  if (proxyProtocol && !["http", "socks5", "direct"].includes(proxyProtocol)) {
    return fail(res, "代理协议请选择 HTTP、SOCKS5 或直连。");
  }
  const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  if (apiKey && !apiKey.startsWith("sk-") && !apiKey.startsWith("sk_")) {
    return fail(res, "API Key 格式不正确，请粘贴对应平台创建的完整 Key（sk- 或 sk_ 开头）。");
  }
  const result = await configService.update(req.body || {});
  const message = result.autoProxy
    ? `配置已保存，已自动配置代理 ${result.autoProxy.proxyHost}:${result.autoProxy.proxyPort}`
    : "配置已保存";
  return ok(res, { config: result.config, autoProxy: result.autoProxy }, message);
}

export async function testConfig(req, res) {
  const result = await configService.test(req.body || {});
  return result.success ? ok(res, { config: result.config }, result.message) : fail(res, result.message);
}

export async function getCacheStatus(req, res) {
  const config = await configStore.getRaw();
  return ok(res, { status: await inspectUploadsCache(config.cacheRetentionDays) });
}

export async function cleanupCache(req, res) {
  const config = await configStore.getRaw();
  const result = await cleanupExpiredUploads(config.cacheRetentionDays);
  const status = await inspectUploadsCache(config.cacheRetentionDays);
  return ok(res, { result, status }, "缓存清理完成");
}

export async function listPromptTemplates(req, res) {
  return ok(res, { templates: await promptTemplateStore.list() });
}

export async function savePromptTemplate(req, res) {
  try {
    const template = await promptTemplateStore.save(req.body || {});
    return ok(res, { template }, "提示词模板已保存");
  } catch (error) {
    return fail(res, error.message);
  }
}

export async function deletePromptTemplates(req, res) {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (!ids.length) return fail(res, "请选择要删除的模板");
  return ok(res, { templates: await promptTemplateStore.remove(ids) }, "提示词模板已删除");
}
