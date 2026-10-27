<template>
  <el-dialog
    :model-value="modelValue"
    title="📕 小红书发布工作台"
    width="820px"
    append-to-body
    class="source-dialog xhs-publish-dialog"
    @update:model-value="emit('update:modelValue', $event)"
    @open="initialize"
  >
    <div class="publish-intro">
      <div>
        <b>自动上传勾选的生成图，并填写笔记文案</b>
        <span>支持保存草稿或直接发布，也可以自动关联当前店铺中已上架的自有商品。</span>
      </div>
      <div class="publish-intro-actions">
        <el-tag type="success" effect="plain">{{ publishTasks.length }} 张图片</el-tag>
        <el-button class="soft-button" :loading="copyGenerating" :disabled="!publishTasks.length" @click="generateCopy">
          ✨ AI生成文案
        </el-button>
      </div>
    </div>

    <div v-if="publishTasks.length" class="publish-grid">
      <figure v-for="task in publishTasks" :key="task.id">
        <img :src="taskPreviewUrl(task)" :alt="task.title || task.originalName" />
        <figcaption>第 {{ task.index }} 张</figcaption>
      </figure>
    </div>
    <el-empty v-else description="请先在任务列表勾选已完成的生成图" :image-size="72" />

    <el-form label-position="top" class="publish-form">
      <el-form-item label="笔记标题">
        <el-input v-model="form.title" maxlength="20" show-word-limit placeholder="输入小红书标题" />
      </el-form-item>
      <el-form-item v-if="!isDesktop" label="发布方式">
        <el-radio-group v-model="form.publishMode">
          <el-radio-button value="draft">保存草稿</el-radio-button>
          <el-radio-button value="publish">直接发布</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="正文" class="field-wide">
        <el-input v-model="form.content" type="textarea" :rows="7" maxlength="1000" show-word-limit
          placeholder="输入正文内容，可在下面添加话题标签" />
      </el-form-item>
      <el-form-item label="话题标签">
        <el-input v-model="form.tags" placeholder="例如：学习资料 教辅分享 初中衔接" />
        <div class="field-hint">空格、逗号均可分隔，发布时会自动转换为 #话题。</div>
      </el-form-item>
      <el-form-item v-if="!isDesktop" label="关联自己的商品">
        <el-switch v-model="form.attachProduct" active-text="自动挂商品" inactive-text="普通笔记" />
      </el-form-item>
      <el-form-item v-if="!isDesktop && form.attachProduct" label="店铺商品名称" class="field-wide">
        <el-input v-model="form.productName" maxlength="120" clearable
          placeholder="填写千帆后台中已上架商品的完整名称" />
        <div class="field-hint">发布时会搜索并精确匹配该商品；名称不唯一或商品未上架时将停止发布。</div>
      </el-form-item>
    </el-form>

    <div v-if="status.message" class="publish-status" :class="`is-${status.stage}`">
      <span class="status-dot"></span>
      <div><b>{{ statusTitle }}</b><span>{{ status.message }}</span></div>
    </div>

    <template #footer>
      <el-button class="soft-button" @click="emit('update:modelValue', false)">取消</el-button>
      <el-button class="pink-button" :loading="preparing" :disabled="!canPublish" @click="preparePublish">
        {{ publishActionLabel }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, onBeforeUnmount, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useTaskStore } from "../stores/useTaskStore";
import { taskPreviewUrl } from "../utils/taskPreview";
import { createXhsDraft, generateXhsCopy, publishXhsNote } from "../api/xhsPublish";

defineProps({ modelValue: Boolean });
const emit = defineEmits(["update:modelValue"]);
const taskStore = useTaskStore();
const isDesktop = Boolean(window.xhsPublish?.isDesktop);
const preparing = ref(false);
const copyGenerating = ref(false);
const form = reactive({
  title: "",
  content: "",
  tags: "学习资料 教辅分享",
  publishMode: "draft",
  attachProduct: false,
  productName: localStorage.getItem("xhs-own-product-name") || ""
});
const status = reactive({ stage: "", message: "" });
const publishTasks = computed(() => taskStore.tasks
  .filter((task) => task.selected && task.status === "已完成" && (task.enhancedUrl || task.generatedUrl))
  .slice(0, 9));
const canPublish = computed(() => publishTasks.value.length > 0
  && form.title.trim()
  && (!form.attachProduct || form.productName.trim())
  && !preparing.value);
const publishActionLabel = computed(() => {
  if (isDesktop) return "打开小红书并自动填充";
  return form.publishMode === "publish" ? "确认并直接发布" : "保存到小红书草稿箱";
});
const statusTitle = computed(() => ({
  opened: "发布窗口已打开",
  login: "等待登录",
  waiting: "等待页面",
  uploading: "正在上传",
  filling: "正在填写",
  ready: "草稿已保存",
  published: "发布成功"
}[status.stage] || "发布准备"));

function initialize() {
  const batchName = taskStore.batch?.presentationName || taskStore.batch?.folderName || taskStore.currentTask?.title || "学习资料分享";
  if (!form.title) form.title = String(batchName).replace(/\.[^.]+$/, "").slice(0, 20);
  if (!form.content) {
    const source = publishTasks.value.find((task) => task.sourceText)?.sourceText || "";
    form.content = String(source).trim().slice(0, 900);
  }
  if (taskStore.tasks.filter((task) => task.selected && task.status === "已完成").length > 9) {
    ElMessage.warning("小红书发布通道单篇最多准备 9 张图片，已取前 9 张");
  }
}

function formattedContent() {
  const tags = form.tags.split(/[\s,，#]+/).map((item) => item.trim()).filter(Boolean);
  const tagLine = [...new Set(tags)].map((tag) => `#${tag}`).join(" ");
  return [form.content.trim(), tagLine].filter(Boolean).join("\n\n");
}

async function generateCopy() {
  if (!publishTasks.value.length || copyGenerating.value) return;
  copyGenerating.value = true;
  try {
    const response = await generateXhsCopy({
      taskIds: publishTasks.value.map((task) => task.id),
      titleHint: form.title.trim()
    });
    const result = response.data?.result || {};
    if (result.title) form.title = String(result.title).slice(0, 20);
    if (result.content) form.content = String(result.content).slice(0, 1000);
    if (Array.isArray(result.tags)) form.tags = result.tags.join(" ");
    ElMessage.success("标题、正文和话题标签已生成");
  } catch (error) {
    ElMessage.warning(error.response?.data?.message || error.message || "AI 文案生成失败");
  } finally {
    copyGenerating.value = false;
  }
}

async function preparePublish() {
  if (!canPublish.value) return;
  if (!isDesktop && form.publishMode === "publish") {
    try {
      await ElMessageBox.confirm(
        `即将公开发布这篇笔记${form.attachProduct ? `，并关联商品“${form.productName.trim()}”` : ""}。发布后会对外可见，是否继续？`,
        "确认直接发布",
        { confirmButtonText: "确认发布", cancelButtonText: "取消", type: "warning" }
      );
    } catch {
      return;
    }
  }
  preparing.value = true;
  status.stage = "waiting";
  status.message = "正在整理图片和文案…";
  try {
    const payload = JSON.parse(JSON.stringify({
      title: form.title.trim(),
      content: form.content.trim(),
      topics: form.tags,
      productName: form.attachProduct ? form.productName.trim() : "",
      taskIds: publishTasks.value.map((task) => task.id),
      items: publishTasks.value.map((task, index) => ({
        name: `${String(index + 1).padStart(2, "0")}.png`,
        url: taskPreviewUrl(task)
      }))
    }));
    if (isDesktop) {
      payload.content = formattedContent();
      const result = await window.xhsPublish.prepareAndOpen(payload);
      if (!result?.success) throw new Error(result?.message || "发布准备失败");
      status.stage = "opened";
      status.message = `已准备 ${result.imageCount} 张图片，小红书窗口正在打开`;
      ElMessage.success("小红书发布窗口已打开，登录后会自动上传并填写");
    } else {
      if (form.attachProduct) localStorage.setItem("xhs-own-product-name", form.productName.trim());
      const response = form.publishMode === "publish"
        ? await publishXhsNote(payload)
        : await createXhsDraft(payload);
      const result = response.data?.result || {};
      status.stage = form.publishMode === "publish" ? "published" : "ready";
      status.message = form.publishMode === "publish"
        ? `已公开发布 ${result.imageCount || publishTasks.value.length} 张图片${result.productName ? `，并关联商品“${result.productName}”` : ""}`
        : `已将 ${result.imageCount || publishTasks.value.length} 张图片保存到小红书草稿箱，请检查后发布`;
      ElMessage.success(form.publishMode === "publish" ? "小红书笔记已发布" : "小红书草稿已保存");
    }
  } catch (error) {
    status.stage = "error";
    status.message = error.response?.data?.message || error.message || "发布准备失败";
    ElMessage.warning(status.message);
  } finally {
    preparing.value = false;
  }
}

const unsubscribe = window.xhsPublish?.onStatus?.((nextStatus = {}) => {
  status.stage = nextStatus.stage || "";
  status.message = nextStatus.message || "";
});
onBeforeUnmount(() => unsubscribe?.());
</script>

<style scoped>
.publish-intro{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:12px 14px;margin-bottom:14px;border:1px solid #f0c6c2;border-radius:10px;background:linear-gradient(135deg,#fff5f3,#f4fbf8)}
.publish-intro b,.publish-intro span{display:block}.publish-intro span{margin-top:4px;color:var(--text-muted);font-size:13px}
.publish-intro-actions{display:flex;align-items:center;gap:10px;flex:0 0 auto}
.publish-grid{display:flex;gap:9px;margin:14px 0;padding:10px;overflow-x:auto;border:1px solid #e4e7ed;border-radius:10px;background:#fafcfb}
.publish-grid figure{flex:0 0 92px;margin:0}.publish-grid img{display:block;width:92px;height:118px;object-fit:cover;border-radius:7px;background:#eef3f2}.publish-grid figcaption{margin-top:5px;color:var(--text-muted);font-size:12px;text-align:center}
.publish-form{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}.publish-form :deep(.field-wide){grid-column:1/-1}.publish-form :deep(.el-form-item){margin-bottom:14px}.field-hint{margin-top:5px;color:var(--text-muted);font-size:12px}
.publish-status{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #d8ebe8;border-radius:9px;background:#f3fbf8}.publish-status.is-ready,.publish-status.is-published{border-color:#a8dfbd;background:#effbf3}.publish-status.is-error{border-color:#efb3b3;background:#fff2f2}.status-dot{width:9px;height:9px;border-radius:50%;background:#5cb5ce;box-shadow:0 0 0 4px rgba(92,181,206,.15)}.is-ready .status-dot,.is-published .status-dot{background:#55b779}.is-error .status-dot{background:#e26767}.publish-status b,.publish-status span{display:block}.publish-status span{margin-top:2px;color:var(--text-muted);font-size:12px}
@media(max-width:760px){.publish-form{grid-template-columns:1fr}}
</style>
