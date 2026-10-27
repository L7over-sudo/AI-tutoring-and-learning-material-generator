const token = new URLSearchParams(location.search).get("token") || "";
const generateButton = document.getElementById("generate");
const statusText = document.getElementById("status");
const resultBox = document.getElementById("result");
const codeOutput = document.getElementById("code");
const meta = document.getElementById("meta");
const historyBox = document.getElementById("history");
const historySearch = document.getElementById("historySearch");
const statusFilter = document.getElementById("statusFilter");
const feishuWebhook = document.getElementById("feishuWebhook");
const feishuReportToken = document.getElementById("feishuReportToken");
const feishuStatus = document.getElementById("feishuStatus");
const toast = document.getElementById("toast");
let selectedPlan = "week";
let historyRecords = [];
let toastTimer;

function authorization() {
  return { authorization: `Bearer ${token}` };
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
}

function switchView(view) {
  document.querySelectorAll(".view").forEach((item) => item.classList.toggle("active", item.id === `${view}View`));
  document.querySelectorAll(".nav").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  if (view === "history") loadHistory();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function formatTime(value) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
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

function stateLabel(state) {
  if (state === "activation") return "激活后计时";
  return state === "active" ? "有效" : "已过期";
}

async function copyText(value, message = "已复制") {
  if (!value) return;
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
  showToast(message);
}

function renderHistory() {
  const query = historySearch.value.trim().toLowerCase();
  const selectedState = statusFilter.value;
  const records = historyRecords.filter((record) => {
    const stateMatches = selectedState === "all" || recordState(record) === selectedState;
    const searchText = [record.planLabel, record.plan, record.code, record.licenseId].filter(Boolean).join(" ").toLowerCase();
    return stateMatches && (!query || searchText.includes(query));
  });

  historyBox.innerHTML = "";
  if (!records.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = historyRecords.length ? "没有符合条件的发卡记录" : "还没有发卡记录";
    historyBox.appendChild(empty);
    return;
  }

  records.forEach((record) => {
    const state = recordState(record);
    const card = document.createElement("article");
    card.className = "history-card";

    const head = document.createElement("div");
    head.className = "history-head";
    const name = document.createElement("strong");
    name.textContent = record.planLabel;
    const badge = document.createElement("span");
    badge.className = `badge ${state}`;
    badge.textContent = stateLabel(state);
    head.append(name, badge);

    const detail = document.createElement("div");
    detail.className = "history-meta";
    [["生成时间", formatTime(record.issuedAt)], ["到期时间", formatExpiry(record)], ["记录编号", record.licenseId || "—"]].forEach(([label, value]) => {
      const key = document.createElement("b");
      key.textContent = label;
      const text = document.createElement("span");
      text.textContent = value;
      detail.append(key, text);
    });

    const actions = document.createElement("div");
    actions.className = "history-actions";
    const copy = document.createElement("button");
    copy.className = "secondary";
    copy.textContent = "复制激活码";
    copy.addEventListener("click", () => copyText(record.code, "激活码已复制"));
    const remove = document.createElement("button");
    remove.className = "danger";
    remove.textContent = "删除记录";
    remove.addEventListener("click", () => deleteRecord(record));
    actions.append(copy, remove);
    card.append(head, detail, actions);
    historyBox.appendChild(card);
  });
}

async function loadHistory() {
  try {
    const response = await fetch("/api/history", { headers: authorization() });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || "记录读取失败");
    historyRecords = data.records;
    renderHistory();
  } catch (error) {
    historyBox.innerHTML = `<div class="empty">${error?.message || "记录读取失败"}</div>`;
  }
}

async function deleteRecord(record) {
  if (!window.confirm(`确定删除这条${record.planLabel}记录吗？\n\n只删除本地记录，已发出的激活码仍然有效。`)) return;
  try {
    const response = await fetch("/api/history", {
      method: "DELETE",
      headers: { ...authorization(), "content-type": "application/json" },
      body: JSON.stringify({ licenseId: record.licenseId })
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || "删除失败");
    showToast("本地记录已删除");
    await loadHistory();
  } catch (error) {
    showToast(error?.message || "删除失败");
  }
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
    feishuStatus.textContent = feishuWebhook.value ? "飞书记录已配置" : "尚未配置飞书记录";
  } catch (error) {
    feishuStatus.textContent = error?.message || "读取飞书配置失败";
  }
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
    [result.planLabel, `生成：${formatTime(result.issuedAt)}`, `有效期：${formatExpiry(result)}`].forEach((value) => {
      const item = document.createElement("span");
      item.textContent = value;
      meta.appendChild(item);
    });
    resultBox.classList.add("show");
    statusText.className = "status ok";
    statusText.textContent = "生成成功，激活码已复制";
    await copyText(result.code, "生成成功，已复制");
    await loadHistory();
    resultBox.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    statusText.className = "status";
    statusText.textContent = error?.message || "激活码生成失败";
  } finally {
    generateButton.disabled = false;
    generateButton.textContent = "一键生成并复制";
  }
});

document.getElementById("copy").addEventListener("click", () => copyText(codeOutput.value, "激活码已复制"));
document.getElementById("goHistory").addEventListener("click", () => switchView("history"));
document.getElementById("refresh").addEventListener("click", loadHistory);
historySearch.addEventListener("input", renderHistory);
statusFilter.addEventListener("change", renderHistory);
document.querySelectorAll(".nav").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));

document.getElementById("saveFeishu").addEventListener("click", async () => {
  try {
    await feishuRequest("/api/feishu-config", { webhookUrl: feishuWebhook.value, reportToken: feishuReportToken.value });
    feishuStatus.className = "status ok";
    feishuStatus.textContent = "飞书配置已保存，重新打包客户端后生效";
    showToast("配置已保存");
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
    feishuStatus.textContent = error?.message || "连接飞书失败";
  }
});

loadHistory();
loadFeishuConfig();
