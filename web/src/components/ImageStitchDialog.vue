<template>
  <el-dialog :model-value="modelValue" title="🧩 图片拼接" width="920px" class="source-dialog image-stitch-dialog"
    @update:model-value="emit('update:modelValue', $event)" @closed="resetResult">
    <div class="stitch-head">
      <div><b>多张图片拼成一张长图</b><span>默认按文件名顺序纵向等宽拼接，可调整顺序、方向、间距和背景色。</span></div>
      <div class="stitch-head-actions">
        <el-button class="pink-outline" @click="fileInput?.click()">选择图片</el-button>
        <el-button class="pink-outline" @click="folderInput?.click()">选择文件夹</el-button>
        <input ref="fileInput" type="file" multiple hidden accept=".jpg,.jpeg,.png,.webp" @change="onFilesPicked" />
        <input ref="folderInput" type="file" webkitdirectory multiple hidden accept=".jpg,.jpeg,.png,.webp" @change="onFilesPicked" />
      </div>
    </div>

    <el-upload class="upload-box stitch-upload" drag multiple accept=".jpg,.jpeg,.png,.webp" :auto-upload="false"
      :show-file-list="false" :on-change="onUploadChange">
      <div class="upload-emoji">🧩</div>
      <div class="upload-text">拖入多张图片，或点击选择</div>
      <div class="upload-hint">支持 JPG / PNG / WebP，最多 200 张</div>
    </el-upload>

    <div v-if="items.length" class="stitch-settings">
      <el-form-item label="拼接方向">
        <el-radio-group v-model="settings.direction">
          <el-radio-button value="vertical">纵向长图</el-radio-button>
          <el-radio-button value="horizontal">横向长图</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="画布比例">
        <el-select v-model="settings.ratio">
          <el-option label="自适应" value="auto" />
          <el-option label="3:4" value="3:4" />
        </el-select>
      </el-form-item>
      <el-form-item label="尺寸统一"><el-switch v-model="settings.normalizeSize" /><span class="setting-tip">{{ settings.direction === 'vertical' ? '统一宽度' : '统一高度' }}</span></el-form-item>
      <el-form-item label="对齐">
        <el-select v-model="settings.align">
          <el-option :label="settings.direction === 'vertical' ? '左对齐' : '顶部对齐'" value="start" />
          <el-option label="居中对齐" value="center" />
          <el-option :label="settings.direction === 'vertical' ? '右对齐' : '底部对齐'" value="end" />
        </el-select>
      </el-form-item>
      <el-form-item label="图片间距"><el-input-number v-model="settings.gap" :min="0" :max="200" :disabled="settings.ratio === '3:4'" /></el-form-item>
      <el-form-item label="外边距"><el-input-number v-model="settings.padding" :min="0" :max="200" :disabled="settings.ratio === '3:4'" /></el-form-item>
      <el-form-item label="背景色"><el-color-picker v-model="settings.background" /></el-form-item>
      <el-form-item label="导出格式">
        <el-select v-model="settings.imageFormat">
          <el-option label="PNG" value="png" /><el-option label="JPG" value="jpeg" /><el-option label="WebP" value="webp" />
        </el-select>
      </el-form-item>
      <el-form-item label="文件名"><el-input v-model="settings.fileName" clearable /></el-form-item>
      <div v-if="settings.ratio === '3:4'" class="stitch-ratio-tip">3:4 模式固定间距和外边距为 0，每张图片逐张居中铺满拼接区，不留空白；图片边缘可能被适度裁切。</div>
    </div>

    <div v-if="items.length" class="stitch-list-head">
      <span>已选择 {{ items.length }} 张，按下列顺序拼接</span>
      <div><el-button link @click="sortByName">按文件名排序</el-button><el-button link type="danger" @click="clearItems">清空</el-button></div>
    </div>
    <div v-if="items.length" class="stitch-list">
      <div v-for="(item, index) in items" :key="item.id" class="stitch-item">
        <span class="stitch-index">{{ index + 1 }}</span><img :src="item.url" :alt="item.file.name" />
        <span class="stitch-name" :title="item.file.name">{{ item.file.name }}</span>
        <div><el-button link :disabled="index === 0" @click="move(index, -1)">上移</el-button><el-button link :disabled="index === items.length - 1" @click="move(index, 1)">下移</el-button><el-button link type="danger" @click="remove(index)">删除</el-button></div>
      </div>
    </div>

    <div v-if="result.imageUrl" class="stitch-result">
      <div><b>拼接完成</b><span>{{ result.width }} × {{ result.height }}，{{ formatBytes(result.size) }}</span></div>
      <img :src="result.imageUrl" alt="拼接结果预览" />
    </div>

    <template #footer>
      <div class="stitch-footer">
        <span class="muted">导出文件自动压缩到 5MB 以内；超大长图会等比缩小。</span>
        <div><el-button class="soft-button" @click="emit('update:modelValue', false)">关闭</el-button><el-button class="pink-button" :loading="processing" :disabled="items.length < 2" @click="generate">生成并下载</el-button></div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { reactive, ref, onUnmounted, watch } from "vue";
import { ElMessage } from "element-plus";
import { stitchImages } from "../api/convert";

defineProps({ modelValue: Boolean });
const emit = defineEmits(["update:modelValue"]);
const fileInput = ref(null);
const folderInput = ref(null);
const items = ref([]);
const processing = ref(false);
const result = reactive({ imageUrl: "", downloadUrl: "", width: 0, height: 0, size: 0 });
const settings = reactive({ direction: "vertical", ratio: "auto", normalizeSize: true, align: "center", gap: 0, padding: 0, background: "#ffffff", imageFormat: "png", quality: 92, fileName: "图片拼接" });
const settingsKey = "aiTeachingImageStitchSettingsV1";
const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

try {
  Object.assign(settings, JSON.parse(localStorage.getItem(settingsKey) || "{}"));
} catch {
  localStorage.removeItem(settingsKey);
}

watch(settings, (value) => {
  if (value.ratio === "3:4") {
    value.gap = 0;
    value.padding = 0;
  }
  localStorage.setItem(settingsKey, JSON.stringify(value));
}, { deep: true });

function isImage(file) { return /\.(jpe?g|png|webp)$/i.test(file?.name || ""); }
function addFiles(files) {
  const accepted = [...files].filter(isImage).slice(0, Math.max(0, 200 - items.value.length));
  if (!accepted.length) return ElMessage.warning("没有找到可拼接的图片");
  items.value.push(...accepted.map((file) => ({ id: `${Date.now()}-${Math.random()}`, file, url: URL.createObjectURL(file) })));
  items.value.sort((a, b) => collator.compare(a.file.webkitRelativePath || a.file.name, b.file.webkitRelativePath || b.file.name));
  resetResult();
  if (items.value.length >= 200) ElMessage.warning("一次最多拼接 200 张图片");
}
function onFilesPicked(event) { addFiles(event.target.files || []); event.target.value = ""; }
function onUploadChange(uploadFile) { if (uploadFile?.raw) addFiles([uploadFile.raw]); }
function revoke(item) { if (item?.url) URL.revokeObjectURL(item.url); }
function clearItems() { items.value.forEach(revoke); items.value = []; resetResult(); }
function remove(index) { revoke(items.value[index]); items.value.splice(index, 1); resetResult(); }
function move(index, delta) { const target = index + delta; if (target < 0 || target >= items.value.length) return; const [item] = items.value.splice(index, 1); items.value.splice(target, 0, item); resetResult(); }
function sortByName() { items.value.sort((a, b) => collator.compare(a.file.webkitRelativePath || a.file.name, b.file.webkitRelativePath || b.file.name)); resetResult(); }
function resetResult() { Object.assign(result, { imageUrl: "", downloadUrl: "", width: 0, height: 0, size: 0 }); }
function formatBytes(value) { const size = Number(value) || 0; return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(2)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`; }
async function generate() {
  if (items.value.length < 2) return ElMessage.warning("请至少选择 2 张图片");
  processing.value = true;
  resetResult();
  try {
    const response = await stitchImages(items.value.map((item) => item.file), { ...settings, preserveOrder: true });
    Object.assign(result, response.data || {});
    ElMessage.success(`已拼接 ${response.data.imageCount || items.value.length} 张图片`);
    window.location.href = response.data.downloadUrl;
  } catch (error) {
    ElMessage.warning(error.response?.data?.message || error.message || "图片拼接失败");
  } finally { processing.value = false; }
}
onUnmounted(() => items.value.forEach(revoke));
</script>

<style scoped>
.stitch-head,.stitch-list-head,.stitch-footer,.stitch-result>div{display:flex;align-items:center;justify-content:space-between;gap:16px}.stitch-head>div:first-child,.stitch-result>div:first-child{display:flex;flex-direction:column;gap:5px}.stitch-head span,.stitch-result span,.setting-tip{color:var(--text-muted);font-size:13px}.stitch-head-actions{display:flex;gap:8px}.stitch-upload{margin:16px 0}.stitch-settings{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px 14px;padding:14px;background:#f1faf7;border:1px solid var(--border-pink);border-radius:12px}.stitch-settings :deep(.el-form-item){margin:0}.setting-tip{margin-left:8px}.stitch-ratio-tip{grid-column:1/-1;color:var(--text-muted);font-size:13px}.stitch-list-head{margin:16px 0 8px}.stitch-list{max-height:280px;overflow:auto;border:1px solid #d8ebe8;border-radius:12px}.stitch-item{display:grid;grid-template-columns:38px 58px minmax(0,1fr) auto;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid #e8f2ef}.stitch-item:last-child{border-bottom:0}.stitch-index{color:var(--deep-pink);font-weight:700}.stitch-item img{width:56px;height:42px;object-fit:cover;border-radius:6px;background:#f5f5f5}.stitch-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.stitch-result{margin-top:16px;padding:14px;border:1px solid #bdebd1;background:#f2fff7;border-radius:12px}.stitch-result img{display:block;max-width:100%;max-height:360px;margin:12px auto 0;object-fit:contain;background:#eee}.stitch-footer>div{display:flex;gap:8px}@media(max-width:760px){.stitch-settings{grid-template-columns:repeat(2,minmax(0,1fr))}.stitch-head{align-items:flex-start;flex-direction:column}.stitch-item{grid-template-columns:30px 48px minmax(0,1fr)}.stitch-item>div{grid-column:3}}
</style>
