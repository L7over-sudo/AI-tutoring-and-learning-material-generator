# 📚 AI自动作图工具

网页端 AI 教辅批量作图系统，适合小红书教辅内容创作者本地运行，也方便后续部署成在线 SaaS。

项目包含：

- Vue 3 + Vite + Pinia + Element Plus 前端工作台
- Node.js + Express 后端 API
- OpenAI Images API 图像重绘封装
- 按原文档页数固定创建同等数量的 PPT 页面任务（Word 由 Microsoft Word 按实际版式重新分页），中间提示词统一控制风格，逐页预览后导出 PPT（支持 PDF、DOCX、TXT、Markdown）
- 批量任务队列、并发控制、超时重试、停止任务、失败重试
- Sharp 图片差异化增强
- 本地文件存储、JSON 任务持久化、winston 日志
- archiver 一键 ZIP 导出

## 目录结构

```txt
ai-teaching-image-web
├─ package.json
├─ README.md
├─ .env.example
├─ server
│  ├─ package.json
│  ├─ data
│  ├─ logs
│  └─ src
│     ├─ app.js
│     ├─ routes
│     ├─ controllers
│     ├─ services
│     ├─ stores
│     ├─ utils
│     └─ uploads
└─ web
   ├─ package.json
   ├─ index.html
   ├─ vite.config.js
   └─ src
```

## 安装依赖

```bash
cd ai-teaching-image-web
npm run install:all
```

## 配置 API Key

复制环境变量示例：

```bash
cp .env.example .env
```

填写：

```env
OPENAI_API_KEY=你的 OpenAI API Key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_IMAGE_MODEL=gpt-image-2
PORT=3001
```

也可以启动后在页面右上角点击 `⚙️ API 设置` 保存配置。API Key 只保存在后端，前端只显示掩码。

## 启动项目

同时启动前后端：

```bash
npm run dev
```

也可以分别启动：

```bash
npm run dev:server
npm run dev:web
```

访问地址：

- 前端：http://localhost:5173
- 后端：http://localhost:3001

## 桌面版激活码

正式安装包启动时会先校验许可证，支持一天卡、7天卡、14天卡、月卡、年卡和永久卡。新生成的激活码不绑定机器，可在多台电脑使用；永久卡不设置到期时间。开发模式默认跳过激活；需要在开发环境查看激活页时，可设置 `LICENSE_FORCE=1`。

首次初始化发卡密钥：

```bash
npm run license:init
```

按卡型直接生成通用激活码：

```bash
npm run license:generate -- --plan week
```

更方便的方式是双击项目根目录的 `启动激活码后台.cmd`，浏览器会自动打开只允许本机访问的发卡后台。点选卡型，再点击“一键生成激活码”，生成结果会自动复制，并保留最多 1000 条本地发卡记录。记录列表支持关键词搜索、按“激活后计时 / 有效 / 已过期”筛选，以及删除本地记录；删除记录不会使已经发出的离线激活码失效。

命令行方式的 `--plan` 可选 `day`、`week`、`fortnight`、`month`、`year`、`lifetime`；旧参数 `halfmonth` 会兼容映射到 14 天卡。私钥保存在 `.license-private/license-private-key.pem`，该目录已被 Git 忽略且不会进入安装包；必须单独安全备份，私钥遗失后将无法为已经发布的客户端生成新激活码。

新生成的限时卡从客户在电脑上首次成功输入激活码时开始计算有效期；同一台电脑重复输入同一张码不会重置时间。同一个通用码复制到另一台电脑后，那台电脑会独立从首次激活时开始计时；永久卡没有到期时间。旧版已经生成的固定到期码和机器绑定码仍可继续使用。通用离线激活码无法限制使用电脑数量；若需要防重复核销或后台冻结授权，应改用在线授权服务器。

### 飞书激活记录

发卡后台通过 Cloudflare Worker 调用飞书官方多维表格 API。客户首次成功激活后，桌面客户端会自动上报卡号、卡型、首次激活时间、到期时间、软件版本和随机安装编号；不会上传完整激活码，也不使用机器码绑定。上报失败会保存在客户电脑，后续启动时自动重试，不影响本地激活和使用。

中转代码和部署配置位于 `cloudflare/activation-relay`。飞书 App ID、App Secret 和 Worker 上报令牌必须使用 `wrangler secret put` 或 `wrangler secret bulk` 保存，不能写入源码或配置文件。桌面客户端仅保存 Worker 的 `/activation` 地址和上报令牌，配置文件位于 `electron/activation-report-config.json`，已被 Git 忽略，但会由桌面打包规则放入安装包；修改配置后需要重新打包客户安装程序。上报令牌可能被安装包使用者提取，因此 Worker 只拥有“新增记录”权限，切勿把飞书 App Secret 放进客户端。

## 使用流程

1. 点击 `📁 导入图片`，上传多张图片或选择文件夹。
2. 在中间面板调整提示词、尺寸、质量、并发数、超时和重试次数。
3. 点击 `🎨 AI 教辅绘制` 开始批量生成。
4. 在任务列表和右侧预览区检查原图与生成图。
5. 如有失败，点击 `🔁 重试失败项`。
6. 完成后点击 `📦 导出 ZIP`，系统会优先导出增强图，其次导出生成图。

`📄 文档生图` 会在转图后自动跳过纯白或近白的空白页，并显示跳过数量。保留页面沿用原页码和顺序，原始文档不改动；文字、表格、图片和只有页码的页面会保留。检测失败时保留该页，全空白文档不创建生图任务。此规则不影响 `🖼️ 格式转换`。带明显底色或扫描噪声的空页可能被保留，以减少误删。

空白页过滤回归验证：`node scripts/test-blank-pages.mjs`（使用隔离的临时目录，不调用生图 API）。

## 数据与文件

- 原图：`server/src/uploads/original`
- 生成图：`server/src/uploads/generated`
- 增强图：`server/src/uploads/enhanced`
- ZIP：`server/src/uploads/exports`
- 任务记录：`server/data/tasks.json`
- 批次记录：`server/data/batches.json`
- 配置记录：`server/data/config.json`
- 日志：`server/logs/YYYY-MM-DD.log`

## API 列表

- `POST /api/upload/images` 上传图片
- `GET /api/tasks/:batchId` 查询任务
- `POST /api/tasks/generate` 批量生成
- `POST /api/tasks/:batchId/cancel` 停止生成
- `POST /api/tasks/:batchId/retry-failed` 重试失败项
- `GET /api/config` 读取配置
- `POST /api/config` 保存配置
- `POST /api/config/test` 测试连接
- `POST /api/export/zip` 导出 ZIP
- `GET /api/export/download/:batchId` 下载 ZIP
- `POST /api/presentations/tasks` 将文档拆成 PPT 页面任务
- `POST /api/presentations/export/:batchId` 将已完成的页面按顺序导出 PPT
- `GET /api/logs/recent` 读取界面日志
- `GET /api/logs/download` 下载日志文件
- `POST /api/logs/clear-ui` 清空界面日志

## 注意

- 前端不会直接请求 OpenAI，也不会拿到完整 API Key。
- 上传文件会校验图片类型，默认单文件最大 20MB，单批最多 100 张。
- AI 生成内容可能存在文字错误，生成后需要人工复核。
- 图片差异化增强用于轻量画面调整，默认保守，避免影响教辅文字清晰度。
