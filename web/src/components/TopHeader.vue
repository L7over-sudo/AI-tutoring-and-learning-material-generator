<template>
  <header class="top-header">
    <div>
        <h1>📚 AI自动作图工具</h1>
      <p>批量导入教辅图，一键 AI 重绘，生成适合小红书发布的清晰图片 ✨</p>
    </div>
    <div class="header-actions">
      <el-tag
        v-if="licenseStatus?.valid && !licenseStatus.development"
        type="success"
        effect="light"
        :title="licenseExpiryTitle"
      >
        {{ licenseStatus.planLabel }} · {{ licenseRemainingLabel }}
      </el-tag>
      <el-tag :type="configStore.backendOnline ? 'success' : 'danger'" effect="light">
        {{ configStore.backendOnline ? "后端已连接" : "后端未连接" }}
      </el-tag>
      <el-tag :type="configStore.config?.hasApiKey ? 'success' : 'warning'" effect="light">
        {{ configStore.config?.hasApiKey ? `API ${configStore.config.apiKey}` : "API 未设置" }}
      </el-tag>
      <el-button class="pink-outline" @click="$emit('openConfig')">⚙️ API 设置</el-button>
    </div>
  </header>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useConfigStore } from "../stores/useConfigStore";

defineEmits(["openConfig"]);
const configStore = useConfigStore();
const licenseStatus = ref(null);
const nowMs = ref(Date.now());
let unsubscribeLicense;
let countdownTimer;

function padTime(value) {
  return String(value).padStart(2, "0");
}

const licenseRemainingLabel = computed(() => {
  if (licenseStatus.value?.permanent) return "永久有效";
  const expiresAt = Date.parse(licenseStatus.value?.expiresAt || "");
  const remainingMs = Number.isFinite(expiresAt)
    ? Math.max(0, expiresAt - nowMs.value)
    : Number(licenseStatus.value?.remainingMs || 0);
  if (remainingMs <= 0) return "已到期";
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock = `${padTime(hours)}:${padTime(minutes)}:${padTime(seconds)}`;
  return days > 0 ? `剩余 ${days}天 ${clock}` : `剩余 ${clock}`;
});
const licenseExpiryTitle = computed(() => licenseStatus.value?.permanent
  ? "永久有效"
  : (licenseStatus.value?.expiresAt
    ? `有效期至 ${new Date(licenseStatus.value.expiresAt).toLocaleString("zh-CN")}`
    : ""));

onMounted(async () => {
  if (!window.license?.getStatus) return;
  licenseStatus.value = await window.license.getStatus();
  nowMs.value = Date.now();
  unsubscribeLicense = window.license.onStatus?.((status) => {
    licenseStatus.value = status;
    nowMs.value = Date.now();
  });
  countdownTimer = window.setInterval(async () => {
    nowMs.value = Date.now();
    const expiresAt = Date.parse(licenseStatus.value?.expiresAt || "");
    if (licenseStatus.value?.valid && Number.isFinite(expiresAt) && nowMs.value >= expiresAt) {
      licenseStatus.value = await window.license.getStatus();
    }
  }, 1000);
});

onBeforeUnmount(() => {
  unsubscribeLicense?.();
  if (countdownTimer) window.clearInterval(countdownTimer);
});
</script>
