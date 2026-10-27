<template>
  <el-dialog v-model="visible" title="🧩 提示词模板管理" width="920px" class="prompt-template-dialog">
    <div class="template-dialog-layout">
      <section class="template-editor">
        <el-form label-position="top">
          <el-form-item label="模板名称">
            <el-input v-model="draft.name" placeholder="例如：低年级数学错题卡" />
          </el-form-item>
          <el-form-item label="模板内容">
            <el-input v-model="draft.content" type="textarea" :rows="12" resize="none" placeholder="填写提示词内容..." />
          </el-form-item>
          <div class="template-actions">
            <el-button class="soft-button" @click="resetDraft">新建</el-button>
            <el-button class="pink-button" @click="saveDraft">保存模板</el-button>
          </div>
        </el-form>
      </section>

      <section class="template-list">
        <div class="template-list-head">
          <span>模板列表</span>
          <el-button link type="danger" :disabled="!selectedIds.length" @click="removeSelected">批量删除</el-button>
        </div>
        <el-table
          v-loading="templateStore.loading"
          :data="templateStore.templates"
          height="390"
          @selection-change="selectedIds = $event.map((item) => item.id)"
          @row-click="editTemplate"
        >
          <el-table-column type="selection" width="42" />
          <el-table-column prop="name" label="模板名称" min-width="140" show-overflow-tooltip />
          <el-table-column label="类型" width="76">
            <template #default="{ row }">
              <el-tag size="small" :type="row.builtin ? 'info' : 'success'">{{ row.builtin ? "内置" : "自定义" }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="90">
            <template #default="{ row }">
              <el-button link type="danger" @click.stop="removeOne(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </section>
    </div>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { usePromptTemplateStore } from "../stores/usePromptTemplateStore";

const props = defineProps({ modelValue: Boolean });
const emit = defineEmits(["update:modelValue"]);
const templateStore = usePromptTemplateStore();
const selectedIds = ref([]);
const draft = reactive({ id: "", name: "", content: "" });

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit("update:modelValue", value)
});

watch(
  () => props.modelValue,
  async (value) => {
    if (value) await templateStore.load();
  },
  { immediate: true }
);

function editTemplate(row) {
  draft.id = row.id;
  draft.name = row.name;
  draft.content = row.content;
}

function resetDraft() {
  draft.id = "";
  draft.name = "";
  draft.content = "";
}

async function saveDraft() {
  if (!draft.name.trim() || !draft.content.trim()) return ElMessage.warning("请填写模板名称和模板内容");
  await templateStore.save({ id: draft.id, name: draft.name, content: draft.content });
  resetDraft();
}

async function removeOne(row) {
  await templateStore.remove([row.id]);
  if (draft.id === row.id) resetDraft();
}

async function removeSelected() {
  const removedIds = [...selectedIds.value];
  await templateStore.remove(removedIds);
  selectedIds.value = [];
  if (removedIds.includes(draft.id)) resetDraft();
}
</script>
