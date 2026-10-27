<template>
  <el-dialog v-model="visible" title="⚙️ API 设置" width="880px" class="config-dialog" @open="lockOverlayScroll" @closed="unlockOverlayScroll">
    <el-form v-if="local" label-position="top">
      <div class="form-grid">
        <el-form-item label="API 平台">
          <el-select v-model="local.provider" @change="applyProviderPreset">
            <el-option label="APIMart" value="apimart" />
            <el-option label="HFSY API" value="hfsy" />
            <el-option label="图见" value="ltutuai" />
            <el-option label="兔子API" value="tuzi" />
          </el-select>
        </el-form-item>
        <el-form-item label="API Key">
          <el-input
            v-model="apiKeyInput"
            type="password"
            show-password
            :placeholder="apiKeyPlaceholder"
            autocomplete="new-password"
          />
        </el-form-item>
        <el-form-item label="Base URL"><el-input v-model="local.baseUrl" /></el-form-item>
        <el-form-item label="模型名称">
          <el-select v-if="local.provider === 'hfsy'" v-model="local.model">
            <el-option label="GPT Image 2（仅 1K）" value="gpt-image-2" />
            <el-option label="GPT Image 2.5（仅 1K）" value="gpt-image-2.5" />
            <el-option label="Nano Banana 2" value="nano-banana-2" />
            <el-option label="Nano Banana Pro" value="nano-banana-pro" />
          </el-select>
          <el-input v-else v-model="local.model" />
        </el-form-item>
      </div>
      <el-divider>批量生图控制</el-divider>
      <div class="batch-control-box">
        <div class="batch-control-row">
          <label>最大批量生图数量：</label>
          <div class="batch-number-field">
            <el-input-number v-model="local.maxBatchCount" :min="1" :max="1000" controls-position="right" />
            <span>个</span>
          </div>
          <p>每批提交的任务数量，例如总量 500 个，设置 500 则一次提交</p>
        </div>
        <div class="batch-control-row">
          <label>主 API 并发数：</label>
          <div class="batch-number-field">
            <el-input-number v-model="local.maxConcurrency" :min="1" :max="100" controls-position="right" />
            <span>个线程</span>
          </div>
          <p>同时向生图接口提交的任务数量，默认 100，最高 100，优先保证稳定生成</p>
        </div>
        <div class="batch-control-row">
          <label>批次等待模式：</label>
          <strong>提交一批后等待完成，再提交下一批</strong>
          <p>大批量任务会自动分批，减少接口限流、超时和代理中断</p>
        </div>
      </div>
      <el-divider>高级稳定参数</el-divider>
      <div class="form-grid">
        <el-form-item label="单张超时 ms"><el-input-number v-model="local.timeoutMs" :min="10000" :step="1000" /></el-form-item>
        <el-form-item label="失败重试次数"><el-input-number v-model="local.maxRetries" :min="0" :max="6" /></el-form-item>
        <el-form-item label="重试等待 ms"><el-input-number v-model="local.retryDelay" :min="500" :step="500" /></el-form-item>
      </div>
      <el-divider>版面规划模型（PPT 多图层版式）</el-divider>
      <div class="form-grid">
        <el-form-item label="启用 LLM 规划">
          <el-switch v-model="local.layoutModel.enabled" active-text="开启" inactive-text="关闭（按内容自动布局）" />
          <span class="muted">开启后文档生 PPT 由文本大模型规划版面，效果更丰富</span>
        </el-form-item>
        <el-form-item label="API Key" v-if="local.layoutModel.enabled">
          <el-input v-model="local.layoutModel.apiKey" placeholder="DeepSeek 等 OpenAI 兼容 key" show-password />
        </el-form-item>
        <el-form-item label="Base URL" v-if="local.layoutModel.enabled">
          <el-input v-model="local.layoutModel.baseUrl" placeholder="https://api.deepseek.com/v1" />
        </el-form-item>
        <el-form-item label="模型名称" v-if="local.layoutModel.enabled">
          <el-input v-model="local.layoutModel.model" placeholder="deepseek-chat" />
        </el-form-item>
      </div>
      <el-divider>小红书官方商品 API</el-divider>
      <el-alert
        title="只读连通检测"
        type="info"
        :closable="false"
        show-icon
        description="使用开放平台分配的 App Key 和 App Secret 读取 1 条商品列表数据；不会创建、修改、审核或上架商品。"
      />
      <div class="form-grid xhs-api-grid">
        <el-form-item label="接口环境">
          <el-select v-model="local.xhsOfficialApi.environment">
            <el-option label="沙箱环境（推荐先测试）" value="sandbox" />
            <el-option label="正式环境" value="production" />
          </el-select>
        </el-form-item>
        <div class="xhs-api-ready">
          <el-tag :type="xhsCredentialsReady ? 'success' : 'info'" effect="plain">
            {{ xhsCredentialsReady ? '凭据已保存' : '等待开放平台凭据' }}
          </el-tag>
        </div>
        <el-form-item label="App Key">
          <el-input
            v-model="xhsAppKeyInput"
            type="password"
            show-password
            autocomplete="new-password"
            :placeholder="xhsAppKeyPlaceholder"
          />
        </el-form-item>
        <el-form-item label="App Secret">
          <el-input
            v-model="xhsAppSecretInput"
            type="password"
            show-password
            autocomplete="new-password"
            :placeholder="xhsAppSecretPlaceholder"
          />
        </el-form-item>
      </div>
      <div class="xhs-api-actions">
        <el-button class="pink-outline" :loading="xhsOfficialTesting" @click="testXhsOfficialConnection">
          检测小红书官方连接
        </el-button>
        <span>密钥只保存在本机服务端配置中，网页端只能看到掩码。</span>
      </div>
      <el-divider>文件缓存管理</el-divider>
      <div class="form-grid">
        <el-form-item label="自动清理缓存">
          <el-switch v-model="local.cacheCleanupEnabled" active-text="开启" inactive-text="关闭" :loading="cacheAutoSaving" @change="saveCacheSettings" />
        </el-form-item>
        <el-form-item label="缓存保留天数">
          <el-input-number v-model="local.cacheRetentionDays" :min="1" :max="3650" :disabled="!local.cacheCleanupEnabled" @change="saveCacheSettings" />
          <span class="muted">天</span>
        </el-form-item>
      </div>
      <div class="cache-status-box">
        <div>
          <b>当前缓存：{{ formatBytes(cacheStatus.totalBytes) }}（{{ cacheStatus.totalFiles }} 个文件）</b>
          <span>按保留 {{ local.cacheRetentionDays }} 天计算，可清理 {{ formatBytes(cacheStatus.cleanableBytes) }}（{{ cacheStatus.cleanableFiles }} 个文件）</span>
          <span v-if="cacheStatus.protectedFiles">另有 {{ cacheStatus.protectedFiles }} 个未完成任务文件受保护，不会清理。</span>
        </div>
        <div class="cache-status-actions">
          <el-button class="pink-outline" :loading="cacheStatusLoading" @click="loadCacheStatus">刷新统计</el-button>
          <el-button class="pink-button" :loading="cacheCleaning" :disabled="!cacheStatus.cleanableFiles" @click="runCacheCleanup">立即清理</el-button>
        </div>
      </div>
      <p class="cache-cleanup-note">开关和保留天数修改后会立即自动保存。后台每天检查一次，只清理 uploads 缓存目录中超过保留天数且不属于未完成任务的文件；外部输出文件夹不会被清理。</p>
      <el-divider>图片差异化增强</el-divider>
      <div class="form-grid">
        <el-form-item label="默认开启"><el-switch v-model="local.originality.enabled" /></el-form-item>
        <el-form-item label="透明 PNG 叠加文件夹"><el-input v-model="local.originality.overlayFolder" placeholder="可选，本机 PNG 文件夹路径" /></el-form-item>
        <el-form-item label="最小透明度 %"><el-input-number v-model="local.originality.minOpacity" :min="0" :max="10" /></el-form-item>
        <el-form-item label="最大透明度 %"><el-input-number v-model="local.originality.maxOpacity" :min="0" :max="10" /></el-form-item>
        <el-form-item label="空间缩放 %"><el-input-number v-model="local.originality.spatialDistortion" :min="0" :max="2" :step="0.1" /></el-form-item>
        <el-form-item label="色彩调整 %"><el-input-number v-model="local.originality.colorShift" :min="0" :max="8" :step="0.5" /></el-form-item>
        <el-form-item label="保留 EXIF"><el-switch v-model="local.originality.cloneExif" /></el-form-item>
      </div>
    </el-form>
    <template #footer>
      <el-button class="pink-outline" :loading="configStore.testing" @click="testCurrent">🌐 测试连接</el-button>
      <el-button @click="visible = false">取消</el-button>
      <el-button class="pink-button" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { cleanupCache, getCacheStatus } from "../api/config";
import { testXhsOfficialApi } from "../api/xhsPublish";
import { useConfigStore } from "../stores/useConfigStore";
import { useTaskStore } from "../stores/useTaskStore";

const props = defineProps({ modelValue: Boolean });
const emit = defineEmits(["update:modelValue"]);
const configStore = useConfigStore();
const taskStore = useTaskStore();
const local = ref(null);
const apiKeyInput = ref("");
const xhsAppKeyInput = ref("");
const xhsAppSecretInput = ref("");
const xhsOfficialTesting = ref(false);
const activeProvider = ref("");
const cacheStatusLoading = ref(false);
const cacheCleaning = ref(false);
const cacheAutoSaving = ref(false);
const cacheStatus = ref({ totalFiles: 0, totalBytes: 0, protectedFiles: 0, cleanableFiles: 0, cleanableBytes: 0 });
let cacheSavePending = false;
const DEFAULT_PROVIDER = "hfsy";
const API_PROVIDER_PRESETS = {
  apimart: {
    baseUrl: "https://api.apimart.ai/v1",
    model: "gpt-image-2",
    proxyHost: "",
    proxyPort: "",
    proxyProtocol: "direct"
  },
  hfsy: {
    baseUrl: "https://www.hfsyapi.cn/v1",
    model: "gpt-image-2",
    proxyHost: "",
    proxyPort: "",
    proxyProtocol: "direct"
  },
  ltutuai: {
    baseUrl: "https://ltutuai.top/api/v1",
    model: "gpt-image-2",
    proxyHost: "",
    proxyPort: "",
    proxyProtocol: "direct"
  },
  tuzi: {
    baseUrl: "https://api.tu-zi.com/v1",
    model: "gpt-image-2",
    proxyHost: "",
    proxyPort: "",
    proxyProtocol: "direct"
  }
};
const PROVIDER_PROFILE_FIELDS = ["baseUrl", "model", "proxyHost", "proxyPort", "proxyProtocol"];
const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit("update:modelValue", value)
});

function normalizeProvider(provider = DEFAULT_PROVIDER) {
  return API_PROVIDER_PRESETS[provider] ? provider : DEFAULT_PROVIDER;
}

function getProviderPreset(provider = DEFAULT_PROVIDER) {
  return API_PROVIDER_PRESETS[normalizeProvider(provider)];
}

function normalizeProviderProfile(profile = {}, provider = DEFAULT_PROVIDER) {
  const normalizedProvider = normalizeProvider(provider);
  const preset = getProviderPreset(normalizedProvider);
  const otherProviderPresetUrls = Object.entries(API_PROVIDER_PRESETS)
    .filter(([name]) => name !== normalizedProvider)
    .map(([, value]) => value.baseUrl);
  const baseUrl = otherProviderPresetUrls.includes(profile.baseUrl) ? preset.baseUrl : profile.baseUrl || preset.baseUrl;
  return {
    ...preset,
    ...profile,
    baseUrl,
    model: profile.model || preset.model,
    proxyHost: profile.proxyHost ?? preset.proxyHost,
    proxyPort: profile.proxyPort ?? preset.proxyPort,
    proxyProtocol: profile.proxyProtocol || preset.proxyProtocol
  };
}

function getCurrentProfile() {
  return PROVIDER_PROFILE_FIELDS.reduce((profile, field) => {
    profile[field] = local.value?.[field] ?? "";
    return profile;
  }, {});
}

function ensureProviderSettings() {
  if (!local.value) return;
  const providerSettings = local.value.providerSettings || {};
  local.value.providerSettings = Object.keys(API_PROVIDER_PRESETS).reduce((settings, provider) => {
    settings[provider] = normalizeProviderProfile(providerSettings[provider], provider);
    return settings;
  }, {});

  local.value.provider = normalizeProvider(local.value.provider);
}

function applyProviderProfile(provider) {
  if (!local.value) return;
  const normalizedProvider = normalizeProvider(provider);
  const profile = normalizeProviderProfile(local.value.providerSettings?.[normalizedProvider], normalizedProvider);
  PROVIDER_PROFILE_FIELDS.forEach((field) => {
    local.value[field] = profile[field] ?? "";
  });
}

function rememberProviderProfile(provider = activeProvider.value) {
  if (!local.value || !provider) return;
  ensureProviderSettings();
  local.value.providerSettings[normalizeProvider(provider)] = {
    ...local.value.providerSettings[normalizeProvider(provider)],
    ...getCurrentProfile()
  };
}

watch(
  () => props.modelValue,
  async (isOpen) => {
    if (!isOpen) return;
    await configStore.load();
    if (configStore.config) {
      local.value = JSON.parse(JSON.stringify(configStore.config));
      local.value.apiKey = "";
      local.value.layoutModel = {
        enabled: false, apiKey: "", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat",
        ...(local.value.layoutModel || {})
      };
      local.value.xhsOfficialApi = {
        environment: "sandbox",
        appKey: "",
        appSecret: "",
        hasAppKey: false,
        hasAppSecret: false,
        ...(local.value.xhsOfficialApi || {})
      };
      local.value.provider = normalizeProvider(local.value.provider);
      ensureProviderSettings();
      local.value.providerSettings[local.value.provider] = normalizeProviderProfile(
        {
          ...local.value.providerSettings[local.value.provider],
          ...getCurrentProfile()
        },
        local.value.provider
      );
      activeProvider.value = local.value.provider;
      applyProviderProfile(activeProvider.value);
      local.value.originality = local.value.originality || {};
      local.value.maxBatchCount = Number(local.value.maxBatchCount || 100);
      local.value.maxConcurrency = Number(local.value.maxConcurrency || 100);
      apiKeyInput.value = "";
      xhsAppKeyInput.value = "";
      xhsAppSecretInput.value = "";
      await loadCacheStatus();
    }
  },
  { immediate: true }
);

async function save() {
  if (!local.value) return;
  await configStore.save(buildConfigPayload());
  taskStore.applyConfig(configStore.config);
  visible.value = false;
}

async function saveCacheSettings() {
  if (!local.value) return;
  if (cacheAutoSaving.value) {
    cacheSavePending = true;
    return;
  }
  cacheAutoSaving.value = true;
  try {
    await configStore.save(buildConfigPayload(), { silent: true });
    taskStore.applyConfig(configStore.config);
    ElMessage.success("缓存清理设置已自动保存");
    await loadCacheStatus();
  } catch (error) {
    ElMessage.error(error.response?.data?.message || "缓存设置保存失败");
  } finally {
    cacheAutoSaving.value = false;
    if (cacheSavePending) {
      cacheSavePending = false;
      void saveCacheSettings();
    }
  }
}

async function loadCacheStatus() {
  cacheStatusLoading.value = true;
  try {
    const response = await getCacheStatus();
    cacheStatus.value = { ...cacheStatus.value, ...(response.data.status || {}) };
  } catch (error) {
    ElMessage.error(error.response?.data?.message || "缓存统计读取失败");
  } finally {
    cacheStatusLoading.value = false;
  }
}

async function runCacheCleanup() {
  if (!cacheStatus.value.cleanableFiles) return ElMessage.info("当前没有超过保留天数的可清理缓存");
  try {
    await ElMessageBox.confirm(
      `将清理 ${cacheStatus.value.cleanableFiles} 个超过 ${local.value.cacheRetentionDays} 天的缓存文件，未完成任务和外部输出文件不会受影响。`,
      "确认清理缓存",
      { confirmButtonText: "立即清理", cancelButtonText: "取消", type: "warning" }
    );
  } catch {
    return;
  }

  cacheCleaning.value = true;
  try {
    const response = await cleanupCache();
    cacheStatus.value = { ...cacheStatus.value, ...(response.data.status || {}) };
    const result = response.data.result || {};
    ElMessage.success(`已清理 ${result.removedFiles || 0} 个文件，释放 ${formatBytes(result.removedBytes || 0)}`);
  } catch (error) {
    ElMessage.error(error.response?.data?.message || "缓存清理失败");
  } finally {
    cacheCleaning.value = false;
  }
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function buildConfigPayload() {
  rememberProviderProfile(local.value.provider);
  return {
    ...local.value,
    apiKey: apiKeyInput.value.trim(),
    xhsOfficialApi: {
      ...local.value.xhsOfficialApi,
      appKey: xhsAppKeyInput.value.trim(),
      appSecret: xhsAppSecretInput.value.trim()
    }
  };
}

async function testCurrent() {
  if (!local.value) return;
  await configStore.test(buildConfigPayload());
}

async function testXhsOfficialConnection() {
  if (!local.value || xhsOfficialTesting.value) return;
  xhsOfficialTesting.value = true;
  try {
    const payload = buildConfigPayload().xhsOfficialApi;
    const response = await testXhsOfficialApi(payload);
    ElMessage.success(response.data?.message || "小红书官方 API 已接通");
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message || "小红书官方 API 连接失败");
  } finally {
    xhsOfficialTesting.value = false;
  }
}

function applyProviderPreset(provider) {
  if (!local.value) return;
  rememberProviderProfile(activeProvider.value || local.value.provider);
  local.value.provider = normalizeProvider(provider);
  applyProviderProfile(local.value.provider);
  activeProvider.value = local.value.provider;
}

const apiKeyPlaceholder = computed(() => {
  const provider = normalizeProvider(local.value?.provider);
  const status = configStore.config?.providerKeyStatus?.[provider];
  if (status?.hasApiKey) return `当前平台已设置 ${status.apiKey}，如需更换请粘贴新 Key`;
  return "粘贴当前平台的 API Key，例如 sk-...";
});

const xhsCredentialsReady = computed(() => Boolean(
  (xhsAppKeyInput.value.trim() || local.value?.xhsOfficialApi?.hasAppKey)
  && (xhsAppSecretInput.value.trim() || local.value?.xhsOfficialApi?.hasAppSecret)
));
const xhsAppKeyPlaceholder = computed(() => local.value?.xhsOfficialApi?.hasAppKey
  ? `已保存 ${local.value.xhsOfficialApi.appKey}，如需更换请粘贴新 Key`
  : "粘贴开放平台分配的 App Key");
const xhsAppSecretPlaceholder = computed(() => local.value?.xhsOfficialApi?.hasAppSecret
  ? "App Secret 已保存，如需更换请粘贴新 Secret"
  : "粘贴与 App Key 配套的 App Secret");

let lockedOverlay = null;
function lockOverlayScroll() {
  const dialog = document.querySelector(".el-dialog.config-dialog");
  const overlay = dialog?.closest(".el-overlay-dialog") || dialog?.parentElement;
  if (overlay) {
    overlay.style.overflow = "hidden";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    lockedOverlay = overlay;
  }
}
function unlockOverlayScroll() {
  if (!lockedOverlay) return;
  lockedOverlay.style.overflow = "";
  lockedOverlay.style.display = "";
  lockedOverlay.style.alignItems = "";
  lockedOverlay.style.justifyContent = "";
  lockedOverlay = null;
}
</script>

<style scoped>
.cache-status-box{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:14px 16px;border:1px solid var(--border-pink);border-radius:12px;background:#f1faf7}.cache-status-box>div:first-child{display:grid;gap:5px}.cache-status-box span{color:var(--text-muted);font-size:13px}.cache-status-actions{display:flex;flex-shrink:0;gap:8px}.cache-cleanup-note{margin:10px 0 0;color:var(--text-muted);font-size:13px;line-height:1.7}@media(max-width:760px){.cache-status-box{align-items:flex-start;flex-direction:column}}
.xhs-api-grid{align-items:end;margin-top:14px}.xhs-api-ready{display:flex;align-items:center;min-height:40px}.xhs-api-actions{display:flex;align-items:center;gap:12px;margin-top:2px}.xhs-api-actions span{color:var(--text-muted);font-size:13px}@media(max-width:760px){.xhs-api-actions{align-items:flex-start;flex-direction:column}}
</style>
