# 给朋友打包 Mac 版（不签名、不发行）

这份清单用于：只发给朋友用、能装能跑就行、不公开发行的场景。
不需要 Apple Developer 账号（$99/年那 个），不需要签名和公证。

> ⚠️ Mac 安装包不能在 Windows 上打，必须在 macOS 上跑下面的命令。

## 一、把项目弄到 Mac 上

把整个 `ai-teaching-image-web` 文件夹拷到 Mac 上（U盘、网盘、git clone 都行）。
注意：`node_modules` 和 `release` 目录不用拷，Mac 上重新装。

## 二、装依赖

打开「终端」，进入项目目录：

```bash
cd /你/放项目的路径/ai-teaching-image-web
npm run install:all
```

这一步会装根目录、server、web 三处的依赖，第一次比较慢（10~20 分钟）。

## 三、打包

```bash
npm run dist:mac
```

跑完后产物在 `release` 目录，主要发这两个其中一个：

- `AI-Teaching-Image-1.0.6-arm64.dmg` → 朋友是 M1/M2/M3/M4 芯片的 Mac
- `AI-Teaching-Image-1.0.6-x64.dmg` → 朋友是 Intel 芯片的 Mac

不知道朋友是什么芯片？两个都发，让朋友装对的那个。
（查看方法：朋友点左上角苹果菜单 → "关于本机" → 看芯片一栏，写 Apple M系列就是 arm64，写 Intel 就是 x64）

## 四、把 dmg 发给朋友

把对应的 `.dmg` 文件用微信/网盘发给朋友就行。

## 五、朋友安装步骤（告诉朋友照做）

1. 双击 `.dmg`，把里面的 app 图标拖到「Applications」文件夹。
2. 在「启动台」或「应用程序」里找到 app，**第一次打开用右键**：
   - 右键点 app 图标 → 选「打开」
   - 弹出"来自身份不明的开发者"提示 → 再点「打开」
   - 这一步只需要做一次，以后双击就能开
3. 如果右键打开也被拦（macOS 较新版本），用终端跑一句：
   ```bash
   xattr -dr com.apple.quarantine "/Applications/AI自动作图工具.app"
   ```
   然后就能正常双击打开了。

## 常见问题

**Q: 打包时报错 "code signing failed" / 找不到证书？**
A: 不会。已经在 package.json 里关掉了 `forceCodeSigning` 和 `notarize`（设成 false），不签名也能打。

**Q: 朋友打开后闪退或提示"已损坏"？**
A: 通常是 macOS 的隔离标记。让朋友跑第五步方法 3 那条 `xattr` 命令即可。

**Q: 朋友是 Windows 怎么办？**
A: 那不需要这份清单，直接在 Windows 上跑 `npm run dist` 出 exe 安装包给朋友。

**Q: 以后想公开发行、要签名公证了怎么办？**
A: 把 package.json 里 `mac.forceCodeSigning`、`mac.notarize`、`mac.hardenedRuntime` 改回 `true`，准备好 Apple Developer 证书和凭据，再跑 `npm run dist:mac`。详见 `MAC_DISTRIBUTION.md`。
