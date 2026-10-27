<template>
  <section class="panel log-panel">
    <div class="panel-title compact">
      <span>📝 运行日志</span>
      <div>
        <el-button link @click="copy">📋 复制日志</el-button>
        <el-button link @click="logStore.clear">清空</el-button>
        <el-button link @click="logStore.load">刷新</el-button>
        <el-button link @click="download">下载</el-button>
      </div>
    </div>
    <div v-if="logStore.logs.length" class="log-list">
      <div v-for="log in logStore.logs" :key="log.id" :class="['log-line', log.level.toLowerCase()]">
        <span>{{ new Date(log.time).toLocaleTimeString() }}</span>
        <b>[{{ log.level }}]</b>
        <em>[{{ log.module }}]</em>
        <p>{{ log.message }}</p>
      </div>
    </div>
    <div v-else class="blank-log">日志会显示上传、生成、重试和导出进度 ✨</div>
  </section>
</template>

<script setup>
import { ElMessage } from "element-plus";
import { useLogStore } from "../stores/useLogStore";

const logStore = useLogStore();

function copy() {
  const text = logStore.logs.map((log) => `[${log.time}] [${log.level}] [${log.module}] ${log.message}`).join("\n");
  navigator.clipboard.writeText(text);
  ElMessage.success("📋 日志已复制");
}

function download() {
  window.location.href = "/api/logs/download";
}
</script>
