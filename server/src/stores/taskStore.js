import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "../paths.js";

const tasksPath = path.join(dataDir, "tasks.json");
const batchesPath = path.join(dataDir, "batches.json");
const fileQueues = new Map();

function queueFileOperation(file, operation) {
  const previous = fileQueues.get(file) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  fileQueues.set(file, next.catch(() => {}));
  return next;
}

function isCompatibleJson(value, fallback) {
  return Array.isArray(fallback) ? Array.isArray(value) : value !== null && typeof value === typeof fallback;
}

async function atomicWrite(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tempFile = `${file}.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
  let handle = null;
  try {
    handle = await fs.open(tempFile, "w");
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(tempFile, file);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(tempFile).catch(() => {});
  }
}

async function writeJsonFile(file, data) {
  const content = JSON.stringify(data, null, 2);
  await atomicWrite(file, content);
  await atomicWrite(`${file}.bak`, content).catch(() => {});
}

async function readBackup(file, fallback) {
  try {
    const recovered = JSON.parse(await fs.readFile(`${file}.bak`, "utf8"));
    return isCompatibleJson(recovered, fallback) ? recovered : null;
  } catch {
    return null;
  }
}

async function readJsonFile(file, fallback) {
  await fs.mkdir(dataDir, { recursive: true });
  let content;
  try {
    content = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const recovered = await readBackup(file, fallback);
    const initial = recovered ?? fallback;
    await writeJsonFile(file, initial);
    return initial;
  }

  try {
    const parsed = JSON.parse(content);
    if (!isCompatibleJson(parsed, fallback)) throw new Error("JSON 数据结构不正确");
    return parsed;
  } catch {
    const backup = `${file}.broken-${Date.now()}`;
    if (content.trim()) await fs.writeFile(backup, content, "utf8");

    const recoveredBackup = await readBackup(file, fallback);
    if (recoveredBackup) {
      await writeJsonFile(file, recoveredBackup);
      return recoveredBackup;
    }

    const trimmed = content.slice(0, content.lastIndexOf("]") + 1);
    if (trimmed) {
      try {
        const recovered = JSON.parse(trimmed);
        if (isCompatibleJson(recovered, fallback)) {
          await writeJsonFile(file, recovered);
          return recovered;
        }
      } catch {
        // Report the corruption below after preserving the broken file.
      }
    }

    throw new Error(`任务数据文件损坏，已保留原文件，未执行清空：${file}`);
  }
}

async function readJson(file, fallback) {
  return queueFileOperation(file, () => readJsonFile(file, fallback));
}

async function writeJson(file, data) {
  return queueFileOperation(file, () => writeJsonFile(file, data));
}

async function updateJson(file, fallback, updater) {
  return queueFileOperation(file, async () => {
    const current = await readJsonFile(file, fallback);
    const next = await updater(current);
    await writeJsonFile(file, next);
    return next;
  });
}

function summarizeTasks(tasks) {
  return {
    total: tasks.length,
    success: tasks.filter((task) => task.status === "已完成").length,
    failed: tasks.filter((task) => task.status === "失败").length,
    running: tasks.filter((task) => task.status === "生成中").length,
    pending: tasks.filter((task) => task.status === "待生成").length,
    canceled: tasks.filter((task) => task.status === "已取消").length
  };
}

export const taskStore = {
  async listTasks() {
    return readJson(tasksPath, []);
  },
  async listBatches() {
    return readJson(batchesPath, []);
  },
  async saveTasks(tasks) {
    await writeJson(tasksPath, tasks);
  },
  async saveBatches(batches) {
    await writeJson(batchesPath, batches);
  },
  async addBatch(batch, tasks) {
    await updateJson(tasksPath, [], (allTasks) => [...allTasks, ...tasks]);
    await updateJson(batchesPath, [], (batches) => [...batches.filter((item) => item.id !== batch.id), batch]);
  },
  async addTask(task) {
    await updateJson(tasksPath, [], (tasks) => [...tasks, task]);
    return task;
  },
  async getBatch(batchId) {
    const batches = await this.listBatches();
    const tasks = await this.listTasks();
    return {
      batch: batches.find((item) => item.id === batchId) || null,
      tasks: tasks.filter((item) => item.batchId === batchId).sort((a, b) => a.index - b.index)
    };
  },
  async updateBatch(batchId, patch) {
    let updated = null;
    const next = await updateJson(batchesPath, [], (batches) => {
      const now = new Date().toISOString();
      const result = batches.map((item) => (item.id === batchId ? { ...item, ...patch, updatedAt: now } : item));
      updated = result.find((item) => item.id === batchId) || null;
      return result;
    });
    return updated || next.find((item) => item.id === batchId);
  },
  async updateTask(taskId, patch) {
    let updated = null;
    const next = await updateJson(tasksPath, [], (tasks) => {
      const now = new Date().toISOString();
      const result = tasks.map((task) => (task.id === taskId ? { ...task, ...patch, updatedAt: now } : task));
      updated = result.find((task) => task.id === taskId) || null;
      return result;
    });
    return updated || next.find((task) => task.id === taskId);
  },
  async updateTasks(batchId, updater) {
    const next = await updateJson(tasksPath, [], (tasks) =>
      tasks.map((task) => (task.batchId === batchId ? updater(task) : task))
    );
    return next.filter((task) => task.batchId === batchId).sort((a, b) => a.index - b.index);
  },
  async deleteTask(taskId) {
    await updateJson(tasksPath, [], (tasks) => tasks.filter((task) => task.id !== taskId));
  },
  async clearAll() {
    await this.saveTasks([]);
    await this.saveBatches([]);
  },
  async reconcileInterruptedRunningTasks() {
    const now = new Date().toISOString();
    const nextTasks = await updateJson(tasksPath, [], (tasks) => tasks.map((task) =>
        task.status === "生成中"
          ? { ...task, status: "失败", error: "服务已重启或任务被中断，请重试", updatedAt: now }
          : task
    ));
    await updateJson(batchesPath, [], (batches) =>
      batches.map((batch) => {
        const batchTasks = nextTasks.filter((task) => task.batchId === batch.id);
        const summary = summarizeTasks(batchTasks);
        return ["生成中", "停止中"].includes(batch.status) || batch.summary?.running
          ? { ...batch, status: "已停止", cancelRequested: false, summary, updatedAt: now }
          : { ...batch, summary };
      })
    );
  }
};
