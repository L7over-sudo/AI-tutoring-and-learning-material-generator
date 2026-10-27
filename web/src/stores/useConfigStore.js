import { defineStore } from "pinia";
import { ElMessage } from "element-plus";
import { getConfig, health, saveConfig, testConfig } from "../api/config";

export const useConfigStore = defineStore("config", {
  state: () => ({
    config: null,
    backendOnline: false,
    testing: false
  }),
  actions: {
    async load() {
      try {
        const [configRes] = await Promise.all([getConfig(), this.checkHealth()]);
        this.config = configRes.data.config;
      } catch (error) {
        this.backendOnline = false;
      }
    },
    async checkHealth() {
      try {
        await health();
        this.backendOnline = true;
      } catch {
        this.backendOnline = false;
      }
    },
    async save(data, { silent = false } = {}) {
      const res = await saveConfig(data);
      this.config = res.data.config;
      if (!silent) ElMessage.success(`✅ ${res.data.message || "配置已保存"}`);
      return this.config;
    },
    async test(data = {}) {
      this.testing = true;
      try {
        const res = await testConfig(data);
        ElMessage.success(`🌐 ${res.data.message}`);
      } catch (error) {
        ElMessage.error(error.response?.data?.message || "API 连接失败");
      } finally {
        this.testing = false;
      }
    }
  }
});
