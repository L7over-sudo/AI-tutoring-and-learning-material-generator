const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_PENDING_REPORTS = 200;

function readReportConfig(configPath) {
  const environmentUrl = String(process.env.FEISHU_ACTIVATION_WEBHOOK_URL || "").trim();
  const environmentToken = String(process.env.FEISHU_ACTIVATION_REPORT_TOKEN || "").trim();
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return {
      webhookUrl: environmentUrl || String(config?.webhookUrl || "").trim(),
      reportToken: environmentToken || String(config?.reportToken || "").trim()
    };
  } catch {
    return { webhookUrl: environmentUrl, reportToken: environmentToken };
  }
}

function readWebhookUrl(configPath) {
  return readReportConfig(configPath).webhookUrl;
}

function createActivationReporter({
  app,
  fetchImpl = globalThis.fetch,
  configPath = path.join(__dirname, "activation-report-config.json"),
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  const dataDir = app.getPath("userData");
  const queuePath = path.join(dataDir, "activation-report-queue.json");
  const installationPath = path.join(dataDir, "installation-id.txt");
  let operation = Promise.resolve();

  async function installationId() {
    try {
      const existing = (await fsp.readFile(installationPath, "utf8")).trim();
      if (existing) return existing;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const value = crypto.randomUUID();
    await fsp.mkdir(dataDir, { recursive: true });
    await fsp.writeFile(installationPath, value, { encoding: "utf8", mode: 0o600 });
    return value;
  }

  async function readQueue() {
    try {
      const parsed = JSON.parse(await fsp.readFile(queuePath, "utf8"));
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      return [];
    }
  }

  async function writeQueue(records) {
    await fsp.mkdir(dataDir, { recursive: true });
    const temporaryPath = `${queuePath}.tmp`;
    await fsp.writeFile(temporaryPath, JSON.stringify(records.slice(-MAX_PENDING_REPORTS), null, 2), {
      encoding: "utf8",
      mode: 0o600
    });
    await fsp.rename(temporaryPath, queuePath);
  }

  function serial(task) {
    operation = operation.then(task, task);
    return operation;
  }

  async function enqueue(status) {
    if (!status?.firstActivation || !status.licenseId) return { queued: false };
    return serial(async () => {
      const records = await readQueue();
      const installId = await installationId();
      const event = {
        event_type: "license_activated",
        event_id: crypto.randomUUID(),
        product: "AI自动作图工具",
        license_id: status.licenseId,
        plan: status.plan,
        plan_label: status.planLabel,
        activated_at: status.activatedAt,
        expires_at: status.expiresAt || "永久有效",
        permanent: Boolean(status.permanent),
        installation_id: installId,
        app_version: app.getVersion?.() || ""
      };
      if (!records.some((record) => record.event_id === event.event_id)) records.push(event);
      await writeQueue(records);
      return { queued: true, event };
    });
  }

  async function send(webhookUrl, reportToken, event) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      const headers = { "content-type": "application/json; charset=utf-8" };
      if (reportToken) headers["x-activation-report-token"] = reportToken;
      const response = await fetchImpl(webhookUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(event),
        signal: controller.signal
      });
      const responseText = await response.text();
      let responseBody;
      try { responseBody = JSON.parse(responseText); } catch { responseBody = null; }
      if (!response.ok || (responseBody && Number.isFinite(responseBody.code) && responseBody.code !== 0)) {
        throw new Error(responseBody?.msg || responseBody?.message || `HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async function flush() {
    return serial(async () => {
      const { webhookUrl, reportToken } = readReportConfig(configPath);
      const records = await readQueue();
      if (!webhookUrl || !records.length) return { configured: Boolean(webhookUrl), sent: 0, pending: records.length };
      const remaining = [];
      let sent = 0;
      for (const event of records) {
        try {
          await send(webhookUrl, reportToken, event);
          sent += 1;
        } catch {
          remaining.push(event);
        }
      }
      await writeQueue(remaining);
      return { configured: true, sent, pending: remaining.length };
    });
  }

  return { configPath, enqueue, flush, installationPath, queuePath };
}

module.exports = { createActivationReporter, readReportConfig, readWebhookUrl };
