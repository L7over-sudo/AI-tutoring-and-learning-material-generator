import { logService } from "../services/logService.js";
import { generateXhsCopy, publishXhsDraft, publishXhsNote } from "../services/xhsPublishService.js";
import { createXhsProduct } from "../services/xhsProductService.js";
import { testXhsOfficialApiConnection } from "../services/xhsOfficialApiService.js";
import { ok, fail } from "../utils/response.js";

export async function createXhsDraft(req, res) {
  try {
    const result = await publishXhsDraft(req.body || {});
    logService.success("xhs-publish", `小红书草稿已准备：${result.title}（${result.imageCount} 张）`);
    return ok(res, { result }, "小红书草稿已保存，请在创作中心检查后发布");
  } catch (error) {
    logService.error("xhs-publish", error.message);
    return fail(res, error.message);
  }
}

export async function createXhsPublish(req, res) {
  try {
    const result = await publishXhsNote({ ...(req.body || {}), draft: false });
    logService.success("xhs-publish", `小红书笔记已发布：${result.title}（${result.imageCount} 张${result.productName ? `，商品：${result.productName}` : ""}）`);
    return ok(res, { result }, "小红书笔记已发布");
  } catch (error) {
    logService.error("xhs-publish", error.message);
    return fail(res, error.message);
  }
}

export async function createXhsCopy(req, res) {
  try {
    const result = await generateXhsCopy(req.body || {});
    logService.success("xhs-publish", `AI 文案已生成：${result.title}`);
    return ok(res, { result }, "AI 文案已生成");
  } catch (error) {
    logService.error("xhs-publish", error.message);
    return fail(res, error.message);
  }
}

export async function createXhsMerchantProduct(req, res) {
  try {
    const result = await createXhsProduct(req.body || {});
    const verb = result.status === "submitted" ? "已提交审核" : "已保存草稿";
    logService.success("xhs-product", `小红书商品${verb}：${result.title}（${result.imageCount} 张）`);
    return ok(res, { result }, `小红书商品${verb}`);
  } catch (error) {
    const diagnostic = String(error.diagnostic || "").trim();
    logService.error("xhs-product", diagnostic ? `${error.message}\n诊断信息：${diagnostic}` : error.message);
    return fail(res, error.message);
  }
}

export async function testXhsOfficialConnection(req, res) {
  try {
    const result = await testXhsOfficialApiConnection(req.body || {});
    logService.success("xhs-official-api", result.message);
    return ok(res, { result }, result.message);
  } catch (error) {
    logService.error("xhs-official-api", error.message);
    return fail(res, error.message);
  }
}
