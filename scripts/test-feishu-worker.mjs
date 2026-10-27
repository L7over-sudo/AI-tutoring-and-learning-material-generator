import assert from "node:assert/strict";
import { handleRequest } from "../cloudflare/activation-relay/worker.mjs";

const calls = [];
const fetchImpl = async (url, init) => {
  calls.push({ url, init, body: JSON.parse(init.body) });
  if (url.includes("tenant_access_token")) {
    return new Response(JSON.stringify({ code: 0, tenant_access_token: "tenant-token" }), { status: 200 });
  }
  return new Response(JSON.stringify({ code: 0, data: { record: { record_id: "rec-test" } } }), { status: 200 });
};

const env = {
  FEISHU_APP_ID: "cli-test",
  FEISHU_APP_SECRET: "secret-test",
  FEISHU_APP_TOKEN: "app-token",
  FEISHU_TABLE_ID: "table-id",
  REPORT_TOKEN: "report-token"
};
const event = {
  event_type: "license_activated",
  event_id: "event-1",
  license_id: "license-1",
  plan_label: "7天卡",
  activated_at: "2026-09-04T00:00:00.000Z",
  expires_at: "2026-09-11T00:00:00.000Z",
  permanent: false,
  installation_id: "installation-1",
  app_version: "1.0.7"
};

const unauthorized = await handleRequest(new Request("https://relay.example/activation", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(event)
}), env, fetchImpl);
assert.equal(unauthorized.status, 401);

const response = await handleRequest(new Request("https://relay.example/activation", {
  method: "POST",
  headers: { "content-type": "application/json", "x-activation-report-token": "report-token" },
  body: JSON.stringify(event)
}), env, fetchImpl);
assert.equal(response.status, 200);
assert.equal((await response.json()).record_id, "rec-test");
assert.equal(calls.length, 2);
assert.equal(calls[1].body.fields["卡号"], "license-1");
assert.equal(calls[1].body.fields["卡型"], "7天卡");
assert.equal(calls[1].body.fields["激活时间"], Date.parse(event.activated_at));
assert.equal(calls[1].body.fields["到期时间"], Date.parse(event.expires_at));
assert.equal(calls[1].init.headers.authorization, "Bearer tenant-token");

console.log("飞书中转 Worker 测试通过：鉴权、令牌获取和字段映射均正常。");
