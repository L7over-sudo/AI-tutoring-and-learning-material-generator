import { defineStore } from "pinia";
import { ElMessage } from "element-plus";
import { deletePromptTemplates, getPromptTemplates, savePromptTemplate } from "../api/config";

export const usePromptTemplateStore = defineStore("promptTemplates", {
  state: () => ({
    templates: [],
    loading: false
  }),
  getters: {
    templateMap: (state) => Object.fromEntries(state.templates.map((item) => [item.name, item.content]))
  },
  actions: {
    async load() {
      this.loading = true;
      try {
        const res = await getPromptTemplates();
        this.templates = res.data.templates || [];
      } finally {
        this.loading = false;
      }
    },
    async save(template) {
      await savePromptTemplate(template);
      await this.load();
      ElMessage.success("✅ 提示词模板已保存");
    },
    async remove(ids) {
      await deletePromptTemplates(ids);
      await this.load();
      ElMessage.success("🧹 提示词模板已删除");
    }
  }
});
