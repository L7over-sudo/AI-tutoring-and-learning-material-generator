const token = new URLSearchParams(location.search).get("token") || "";
const generateButton = document.getElementById("generate");
const statusText = document.getElementById("status");
const resultBox = document.getElementById("result");
const codeOutput = document.getElementById("code");
const meta = document.getElementById("meta");
const historyBody = document.getElementById("history");
const historySearch = document.getElementById("historySearch");
const statusFilter = document.getElementById("statusFilter");
const feishuWebhook = document.getElementById("feishuWebhook");
const feishuReportToken = document.getElementById("feishuReportToken");
const feishuStatus = document.getElementById("feishuStatus");
const mobileLink = document.getElementById("mobileLink");
const mobileTip = document.getElementById("mobileTip");
let selectedPlan = "week";
let historyRecords = [];

function authorization() {
  return { authorization: `Bearer ${token}` };
}

async function feishuRequest(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { ...authorization(), "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.message || "飞书操作失败");
  return data;
}

async function loadFeishuConfig() {
  try {
    const response = await fetch("/api/feishu-config", { headers: authorization() });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || "读取飞书配置失败");
    feishuWebhook.value = data.config?.webhookUrl || "";
    feishuReportToken.value = data.config?.reportToken || "";
    feishuStatus.className = "status ok";
    feishuStatus.textContent = feishuWebhook.value ? "已配置；重新打包客户端后生效" : "尚未配置飞书 Webhook";
  } catch (error) {
    feishuStatus.className = "status";
    feishuStatus.textContent = error?.message || "读取飞书配置失败";
  }
}

async function loadMobileInfo() {
  try {
    const response = await fetch("/api/mobile-info", { headers: authorization() });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || "读取手机地址失败");
    mobileLink.value = data.urls?.[0] || "";
    mobileTip.textContent = mobileLink.value
      ? "手机与电脑连接同一 Wi-Fi 后打开此地址；管理链接请勿公开分享。"
      : "没有检测到局域网地址，请检查电脑网络连接。";
  } catch (error) {
    mobileLink.value = "";
    mobileTip.textContent = error?.message || "读取手机地址失败";
  }
}

function formatTime(value) {
  return value ? new Date(value).toLocaleString("zh-CN") : "—";
}

function formatExpiry(record) {
  if (record.plan === "lifetime") return "永久有效";
  if (record.startsOnActivation) return `首次激活后 ${record.days} 天`;
  return formatTime(record.expiresAt);
}

function recordState(record) {
  if (record.startsOnActivation) return "activation";
  if (record.plan === "lifetime") return "active";
  return new Date(record.expiresAt).getTime() > Date.now() ? "active" : "expired";
}

function renderHistory() {
  const query = historySearch.value.trim().toLowerCase();
  const selectedState = statusFilter.value;
  const records = historyRecords.filter((record) => {
    const stateMatches = selectedState === "all" || recordState(record) === selectedState;
    const searchText = [record.planLabel, record.plan, record.code, record.licenseId]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return stateMatches && (!query || searchText.includes(query));
  });

  historyBody.innerHTML = "";
  if (!records.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.className = "empty";
    cell.textContent = historyRecords.length ? "没有符合条件的发卡记录" : "还没有发卡记录";
    row.appendChild(cell);
    historyBody.appendChild(row);
    return;
  }

  records.forEach((record) => {
    const row = document.createElement("tr");
    const planCell = document.createElement("td");
    planCell.textContent = record.planLabel;
    row.appendChild(planCell);

    const state = recordState(record);
    const stateCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `state ${state}`;
    badge.textContent = state === "activation" ? "激活后计时" : (state === "active" ? "有效" : "已过期");
    stateCell.appendChild(badge);
    row.appendChild(stateCell);

    [formatTime(record.issuedAt), formatExpiry(record)].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });

    const action = document.createElement("td");
    const actionGroup = document.createElement("div");
    actionGroup.className = "row-actions";
    const copyButton = document.createElement("button");
    copyButton.className = "mini";
    copyButton.textContent = "复制";
    copyButton.addEventListener("click", () => copyText(record.code));
    const deleteButton = document.createElement("button");
    deleteButton.className = "mini danger";
    deleteButton.textContent = "删除";
    deleteButton.addEventListener("click", () => deleteRecord(record));
    actionGroup.append(copyButton, deleteButton);
    action.appendChild(actionGroup);
    row.appendChild(action);
    historyBody.appendChild(row);
  });
}

async function deleteRecord(record) {
  const confirmed = window.confirm(`确定删除这条${record.planLabel}记录吗？\n\n只会删除本地记录，已经发给客户的离线激活码仍然有效。`);
  if (!confirmed) return;
  try {
    const response = await fetch("/api/history", {
      method: "DELETE",
      headers: { ...authorization(), "content-type": "application/json" },
      body: JSON.stringify({ licenseId: record.licenseId })
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || "删除失败");
    statusText.className = "status ok";
    statusText.textContent = "本地发卡记录已删除；已发出的激活码不受影响";
    await loadHistory();
  } catch (error) {
    statusText.className = "status";
    statusText.textContent = error?.message || "发卡记录删除失败";
  }
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const temporary = document.createElement("textarea");
    temporary.value = value;
    temporary.style.position = "fixed";
    temporary.style.opacity = "0";
    document.body.appendChild(temporary);
    temporary.select();
    document.execCommand("copy");
    temporary.remove();
  }
  statusText.className = "status ok";
  statusText.textContent = "激活码已复制，可以直接发给客户";
}

document.getElementById("plans").addEventListener("click", (event) => {
  const button = event.target.closest("[data-plan]");
  if (!button) return;
  selectedPlan = button.dataset.plan;
  document.querySelectorAll("[data-plan]").forEach((item) => item.classList.toggle("active", item === button));
});

generateButton.addEventListener("click", async () => {
  generateButton.disabled = true;
  generateButton.textContent = "正在生成…";
  statusText.textContent = "";
  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { ...authorization(), "content-type": "application/json" },
      body: JSON.stringify({ plan: selectedPlan })
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || "生成失败");
    const result = data.result;
    codeOutput.value = result.code;
    meta.innerHTML = "";
    [result.planLabel, `生成：${formatTime(result.issuedAt)}`, `有效期：${formatExpiry(result)}`]
      .forEach((value) => {
        const item = document.createElement("span");
        item.textContent = value;
        meta.appendChild(item);
      });
    resultBox.classList.add("show");
    await copyText(result.code);
    await loadHistory();
  } catch (error) {
    statusText.className = "status";
    statusText.textContent = error?.message || "激活码生成失败";
  } finally {
    generateButton.disabled = false;
    generateButton.textContent = "一键生成激活码";
  }
});

document.getElementById("copy").addEventListener("click", () => copyText(codeOutput.value));
document.getElementById("copyMobileLink").addEventListener("click", () => {
  if (mobileLink.value) copyText(mobileLink.value);
});
document.getElementById("openMobile").addEventListener("click", () => {
  if (mobileLink.value) window.open(mobileLink.value, "_blank", "noopener");
});
document.getElementById("refresh").addEventListener("click", () => loadHistory());
document.getElementById("saveFeishu").addEventListener("click", async () => {
  try {
    await feishuRequest("/api/feishu-config", { webhookUrl: feishuWebhook.value, reportToken: feishuReportToken.value });
    feishuStatus.className = "status ok";
    feishuStatus.textContent = "飞书配置已保存；重新打包客户端后生效";
  } catch (error) {
    feishuStatus.className = "status";
    feishuStatus.textContent = error?.message || "保存飞书配置失败";
  }
});
document.getElementById("testFeishu").addEventListener("click", async () => {
  feishuStatus.className = "status";
  feishuStatus.textContent = "正在连接飞书…";
  try {
    await feishuRequest("/api/feishu-test", { webhookUrl: feishuWebhook.value, reportToken: feishuReportToken.value });
    feishuStatus.className = "status ok";
    feishuStatus.textContent = "连接成功，飞书已收到测试事件";
  } catch (error) {
    feishuStatus.className = "status";
    feishuStatus.textContent = error?.message || "连接飞书失败";
  }
});
historySearch.addEventListener("input", renderHistory);
statusFilter.addEventListener("change", renderHistory);

async function loadHistory() {
  try {
    const response = await fetch("/api/history", { headers: authorization() });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || "记录读取失败");
    historyRecords = data.records;
    renderHistory();
  } catch (error) {
    historyBody.innerHTML = "";
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.className = "empty";
    cell.textContent = error?.message || "记录读取失败";
    row.appendChild(cell);
    historyBody.appendChild(row);
  }
}

loadHistory();
loadFeishuConfig();
loadMobileInfo();
