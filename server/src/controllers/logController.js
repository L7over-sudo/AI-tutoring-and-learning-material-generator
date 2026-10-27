import { logService } from "../services/logService.js";
import { ok } from "../utils/response.js";

export async function getRecentLogs(req, res) {
  return ok(res, { logs: logService.recent() });
}

export async function clearUiLogs(req, res) {
  logService.clearUi();
  return ok(res, {}, "已清空界面日志");
}

export async function downloadLogs(req, res) {
  return res.download(logService.latestLogPath(), "server-log.log");
}
