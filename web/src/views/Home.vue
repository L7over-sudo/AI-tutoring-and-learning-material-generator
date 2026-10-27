<template>
  <main class="app-shell">
    <TopHeader @open-config="configVisible = true" />
    <SourceInputTabs />
    <section class="workspace-grid" :class="{ 'is-quick-workspace': isTextReferenceBatch }">
      <ImageTaskTable />
      <PromptPanel v-if="!isTextReferenceBatch" />
      <PreviewPanel />
    </section>
    <LogPanel />
    <ControlBar />
    <ConfigDialog v-model="configVisible" />
  </main>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import TopHeader from "../components/TopHeader.vue";
import SourceInputTabs from "../components/SourceInputTabs.vue";
import ImageTaskTable from "../components/ImageTaskTable.vue";
import PromptPanel from "../components/PromptPanel.vue";
import PreviewPanel from "../components/PreviewPanel.vue";
import ControlBar from "../components/ControlBar.vue";
import ConfigDialog from "../components/ConfigDialog.vue";
import LogPanel from "../components/LogPanel.vue";
import { useConfigStore } from "../stores/useConfigStore";
import { useLogStore } from "../stores/useLogStore";
import { useTaskStore } from "../stores/useTaskStore";

const configVisible = ref(false);
const configStore = useConfigStore();
const logStore = useLogStore();
const taskStore = useTaskStore();
const isTextReferenceBatch = computed(() => taskStore.batch?.sourceType === "text-reference");
let logTimer;

onMounted(async () => {
  taskStore.enableOperationPersistence();
  await Promise.all([configStore.load(), logStore.clear()]);
  taskStore.applyConfig(configStore.config);
  await taskStore.loadLatest();
  logTimer = window.setInterval(() => logStore.load(), 3000);
});

onUnmounted(() => {
  if (logTimer) window.clearInterval(logTimer);
  taskStore.stopPolling();
});
</script>
