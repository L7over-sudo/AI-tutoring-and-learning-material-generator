<template>
  <section class="panel task-panel">
    <div class="panel-title compact">
      <span>🖼️ 任务列表</span>
      <el-select v-model="taskStore.filters" multiple collapse-tags size="small" class="filter-select">
        <el-option v-for="status in statuses" :key="status" :label="status" :value="status" />
      </el-select>
    </div>
    <el-table
      :data="taskStore.visibleTasks"
      :row-class-name="taskRowClassName"
      height="100%"
      stripe
      @row-click="selectRow"
    >
      <el-table-column width="44">
        <template #header>
          <el-checkbox
            :model-value="allVisibleSelected"
            :indeterminate="partVisibleSelected"
            :disabled="!visibleTasks.length"
            @click.stop
            @change="toggleVisibleSelection"
          />
        </template>
        <template #default="{ row }"><el-checkbox v-model="row.selected" @click.stop @change="selectRow(row)" /></template>
      </el-table-column>
      <el-table-column prop="index" label="#" width="52" />
      <el-table-column label="原图" width="74">
        <template #default="{ row }">
          <img v-if="row.originalUrl" class="thumb" :src="row.originalUrl" alt="原图" />
          <span v-else class="empty-thumb">文</span>
        </template>
      </el-table-column>
      <el-table-column label="生成图" width="84">
        <template #default="{ row }"><img v-if="row.enhancedUrl || row.generatedUrl" class="thumb" :src="taskPreviewUrl(row)" alt="生成图" loading="lazy" /><span v-else class="empty-thumb">待</span></template>
      </el-table-column>
      <el-table-column prop="originalName" label="文件名" min-width="150" show-overflow-tooltip />
      <el-table-column prop="error" label="错误原因" min-width="150" show-overflow-tooltip />
      <el-table-column label="状态" width="78" align="center" fixed="right">
        <template #default="{ row }"><div class="status-cell"><StatusTag :status="row.status" /></div></template>
      </el-table-column>
      <el-table-column label="操作" width="232" align="center" header-align="center" fixed="right">
        <template #default="{ row }">
          <div class="task-actions">
            <el-button link type="primary" @click.stop="preview(row)">预览</el-button>
            <el-button link type="warning" :disabled="row.status !== '失败'" @click.stop="retryOne(row)">重试</el-button>
            <el-button link type="success" :disabled="row.status !== '已完成' || !(row.enhancedUrl || row.generatedUrl)" @click.stop="regenerateOne(row)">重新生成</el-button>
            <el-button link type="danger" @click.stop="taskStore.remove(row)">删除</el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>
  </section>
</template>

<script setup>
import { computed } from "vue";
import { useTaskStore } from "../stores/useTaskStore";
import StatusTag from "./StatusTag.vue";
import { taskPreviewUrl } from "../utils/taskPreview";

const taskStore = useTaskStore();
const statuses = ["待生成", "生成中", "已完成", "失败", "已取消", "已跳过"];
const visibleTasks = computed(() => taskStore.visibleTasks);
const selectedVisibleCount = computed(() => visibleTasks.value.filter((task) => task.selected).length);
const allVisibleSelected = computed(() => visibleTasks.value.length > 0 && selectedVisibleCount.value === visibleTasks.value.length);
const partVisibleSelected = computed(() => selectedVisibleCount.value > 0 && !allVisibleSelected.value);

function toggleVisibleSelection(selected) {
  visibleTasks.value.forEach((task) => {
    task.selected = selected;
  });
  if (selected && visibleTasks.value[0]) taskStore.setCurrentTask(visibleTasks.value[0].id);
}

function selectRow(row) {
  taskStore.setCurrentTask(row.id);
}

function taskRowClassName({ row }) {
  return row.id === taskStore.currentTask?.id ? "is-current-task" : "";
}

function preview(row) {
  selectRow(row);
}

async function regenerateOne(row) {
  await taskStore.regenerate(row);
}

async function retryOne(row) {
  row.selected = true;
  await taskStore.retryFailed();
}
</script>

<style scoped>
.task-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  white-space: nowrap;
}

.task-actions :deep(.el-button) {
  margin-left: 0;
  padding: 0;
}
.task-panel :deep(.el-table__body tr.is-current-task > td.el-table__cell) {
  background: #eaf7f9 !important;
}

.task-panel :deep(.el-table__body tr.is-current-task > td.el-table__cell:first-child) {
  box-shadow: inset 4px 0 0 var(--deep-pink);
}

.task-panel :deep(.el-table__body tr.is-current-task:hover > td.el-table__cell) {
  background: #dff3ee !important;
}

</style>
