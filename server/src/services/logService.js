import fs from "node:fs";
import path from "node:path";
import winston from "winston";
import { logDir } from "../paths.js";

fs.mkdirSync(logDir, { recursive: true });

const dateName = () => new Date().toISOString().slice(0, 10);
const safe = (text = "") => String(text).replace(/sk-[A-Za-z0-9_-]+/g, "sk-****");

const levels = { error: 0, warn: 1, success: 2, info: 3 };
const colors = { error: "red", warn: "yellow", success: "green", info: "gray" };
winston.addColors(colors);

const fileTransport = new winston.transports.File({
  filename: path.join(logDir, `${dateName()}.log`),
  level: "info"
});

const logger = winston.createLogger({
  levels,
  format: winston.format.printf(({ level, message, module = "app", timestamp }) => {
    const time = timestamp || new Date().toISOString().replace("T", " ").slice(0, 19);
    return `[${time}] [${level.toUpperCase()}] [${module}] ${safe(message)}`;
  }),
  transports: [fileTransport, new winston.transports.Console()]
});

const uiLogs = [];
const progressUiModules = new Set(["upload", "convert", "batch", "retry", "export"]);
const batchProgressKeywords = [
  "\u5f00\u59cb\u6279\u91cf\u751f\u6210",
  "\u5f00\u59cb\u751f\u6210",
  "\u751f\u6210\u5b8c\u6210",
  "\u751f\u6210\u5931\u8d25",
  "\u6279\u91cf\u751f\u6210\u5b8c\u6210",
  "\u6279\u91cf\u751f\u6210\u7ed3\u675f",
  "\u6279\u91cf\u751f\u6210\u5df2\u505c\u6b62",
  "\u5df2\u53d6\u6d88",
  "\u5df2\u8bf7\u6c42\u505c\u6b62",
  "\u91cd\u65b0\u751f\u6210",
  "\u5df2\u8ffd\u52a0"
];

function shouldShowInUi(module, message) {
  if (!progressUiModules.has(module)) return false;
  if (module === "batch") return batchProgressKeywords.some((keyword) => message.includes(keyword));
  return true;
}

function push(level, module, message) {
  const sanitized = safe(message);
  logger.log({ level, module, message: sanitized, timestamp: new Date().toISOString().replace("T", " ").slice(0, 19) });
  if (!shouldShowInUi(module, sanitized)) return;

  const item = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    time: new Date().toISOString(),
    level: level.toUpperCase(),
    module,
    message: sanitized
  };
  uiLogs.push(item);
  if (uiLogs.length > 500) uiLogs.shift();
}

export const logService = {
  info: (module, message) => push("info", module, message),
  success: (module, message) => push("success", module, message),
  warn: (module, message) => push("warn", module, message),
  error: (module, message) => push("error", module, message),
  recent: () => [...uiLogs].reverse(),
  clearUi: () => {
    uiLogs.length = 0;
  },
  latestLogPath: () => path.join(logDir, `${dateName()}.log`)
};
