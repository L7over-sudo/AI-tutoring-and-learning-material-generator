<template>
  <el-dialog
    :model-value="modelValue"
    title="📦 小红书商品上架"
    width="900px"
    append-to-body
    class="source-dialog xhs-product-dialog"
    @update:model-value="emit('update:modelValue', $event)"
    @open="initialize"
  >
    <div class="product-intro">
      <div>
        <b>把勾选的生成图直接做成店铺商品</b>
        <span>自动复用店内“电子资源 › 课件/教案/手抄报”商品模板，填写图片、价格、库存和自动发货信息。</span>
      </div>
      <el-tag type="success" effect="plain">{{ productTasks.length }} 张商品图</el-tag>
    </div>

    <div v-if="productTasks.length" class="product-grid">
      <figure v-for="task in productTasks" :key="task.id">
        <img :src="taskPreviewUrl(task)" :alt="task.title || task.originalName" />
        <figcaption>第 {{ task.index }} 张</figcaption>
      </figure>
    </div>
    <el-empty v-else description="请先在任务列表勾选已完成的生成图" :image-size="72" />

    <el-alert
      title="商品创建要求"
      type="info"
      :closable="false"
      show-icon
      description="需要已登录小红书千帆商家后台。图片会处理成 3:4 商品图；保存草稿不会上架，提交审核会真实创建商品。"
    />

    <el-form label-position="top" class="product-form">
      <el-form-item label="商品标题" class="field-wide">
        <el-input v-model="form.title" maxlength="60" show-word-limit placeholder="例如：六升七衔接综合学习资料 教师版" />
      </el-form-item>
      <el-form-item label="导购短标题">
        <el-input v-model="form.shortTitle" maxlength="24" show-word-limit placeholder="用于商品卡片展示" />
      </el-form-item>
      <el-form-item label="商品货号（可选）">
        <el-input v-model="form.articleNo" maxlength="60" clearable placeholder="例如：XS-20260902-01" />
      </el-form-item>
      <el-form-item label="售价（元）">
        <el-input v-model="form.price" inputmode="decimal" placeholder="4.99">
          <template #prepend>¥</template>
        </el-input>
      </el-form-item>
      <el-form-item label="库存">
        <el-input v-model="form.stock" inputmode="numeric" placeholder="9999" />
      </el-form-item>
      <el-form-item label="自动发货网盘链接" class="field-wide">
        <el-input v-model="form.deliveryLink" type="textarea" :rows="2" maxlength="200" show-word-limit
          placeholder="粘贴百度网盘、夸克网盘等资料链接（含提取码）" />
      </el-form-item>
      <el-form-item label="自动发货内容说明" class="field-wide">
        <el-input v-model="form.deliveryContent" type="textarea" :rows="2" maxlength="200" show-word-limit
          placeholder="买家付款后看到的使用说明" />
      </el-form-item>
      <el-form-item label="详情页描述（可选）" class="field-wide">
        <el-input v-model="form.description" type="textarea" :rows="3" maxlength="500" show-word-limit
          placeholder="说明资料内容、适用对象和使用方式" />
      </el-form-item>
      <el-form-item label="上架方式" class="field-wide">
        <el-radio-group v-model="form.action">
          <el-radio-button value="draft">先保存商品草稿</el-radio-button>
          <el-radio-button value="submit">直接提交审核</el-radio-button>
        </el-radio-group>
        <div class="field-hint">
          {{ form.action === 'submit' ? '会真实提交到小红书审核；按当前模板设置，审核通过后立即上架。' : '只进入千帆商品草稿箱，可检查后再提交。' }}
        </div>
      </el-form-item>
    </el-form>

    <div v-if="status.message" class="product-status" :class="`is-${status.stage}`">
      <span class="status-dot"></span>
      <div><b>{{ statusTitle }}</b><span>{{ status.message }}</span></div>
    </div>

    <template #footer>
      <el-button class="soft-button" :disabled="submitting" @click="emit('update:modelValue', false)">取消</el-button>
      <el-button class="product-submit-button" :loading="submitting" :disabled="!canSubmit" @click="submitProduct">
        {{ form.action === 'submit' ? '确认并提交审核' : '保存到商品草稿箱' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { createXhsProduct } from "../api/xhsPublish";
import { useTaskStore } from "../stores/useTaskStore";
import { taskPreviewUrl } from "../utils/taskPreview";

defineProps({ modelValue: Boolean });
const emit = defineEmits(["update:modelValue"]);
const taskStore = useTaskStore();
const submitting = ref(false);
const form = reactive({
  title: "",
  shortTitle: "",
  articleNo: "",
  price: localStorage.getItem("xhs-product-price") || "4.99",
  stock: localStorage.getItem("xhs-product-stock") || "9999",
  deliveryLink: localStorage.getItem("xhs-product-delivery-link") || "",
  deliveryContent: localStorage.getItem("xhs-product-delivery-content") || "付款后请复制网盘链接保存资料，如链接异常请联系商家。",
  description: "",
  action: "draft"
});
const status = reactive({ stage: "", message: "" });
const productTasks = computed(() => taskStore.tasks
  .filter((task) => task.selected && task.status === "已完成" && (task.enhancedUrl || task.generatedUrl))
  .slice(0, 10));
const validPrice = computed(() => /^\d+(?:[.]\d{1,2})?$/.test(form.price.trim()) && Number(form.price) > 0);
const validStock = computed(() => /^\d+$/.test(form.stock.trim()) && Number(form.stock) > 0);
const canSubmit = computed(() => productTasks.value.length > 0
  && form.title.trim()
  && form.shortTitle.trim()
  && form.deliveryLink.trim()
  && form.deliveryContent.trim()
  && validPrice.value
  && validStock.value
  && !submitting.value);
const statusTitle = computed(() => ({
  preparing: "正在准备商品",
  draft: "商品草稿已保存",
  submitted: "商品已提交审核",
  error: "商品上架失败"
}[status.stage] || "商品上架"));

function baseTitle() {
  return String(
    taskStore.batch?.presentationName
    || taskStore.batch?.folderName
    || taskStore.currentTask?.folderName
    || taskStore.currentTask?.title
    || "学习资料"
  ).replace(/\.[^.]+$/, "").trim();
}

function initialize() {
  const title = baseTitle();
  if (!form.title) form.title = title.slice(0, 60);
  if (!form.shortTitle) form.shortTitle = title.slice(0, 24);
  if (!form.description) form.description = `${title}电子学习资料，付款后自动发送网盘链接。`.slice(0, 500);
  if (taskStore.tasks.filter((task) => task.selected && task.status === "已完成").length > 10) {
    ElMessage.warning("小红书单个商品最多使用 10 张主图，已取前 10 张");
  }
}

function savePreferences() {
  localStorage.setItem("xhs-product-price", form.price.trim());
  localStorage.setItem("xhs-product-stock", form.stock.trim());
  localStorage.setItem("xhs-product-delivery-link", form.deliveryLink.trim());
  localStorage.setItem("xhs-product-delivery-content", form.deliveryContent.trim());
}

async function submitProduct() {
  if (!canSubmit.value) return;
  const isSubmit = form.action === "submit";
  try {
    await ElMessageBox.confirm(
      isSubmit
        ? `将创建商品“${form.title.trim()}”并真实提交审核，售价 ¥${form.price.trim()}。是否继续？`
        : `将上传 ${productTasks.value.length} 张图片并把商品“${form.title.trim()}”保存到千帆草稿箱。是否继续？`,
      isSubmit ? "确认提交商品" : "确认保存商品草稿",
      {
        confirmButtonText: isSubmit ? "确认提交审核" : "确认保存草稿",
        cancelButtonText: "取消",
        type: isSubmit ? "warning" : "info"
      }
    );
  } catch {
    return;
  }

  submitting.value = true;
  status.stage = "preparing";
  status.message = "正在处理商品图并连接小红书千帆，请不要关闭 Chrome…";
  savePreferences();
  try {
    const response = await createXhsProduct({
      taskIds: productTasks.value.map((task) => task.id),
      title: form.title.trim(),
      shortTitle: form.shortTitle.trim(),
      articleNo: form.articleNo.trim(),
      price: form.price.trim(),
      stock: form.stock.trim(),
      deliveryLink: form.deliveryLink.trim(),
      deliveryContent: form.deliveryContent.trim(),
      description: form.description.trim(),
      action: form.action
    });
    const result = response.data?.result || {};
    status.stage = result.status || form.action;
    status.message = result.status === "submitted"
      ? `“${result.title || form.title}”已提交审核，请到千帆商品管理查看审核状态。`
      : `“${result.title || form.title}”已保存到千帆商品草稿箱。`;
    ElMessage.success(result.status === "submitted" ? "商品已提交审核" : "商品草稿已保存");
  } catch (error) {
    status.stage = "error";
    status.message = error.response?.data?.message || error.message || "小红书商品上架失败";
    ElMessage.warning(status.message);
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.product-intro{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:12px 14px;margin-bottom:14px;border:1px solid #bfe0d5;border-radius:10px;background:linear-gradient(135deg,#f2fbf7,#f7fbff)}
.product-intro b,.product-intro span{display:block}.product-intro span{margin-top:4px;color:var(--text-muted);font-size:13px}
.product-grid{display:flex;gap:9px;margin:14px 0;padding:10px;overflow-x:auto;border:1px solid #e4e7ed;border-radius:10px;background:#fafcfb}
.product-grid figure{flex:0 0 92px;margin:0}.product-grid img{display:block;width:92px;height:122px;object-fit:cover;border-radius:7px;background:#eef3f2}.product-grid figcaption{margin-top:5px;color:var(--text-muted);font-size:12px;text-align:center}
.product-form{display:grid;grid-template-columns:1fr 1fr;gap:0 14px;margin-top:16px}.product-form :deep(.field-wide){grid-column:1/-1}.product-form :deep(.el-form-item){margin-bottom:14px}.field-hint{margin-top:6px;color:var(--text-muted);font-size:12px}
.product-status{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #d8ebe8;border-radius:9px;background:#f3fbf8}.product-status.is-draft,.product-status.is-submitted{border-color:#a8dfbd;background:#effbf3}.product-status.is-error{border-color:#efb3b3;background:#fff2f2}.status-dot{width:9px;height:9px;border-radius:50%;background:#5cb5ce;box-shadow:0 0 0 4px rgba(92,181,206,.15)}.is-draft .status-dot,.is-submitted .status-dot{background:#55b779}.is-error .status-dot{background:#e26767}.product-status b,.product-status span{display:block}.product-status span{margin-top:2px;color:var(--text-muted);font-size:12px}
.product-submit-button{color:#fff;border-color:#36a678;background:linear-gradient(135deg,#54bd91,#2d9d70)}.product-submit-button:hover,.product-submit-button:focus{color:#fff;border-color:#288d65;background:linear-gradient(135deg,#45ae82,#288d65)}
@media(max-width:760px){.product-form{grid-template-columns:1fr}}
</style>
