const reason = document.getElementById("reason");
const codeInput = document.getElementById("code");
const statusText = document.getElementById("status");
const activateButton = document.getElementById("activateButton");

async function refresh() {
  const status = await window.licenseApi.getStatus();
  if (status.message) reason.textContent = status.message;
}

document.getElementById("quitButton").addEventListener("click", () => window.licenseApi.quit());

activateButton.addEventListener("click", async () => {
  const code = codeInput.value.trim();
  if (!code) {
    statusText.className = "status";
    statusText.textContent = "请先粘贴激活码";
    return;
  }
  activateButton.disabled = true;
  activateButton.textContent = "正在校验…";
  try {
    const result = await window.licenseApi.activate(code);
    if (!result.valid) throw new Error(result.message || "激活失败");
    statusText.className = "status ok";
    statusText.textContent = result.permanent
      ? `激活成功：${result.planLabel}，永久有效`
      : `激活成功：${result.planLabel}，有效期至 ${new Date(result.expiresAt).toLocaleString("zh-CN")}`;
  } catch (error) {
    statusText.className = "status";
    statusText.textContent = error?.message || "激活失败";
    activateButton.disabled = false;
    activateButton.textContent = "立即激活";
  }
});

refresh().catch((error) => {
  reason.textContent = error?.message || "许可证状态读取失败";
});
