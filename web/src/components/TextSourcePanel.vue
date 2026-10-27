<template>
  <section class="panel text-source-panel">
    <div class="panel-title">
      <span>📝 文字 / 文档生图</span>
      <el-tag effect="light">适合课件、讲义、笔记</el-tag>
    </div>
    <div class="text-source-body">
      <div class="form-grid">
        <el-form-item label="作品标题">
          <el-input v-model="form.title" placeholder="例如：三上语文复习卡片" />
        </el-form-item>
        <el-form-item label="生成张数">
          <el-input-number v-model="form.count" :min="1" :max="20" />
        </el-form-item>
      </div>
      <el-form-item label="文字内容">
        <el-input
          v-model="form.sourceText"
          type="textarea"
          :rows="7"
          resize="none"
          placeholder="粘贴教辅内容、知识点、题目、讲义文字；也可以上传 txt / md / docx / pdf 自动提取文字。"
        />
      </el-form-item>
      <div class="text-source-actions">
        <el-upload
          accept=".txt,.md,.docx,.pdf"
          :auto-upload="false"
          :show-file-list="false"
          :on-change="onDocumentPick"
        >
          <el-button class="pink-outline" :loading="extracting">📄 上传文档</el-button>
        </el-upload>
        <span v-if="form.documentName" class="muted">已读取：{{ form.documentName }}</span>
        <el-button class="pink-button" :loading="taskStore.generating" @click="taskStore.generateFromText">
          ✨ 文字/文档生图
        </el-button>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref } from "vue";
import { storeToRefs } from "pinia";
import { ElMessage } from "element-plus";
import { useTaskStore } from "../stores/useTaskStore";

const taskStore = useTaskStore();
const { textImageForm: form } = storeToRefs(taskStore);
const extracting = ref(false);

async function onDocumentPick(file) {
  extracting.value = true;
  try {
    await taskStore.extractDocument(file.raw);
  } catch (error) {
    ElMessage.warning(error.response?.data?.message || "文档提取失败");
  } finally {
    extracting.value = false;
  }
}
</script>
