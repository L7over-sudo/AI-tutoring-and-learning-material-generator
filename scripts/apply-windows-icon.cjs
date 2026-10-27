const fs = require("node:fs/promises");
const path = require("node:path");

module.exports = async function applyWindowsIcon(context) {
  if (context.electronPlatformName !== "win32") return;

  const projectDir = context.packager.projectDir;
  const executableName = `${context.packager.appInfo.productFilename}.exe`;
  const executablePath = path.join(context.appOutDir, executableName);
  const iconPath = path.join(projectDir, "build", "icon.ico");

  await Promise.all([fs.access(executablePath), fs.access(iconPath)]);

  const { rcedit } = await import("rcedit");
  await rcedit(executablePath, { icon: iconPath });
  console.log(`已写入 Windows 主程序图标：${executableName}`);
};
