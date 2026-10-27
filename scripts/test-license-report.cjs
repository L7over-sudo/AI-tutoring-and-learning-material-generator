const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { createActivationReporter } = require("../electron/license-report.cjs");

async function run() {
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-license-report-test-"));
  const configPath = path.join(temporaryDir, "report-config.json");
  const received = [];
  const receivedTokens = [];
  let shouldFail = true;
  const server = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      received.push(JSON.parse(body));
      receivedTokens.push(request.headers["x-activation-report-token"] || "");
      response.writeHead(shouldFail ? 503 : 200, { "content-type": "application/json" });
      response.end(JSON.stringify(shouldFail ? { code: 1, msg: "temporary" } : { code: 0 }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    fs.writeFileSync(configPath, JSON.stringify({ webhookUrl: "" }));
    const app = { getPath: () => temporaryDir, getVersion: () => "1.0.7" };
    const reporter = createActivationReporter({ app, configPath, timeoutMs: 2000 });
    const status = {
      firstActivation: true,
      licenseId: "license-test-1",
      plan: "week",
      planLabel: "7天卡",
      activatedAt: "2026-09-04T00:00:00.000Z",
      expiresAt: "2026-09-11T00:00:00.000Z",
      permanent: false
    };

    assert.equal((await reporter.enqueue(status)).queued, true);
    assert.deepEqual(await reporter.flush(), { configured: false, sent: 0, pending: 1 });
    const url = `http://127.0.0.1:${server.address().port}/activation`;
    fs.writeFileSync(configPath, JSON.stringify({ webhookUrl: url, reportToken: "test-report-token" }));

    assert.deepEqual(await reporter.flush(), { configured: true, sent: 0, pending: 1 });
    shouldFail = false;
    assert.deepEqual(await reporter.flush(), { configured: true, sent: 1, pending: 0 });
    assert.equal(received.length, 2);
    assert.equal(received[1].license_id, status.licenseId);
    assert.equal(received[1].activated_at, status.activatedAt);
    assert.equal(received[1].expires_at, status.expiresAt);
    assert.equal(received[1].app_version, "1.0.7");
    assert.ok(received[1].installation_id);
    assert.equal(receivedTokens[1], "test-report-token");
    assert.equal("code" in received[1], false);

    assert.equal((await reporter.enqueue({ ...status, firstActivation: false })).queued, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}

run()
  .then(() => console.log("飞书激活回执测试通过：离线排队、失败保留、联网重试和字段保护均正常。"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
