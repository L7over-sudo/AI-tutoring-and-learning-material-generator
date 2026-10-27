<template>
  <el-tag :class="['status-tag', statusClass]" effect="light" round>{{ status }}</el-tag>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({ status: { type: String, default: "待生成" } });
const statusClass = computed(() => ({
  "is-pending": props.status === "待生成",
  "is-running": props.status === "生成中",
  "is-success": props.status === "已完成",
  "is-error": props.status === "失败",
  "is-muted": ["已取消", "已跳过"].includes(props.status)
}));
</script>
