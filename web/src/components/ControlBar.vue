<template>
  <footer class="control-bar">
    <div class="control-buttons">
      <el-button class="pink-button" :loading="taskStore.isActivelyGenerating" @click="taskStore.generate">
        {{ generationLabel }}
      </el-button>
      <el-button class="pink-outline" :disabled="!taskStore.isActivelyGenerating" @click="taskStore.appendGenerate">➕ 追加生成</el-button>
      <el-button class="pink-outline" :disabled="!taskStore.isActivelyGenerating" @click="taskStore.cancel">⏹️ 停止生成</el-button>
      <el-button class="pink-outline" @click="taskStore.retryFailed">🔁 重试失败项</el-button>
      <template v-if="isPresentation">
        <el-button class="pink-button" :loading="taskStore.exporting" @click="taskStore.exportPpt">📊 导出 PPT</el-button>
      </template>
      <el-button v-else class="pink-button" :loading="taskStore.exporting" @click="taskStore.exportCurrent">📦 AI教辅导出</el-button>
      <el-button class="xhs-publish-button" :disabled="!completedSelectedCount" @click="publishVisible = true">📕 发布小红书</el-button>
      <el-button class="xhs-product-button" :disabled="!completedSelectedCount" @click="productVisible = true">📦 上架商品</el-button>
      <el-button class="soft-button" @click="taskStore.clearHistory">🧹 清空任务</el-button>
      <el-button class="soft-button" @click="reloadPage">🔄 刷新</el-button>
    </div>
    <div class="progress-wrap">
      <el-progress :percentage="taskStore.progress" :stroke-width="12" color="#5cb5ce" />
      <span>总数 {{ taskStore.summary.total }} / 成功 {{ taskStore.summary.success }} / 失败 {{ taskStore.summary.failed }}</span>
    </div>
    <div v-if="taskStore.pptDownloadUrl" class="ppt-download-fallback">
      ⬇️ 若未自动下载，<a :href="taskStore.pptDownloadUrl" download>点此手动下载 PPT</a>
    </div>
    <XhsPublishDialog v-model="publishVisible" />
    <XhsProductDialog v-model="productVisible" />
  </footer>
</template>

<script setup>
import { computed, ref } from "vue";
import { useTaskStore } from "../stores/useTaskStore";
import XhsPublishDialog from "./XhsPublishDialog.vue";
import XhsProductDialog from "./XhsProductDialog.vue";

const taskStore = useTaskStore();
const publishVisible = ref(false);
const productVisible = ref(false);
const isPresentation = computed(() => taskStore.batch?.sourceType === "presentation");
const completedSelectedCount = computed(() => taskStore.tasks.filter((task) => task.selected && task.status === "已完成" && (task.enhancedUrl || task.generatedUrl)).length);
const generationLabel = computed(() => {
  if (taskStore.batch?.sourceType === "text-reference") return "🎨 继续生成";
  if (taskStore.batch?.sourceType === "storyboard") return "🎬 AI 分镜绘制";
  if (taskStore.batch?.sourceType === "presentation") return "📊 生成 PPT 页面";
  return "🎨 AI 教辅绘制";
});
function reloadPage() {
  window.location.reload();
}
</script>

<style scoped>
.ppt-download-fallback {
  margin-top: 6px;
  font-size: 13px;
  color: var(--deep-pink);
  text-align: center;
}
.ppt-download-fallback a {
  color: var(--deep-pink);
  font-weight: 600;
  text-decoration: underline;
}
.xhs-publish-button {
  color: #fff;
  border-color: #e65a56;
  background: linear-gradient(135deg, #ff746f, #e54d4a);
}
.xhs-publish-button:hover,
.xhs-publish-button:focus {
  color: #fff;
  border-color: #d84441;
  background: linear-gradient(135deg, #f06661, #d84441);
}
.xhs-product-button {
  color: #fff;
  border-color: #36a678;
  background: linear-gradient(135deg, #54bd91, #2d9d70);
}
.xhs-product-button:hover,
.xhs-product-button:focus {
  color: #fff;
  border-color: #288d65;
  background: linear-gradient(135deg, #45ae82, #288d65);
}
</style>
