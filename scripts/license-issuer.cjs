const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const privateDir = path.join(projectRoot, ".license-private");
const privateKeyPath = path.join(privateDir, "license-private-key.pem");
const publicKeyPath = path.join(projectRoot, "electron", "license-public-key.pem");
const productId = "ai-teaching-image";
const plans = {
  day: { days: 1, label: "一天卡" },
  week: { days: 7, label: "7天卡" },
  fortnight: { days: 14, label: "14天卡" },
  month: { days: 30, label: "月卡" },
  year: { days: 365, label: "年卡" },
  lifetime: { days: null, label: "永久卡" }
};
const aliases = {
  "1": "day", "1d": "day", day: "day",
  "7": "week", "7d": "week", week: "week",
  "14": "fortnight", "14d": "fortnight", fortnight: "fortnight", halfmonth: "fortnight",
  "30": "month", "30d": "month", month: "month",
  "365": "year", "365d": "year", year: "year",
  lifetime: "lifetime", permanent: "lifetime", forever: "lifetime"
};

function normalizeMachine(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function formatMachine(value) {
  const normalized = normalizeMachine(value);
  return normalized.match(/.{1,4}/g)?.join("-") || "";
}

function resolvePlan(value) {
  return aliases[String(value || "").trim().toLowerCase()] || "";
}

function initKeys() {
  if (fs.existsSync(privateKeyPath) || fs.existsSync(publicKeyPath)) {
    throw new Error("许可证密钥已经存在。为避免旧激活码失效，本工具不会覆盖现有密钥。");
  }
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
  });
  fs.mkdirSync(privateDir, { recursive: true });
  fs.writeFileSync(privateKeyPath, privateKey, { encoding: "utf8", mode: 0o600 });
  fs.writeFileSync(publicKeyPath, publicKey, "utf8");
  return { privateKeyPath, publicKeyPath };
}

function issueLicense({ plan: requestedPlan, now = Date.now() }) {
  if (!fs.existsSync(privateKeyPath)) throw new Error("未找到许可证私钥，请先运行 npm run license:init");
  const planName = resolvePlan(requestedPlan);
  const plan = plans[planName];
  if (!plan) throw new Error("卡类型无效，可选：day、week、fortnight、month、year、lifetime");

  const issuedAt = Number(now);
  const startsOnActivation = plan.days !== null;
  const payload = {
    v: 1,
    p: productId,
    id: crypto.randomBytes(6).toString("hex"),
    machine: "*",
    plan: planName,
    issuedAt,
    startMode: startsOnActivation ? "activation" : "permanent",
    durationDays: plan.days,
    expiresAt: null
  };
  const payloadBuffer = Buffer.from(JSON.stringify(payload), "utf8");
  const signature = crypto.sign(null, payloadBuffer, fs.readFileSync(privateKeyPath, "utf8"));
  return {
    code: `AID1.${payloadBuffer.toString("base64url")}.${signature.toString("base64url")}`,
    plan: planName,
    planLabel: plan.label,
    days: plan.days,
    startsOnActivation,
    issuedAt: new Date(payload.issuedAt).toISOString(),
    expiresAt: null,
    licenseId: payload.id
  };
}

module.exports = {
  aliases,
  formatMachine,
  initKeys,
  issueLicense,
  normalizeMachine,
  plans,
  privateDir,
  privateKeyPath,
  publicKeyPath,
  resolvePlan
};
