# Mac 发给别人安装

要让别人正常双击安装并打开，需要在 macOS 上完成签名和 Apple 公证。Windows 只能准备配置，不能生成可发布的 macOS 安装包。

## 需要准备

1. Apple Developer Program 账号。
2. 在 Mac 的“钥匙串访问”里安装 `Developer ID Application` 证书。
3. 用于公证的 Apple 凭据，推荐使用 App Store Connect API Key。

## 打包

在 Mac 上进入项目目录：

```bash
npm run install:all
npm run dist:mac
```

如果使用 App Store Connect API Key，打包前设置：

```bash
export APPLE_API_KEY=/absolute/path/AuthKey_XXXXXXXXXX.p8
export APPLE_API_KEY_ID=XXXXXXXXXX
export APPLE_API_ISSUER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
npm run dist:mac
```

也可以使用 Apple ID 的 app-specific password：

```bash
export APPLE_ID=you@example.com
export APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
npm run dist:mac
```

产物会输出到 `release` 目录，主要发送 `.dmg`：

```txt
release/AI-Teaching-Image-1.0.0-arm64.dmg
release/AI-Teaching-Image-1.0.0-x64.dmg
```

## 发出前验证

在 Mac 上执行：

```bash
spctl --assess --type open --context context:primary-signature --verbose release/AI-Teaching-Image-1.0.0-arm64.dmg
```

看到 `accepted` 后再发给别人。

如果目标用户是 Apple Silicon Mac，优先发 `arm64.dmg`；如果是 Intel Mac，发 `x64.dmg`。
