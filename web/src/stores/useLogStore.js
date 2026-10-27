import { defineStore } from "pinia";
import { clearUiLogs, recentLogs } from "../api/log";

export const useLogStore = defineStore("logs", {
  state: () => ({ logs: [] }),
  actions: {
    async load() {
      const res = await recentLogs();
      this.logs = res.data.logs;
    },
    async clear() {
      await clearUiLogs();
      this.logs = [];
    }
  }
});
