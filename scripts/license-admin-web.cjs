const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const { issueLicense, privateDir, privateKeyPath } = require("./license-issuer.cjs");

const host = process.env.LICENSE_ADMIN_HOST || "0.0.0.0";
const localHost = "127.0.0.1";
const preferredPort = Number(process.env.LICENSE_ADMIN_PORT || 32218);
const accessToken = crypto.randomBytes(24).toString("base64url");
const historyPath = process.env.LICENSE_ADMIN_HISTORY_PATH
  ? path.resolve(process.env.LICENSE_ADMIN_HISTORY_PATH)
  : path.join(privateDir, "issued-licenses.jsonl");
const htmlPath = path.join(__dirname, "license-admin.html");
const scriptPath = path.join(__dirname, "license-admin-web.js");
const mobileHtmlPath = path.join(__dirname, "license-admin-mobile.html");
const mobileScriptPath = path.join(__dirname, "license-admin-mobile.js");
const activationReportConfigPath = path.join(__dirname, "..", "electron", "activation-report-config.json");

function validateWebhookUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  let parsed;
  try { parsed = new URL(normalized); } catch { throw new Error("Webhook 地址格式不正确"); }
  const allowLocal = process.env.LICENSE_ADMIN_ALLOW_LOCAL_WEBHOOK === "1";
  if (parsed.protocol !== "https:" && !(allowLocal && parsed.protocol === "http:")) {
    throw new Error("Webhook 地址必须使用 HTTPS");
  }
  return parsed.toString();
}

function readFeishuConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(activationReportConfigPath, "utf8"));
    return {
      webhookUrl: String(config?.webhookUrl || "").trim(),
      reportToken: String(config?.reportToken || "").trim()
    };
  } catch {
    return { webhookUrl: "", reportToken: "" };
  }
}

function saveFeishuConfig(webhookUrl, reportToken) {
  const normalized = validateWebhookUrl(webhookUrl);
  const normalizedToken = String(reportToken || "").trim();
  fs.writeFileSync(activationReportConfigPath, `${JSON.stringify({ webhookUrl: normalized, reportToken: normalizedToken }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  return { webhookUrl: normalized, reportToken: normalizedToken };
}

async function testFeishuWebhook(webhookUrl, reportToken) {
  const normalized = validateWebhookUrl(webhookUrl);
  if (!normalized) throw new Error("请先填写飞书 Webhook 地址");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  timer.unref?.();
  try {
    const headers = { "content-type": "application/json; charset=utf-8" };
    const normalizedToken = String(reportToken || "").trim();
    if (normalizedToken) headers["x-activation-report-token"] = normalizedToken;
    const response = await fetch(normalized, {
      method: "POST",
      headers,
      body: JSON.stringify({
        event_type: "connection_test",
        product: "AI自动作图工具",
        message: "飞书激活记录连接测试",
        tested_at: new Date().toISOString()
      }),
      signal: controller.signal
    });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = null; }
    if (!response.ok || (body && Number.isFinite(body.code) && body.code !== 0)) {
      throw new Error(body?.msg || body?.message || `飞书返回 HTTP ${response.status}`);
    }
    return { success: true };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("连接飞书超时");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function send(response, status, body, contentType) {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'"
  });
  response.end(body);
}

function sendJson(response, status, data) {
  send(response, status, JSON.stringify(data), "application/json; charset=utf-8");
}

function isAuthorized(request, url) {
  if (["/", "/mobile", "/m"].includes(url.pathname) && url.searchParams.get("token") === accessToken) return true;
  return request.headers.authorization === `Bearer ${accessToken}`;
}

function localIpv4Addresses() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.push(entry.address);
    }
  }
  const priority = (address) => {
    if (address.startsWith("192.168.")) return 3;
    if (address.startsWith("10.")) return 2;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 1;
    return 0;
  };
  return [...new Set(addresses)].sort((left, right) => priority(right) - priority(left));
}

function mobileUrls(port) {
  return localIpv4Addresses().map((address) => `http://${address}:${port}/mobile?token=${accessToken}`);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 8192) reject(new Error("请求内容过大"));
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("请求格式不正确"));
      }
    });
    request.on("error", reject);
  });
}

function saveIssued(result) {
  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  fs.appendFileSync(historyPath, `${JSON.stringify({ ...result, createdAt: new Date().toISOString() })}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
}

function recentIssued(limit = 30) {
  if (!fs.existsSync(historyPath)) return [];
  return fs.readFileSync(historyPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-limit)
    .reverse()
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function deleteIssued(licenseId) {
  const normalizedId = String(licenseId || "").trim();
  if (!normalizedId) throw new Error("缺少要删除的记录编号");
  if (!fs.existsSync(historyPath)) throw new Error("发卡记录不存在");
  const records = fs.readFileSync(historyPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
  const remaining = records.filter((record) => record.licenseId !== normalizedId);
  if (remaining.length === records.length) throw new Error("没有找到要删除的发卡记录");
  const serialized = remaining.length ? `${remaining.map((record) => JSON.stringify(record)).join("\n")}\n` : "";
  fs.writeFileSync(historyPath, serialized, { encoding: "utf8", mode: 0o600 });
}

function openBrowser(url) {
  let command;
  let args;
  if (process.platform === "win32") {
    command = "rundll32.exe";
    args = ["url.dll,FileProtocolHandler", url];
  } else if (process.platform === "darwin") {
    command = "open";
    args = [url];
  } else {
    command = "xdg-open";
    args = [url];
  }
  try {
    childProcess.spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch {
    // The URL is printed below when automatic browser opening is unavailable.
  }
}

function start(port) {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${host}:${port}`);

    if (request.method === "GET" && url.pathname === "/license-admin-web.js") {
      return send(response, 200, fs.readFileSync(scriptPath), "text/javascript; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/license-admin-mobile.js") {
      return send(response, 200, fs.readFileSync(mobileScriptPath), "text/javascript; charset=utf-8");
    }
    if (!isAuthorized(request, url)) return sendJson(response, 403, { success: false, message: "无权访问发卡后台" });
    if (request.method === "GET" && url.pathname === "/") {
      return send(response, 200, fs.readFileSync(htmlPath), "text/html; charset=utf-8");
    }
    if (request.method === "GET" && ["/mobile", "/m"].includes(url.pathname)) {
      return send(response, 200, fs.readFileSync(mobileHtmlPath), "text/html; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/api/mobile-info") {
      return sendJson(response, 200, {
        success: true,
        urls: mobileUrls(port),
        sameWifiRequired: true
      });
    }
    if (request.method === "GET" && url.pathname === "/api/history") {
      return sendJson(response, 200, { success: true, records: recentIssued(1000) });
    }
    if (request.method === "GET" && url.pathname === "/api/feishu-config") {
      return sendJson(response, 200, { success: true, config: readFeishuConfig() });
    }
    if (request.method === "POST" && url.pathname === "/api/feishu-config") {
      try {
        const body = await readBody(request);
        const config = saveFeishuConfig(body.webhookUrl, body.reportToken);
        return sendJson(response, 200, { success: true, config });
      } catch (error) {
        return sendJson(response, 400, { success: false, message: error?.message || "飞书配置保存失败" });
      }
    }
    if (request.method === "POST" && url.pathname === "/api/feishu-test") {
      try {
        const body = await readBody(request);
        await testFeishuWebhook(body.webhookUrl, body.reportToken);
        return sendJson(response, 200, { success: true });
      } catch (error) {
        return sendJson(response, 400, { success: false, message: error?.message || "飞书连接测试失败" });
      }
    }
    if (request.method === "DELETE" && url.pathname === "/api/history") {
      try {
        const body = await readBody(request);
        deleteIssued(body.licenseId);
        return sendJson(response, 200, { success: true });
      } catch (error) {
        return sendJson(response, 400, { success: false, message: error?.message || "发卡记录删除失败" });
      }
    }
    if (request.method === "POST" && url.pathname === "/api/generate") {
      try {
        const body = await readBody(request);
        const result = issueLicense({ plan: body.plan });
        saveIssued(result);
        return sendJson(response, 200, { success: true, result });
      } catch (error) {
        return sendJson(response, 400, { success: false, message: error?.message || "激活码生成失败" });
      }
    }
    return sendJson(response, 404, { success: false, message: "页面不存在" });
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && port < preferredPort + 20) return start(port + 1);
    console.error(`发卡后台启动失败：${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    const url = `http://${localHost}:${port}/?token=${accessToken}`;
    const phoneUrls = mobileUrls(port);
    console.log("激活码发卡后台已启动。管理链接含私密令牌，请勿公开分享。");
    console.log(`电脑端：${url}`);
    if (phoneUrls.length) {
      console.log("手机端（手机与电脑需连接同一 Wi-Fi）：");
      phoneUrls.forEach((phoneUrl) => console.log(phoneUrl));
    } else {
      console.log("未检测到可用的局域网地址，手机端暂时只能在电脑网络配置完成后访问。");
    }
    console.log("关闭本窗口即可停止后台。");
    if (process.env.LICENSE_ADMIN_NO_OPEN !== "1") openBrowser(url);
  });
}

if (!fs.existsSync(privateKeyPath)) {
  console.error("未找到许可证私钥，请先运行 npm run license:init");
  process.exitCode = 1;
} else {
  start(preferredPort);
}
