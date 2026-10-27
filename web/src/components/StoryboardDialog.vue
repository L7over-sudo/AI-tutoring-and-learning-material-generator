<template>
  <el-dialog :model-value="modelValue" title="🎬 文案分镜" width="1120px" class="source-dialog storyboard-dialog" @update:model-value="emit('update:modelValue', $event)">
    <section class="storyboard-panel">
      <div class="storyboard-intro">
        <div><b>一句文案，一个分镜画面</b><span>粘贴或上传文案，自动拆句后可逐条调整画面提示词，再批量加入图片生成任务。</span></div>
        <div class="storyboard-steps"><span>1 导入文案</span><i>→</i><span>2 编辑分镜</span><i>→</i><span>3 加入任务</span></div>
      </div>

      <div class="storyboard-source-grid">
        <div class="storyboard-source-card">
          <div class="storyboard-card-title">
            <div><b>文案内容</b><span>{{ sourceText.length }} 字</span></div>
            <el-upload ref="documentUpload" accept=".txt,.md,.docx,.pdf" :auto-upload="false" :show-file-list="false" :on-change="onDocumentPick">
              <el-button class="pink-outline" size="small" :loading="extracting">📄 上传文案</el-button>
            </el-upload>
          </div>
          <el-input v-model="sourceText" type="textarea" :rows="9" resize="none" placeholder="把需要拆解的文案粘贴到这里。默认智能拆分，会自动平衡分镜数量和每镜内容长度。" />
          <span v-if="documentName" class="storyboard-document-name">已读取：{{ documentName }}</span>
        </div>

        <div class="storyboard-config-card">
          <el-form-item label="任务名称"><el-input v-model="title" maxlength="80" show-word-limit placeholder="例如：暑假学习计划分镜" /></el-form-item>
          <el-form-item label="拆分粒度">
            <el-select v-model="splitMode">
              <el-option label="智能拆分（推荐）" value="smart" />
              <el-option label="精细拆分（更多）" value="fine" />
              <el-option label="按完整句拆分" value="sentence" />
            </el-select>
          </el-form-item>
          <div class="storyboard-rule">
            <b>{{ splitModeInfo.title }}</b>
            <span>{{ splitModeInfo.description }}</span>
          </div>
          <div class="storyboard-stats">
            <div><strong>{{ scenes.length }}</strong><span>全部分镜</span></div>
            <div><strong>{{ selectedScenes.length }}</strong><span>已选任务</span></div>
          </div>
          <el-button class="pink-button storyboard-split-button" :disabled="!sourceText.trim()" @click="splitSourceText">✨ {{ scenes.length ? "重新拆解文案" : "开始拆解文案" }}</el-button>
        </div>
      </div>

      <div v-if="scenes.length" class="storyboard-result">
        <div class="storyboard-result-toolbar">
          <div><el-checkbox v-model="allSelected">全选</el-checkbox><span>已选择 {{ selectedScenes.length }} / {{ scenes.length }} 个分镜</span></div>
          <el-button class="pink-outline" size="small" @click="addScene">＋ 末尾新增空白分镜</el-button>
        </div>
        <div
          ref="sceneList"
          class="storyboard-scene-list"
          :class="{ 'is-drag-active': draggingSceneId }"
          @dragover.prevent="onSceneListDragOver"
          @drop.prevent="dropSceneAtEnd"
        >
          <article
            v-for="(scene, index) in scenes"
            :key="scene.id"
            class="storyboard-scene-card"
            :class="{
              'is-selected': scene.selected,
              'is-dragging': draggingSceneId === scene.id,
              'drag-before': dragOverSceneId === scene.id && dragPosition === 'before',
              'drag-after': dragOverSceneId === scene.id && dragPosition === 'after'
            }"
            @dragover.prevent="onSceneDragOver($event, index)"
            @drop.stop.prevent="dropScene(index)"
          >
            <div class="storyboard-scene-index"><el-checkbox v-model="scene.selected" :aria-label="`选择分镜 ${index + 1}`" /><span>{{ String(index + 1).padStart(2, "0") }}</span></div>
            <div class="storyboard-scene-fields">
              <label><span>文案原句</span><el-input v-model="scene.narration" type="textarea" :rows="2" resize="none" placeholder="输入这一镜对应的文案" /></label>
              <label><span>单镜提示词（可选）</span><el-input v-model="scene.prompt" type="textarea" :rows="3" resize="none" placeholder="可留空；需要单独指定这一镜时再填写" /></label>
            </div>
            <div class="storyboard-scene-actions">
              <button type="button" class="storyboard-drag-handle" draggable="true" @dragstart.stop="startSceneDrag($event, scene)" @dragend="endSceneDrag">⠿ 拖动</button>
              <el-button text @click="insertScene(index, 'before')">上方＋</el-button>
              <el-button text @click="insertScene(index, 'after')">下方＋</el-button>
              <el-button text type="danger" @click="removeScene(index)">删除</el-button>
            </div>
          </article>
          <div
            v-if="draggingSceneId"
            class="storyboard-drop-end"
            @dragover.prevent
            @drop.stop.prevent="dropSceneAtEnd"
          >
            ↓ 放到这里，移动到最后
          </div>
        </div>
      </div>

      <div v-else class="storyboard-empty"><div>🎞️</div><b>等待拆解文案</b><span>拆解后，每句话都会在这里成为一个可编辑的分镜。</span></div>
      <div class="storyboard-footer">
        <div><el-button class="soft-button" :disabled="!sourceText && !scenes.length" @click="clearAll">清空</el-button><span>单镜提示词可留空；加入任务后可在主页面填写全部分镜共用的统一提示词。</span></div>
        <div>
          <el-button class="pink-outline" :loading="creating" :disabled="!canSubmit" @click="submit(false)">仅加入任务</el-button>
          <el-button class="pink-button" :loading="creating" :disabled="!canSubmit" @click="submit(true)">🎨 加入任务并生成</el-button>
        </div>
      </div>
    </section>
  </el-dialog>
</template>

<script setup>
import { computed, onUnmounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { uploadDocument } from "../api/upload";
import { useTaskStore } from "../stores/useTaskStore";

defineProps({ modelValue: { type: Boolean, default: false } });
const emit = defineEmits(["update:modelValue"]);
const taskStore = useTaskStore();
const sourceText = ref("");
const documentName = ref("");
const title = ref("文案分镜");
const splitMode = ref("smart");
const scenes = ref([]);
const draggingSceneId = ref("");
const dragOverSceneId = ref("");
const dragPosition = ref("before");
const extracting = ref(false);
const creating = ref(false);
const documentUpload = ref(null);
const sceneList = ref(null);
let dragScrollFrame = 0;
let dragScrollSpeed = 0;

let sceneSeed = 0;
const storyboardSettingsKey = "aiTeachingStoryboardSettingsV1";

try {
  const saved = JSON.parse(localStorage.getItem(storyboardSettingsKey) || "{}");
  if (["smart", "fine", "sentence"].includes(saved.splitMode)) splitMode.value = saved.splitMode;
  if (saved.title) title.value = saved.title;
} catch {
  localStorage.removeItem(storyboardSettingsKey);
}

watch([title, splitMode], ([latestTitle, latestSplitMode]) => {
  localStorage.setItem(storyboardSettingsKey, JSON.stringify({ title: latestTitle, splitMode: latestSplitMode }));
});

const selectedScenes = computed(() => scenes.value.filter((scene) => scene.selected && scene.narration.trim()));
const canSubmit = computed(() => selectedScenes.value.length > 0 && !creating.value);
const allSelected = computed({
  get: () => scenes.value.length > 0 && scenes.value.every((scene) => scene.selected),
  set: (selected) => scenes.value.forEach((scene) => { scene.selected = selected; })
});
const splitModeInfo = computed(() => ({
  smart: { title: "智能分镜", description: "短分句会自动合并，数量适中，推荐日常使用。" },
  fine: { title: "精细分镜", description: "逗号、顿号、冒号也会拆分，适合需要更多画面时使用。" },
  sentence: { title: "完整句分镜", description: "只按句号、问号、感叹号、分号和换行拆分。" }
})[splitMode.value]);

onUnmounted(endSceneDrag);


const connectorWords = new Set(["首先", "其次", "然后", "接着", "最后", "但是", "而且", "所以", "因此", "例如", "比如", "同时", "另外", "于是", "此时", "其中", "总之", "一方面", "另一方面", "更重要的是"]);

function mergeConnectorFragments(parts) {
  const merged = [];
  let connector = "";
  parts.forEach((part) => {
    if (connector) {
      merged.push(`${connector}${part}`);
      connector = "";
      return;
    }
    const plain = part.replace(/[，,、：:\s]/g, "");
    if (connectorWords.has(plain) && /[，,、：:]$/.test(part)) connector = part;
    else merged.push(part);
  });
  if (connector) merged.push(connector);
  return merged;
}

function visibleTextLength(value) {
  return String(value || "").replace(/[\s。！？!?；;.，,、：:“”‘’"'（）()【】《》]/g, "").length;
}

function mergeShortSmartScenes(items) {
  const result = [];
  let pending = "";
  items.forEach((item) => {
    const combined = pending ? `${pending}${item}` : item;
    pending = "";
    if (visibleTextLength(combined) < 12) pending = combined;
    else result.push(combined);
  });
  if (pending) {
    if (result.length) result[result.length - 1] += pending;
    else result.push(pending);
  }
  return result;
}


function mergeSmartFragments(parts) {
  const merged = [];
  let buffer = "";
  parts.forEach((part) => {
    buffer += part;
    const strongEnding = /[。！？!?；;.][”’"'）】》」』]*$/.test(part);
    const weakEnding = /[，,：:][”’"'）】》」』]*$/.test(part);
    if (strongEnding || (weakEnding && visibleTextLength(buffer) >= 22)) {
      merged.push(buffer.trim());
      buffer = "";
    }
  });
  if (buffer.trim()) merged.push(buffer.trim());
  return mergeShortSmartScenes(merged);
}


function sentenceParts(value) {
  const normalized = String(value || "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ");
  const sentencePattern = /[^。！？!?；;.\n]+(?:[。！？!?；;.]+[”’"'）】》」』]*)?/g;
  const finePattern = /[^。！？!?；;.，,、：:\n]+(?:[。！？!?；;.，,、：:]+[”’"'）】》」』]*)?/g;
  const smartPattern = /[^。！？!?；;.，,：:\n]+(?:[。！？!?；;.，,：:]+[”’"'）】》」』]*)?/g;
  const pattern = splitMode.value === "fine" ? finePattern : splitMode.value === "smart" ? smartPattern : sentencePattern;
  const result = [];
  normalized.split("\n").forEach((paragraph) => {
    const clean = paragraph.trim();
    if (!clean) return;
    const parts = (clean.match(pattern) || [clean]).map((item) => item.trim()).filter(Boolean);
    if (splitMode.value === "fine") result.push(...mergeConnectorFragments(parts));
    else if (splitMode.value === "smart") result.push(...mergeSmartFragments(parts));
    else result.push(...parts);
  });
  return result;
}

function createScene(narration = "") {
  sceneSeed += 1;
  return { id: `${Date.now()}-${sceneSeed}`, selected: true, narration, prompt: "" };
}

function splitSourceText() {
  const parts = sentenceParts(sourceText.value);
  if (!parts.length) return ElMessage.warning("没有识别到可拆解的文案");
  if (parts.length > 1000) return ElMessage.warning("一次最多拆解 1000 个分镜，请缩短文案后重试");
  if (scenes.value.length && !window.confirm("重新拆解会覆盖当前分镜修改，是否继续？")) return;
  scenes.value = parts.map((sentence) => createScene(sentence));
  ElMessage.success(`已拆解为 ${scenes.value.length} 个分镜`);
}

async function onDocumentPick(file) {
  const raw = file?.raw;
  if (!raw) return;
  extracting.value = true;
  try {
    const res = await uploadDocument(raw);
    sourceText.value = res.data.text || "";
    documentName.value = res.data.title || raw.name;
    if (title.value === "文案分镜") title.value = String(res.data.title || raw.name).replace(/\.[^.]+$/, "") || "文案分镜";
    scenes.value = [];
    ElMessage.success("文案读取完成，点击“开始拆解文案”生成分镜");
  } catch (error) {
    ElMessage.warning(error.response?.data?.message || "文案读取失败");
  } finally {
    extracting.value = false;
    documentUpload.value?.clearFiles?.();
  }
}

function addScene() {
  scenes.value.push(createScene());
}

function insertScene(index, position) {
  const insertAt = position === "before" ? index : index + 1;
  scenes.value.splice(insertAt, 0, createScene());
}

function removeScene(index) {
  scenes.value.splice(index, 1);
}

function startSceneDrag(event, scene) {
  draggingSceneId.value = scene.id;
  dragOverSceneId.value = "";
  dragPosition.value = "before";
  window.addEventListener("dragover", onWindowSceneDragOver, true);
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", scene.id);
  }
}


function stopSceneAutoScroll() {
  if (dragScrollFrame) window.cancelAnimationFrame(dragScrollFrame);
  dragScrollFrame = 0;
  dragScrollSpeed = 0;
}

function runSceneAutoScroll() {
  dragScrollFrame = 0;
  const container = sceneList.value;
  if (!container || !draggingSceneId.value || !dragScrollSpeed) return;
  const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
  const nextScroll = Math.min(maxScroll, Math.max(0, container.scrollTop + dragScrollSpeed));
  if (nextScroll === container.scrollTop) return stopSceneAutoScroll();
  container.scrollTop = nextScroll;
  dragScrollFrame = window.requestAnimationFrame(runSceneAutoScroll);
}

function setSceneAutoScrollSpeed(speed) {
  dragScrollSpeed = speed;
  if (!speed) return stopSceneAutoScroll();
  if (!dragScrollFrame) dragScrollFrame = window.requestAnimationFrame(runSceneAutoScroll);
}

function updateSceneAutoScroll(clientY) {
  const container = sceneList.value;
  if (!container || !draggingSceneId.value) return stopSceneAutoScroll();
  const rect = container.getBoundingClientRect();
  const edgeSize = Math.min(96, Math.max(56, rect.height * 0.22));
  const maxSpeed = 32;
  const distanceFromTop = clientY - rect.top;
  const distanceFromBottom = rect.bottom - clientY;
  let speed = 0;

  if (distanceFromTop < edgeSize) {
    const strength = Math.min(1, (edgeSize - Math.max(0, distanceFromTop)) / edgeSize);
    speed = -Math.max(6, Math.ceil(strength * maxSpeed));
  } else if (distanceFromBottom < edgeSize) {
    const strength = Math.min(1, (edgeSize - Math.max(0, distanceFromBottom)) / edgeSize);
    speed = Math.max(6, Math.ceil(strength * maxSpeed));
  }

  setSceneAutoScrollSpeed(speed);
}

function onWindowSceneDragOver(event) {
  if (!draggingSceneId.value) return;
  event.preventDefault();
  updateSceneAutoScroll(event.clientY);
}

function onSceneListDragOver(event) {
  updateSceneAutoScroll(event.clientY);
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}
function onSceneDragOver(event, index) {
  const target = scenes.value[index];
  if (!draggingSceneId.value || !target || target.id === draggingSceneId.value) {
    dragOverSceneId.value = "";
    return;
  }
  const rect = event.currentTarget.getBoundingClientRect();
  dragOverSceneId.value = target.id;
  dragPosition.value = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}

function dropScene(targetIndex) {
  const fromIndex = scenes.value.findIndex((scene) => scene.id === draggingSceneId.value);
  if (fromIndex < 0 || fromIndex === targetIndex) return endSceneDrag();
  let insertAt = targetIndex + (dragPosition.value === "after" ? 1 : 0);
  const next = [...scenes.value];
  const [moved] = next.splice(fromIndex, 1);
  if (fromIndex < insertAt) insertAt -= 1;
  next.splice(insertAt, 0, moved);
  scenes.value = next;
  endSceneDrag();
}

function dropSceneAtEnd() {
  const fromIndex = scenes.value.findIndex((scene) => scene.id === draggingSceneId.value);
  if (fromIndex < 0) return endSceneDrag();
  const next = [...scenes.value];
  const [moved] = next.splice(fromIndex, 1);
  next.push(moved);
  scenes.value = next;
  endSceneDrag();
}

function endSceneDrag() {
  window.removeEventListener("dragover", onWindowSceneDragOver, true);
  draggingSceneId.value = "";
  dragOverSceneId.value = "";
  dragPosition.value = "before";
  stopSceneAutoScroll();
}
function clearAll() {
  if ((sourceText.value || scenes.value.length) && !window.confirm("确定清空当前文案和全部分镜吗？")) return;
  sourceText.value = "";
  documentName.value = "";
  title.value = "文案分镜";
  scenes.value = [];
}

async function submit(autoStart) {
  if (!selectedScenes.value.length) return ElMessage.warning("请至少选择一个包含文案的分镜");
  creating.value = true;
  try {
    const ok = await taskStore.createStoryboard({
      title: title.value.trim() || "文案分镜",
      scenes: selectedScenes.value.map((scene) => ({ narration: scene.narration.trim(), prompt: scene.prompt.trim() })),
      autoStart
    });
    if (ok) {
      emit("update:modelValue", false);
      sourceText.value = "";
      documentName.value = "";
      title.value = "文案分镜";
      scenes.value = [];
    }
  } finally {
    creating.value = false;
  }
}
</script>
