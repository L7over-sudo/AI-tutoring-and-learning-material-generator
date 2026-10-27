<template>
  <section class="panel preview-panel">
    <div class="panel-title preview-title">
      <span>🔍 预览检查</span>
      <span class="muted">{{ taskStore.tasks.length ? `${taskStore.currentIndex + 1}/${taskStore.tasks.length}` : "0/0" }}</span>
    </div>
    <div v-if="task" class="preview-body">
      <div class="preview-toolbar">
        <el-button class="pink-outline" @click="taskStore.prev">上一张</el-button>
        <StatusTag :status="task.status" />
        <el-button class="pink-outline" :loading="regenerating" :disabled="!canRegenerate" @click.stop="regenerateCurrent">重新生成</el-button>
        <el-button class="pink-outline" @click="taskStore.next">下一张</el-button>
      </div>
      <div class="compare-grid" :class="{ 'is-presentation-preview': isPresentation }">
        <figure @click="open(task.originalUrl)">
          <figcaption>{{ task.storyboard ? "分镜内容" : taskStore.batch?.sourceType === "presentation" ? "本页内容规划" : task.sourceType === "text" ? "文字/文档内容" : "原图" }}</figcaption>
          <img v-if="task.originalUrl" :src="task.originalUrl" alt="原图预览" />
          <div v-else class="source-text-preview">
            <template v-if="task.storyboard">
              <div class="storyboard-preview-copy"><b>文案原句</b><p>{{ task.storyboardText }}</p></div>
              <div class="storyboard-preview-copy"><b>画面提示词</b><p>{{ task.sourceText }}</p></div>
            </template>
            <template v-else-if="isPresentation && task.presentationContent">
              <b>{{ task.presentationContent.title }}</b>
              <p>{{ task.presentationContent.body }}</p>
            </template>
            <template v-else>
              {{ task.sourceText }}
            </template>
          </div>
        </figure>
        <figure @click="open(previewUrl)">
          <figcaption>{{ isPresentation ? task.slidePlan?.version === 3 ? "PPT 完整预览（含可编辑文字）" : "旧版 PPT 背景预览" : "生成图" }}</figcaption>
          <img v-if="previewUrl && !previewFailed" :src="previewUrl" alt="生成图预览" @error="previewFailed = true" />
          <div v-else-if="previewFailed" class="preview-empty">完整预览加载失败，请检查后端服务后重试。<el-button link @click.stop="retryPreview">重试预览</el-button></div>
          <div v-else class="preview-empty">等待生成 ✨</div>
        </figure>
      </div>
      <section v-if="canFollowUp" class="follow-up-box">
        <el-input
          v-model="followUpPrompt"
          type="textarea"
          :rows="3"
          resize="none"
          placeholder="继续追问：例如“背景换成浅蓝色，主体不变，整体更高级”"
        />
        <div class="follow-up-actions">
          <span class="muted">基于当前生成图继续修改，未提到的部分尽量保持不变</span>
          <el-button
            class="pink-button"
            :loading="followUpSubmitting"
            :disabled="!followUpPrompt.trim()"
            @click.stop="submitFollowUp"
          >
            继续修改
          </el-button>
        </div>
        <div v-if="followUpStatus" class="follow-up-status">{{ followUpStatus }}</div>
      </section>
      <el-alert v-if="task.error" type="error" :title="task.error" show-icon :closable="false" />
    </div>
    <div v-else class="blank-state">先导入图片，预览区会在这里亮起来 🌸</div>
  </section>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { useTaskStore } from "../stores/useTaskStore";
import StatusTag from "./StatusTag.vue";
import { taskPreviewUrl } from "../utils/taskPreview";

const taskStore = useTaskStore();
const task = computed(() => taskStore.currentTask);
const isPresentation = computed(() => Boolean(task.value?.presentation));
const previewRevision = ref(0);
const previewUrl = computed(() => {
  const url = taskPreviewUrl(task.value);
  return url && previewRevision.value ? `${url}${url.includes("?") ? "&" : "?"}refresh=${previewRevision.value}` : url;
});
const previewFailed = ref(false);
watch(previewUrl, () => { previewFailed.value = false; });
function retryPreview() { previewRevision.value = Date.now(); }
const followUpPrompt = ref("");
const followUpSubmitting = ref(false);
const regenerating = ref(false);
const followUpStatus = ref("");
const hasGeneratedImage = computed(() => Boolean(task.value?.enhancedUrl || task.value?.generatedUrl));
const canRegenerate = computed(() => task.value?.status === "已完成" && hasGeneratedImage.value);
const canFollowUp = computed(() =>
  task.value?.sourceType === "text-reference" &&
  hasGeneratedImage.value
);

function open(url) {
  if (url) window.open(url, "_blank");
}


async function regenerateCurrent() {
  if (!task.value || regenerating.value) return;
  regenerating.value = true;
  try {
    await taskStore.regenerate(task.value);
  } finally {
    regenerating.value = false;
  }
}
async function submitFollowUp() {
  if (followUpSubmitting.value) return;
  followUpStatus.value = "";
  followUpSubmitting.value = true;
  try {
    followUpStatus.value = "正在创建继续修改任务...";
    const ok = await taskStore.followUpCurrentTask(followUpPrompt.value);
    if (ok) {
      followUpPrompt.value = "";
      followUpStatus.value = "继续修改任务已提交，正在生成新图";
    } else {
      followUpStatus.value = "继续修改没有提交成功，请看右上角提示或稍后重试";
    }
  } finally {
    followUpSubmitting.value = false;
  }
}
</script>
