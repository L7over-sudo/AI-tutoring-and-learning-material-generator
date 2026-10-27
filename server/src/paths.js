import path from "node:path";

export const runtimeRoot = path.resolve(process.env.APP_DATA_DIR || process.cwd());
export const dataDir = path.join(runtimeRoot, "data");
export const uploadsRoot = path.join(runtimeRoot, "uploads");
export const logDir = path.join(runtimeRoot, "logs");
