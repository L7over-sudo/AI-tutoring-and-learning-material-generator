const { initKeys, issueLicense, privateKeyPath, publicKeyPath } = require("./license-issuer.cjs");

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : "";
}

function initialize() {
  const result = initKeys();
  console.log("许可证密钥初始化完成。");
  console.log(`私钥：${result.privateKeyPath}（不要发送给客户、不要放进安装包）`);
  console.log(`公钥：${result.publicKeyPath}（会随客户端安装包发布）`);
}

function generate() {
  const result = issueLicense({ plan: argument("plan") });
  console.log(`卡类型：${result.planLabel}${result.days === null ? "（永久有效）" : `（${result.days} 天）`}`);
  console.log(`到期时间：${result.startsOnActivation ? `客户首次激活后 ${result.days} 天` : "永久有效"}`);
  console.log("激活码：");
  console.log(result.code);
}

function usage() {
  console.log("初始化密钥：npm run license:init");
  console.log("打开网页后台：npm run license:admin");
  console.log("命令行发卡：npm run license:generate -- --plan week");
  console.log("卡类型：day | week | fortnight | month | year | lifetime");
  console.log(`当前私钥位置：${privateKeyPath}`);
  console.log(`客户端公钥位置：${publicKeyPath}`);
}

try {
  const command = process.argv[2];
  if (command === "init") initialize();
  else if (command === "generate") generate();
  else usage();
} catch (error) {
  console.error(`失败：${error.message}`);
  process.exitCode = 1;
}
