import { timingSafeEqual } from "node:crypto";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function required(env, name) {
  const value = String(env?.[name] || "").trim();
  if (!value) throw new Error(`缺少云端配置：${name}`);
  return value;
}

function secureTokenMatches(supplied, expected) {
  const encoder = new TextEncoder();
  const suppliedBytes = encoder.encode(supplied);
  const expectedBytes = encoder.encode(expected);
  return suppliedBytes.byteLength === expectedBytes.byteLength
    && timingSafeEqual(suppliedBytes, expectedBytes);
}

function dateMilliseconds(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function recordFields(event) {
  const isTest = event.event_type === "connection_test";
  const activatedAt = dateMilliseconds(event.activated_at || event.tested_at) || Date.now();
  const fields = {
    "卡号": isTest ? `连接测试-${new Date(activatedAt).toISOString()}` : String(event.license_id || "").trim(),
    "卡型": isTest ? "连接测试" : String(event.plan_label || event.plan || "").trim(),
    "激活时间": activatedAt,
    "永久": Boolean(event.permanent),
    "安装编号": isTest ? "后台连接测试" : String(event.installation_id || "").trim(),
    "软件版本": String(event.app_version || "").trim(),
    "事件编号": String(event.event_id || "").trim()
  };
  const expiresAt = dateMilliseconds(event.expires_at);
  if (expiresAt) fields["到期时间"] = expiresAt;
  return fields;
}

async function feishuJson(fetchImpl, url, init) {
  const response = await fetchImpl(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.code !== 0) {
    throw new Error(body.msg || body.message || `飞书接口返回 HTTP ${response.status}`);
  }
  return body;
}

async function tenantAccessToken(env, fetchImpl) {
  const body = await feishuJson(fetchImpl, "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ app_id: required(env, "FEISHU_APP_ID"), app_secret: required(env, "FEISHU_APP_SECRET") })
  });
  if (!body.tenant_access_token) throw new Error("飞书未返回 tenant_access_token");
  return body.tenant_access_token;
}

export async function handleRequest(request, env, fetchImpl = fetch) {
  try {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json(200, { code: 0, message: "activation relay ready" });
    }
    if (request.method !== "POST" || url.pathname !== "/activation") {
      return json(404, { code: 404, message: "not found" });
    }

    const expectedToken = required(env, "REPORT_TOKEN");
    const suppliedToken = String(request.headers.get("x-activation-report-token") || "").trim();
    if (!suppliedToken || !secureTokenMatches(suppliedToken, expectedToken)) {
      return json(401, { code: 401, message: "invalid report token" });
    }

    const event = await request.json();
    if (!event || !["license_activated", "connection_test"].includes(event.event_type)) {
      return json(400, { code: 400, message: "invalid activation event" });
    }
    if (event.event_type === "license_activated" && !String(event.license_id || "").trim()) {
      return json(400, { code: 400, message: "license_id is required" });
    }

    const token = await tenantAccessToken(env, fetchImpl);
    const appToken = required(env, "FEISHU_APP_TOKEN");
    const tableId = required(env, "FEISHU_TABLE_ID");
    const result = await feishuJson(
      fetchImpl,
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records`,
      {
        method: "POST",
        headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
        body: JSON.stringify({ fields: recordFields(event) })
      }
    );
    return json(200, { code: 0, message: "ok", record_id: result.data?.record?.record_id || "" });
  } catch (error) {
    return json(502, { code: 502, message: error?.message || "activation relay failed" });
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  }
};
