import { readdir, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '..')
const projectPrefix = `${projectRoot}${sep}`

const entries = await readdir(projectRoot, { withFileTypes: true })
const rootTargets = entries.filter((entry) => (
  entry.name.startsWith('.tmp-')
  || entry.name.startsWith('_diag_')
  || entry.name.startsWith('_thumb_')
  || entry.name.endsWith('.log')
  || entry.name === 'logs'
)).map((entry) => resolve(projectRoot, entry.name))

const nestedTargets = [
  resolve(projectRoot, 'server', 'logs'),
  resolve(projectRoot, 'server', 'uploads', '_diag'),
  resolve(projectRoot, 'web', 'dist')
]

for (const parentName of ['server', 'web']) {
  const parentPath = resolve(projectRoot, parentName)
  const children = await readdir(parentPath, { withFileTypes: true })
  nestedTargets.push(...children
    .filter((entry) => entry.isFile() && entry.name.endsWith('.log'))
    .map((entry) => resolve(parentPath, entry.name)))
}

const targets = [...new Set([...rootTargets, ...nestedTargets])]

async function getSize(path) {
  const metadata = await stat(path)
  if (!metadata.isDirectory()) return metadata.size

  const children = await readdir(path)
  const sizes = await Promise.all(children.map((name) => getSize(join(path, name))))
  return sizes.reduce((total, size) => total + size, 0)
}

let deletedBytes = 0

for (const targetPath of targets) {
  if (!targetPath.startsWith(projectPrefix)) {
    throw new Error(`拒绝清理项目根目录之外的路径：${targetPath}`)
  }

  try {
    deletedBytes += await getSize(targetPath)
  } catch (error) {
    if (error.code === 'ENOENT') continue
    throw error
  }
  await rm(targetPath, { recursive: true, force: true })
  console.log(`已清理：${targetPath.slice(projectPrefix.length)}`)
}

console.log(`清理完成，共 ${(deletedBytes / 1024 / 1024).toFixed(2)} MB`)
