const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLicenseManager, effectiveExpiry, parseAndVerifyCode } = require("../electron/license.cjs");
const { issueLicense, resolvePlan } = require("./license-issuer.cjs");

const projectRoot = path.resolve(__dirname, "..");
const privateKey = fs.readFileSync(path.join(projectRoot, ".license-private", "license-private-key.pem"), "utf8");
const publicKeyPath = path.join(projectRoot, "electron", "license-public-key.pem");
const publicKey = fs.readFileSync(publicKeyPath, "utf8");
const machine = "1234567890ABCDEF12345678";
const otherMachine = "AAAAAAAAAAAAAAAAAAAAAAAA";
const plans = { day: 1, week: 7, fortnight: 14, month: 30, year: 365 };

function codeFor(plan, issuedAt, expiresAt) {
  const payload = {
    v: 1,
    p: "ai-teaching-image",
    id: crypto.randomBytes(6).toString("hex"),
    machine,
    plan,
    issuedAt,
    expiresAt
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const signature = crypto.sign(null, body, privateKey);
  return `AID1.${body.toString("base64url")}.${signature.toString("base64url")}`;
}

const now = Date.now();
for (const [plan, days] of Object.entries(plans)) {
  const code = codeFor(plan, now, now + days * 86400000);
  const result = parseAndVerifyCode(code, publicKey, machine, now + 1000);
  assert.equal(result.payload.plan, plan);
}

const fourteenDayLicense = issueLicense({ plan: "fortnight", now });
const verifiedFourteenDay = parseAndVerifyCode(fourteenDayLicense.code, publicKey, otherMachine, now + 1000);
const firstActivatedAt = now + 5 * 86400000;
assert.equal(verifiedFourteenDay.payload.startMode, "activation");
assert.equal(verifiedFourteenDay.payload.durationDays, 14);
assert.equal(verifiedFourteenDay.payload.expiresAt, null);
assert.equal(effectiveExpiry(verifiedFourteenDay.payload, firstActivatedAt) - firstActivatedAt, 14 * 86400000);
assert.equal(verifiedFourteenDay.payload.machine, "*");
assert.equal(resolvePlan("halfmonth"), "fortnight");

const lifetimeLicense = issueLicense({ plan: "lifetime", now });
const verifiedLifetime = parseAndVerifyCode(lifetimeLicense.code, publicKey, otherMachine, now + 100 * 365 * 86400000);
assert.equal(verifiedLifetime.payload.plan, "lifetime");
assert.equal(verifiedLifetime.payload.expiresAt, null);
assert.equal(lifetimeLicense.expiresAt, null);

assert.throws(
  () => parseAndVerifyCode(codeFor("week", now, now + 7 * 86400000), publicKey, "AAAAAAAAAAAAAAAAAAAAAAAA", now),
  /机器码不匹配/
);
assert.throws(
  () => parseAndVerifyCode(codeFor("day", now - 2 * 86400000, now - 86400000), publicKey, machine, now),
  /已经过期/
);

const validCode = codeFor("month", now, now + 30 * 86400000);
const [codePrefix, encodedPayload, encodedSignature] = validCode.split(".");
const tamperedSignature = Buffer.from(encodedSignature, "base64url");
tamperedSignature[0] ^= 1;
const tampered = `${codePrefix}.${encodedPayload}.${tamperedSignature.toString("base64url")}`;
assert.throws(() => parseAndVerifyCode(tampered, publicKey, machine, now), /签名无效/);

async function testActivationManager() {
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-license-test-"));
  const app = { isPackaged: true, getPath: () => temporaryDir };
  const safeStorage = { isEncryptionAvailable: () => false };
  try {
    const manager = createLicenseManager({ app, safeStorage, publicKeyPath });
    const code = issueLicense({ plan: "week" }).code;
    const beforeActivation = Date.now();
    const first = await manager.activate(code);
    const afterActivation = Date.now();
    assert.equal(first.valid, true);
    assert.equal(first.firstActivation, true);
    assert.ok(Date.parse(first.expiresAt) >= beforeActivation + 7 * 86400000);
    assert.ok(Date.parse(first.expiresAt) <= afterActivation + 7 * 86400000);

    const repeated = await manager.activate(code);
    assert.equal(repeated.firstActivation, false);
    assert.equal(repeated.activatedAt, first.activatedAt);
    assert.equal(repeated.expiresAt, first.expiresAt);
    const restored = await manager.getStatus();
    assert.equal(restored.expiresAt, first.expiresAt);
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}

testActivationManager()
  .then(() => console.log("许可证测试通过：6 种卡型、首次激活计时、同机防重置、通用码跨机器使用、旧码兼容和签名防篡改均正常。"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
