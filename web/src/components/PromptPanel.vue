<template>
  <section class="panel prompt-panel">
    <div class="panel-title">{{ panelTitle }}</div>
    <el-form label-position="top" class="prompt-form">
      <el-form-item label="提示词模板">
        <div class="template-select-row">
          <el-select v-model="form.promptTemplate" filterable :disabled="isPresentation" @change="applyTemplate">
            <el-option v-for="template in templateStore.templates" :key="template.id" :label="template.name" :value="template.name" />
          </el-select>
          <el-button class="pink-outline" :disabled="isPresentation" @click="templateDialogVisible = true">🧩 管理模板</el-button>
        </div>
        <span v-if="isPresentation" class="muted">此 PPT 使用创建任务时保存的模板；更换风格请重新创建 PPT 任务</span>
      </el-form-item>
      <el-form-item v-if="!isPresentation" label="重绘强度">
        <el-segmented v-model="form.redrawStrength" :options="['默认', '保守优化', '明显重设计', '创意笔记化']" @change="applyStrength" />
      </el-form-item>
      <div class="form-grid">
        <el-form-item label="尺寸">
          <div class="size-field">
            <el-select v-model="displayedSize" filterable :disabled="isPresentation">
              <el-option v-for="item in sizeOptions" :key="item" :label="item" :value="item" />
            </el-select>
            <span v-if="isPresentation" class="muted">PPT 页面固定为 16:9</span>
          </div>
        </el-form-item>
        <el-form-item label="分辨率">
          <el-select v-model="form.quality">
            <el-option v-for="opt in qualityOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </el-form-item>
      </div>
      <el-form-item :label="promptLabel">
        <el-input v-model="form.prompt" type="textarea" :rows="8" resize="none" :disabled="isPresentation" :placeholder="promptPlaceholder" />
      </el-form-item>
    </el-form>
    <PromptTemplateDialog v-model="templateDialogVisible" />
  </section>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useTaskStore } from "../stores/useTaskStore";
import { useConfigStore } from "../stores/useConfigStore";
import { usePromptTemplateStore } from "../stores/usePromptTemplateStore";
import PromptTemplateDialog from "./PromptTemplateDialog.vue";

const taskStore = useTaskStore();
const configStore = useConfigStore();
const templateStore = usePromptTemplateStore();
const { generationForm: form } = storeToRefs(taskStore);
const templateDialogVisible = ref(false);
const defaultTemplateName = "粉色笔记风";
const legacyDefaultTemplateNames = ["小红书教辅重设计", "可爱卡通风"];
const sizeOptions = ["原尺寸", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "21:9", "9:21"];
const qualityOptions = computed(() => {
  const provider = configStore.config?.provider;
  const pricing = configStore.config?.providerPricing?.[provider];
  const tiers = [
    { value: "1k", label: "1K" },
    { value: "2k", label: "2K" },
    { value: "4k", label: "4K" }
  ];
  if (!pricing) return tiers;
  return tiers.map((tier) => ({
    ...tier,
    label: pricing[tier.value] ? `${tier.label}（¥${pricing[tier.value]}/张）` : tier.label
  }));
});
const isPresentation = computed(() => taskStore.batch?.sourceType === "presentation");
const displayedSize = computed({
  get: () => isPresentation.value ? "16:9" : form.value.size,
  set: (value) => {
    if (!isPresentation.value) form.value.size = value;
  }
});
const panelTitle = computed(() => {
  if (isPresentation.value) return "📊 PPT 统一风格";
  return taskStore.batch?.sourceType === "storyboard" ? "🎬 AI 分镜绘制" : "🎨 AI 教辅绘制";
});
const promptLabel = computed(() => isPresentation.value ? "PPT 统一风格提示词" : taskStore.batch?.sourceType === "storyboard" ? "统一提示词" : "提示词");
const promptPlaceholder = computed(() => isPresentation.value
  ? "选择上方模板，或描述整套 PPT 的配色、字体感、构图、插画和排版风格"
  : taskStore.batch?.sourceType === "storyboard"
    ? "可选：填写全部分镜共用的画面风格、角色、构图等要求"
    : "");

onMounted(async () => {
  await templateStore.load();
  syncSelectedTemplate({ preferDefault: true });
});

watch(
  () => templateStore.templates.map((template) => `${template.id}:${template.name}`).join("|"),
  () => syncSelectedTemplate()
);

function syncSelectedTemplate({ preferDefault = false } = {}) {
  const templates = templateStore.templates || [];
  if (!templates.length) {
    form.value.promptTemplate = "";
    form.value.prompt = "";
    return;
  }

  const currentName = form.value.promptTemplate;
  const hasSavedPrompt = Boolean(form.value.prompt?.trim());
  const shouldUseDefault =
    preferDefault &&
    !hasSavedPrompt &&
    (!currentName || currentName === defaultTemplateName || legacyDefaultTemplateNames.includes(currentName)) &&
    templateStore.templateMap[defaultTemplateName];
  const currentExists = currentName && templateStore.templateMap[currentName];
  const nextName = shouldUseDefault ? defaultTemplateName : currentExists ? currentName : templates[0].name;

  if (form.value.promptTemplate !== nextName) {
    form.value.promptTemplate = nextName;
  }
  if (preferDefault && hasSavedPrompt && currentExists && nextName === currentName) return;
  applyTemplate(nextName);
}

function applyTemplate(name) {
  if (!templateStore.templateMap[name]) return;
  form.value.prompt = templateStore.templateMap[name];
  applyStrength(form.value.redrawStrength);
}

function applyStrength(strength) {
  const currentStrength = strength || "默认";
  if (form.value.redrawStrength !== currentStrength) {
    form.value.redrawStrength = currentStrength;
  }
  const base = form.value.prompt.replace(/\n\n重绘强度[\s\S]*$/, "");
  if (currentStrength === "默认") {
    form.value.prompt = base;
    return;
  }
  const strengthPrompt = {
    保守优化: "重绘强度：保守优化。保留原图已有文字、题目数量、栏目数量和信息密度；只做清晰度、色彩、间距、边框和细节优化。可以增加少量轻量装饰元素，例如边框、分隔线、贴纸角标、底纹和图标，让画面更精致；标题如果原图有就保留并美化原标题，原图没有标题就不要新增标题或标题栏。严禁新增原图没有的题目、例题、知识点、答案、学习提示和人物对话。原图内容少时不要扩写内容，空白区域可做淡背景和轻装饰；如果原图是封面或说明页，只做封面/说明页美化，不要扩展成练习页或知识卡片。",
    明显重设计: "重绘强度：明显重设计。保留核心文字和题目，但标题区、装饰元素、分隔线、表格视觉和页面层级需要明显不同于原图。",
    创意笔记化: "重绘强度：创意笔记化。做成小红书学习笔记/教辅卡片风格，允许更明显的色块、标签、重点标记和重新排版。"
  }[currentStrength];
  form.value.prompt = strengthPrompt ? `${base}\n\n${strengthPrompt}` : base;
}
</script>

<style scoped>
.size-field { display: grid; gap: 5px; width: 100%; }
</style>
