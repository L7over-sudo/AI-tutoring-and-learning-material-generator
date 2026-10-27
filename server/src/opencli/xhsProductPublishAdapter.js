/**
 * Xiaohongshu merchant product publisher for electronic teaching resources.
 *
 * The command clones the latest existing product as a category/property
 * template, replaces all product-specific fields and media, then saves a draft
 * or submits the product for review.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { ArgumentError, CommandExecutionError } from "@jackwener/opencli/errors";
import { cli, Strategy } from "@jackwener/opencli/registry";

const LIST_URL = "https://ark.xiaohongshu.com/app-item/list/shelf";
const CREATE_URL = "https://ark.xiaohongshu.com/app-item/good/create";
const EXPECTED_CATEGORY = "电子资源 > 课件/教案/手抄报";
const MAX_IMAGES = 10;

function validateFiles(value) {
  const files = String(value || "").split(",").map(item => item.trim()).filter(Boolean);
  if (!files.length) throw new ArgumentError("--images is required");
  if (files.length > MAX_IMAGES) throw new ArgumentError(`Too many images: ${files.length} (max ${MAX_IMAGES})`);
  return files.map(file => {
    const absolute = path.resolve(file);
    if (!fs.existsSync(absolute)) throw new ArgumentError(`Image file not found: ${absolute}`);
    if (!/[.](?:jpg|jpeg|png)$/i.test(absolute)) throw new ArgumentError(`Unsupported image format: ${absolute}`);
    return absolute;
  });
}

async function wait(page, seconds) {
  await page.wait({ time: seconds });
}

async function evaluate(page, expression) {
  const value = await page.evaluate(expression);
  return value && typeof value === "object" && "data" in value ? value.data : value;
}

async function currentUrl(page) {
  return String(await evaluate(page, "() => location.href") || "");
}

async function assertMerchantLogin(page) {
  let state = null;
  for (let retry = 0; retry < 20; retry += 1) {
    state = await evaluate(page, `(() => ({
      url: location.href,
      title: document.title,
      hasStore: /小红书千帆|商品管理|发布商品|商品创建|店铺分/.test(document.body?.innerText || ""),
      hasLogin: /验证码登录|账号密码登录|立即入驻/.test(document.body?.innerText || "")
    }))()`);
    if (state?.hasLogin || /login/i.test(String(state?.url || ""))) break;
    if (state?.hasStore) return state;
    await wait(page, 1);
  }
  throw new CommandExecutionError("Xiaohongshu merchant center is not logged in. Open ark.xiaohongshu.com and sign in first.");
}

async function latestTemplateProductId(page) {
  for (let retry = 0; retry < 20; retry += 1) {
    const productId = await evaluate(page, `(() => {
      const text = document.body?.innerText || "";
      const match = text.match(/商品ID[:：]\\s*([a-z0-9]+)/i);
      return match ? match[1] : "";
    })()`);
    if (productId) return String(productId);
    await wait(page, 1);
  }
  throw new CommandExecutionError("Could not find an existing product to use as the category template.");
}

async function inspectProductForm(page) {
  let surface = null;
  for (let retry = 0; retry < 25; retry += 1) {
    surface = await evaluate(page, `(() => ({
      category: document.querySelector("#anchor-类目信息")?.innerText?.replace(/\\s+/g, " ").trim() || "",
      hasTitle: !!document.querySelector("#anchor-cell-itemName input"),
      hasPrice: !!document.querySelector("#anchor-cell-singleSku-module [id$='-price'] input"),
      hasDelivery: !!document.querySelector("#anchor-cell-singleSku-module [id$='-deliveryLink'] textarea")
    }))()`);
    if (surface?.hasTitle && surface?.hasPrice && surface?.hasDelivery) return surface;
    await wait(page, 1);
  }
  return surface;
}

async function fill(page, selector, value, fieldName, required = true) {
  const result = await evaluate(page, `((cfg) => {
    const el = document.querySelector(cfg.selector);
    if (!el) return { ok: false, reason: "missing" };
    el.scrollIntoView({ block: "center", inline: "nearest" });
    el.focus();
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, cfg.value); else el.value = cfg.value;
    try {
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: cfg.value, inputType: "insertText" }));
    } catch {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
    return { ok: String(el.value || "") === cfg.value, actual: String(el.value || "") };
  })(${JSON.stringify({ selector, value: String(value ?? "") })})`);
  if (!result?.ok && required) throw new CommandExecutionError(`Could not fill ${fieldName}: ${result?.reason || result?.actual || "unknown"}`);
  return result;
}

async function cdpClick(page, x, y) {
  if (typeof page.cdp !== "function") throw new CommandExecutionError("The browser bridge does not support CDP mouse input. Update the OpenCLI extension to v1.6+.");
  await page.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await page.cdp("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await page.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function rectFor(page, expression) {
  return evaluate(page, `(() => {
    const el = ${expression};
    if (!el) return null;
    el.scrollIntoView({ block: "center", inline: "nearest" });
    const r = el.getBoundingClientRect();
    return r.width && r.height ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  })()`);
}

async function mediaCount(page, materialIndex) {
  return Number(await evaluate(page, `(() => {
    const root = document.querySelectorAll("#anchor-图文信息 .material-space")[${materialIndex}];
    return root ? root.querySelectorAll(".upload-trigger:not(.upload-last-trigger)").length : -1;
  })()`) || 0);
}

async function removeExistingMedia(page, materialIndex) {
  console.error(`[xhs-product] clearing media section ${materialIndex}`);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const before = await mediaCount(page, materialIndex);
    if (before <= 0) {
      console.error(`[xhs-product] media section ${materialIndex} cleared`);
      return;
    }
    console.error(`[xhs-product] section ${materialIndex}: removing ${attempt + 1}, remaining ${before}`);
    const imageRect = await rectFor(page, `(() => {
      document.querySelectorAll("[data-opencli-product-delete-target]").forEach(el => el.removeAttribute("data-opencli-product-delete-target"));
      const item = document.querySelectorAll("#anchor-图文信息 .material-space")[${materialIndex}]?.querySelector(".upload-trigger:not(.upload-last-trigger)");
      if (item) item.setAttribute("data-opencli-product-delete-target", "true");
      return item;
    })()`);
    if (!imageRect) throw new CommandExecutionError(`Could not locate existing image in media section ${materialIndex}.`);
    let removed = false;
    for (let reveal = 0; reveal < 4 && !removed; reveal += 1) {
      if (typeof page.cdp === "function") {
        await page.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: imageRect.x, y: imageRect.y });
      }
      await wait(page, 0.25);
      let clicked = await evaluate(page, `(() => {
        const target = document.querySelector('[data-opencli-product-delete-target="true"]');
        if (!target) return false;
        const targetRect = target.getBoundingClientRect();
        const tx = targetRect.x + targetRect.width / 2;
        const ty = targetRect.y + targetRect.height / 2;
        const action = [...document.querySelectorAll(".trigger-opera__item")]
          .filter(el => el.offsetParent !== null && (el.textContent || "").trim() === "删除")
          .map(el => { const rect = el.getBoundingClientRect(); return { el, distance: (rect.x + rect.width / 2 - tx) ** 2 + (rect.y + rect.height / 2 - ty) ** 2 }; })
          .sort((a, b) => a.distance - b.distance)[0]?.el;
        if (!action) return false;
        action.click();
        return true;
      })()`);
      if (!clicked && typeof page.hover === "function") {
        await page.hover('[data-opencli-product-delete-target="true"]').catch(() => undefined);
        await wait(page, 0.4);
        clicked = await evaluate(page, `(() => {
          const target = document.querySelector('[data-opencli-product-delete-target="true"]');
          if (!target) return false;
          const targetRect = target.getBoundingClientRect();
          const tx = targetRect.x + targetRect.width / 2;
          const ty = targetRect.y + targetRect.height / 2;
          const action = [...document.querySelectorAll(".trigger-opera__item")]
            .filter(el => el.offsetParent !== null && (el.textContent || "").trim() === "删除")
            .map(el => { const rect = el.getBoundingClientRect(); return { el, distance: (rect.x + rect.width / 2 - tx) ** 2 + (rect.y + rect.height / 2 - ty) ** 2 }; })
            .sort((a, b) => a.distance - b.distance)[0]?.el;
          if (!action) return false;
          action.click();
          return true;
        })()`);
      }
      if (!clicked) continue;
      await wait(page, 0.45);
      removed = await mediaCount(page, materialIndex) < before;
    }
    if (!removed) throw new CommandExecutionError("Product image delete action did not take effect after retries.");
  }
  if (await mediaCount(page, materialIndex)) throw new CommandExecutionError("Could not clear all existing product images.");
}

async function clickText(page, text, tagSelector = "button,span,div") {
  const target = await evaluate(page, `(() => {
    document.querySelectorAll("[data-opencli-text-action]").forEach(el => el.removeAttribute("data-opencli-text-action"));
    const el = [...document.querySelectorAll(${JSON.stringify(tagSelector)})]
      .find(node => node.offsetParent !== null && (node.innerText || node.textContent || "").trim() === ${JSON.stringify(text)});
    if (!el) return null;
    el.setAttribute("data-opencli-text-action", "true");
    el.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = el.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  if (!target) throw new CommandExecutionError(`Could not find visible action: ${text}`);
  let clicked = false;
  if (typeof page.click === "function") {
    clicked = await page.click('[data-opencli-text-action="true"]').then(() => true).catch(() => false);
  }
  if (!clicked) await cdpClick(page, target.x, target.y);
}

async function openMaterialPicker(page, materialIndex) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const state = await evaluate(page, `(() => {
      const ready = [...document.querySelectorAll("button")]
        .some(el => el.offsetParent !== null && (el.innerText || "").trim() === "上传本地图片");
      if (ready) return { ready: true, found: true };
      document.querySelectorAll("[data-opencli-product-upload-trigger]")
        .forEach(el => el.removeAttribute("data-opencli-product-upload-trigger"));
      const outer = document.querySelectorAll("#anchor-图文信息 .material-space")[${materialIndex}]?.querySelector(".upload-last-trigger");
      const trigger = outer?.querySelector(".upload-trigger_container") || outer;
      if (!trigger) return { ready: false, found: false };
      trigger.scrollIntoView({ block: "center", inline: "nearest" });
      trigger.setAttribute("data-opencli-product-upload-trigger", "true");
      trigger.click();
      const rect = trigger.getBoundingClientRect();
      return { ready: false, found: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    if (state?.ready) return;
    if (!state?.found) throw new CommandExecutionError(`Could not find upload trigger for media section ${materialIndex}.`);
    let clicked = false;
    if (typeof page.click === "function") {
      clicked = await page.click('[data-opencli-product-upload-trigger="true"]').then(() => true).catch(() => false);
    }
    for (let poll = 0; poll < 2; poll += 1) {
      await wait(page, 0.6);
      const pickerReady = await evaluate(page, `(() => [...document.querySelectorAll("button")]
        .some(el => el.offsetParent !== null && (el.innerText || "").trim() === "上传本地图片"))()`);
      if (pickerReady) return;
    }
    const freshTarget = await evaluate(page, `(() => {
      const trigger = document.querySelector('[data-opencli-product-upload-trigger="true"]');
      if (!trigger) return null;
      trigger.scrollIntoView({ block: "center", inline: "nearest" });
      const rect = trigger.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    if (freshTarget && Number.isFinite(freshTarget.x) && Number.isFinite(freshTarget.y)) {
      await cdpClick(page, freshTarget.x, freshTarget.y);
    } else if (!clicked) {
      continue;
    }
    for (let poll = 0; poll < 5; poll += 1) {
      await wait(page, 0.6);
      const pickerReady = await evaluate(page, `(() => [...document.querySelectorAll("button")]
        .some(el => el.offsetParent !== null && (el.innerText || "").trim() === "上传本地图片"))()`);
      if (pickerReady) return;
    }
  }
  throw new CommandExecutionError("Xiaohongshu material picker did not open after retries.");
}

async function uploadToMaterialPicker(page, files) {
  console.error(`[xhs-product] preparing ${files.length} local image(s)`);
  const inputSelector = 'input[type="file"][accept*=".jpg"],input[type="file"][accept*=".jpeg"],input[type="file"][accept*=".png"]';
  let inputReady = Boolean(await evaluate(page, `(() => !!document.querySelector(${JSON.stringify(inputSelector)}))()`));
  if (!inputReady) {
    const uploadStarted = await evaluate(page, `(() => {
      const button = [...document.querySelectorAll("button")]
        .find(el => el.offsetParent !== null && (el.innerText || "").trim() === "上传本地图片");
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!uploadStarted) throw new CommandExecutionError("Could not activate Xiaohongshu local image upload.");
  }
  for (let retry = 0; retry < 8 && !inputReady; retry += 1) {
    inputReady = Boolean(await evaluate(page, `(() => !!document.querySelector(${JSON.stringify(inputSelector)}))()`));
    if (!inputReady) await wait(page, 0.5);
  }
  if (!inputReady) throw new CommandExecutionError("Could not find Xiaohongshu material image input.");

  const nativeErrors = [];
  let uploaded = false;
  if (typeof page.cdp === "function") {
    try {
      await page.cdp("DOM.enable", {}).catch(() => undefined);
      const doc = await page.cdp("DOM.getDocument", {});
      const rootNodeId = doc?.root?.nodeId;
      if (typeof rootNodeId !== "number") throw new Error("DOM.getDocument returned no root node");
      const query = await page.cdp("DOM.querySelector", { nodeId: rootNodeId, selector: inputSelector });
      if (typeof query?.nodeId !== "number" || query.nodeId <= 0) throw new Error("CDP could not find material image input");
      await page.cdp("DOM.setFileInputFiles", { files, nodeId: query.nodeId });
      uploaded = true;
    } catch (error) {
      nativeErrors.push(error instanceof Error ? error.message : String(error));
    }
  } else {
    nativeErrors.push("CDP is unavailable");
  }
  if (!uploaded && page.setFileInput) {
    try {
      await page.setFileInput(files, inputSelector);
      uploaded = true;
    } catch (error) {
      nativeErrors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (!uploaded) {
    console.error("[xhs-product] native upload unavailable; using compressed legacy injection");
    const images = files.map(file => ({
      name: path.basename(file),
      mimeType: /[.]png$/i.test(file) ? "image/png" : "image/jpeg",
      base64: fs.readFileSync(file).toString("base64")
    }));
    const totalBytes = images.reduce((sum, image) => sum + image.base64.length, 0);
    if (totalBytes > 3_500_000) {
      throw new CommandExecutionError(`Compressed image payload is still too large for the legacy browser bridge (${Math.ceil(totalBytes / 1024)}KB).`);
    }
    const injected = await evaluate(page, `(async () => {
      const input = document.querySelector(${JSON.stringify(inputSelector)});
      if (!input) return { ok: false, error: "material input disappeared" };
      const images = ${JSON.stringify(images)};
      const transfer = new DataTransfer();
      for (const image of images) {
        const binary = atob(image.base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        transfer.items.add(new File([bytes], image.name, { type: image.mimeType }));
      }
      Object.defineProperty(input, "files", { configurable: true, value: transfer.files });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return { ok: input.files?.length === images.length, count: input.files?.length || 0 };
    })()`);
    if (!injected?.ok) {
      throw new CommandExecutionError(`Could not upload product images: ${nativeErrors.join("; ")}; legacy injection failed: ${injected?.error || injected?.count || "unknown"}`);
    }
  }
  console.error("[xhs-product] files injected; waiting for Xiaohongshu upload result");
  await wait(page, 4);

  let uploadSummary = null;
  for (let retry = 0; retry < 25; retry += 1) {
    uploadSummary = await evaluate(page, `(() => {
      const text = document.body?.innerText || "";
      const match = text.match(/本次共成功上传\s*(\d+)\s*个文件[\s\S]{0,40}?(\d+)\s*个文件上传失败/);
      return match ? { success: Number(match[1]), failed: Number(match[2]) } : null;
    })()`);
    if (uploadSummary) break;
    await wait(page, 0.8);
  }
  if (uploadSummary) {
    console.error(`[xhs-product] material upload result: ${uploadSummary.success} success, ${uploadSummary.failed} failed`);
    if (uploadSummary.failed || uploadSummary.success < files.length) {
      throw new CommandExecutionError(`Xiaohongshu material upload reported ${uploadSummary.success} success and ${uploadSummary.failed} failure.`);
    }
    const resultConfirm = await rectFor(page, `[...document.querySelectorAll("button")]
      .filter(el => el.offsetParent !== null && (el.innerText || "").trim() === "确认").at(-1)`);
    if (!resultConfirm) throw new CommandExecutionError("Could not close Xiaohongshu local upload result dialog.");
    await cdpClick(page, resultConfirm.x, resultConfirm.y);
    await wait(page, 2);
  }

  const names = files.map(file => path.basename(file));
  for (const name of names) {
    const stem = path.basename(name, path.extname(name));
    let rect = null;
    for (let retry = 0; retry < 10 && !rect; retry += 1) {
      rect = await rectFor(page, `[...document.querySelectorAll("span,div")].find(el => {
        if (el.offsetParent === null || el.children.length !== 0) return false;
        const value = (el.textContent || "").trim();
        return value === ${JSON.stringify(name)} || value === ${JSON.stringify(`${stem}.jpeg`)} || value === ${JSON.stringify(`${stem}.jpg`)};
      })`);
      if (!rect) await wait(page, 1);
    }
    if (!rect) {
      const diagnostic = await evaluate(page, `(() => ({
        url: location.href,
        inputFiles: [...document.querySelectorAll("input[type=file]")].map(el => [...(el.files || [])].map(file => file.name)),
        matchingText: [...document.querySelectorAll("span,div")]
          .filter(el => el.offsetParent !== null && /xhs-|上传|失败|错误|格式|大小/.test(el.textContent || ""))
          .map(el => (el.textContent || "").trim().slice(0, 180)).filter(Boolean).slice(-20),
        imageLabels: [...document.querySelectorAll("img")]
          .filter(el => el.offsetParent !== null).map(el => el.alt || el.title || "").filter(Boolean).slice(0, 20),
        visibleButtons: [...document.querySelectorAll("button")]
          .filter(el => el.offsetParent !== null).map(el => (el.innerText || "").trim()).filter(Boolean).slice(-15)
      }))()`);
      throw new CommandExecutionError(`Uploaded image did not appear in material space: ${name}; state=${JSON.stringify(diagnostic)}`);
    }
    console.error(`[xhs-product] selecting material ${name}`);
    await cdpClick(page, rect.x, rect.y);
    await wait(page, 0.15);
  }
  await clickText(page, "确认", "button");
  await wait(page, 2);
  console.error("[xhs-product] material picker confirmed");
}

async function selectExistingMaterials(page, files) {
  for (const file of files) {
    const name = path.basename(file);
    const stem = path.basename(name, path.extname(name));
    let rect = null;
    for (let retry = 0; retry < 15 && !rect; retry += 1) {
      rect = await rectFor(page, `[...document.querySelectorAll("span,div")].find(el => {
        if (el.offsetParent === null || el.children.length !== 0) return false;
        const value = (el.textContent || "").trim();
        return value === ${JSON.stringify(name)} || value === ${JSON.stringify(`${stem}.jpeg`)} || value === ${JSON.stringify(`${stem}.jpg`)};
      })`);
      if (!rect) await wait(page, 0.8);
    }
    if (!rect) throw new CommandExecutionError(`Could not find uploaded material for product detail: ${name}`);
    console.error(`[xhs-product] selecting detail material ${name}`);
    await cdpClick(page, rect.x, rect.y);
    await wait(page, 0.2);
  }
  await clickText(page, "确认", "button");
  await wait(page, 2);
  console.error("[xhs-product] detail material picker confirmed");
}

async function replaceProductImages(page, files) {
  await removeExistingMedia(page, 0);
  await openMaterialPicker(page, 0);
  console.error("[xhs-product] material picker opened");
  await uploadToMaterialPicker(page, files);
  const mainCount = await mediaCount(page, 0);
  if (mainCount !== files.length) throw new CommandExecutionError(`Main image count mismatch: expected ${files.length}, got ${mainCount}.`);
  await removeExistingMedia(page, 2);
  await openMaterialPicker(page, 2);
  console.error("[xhs-product] detail material picker opened");
  await selectExistingMaterials(page, files);
  const detailCount = await mediaCount(page, 2);
  if (detailCount !== mainCount) throw new CommandExecutionError(`Detail image count mismatch: expected ${mainCount}, got ${detailCount}.`);
  console.error(`[xhs-product] image replacement complete: ${mainCount} main, ${detailCount} detail`);
}

async function submitProduct(page, shouldSubmit) {
  const label = shouldSubmit ? "提交商品" : "保存草稿";
  await clickText(page, label, "button");
  await wait(page, 4);
  const result = await evaluate(page, `((cfg) => {
    const text = document.body?.innerText || "";
    return {
      url: location.href,
      marker: cfg.markers.find(item => text.includes(item)) || "",
      error: [...document.querySelectorAll("[class*=error], [class*=danger]")]
        .filter(el => el.offsetParent !== null)
        .map(el => (el.innerText || "").trim())
        .filter(Boolean)
        .slice(0, 5)
        .join("；")
    };
  })(${JSON.stringify({ markers: shouldSubmit ? ["提交成功", "发布成功", "审核中"] : ["保存成功", "草稿已保存"] })})`);
  const navigated = result?.url && !String(result.url).includes("/good/create");
  if (!result?.marker && !navigated) throw new CommandExecutionError(`${label}结果无法确认${result?.error ? `：${result.error}` : ""}`);
  return result?.marker || result?.url || label;
}

cli({
  site: "xiaohongshu",
  name: "product-publish",
  access: "write",
  description: "在小红书千帆发布电子资源商品",
  domain: "ark.xiaohongshu.com",
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: "title", required: true, help: "商品标题（最多60字）" },
    { name: "short-title", required: true, help: "导购短标题（最多24字）" },
    { name: "images", required: false, help: "商品图片路径，逗号分隔，最多10张" },
    { name: "price", required: true, help: "售价" },
    { name: "stock", required: true, help: "库存" },
    { name: "delivery-link", required: true, help: "自动发货网盘链接" },
    { name: "delivery-content", required: true, help: "自动发货内容说明" },
    { name: "description", required: false, help: "详情页描述" },
    { name: "article-no", required: false, help: "商品货号" },
    { name: "template-id", required: false, help: "参考商品ID；省略时使用商品列表第一项" },
    { name: "submit", type: "bool", default: false, help: "提交审核；默认只保存草稿" },
    { name: "dry-run", type: "bool", default: false, help: "只检查页面和模板，不填写或保存" },
    { name: "upload-check", type: "bool", default: false, help: "调试：完成图片上传后停止，不保存商品" }
  ],
  columns: ["status", "detail"],
  func: async (page, kwargs) => {
    if (!page) throw new CommandExecutionError("Browser page required");
    const title = String(kwargs.title || "").trim();
    const shortTitle = String(kwargs["short-title"] || "").trim();
    const price = String(kwargs.price || "").trim();
    const stock = String(kwargs.stock || "").trim();
    const deliveryLink = String(kwargs["delivery-link"] || "").trim();
    const deliveryContent = String(kwargs["delivery-content"] || "").trim();
    const description = String(kwargs.description || "").trim();
    const articleNo = String(kwargs["article-no"] || "").trim();
    const shouldSubmit = Boolean(kwargs.submit);
    const dryRun = Boolean(kwargs["dry-run"]);
    const uploadCheck = Boolean(kwargs["upload-check"]);
    if (!title || title.length > 60) throw new ArgumentError("--title must be 1-60 characters");
    if (!shortTitle || shortTitle.length > 24) throw new ArgumentError("--short-title must be 1-24 characters");
    if (!/^\d+(?:[.]\d{1,2})?$/.test(price) || Number(price) <= 0) throw new ArgumentError("--price must be a positive amount with up to 2 decimals");
    if (!/^\d+$/.test(stock) || Number(stock) < 1) throw new ArgumentError("--stock must be a positive integer");
    if (!deliveryLink || !deliveryContent) throw new ArgumentError("--delivery-link and --delivery-content are required");
    const files = dryRun ? [] : validateFiles(kwargs.images);

    await page.goto(LIST_URL);
    await wait(page, 3);
    await assertMerchantLogin(page);
    const templateId = String(kwargs["template-id"] || "").trim() || await latestTemplateProductId(page);
    await page.goto(`${CREATE_URL}?similarSpuId=${encodeURIComponent(templateId)}`);
    await wait(page, 5);
    await assertMerchantLogin(page);
    const surface = await inspectProductForm(page);
    if (!surface?.hasTitle || !surface?.hasPrice || !surface?.hasDelivery) throw new CommandExecutionError("Xiaohongshu product form is incomplete or changed.");
    if (!String(surface.category).includes(EXPECTED_CATEGORY)) throw new CommandExecutionError(`Template category is not supported: ${surface.category}`);
    if (dryRun) return [{ status: "✅ 页面可用", detail: `${EXPECTED_CATEGORY} · 模板商品 ${templateId}` }];
    console.error(`[xhs-product] form ready with template ${templateId}`);

    await fill(page, "#anchor-cell-itemName input", title, "商品标题");
    await fill(page, "#anchor-cell-itemShortTitle input", shortTitle, "导购短标题");
    await fill(page, "#anchor-cell-properties-articleNo input", articleNo, "商品货号", false);
    await fill(page, "#anchor-cell-description-__NO_VARIANT_VALUE__-selector textarea", description, "详情页描述", false);
    await fill(page, "#anchor-cell-singleSku-module [id$='-price'] input", price, "售价");
    await fill(page, "#anchor-cell-singleSku-module [id$='-stock'] input", stock, "库存");
    await fill(page, "#anchor-cell-singleSku-module [id$='-deliveryLink'] textarea", deliveryLink, "自动发货链接");
    await fill(page, "#anchor-cell-singleSku-module [id$='-deliveryContent'] textarea", deliveryContent, "自动发货说明");
    console.error("[xhs-product] fields filled; replacing images");
    await replaceProductImages(page, files);
    if (uploadCheck) {
      return [{ status: "✅ 图片上传可用", detail: `${files.length}张图片已进入商品表单；未保存商品` }];
    }
    const marker = await submitProduct(page, shouldSubmit);
    return [{
      status: shouldSubmit ? "✅ 已提交审核" : "✅ 草稿已保存",
      detail: `${title} · ${files.length}张图片 · ¥${price} · ${marker}`
    }];
  }
});
