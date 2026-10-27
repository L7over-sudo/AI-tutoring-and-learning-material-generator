import { readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import packageJson from '../package.json' with { type: 'json' }

const scriptDir = dirname(fileURLToPath(import.meta.url))
const releaseDir = join(scriptDir, '..', 'release')
const currentInstaller = `AI-Teaching-Image-Setup-${packageJson.version}.exe`
const currentBlockmap = `${currentInstaller}.blockmap`
const installerPattern = /^AI-Teaching-Image-Setup-.+\.exe(?:\.blockmap)?$/

const entries = await readdir(releaseDir, { withFileTypes: true })
const obsoleteFiles = entries
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter((name) => installerPattern.test(name))
  .filter((name) => name !== currentInstaller && name !== currentBlockmap)

for (const name of obsoleteFiles) {
  await rm(join(releaseDir, name))
  console.log(`已删除旧安装包文件：${name}`)
}

if (obsoleteFiles.length === 0) {
  console.log('没有需要删除的旧安装包文件')
}

for (const generatedPath of ['win-unpacked', 'builder-debug.yml']) {
  await rm(join(releaseDir, generatedPath), { recursive: true, force: true })
  console.log(`已清理安装包临时产物：${generatedPath}`)
}

await rm(join(scriptDir, '..', 'web', 'dist'), { recursive: true, force: true })
console.log('已清理前端打包临时目录：web/dist')
