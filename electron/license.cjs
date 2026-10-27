const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const PRODUCT_ID = "ai-teaching-image";
const CLOCK_ROLLBACK_TOLERANCE_MS = 5 * 60 * 1000;
const PLAN_LABELS = {
  day: "一天卡",
  week: "7天卡",
  halfmonth: "14天卡",
  fortnight: "14天卡",
  month: "月卡",
  year: "年卡",
  lifetime: "永久卡"
};

function base64UrlDecode(value) {
  return Buffer.from(String(value || ""), "base64url");
}

function normalizeMachineCode(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function formatMachineCode(value) {
  return normalizeMachineCode(value).match(/.{1,4}/g)?.join("-") || "";
}

function readMachineIdentity() {
  try {
    if (process.platform === "win32") {
      const output = childProcess.execFileSync("reg.exe", [
        "query",
        "HKLM\\SOFTWARE\\Microsoft\\Cryptography",
        "/v",
        "MachineGuid"
      ], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
      const match = output.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
      if (match?.[1]) return `windows:${match[1].trim()}`;
    }
    if (process.platform === "darwin") {
      const output = childProcess.execFileSync("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      });
      const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/i);
      if (match?.[1]) return `mac:${match[1]}`;
    }
    for (const candidate of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
      if (fs.existsSync(candidate)) return `linux:${fs.readFileSync(candidate, "utf8").trim()}`;
    }
  } catch {
    // Fall through to a stable-enough local identity when the OS identifier is unavailable.
  }
  return `fallback:${process.platform}:${process.arch}:${os.hostname()}:${os.homedir()}`;
}

function createMachineCode() {
  const digest = crypto.createHash("sha256").update(`${PRODUCT_ID}:${readMachineIdentity()}`, "utf8").digest("hex");
  return digest.slice(0, 24).toUpperCase();
}

function parseAndVerifyCode(code, publicKey, expectedMachineCode, now = Date.now()) {
  const normalizedCode = String(code || "").replace(/\s+/g, "");
  const parts = normalizedCode.split(".");
  if (parts.length !== 3 || parts[0] !== "AID1") throw new Error("激活码格式不正确");

  let payload;
  let payloadBuffer;
  try {
    payloadBuffer = base64UrlDecode(parts[1]);
    payload = JSON.parse(payloadBuffer.toString("utf8"));
  } catch {
    throw new Error("激活码内容损坏");
  }

  const signature = base64UrlDecode(parts[2]);
  if (!crypto.verify(null, payloadBuffer, publicKey, signature)) throw new Error("激活码签名无效");
  if (payload?.v !== 1 || payload?.p !== PRODUCT_ID) throw new Error("该激活码不适用于当前软件");
  const isLifetime = payload?.plan === "lifetime";
  const startsOnActivation = payload?.startMode === "activation";
  const expiryIsValid = isLifetime
    ? payload.expiresAt === null
    : (startsOnActivation
      ? payload.expiresAt === null && Number.isFinite(payload.durationDays) && payload.durationDays > 0
      : Number.isFinite(payload.expiresAt));
  if (!PLAN_LABELS[payload.plan] || !Number.isFinite(payload.issuedAt) || !expiryIsValid) {
    throw new Error("激活码授权信息不完整");
  }
  const isPortable = payload.machine === "*";
  if (!isPortable && normalizeMachineCode(payload.machine) !== normalizeMachineCode(expectedMachineCode)) {
    throw new Error("激活码与本机机器码不匹配");
  }
  if (!isLifetime && !startsOnActivation && payload.expiresAt <= payload.issuedAt) throw new Error("激活码有效期无效");
  if (now + CLOCK_ROLLBACK_TOLERANCE_MS < payload.issuedAt) throw new Error("系统时间异常，请校准电脑时间后重试");
  if (!isLifetime && !startsOnActivation && now >= payload.expiresAt) throw new Error("激活码已经过期");

  return { code: normalizedCode, payload, startsOnActivation };
}

function effectiveExpiry(payload, activatedAt) {
  if (payload?.plan === "lifetime") return null;
  if (payload?.startMode !== "activation") return payload?.expiresAt;
  const activationTime = Number(activatedAt);
  if (!Number.isFinite(activationTime)) throw new Error("本机激活时间记录不完整");
  return activationTime + Number(payload.durationDays) * 86400000;
}

function withEffectiveExpiry(payload, activatedAt) {
  return { ...payload, expiresAt: effectiveExpiry(payload, activatedAt) };
}

function publicStatus(machineCode, payload, now, extra = {}) {
  const permanent = payload?.plan === "lifetime";
  const expiresAt = Number.isFinite(payload?.expiresAt) ? payload.expiresAt : 0;
  return {
    valid: Boolean(payload && (permanent || now < expiresAt)),
    plan: payload?.plan || "",
    planLabel: payload ? PLAN_LABELS[payload.plan] || payload.plan : "",
    licenseId: payload?.id || "",
    issuedAt: payload?.issuedAt ? new Date(payload.issuedAt).toISOString() : "",
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : "",
    remainingMs: permanent ? null : (expiresAt ? Math.max(0, expiresAt - now) : 0),
    permanent,
    portable: payload?.machine === "*",
    ...extra
  };
}

function createLicenseManager({ app, safeStorage, publicKeyPath = path.join(__dirname, "license-public-key.pem") }) {
  const machineCode = createMachineCode();
  const licensePath = path.join(app.getPath("userData"), "license.dat");

  function loadPublicKey() {
    try {
      return fs.readFileSync(publicKeyPath, "utf8");
    } catch {
      throw new Error("软件缺少许可证公钥，请联系软件提供方重新安装");
    }
  }

  async function readState() {
    try {
      const stored = await fsp.readFile(licensePath, "utf8");
      if (stored.startsWith("safe:")) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error("系统安全存储暂不可用");
        return JSON.parse(safeStorage.decryptString(Buffer.from(stored.slice(5), "base64")));
      }
      if (stored.startsWith("plain:")) return JSON.parse(Buffer.from(stored.slice(6), "base64").toString("utf8"));
      throw new Error("许可证文件格式不正确");
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async function writeState(state) {
    await fsp.mkdir(path.dirname(licensePath), { recursive: true });
    const serialized = JSON.stringify(state);
    const stored = safeStorage.isEncryptionAvailable()
      ? `safe:${safeStorage.encryptString(serialized).toString("base64")}`
      : `plain:${Buffer.from(serialized, "utf8").toString("base64")}`;
    const temporaryPath = `${licensePath}.tmp`;
    await fsp.writeFile(temporaryPath, stored, { encoding: "utf8", mode: 0o600 });
    await fsp.rename(temporaryPath, licensePath);
  }

  async function getStatus() {
    if (!app.isPackaged && process.env.LICENSE_FORCE !== "1") {
      return publicStatus(machineCode, {
        plan: "development",
        id: "development",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3650 * 86400000
      }, Date.now(), { valid: true, planLabel: "开发模式", development: true });
    }

    const now = Date.now();
    let state;
    try {
      state = await readState();
    } catch (error) {
      return publicStatus(machineCode, null, now, { reason: "corrupt", message: error.message });
    }
    if (!state?.code) return publicStatus(machineCode, null, now, { reason: "missing", message: "请输入激活码后使用" });

    let verified;
    let effectivePayload;
    try {
      verified = parseAndVerifyCode(state.code, loadPublicKey(), machineCode, now);
      effectivePayload = withEffectiveExpiry(verified.payload, state.activatedAt);
      if (effectivePayload.expiresAt && now >= effectivePayload.expiresAt) throw new Error("激活码已经过期");
    } catch (error) {
      return publicStatus(machineCode, null, now, {
        reason: /过期/.test(error.message) ? "expired" : "invalid",
        message: error.message
      });
    }

    if (Number(state.lastSeenAt) > now + CLOCK_ROLLBACK_TOLERANCE_MS) {
      return publicStatus(machineCode, null, now, { reason: "clock", message: "检测到系统时间回拨，请校准电脑时间" });
    }
    if (!state.lastSeenAt || now - Number(state.lastSeenAt) > 5 * 60 * 1000) {
      await writeState({ ...state, lastSeenAt: now });
    }
    return publicStatus(machineCode, effectivePayload, now, {
      message: "许可证有效",
      activatedAt: Number.isFinite(state.activatedAt) ? new Date(state.activatedAt).toISOString() : ""
    });
  }

  async function activate(code) {
    const now = Date.now();
    const verified = parseAndVerifyCode(code, loadPublicKey(), machineCode, now);
    let activatedAt = now;
    let firstActivation = true;
    try {
      const existing = await readState();
      if (existing?.code === verified.code && Number.isFinite(existing.activatedAt)) {
        activatedAt = existing.activatedAt;
        firstActivation = false;
      }
    } catch {
      // A damaged previous state must not prevent activation with a newly supplied valid code.
    }
    const effectivePayload = withEffectiveExpiry(verified.payload, activatedAt);
    if (effectivePayload.expiresAt && now >= effectivePayload.expiresAt) throw new Error("激活码已经过期");
    await writeState({ code: verified.code, activatedAt, lastSeenAt: now });
    return publicStatus(machineCode, effectivePayload, now, {
      message: "激活成功",
      activatedAt: new Date(activatedAt).toISOString(),
      firstActivation
    });
  }

  return { activate, getStatus, machineCode: formatMachineCode(machineCode), licensePath };
}

module.exports = {
  PLAN_LABELS,
  PRODUCT_ID,
  createLicenseManager,
  createMachineCode,
  effectiveExpiry,
  formatMachineCode,
  normalizeMachineCode,
  parseAndVerifyCode
};
