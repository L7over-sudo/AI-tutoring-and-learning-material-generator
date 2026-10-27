<template>
  <el-dialog v-model="visible" title="📊 文档生 PPT" width="760px" class="source-dialog document-ppt-dialog" @closed="reset">
    <div class="document-ppt-body">
      <el-upload ref="uploadRef" class="upload-box document-ppt-uploader" drag accept=".pdf,.docx,.txt,.md"
        :auto-upload="false" :show-file-list="false" :on-change="onFileChange">
        <div class="upload-emoji">📊</div>
        <div class="upload-text">拖拽文档到这里，或点击选择文档</div>
        <div class="upload-hint">支持 PDF / DOCX / TXT / Markdown，单文件最大 50MB</div>
      </el-upload>

      <div v-if="file" class="document-ppt-file">
        <span>当前文档：{{ file.name }}</span>
        <el-button link type="danger" @click="clearFile">移除</el-button>
      </div>

      <div class="document-ppt-settings single">
        <el-form-item label="PPT 文件名">
          <el-input v-model="settings.pptName" placeholder="默认使用文档名" clearable />
        </el-form-item>
        <div class="document-ppt-style-source">
          <span>统一视觉风格</span>
          <b>{{ activeTemplateName }}</b>
          <small>使用页面右侧当前“提示词模板”和提示词</small>
        </div>
        <el-form-item label="文字内容">
          <el-select v-model="settings.textMode" style="width: 100%">
            <el-option label="精简要点（推荐）" value="concise" />
            <el-option label="完整保留原文" value="preserve" />
          </el-select>
        </el-form-item>
        <el-form-item label="页面疏密">
          <el-select v-model="settings.pageDensity" style="width: 100%">
            <el-option label="平衡排版（推荐）" value="balanced" />
            <el-option label="尽量保持原页数" value="preserve" />
            <el-option label="大字疏朗" value="spacious" />
          </el-select>
        </el-form-item>
      </div>

      <div class="document-ppt-actions">
        <el-button class="pink-button" :loading="processing" :disabled="!file" @click="createTasks">📋 加入任务列表</el-button>
      </div>

      <div v-if="processing" class="document-ppt-progress">
        <div class="convert-progress-title"><span>{{ statusText }}</span><span class="muted">{{ progress }}%</span></div>
        <el-progress :percentage="progress" />
      </div>
      <p class="document-ppt-note">当前提示词会同时用于 PPT 版面规划和图片生成，并在创建任务时保存。“精简要点”会调用版面规划模型提炼短句，保留数字、步骤和结论；“完整原文”可再选择保持原页数或更疏朗的分页。扫描版 PDF 请先 OCR。</p>
    </div>
  </el-dialog>
</template>

<script setup>
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { createDocumentPptTasks } from "../api/presentation";
import { useTaskStore } from "../stores/useTaskStore";

const props = defineProps({ modelValue: Boolean });
const emit = defineEmits(["update:modelValue"]);
const taskStore = useTaskStore();
const visible = computed({ get: () => props.modelValue, set: (value) => emit("update:modelValue", value) });
const uploadRef = ref(null);
const file = ref(null);
const processing = ref(false);
const progress = ref(0);
const statusText = ref("等待上传文档");
const settings = ref({ pptName: "", textMode: "concise", pageDensity: "balanced" });
const activeTemplateName = computed(() => taskStore.generationForm.promptTemplate || "自定义提示词");

function fileExt(raw) { return String(raw?.name || "").split(".").pop()?.toLowerCase() || ""; }
function baseName(name = "文档演示") { return String(name).replace(/\.[^.]+$/, "") || "文档演示"; }

function onFileChange(uploadFile) {
  const raw = uploadFile?.raw;
  if (!raw) return;
  if (!["pdf", "docx", "txt", "md"].includes(fileExt(raw))) {
    clearFile();
    ElMessage.warning("请上传 PDF / DOCX / TXT / Markdown 文档");
    return;
  }
  file.value = raw;
  settings.value.pptName = baseName(raw.name);
  progress.value = 0;
  statusText.value = "文档已就绪，等待加入任务列表";
}

function clearFile() {
  file.value = null;
  progress.value = 0;
  statusText.value = "等待上传文档";
  uploadRef.value?.clearFiles?.();
}

async function createTasks() {
  if (!file.value || processing.value) return;
  processing.value = true;
  progress.value = 10;
  statusText.value = "正在读取文档并拆分页面";
  try {
    const response = await createDocumentPptTasks(file.value, {
      pptName: settings.value.pptName.trim() || baseName(file.value.name),
      stylePrompt: taskStore.generationForm.prompt || "",
      promptTemplate: taskStore.generationForm.promptTemplate || "",
      textMode: settings.value.textMode,
      pageDensity: settings.value.pageDensity,
      onUploadProgress(event) {
        if (!event.total) return;
        progress.value = Math.min(75, 10 + Math.round((event.loaded / event.total) * 65));
        statusText.value = event.loaded >= event.total ? "文档已上传，正在拆分页面" : "正在上传文档";
      }
    });
    const data = response.data || {};
    taskStore.setTasks(data.batch, data.tasks || []);
    if (data.tasks?.[0]?.id) taskStore.setCurrentTask(data.tasks[0].id);
    progress.value = 100;
    const count = data.pageCount || data.tasks?.length || 0;
    ElMessage.success(`已生成 ${count} 页${settings.value.textMode === "concise" ? "精简要点" : "原文"}插画 PPT`);
    visible.value = false;
  } catch (error) {
    progress.value = 100;
    statusText.value = "拆分失败";
    ElMessage.warning(error.response?.data?.message || error.message || "文档拆分失败");
  } finally {
    processing.value = false;
  }
}

function reset() {
  if (processing.value) return;
  clearFile();
  settings.value = { pptName: "", textMode: "concise", pageDensity: "balanced" };
}
</script>

<style scoped>
.document-ppt-body { display: grid; gap: 18px; }
.document-ppt-head { padding: 16px 18px; border: 1px solid var(--border-pink); border-radius: 14px; background: linear-gradient(135deg, #eef9fb, #f1faf6); }
.document-ppt-head b, .document-ppt-head span, .document-ppt-flow span { display: block; }
.document-ppt-head b { color: var(--deep-pink); font-size: 16px; }
.document-ppt-head span, .document-ppt-note, .document-ppt-flow span { color: var(--text-muted); font-size: 13px; line-height: 1.7; }
.document-ppt-file, .document-ppt-actions, .document-ppt-number-field { display: flex; align-items: center; gap: 12px; }
.document-ppt-file { justify-content: space-between; padding: 10px 14px; border-radius: 10px; background: #eff9f6; color: var(--text-main); }
.document-ppt-settings { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.document-ppt-settings.single { grid-template-columns: 1fr; }
.document-ppt-number-field { align-items: flex-start; flex-direction: column; gap: 6px; }
.document-ppt-flow { display: grid; gap: 5px; padding: 14px 16px; border-radius: 12px; background: #f1faf7; color: #397c78; }
.document-ppt-progress { padding: 12px 14px; border: 1px solid #d7ebe8; border-radius: 12px; }
.document-ppt-note { margin: 0; }
.document-ppt-style-source { display: grid; gap: 4px; padding: 12px 14px; border: 1px solid #d7ebe8; border-radius: 10px; background: #f2faf8; }
.document-ppt-style-source span, .document-ppt-style-source small { color: var(--text-muted); }
.document-ppt-style-source b { color: var(--deep-pink); }
@media (max-width: 720px) { .document-ppt-settings { grid-template-columns: 1fr; } }
</style>
