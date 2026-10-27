<template>
  <section class="panel upload-panel">
    <div class="panel-title">
      <span>📁 导入图片</span>
      <el-input v-model="folderName" placeholder="文件夹名称，例如：三年级数学练习" clearable />
    </div>
    <el-upload
      class="upload-box"
      drag
      multiple
      accept=".jpg,.jpeg,.png,.webp"
      :auto-upload="false"
      :show-file-list="false"
      :on-change="onPick"
    >
      <div class="upload-emoji">🌸</div>
      <div class="upload-text">拖拽图片到这里，或点击选择多张图片</div>
      <div class="upload-hint">支持 jpg / jpeg / png / webp，单张最大 20MB</div>
    </el-upload>
    <div class="upload-actions">
      <el-button class="pink-button" :loading="taskStore.uploading" @click="submitPicked">📁 上传选中图片</el-button>
      <el-button class="pink-outline" @click="folderInput?.click()">🗂️ 文件夹上传</el-button>
      <input ref="folderInput" type="file" webkitdirectory multiple hidden @change="onFolderChange" />
    </div>
  </section>
</template>

<script setup>
import { ref } from "vue";
import { ElMessage } from "element-plus";
import { useTaskStore } from "../stores/useTaskStore";

const taskStore = useTaskStore();
const folderName = ref("");
const picked = ref([]);
const folderInput = ref(null);

function onPick(file, fileList) {
  picked.value = fileList.map((item) => item.raw).filter(Boolean);
}

function submitPicked() {
  if (!picked.value.length) return ElMessage.warning("请先选择图片");
  return taskStore.upload(picked.value, folderName.value);
}

function onFolderChange(event) {
  const files = [...event.target.files];
  const firstPath = files[0]?.webkitRelativePath || "";
  const folder = firstPath.split("/")[0] || folderName.value;
  folderName.value = folder;
  taskStore.upload(files, folder);
  event.target.value = "";
}
</script>
