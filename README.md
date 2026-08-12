# Tuzi Image for Codex

用于 Codex 的本地图片生成 Plugin。模型固定为 `gpt-image-2`，支持两套互相隔离的计费通道：

| 通道 | 用途 | 固定接口 |
| --- | --- | --- |
| `coding` | Codex 订阅套餐 | `https://api.tu-zi.com/coding/images/generations` |
| `api` | API 站余额 | `https://api.tu-zi.com/v1/images/generations` |

Plugin 不会自动跨通道切换，避免未经确认消耗另一账户余额。

## 环境要求

- Codex CLI `0.146.0` 或更高版本
- Node.js `20` 或更高版本
- 对应通道的 Tuzi API Key

## 从 GitHub 安装

```powershell
codex plugin marketplace add <GitHub用户名>/<仓库名> --ref main
codex plugin add tuzi-image@tuzi
```

安装后完全退出并重新打开 Codex，再新建任务。

本地开发安装：

```powershell
codex plugin marketplace add .
codex plugin add tuzi-image@tuzi
```

## Windows 安全配置

脚本会隐藏输入，并使用当前 Windows 用户的 DPAPI 加密 Key。先让 PowerShell 找到已安装的 Plugin：

脚本提示使用英文，以兼容 Windows PowerShell 5.1 的默认脚本编码，避免中文显示乱码。

```powershell
$TuziPlugin = (codex plugin list --json | ConvertFrom-Json).installed | Where-Object pluginId -eq "tuzi-image@tuzi" | Select-Object -First 1
```

Codex 订阅套餐：

```powershell
& "$($TuziPlugin.source.path)\scripts\configure-windows.ps1" -Channel coding
```

API 站余额：

```powershell
& "$($TuziPlugin.source.path)\scripts\configure-windows.ps1" -Channel api
```

完全退出并重新打开 Codex。MCP 启动时只解密并读取一次所选通道的 Key。

## macOS / Linux 配置

Codex 订阅套餐：设置 `TUZI_CODING_API_KEY`，并将 `TUZI_IMAGE_CHANNEL` 设为 `coding`。

API 站余额：设置 `TUZI_API_KEY`，并将 `TUZI_IMAGE_CHANNEL` 设为 `api`。

环境变量需要对启动 Codex 的进程可见。不要把 Key 发到聊天、写进项目配置或提交到 Git。

Windows 也支持同样的环境变量，且环境变量优先于 DPAPI 凭据。

## 使用

```text
使用 Tuzi Image 生成一张 1536x1024 的赛博朋克城市夜景，high 质量
```

```text
检查 Tuzi Image 是否配置完成
```

默认保存到当前项目的 `outputs/tuzi-image/`。可以在生成请求中指定输出目录和文件名；为防止误覆盖，同名文件已存在时会报错。

## 设计与安全

- 生成 POST 只请求一次，超时也不自动重试，避免重复计费
- 仅图片 GET 下载允许有限重试
- 下载使用流式写入，默认单图最大 `50 MiB`
- 拒绝 HTTP、私网、环回、云元数据地址和 DNS 重绑定
- 校验 `Content-Type` 与 PNG/JPEG/WebP 文件头
- UUID 临时文件、排他创建、原子发布，不覆盖现有文件
- 全局最多同时生成 2 张，最多排队 16 个请求
- 两通道凭据分槽，不记录 Key、提示词或完整供应商响应

## 可选环境变量

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `TUZI_IMAGE_CHANNEL` | `coding` 或 `api` | 本地配置 |
| `TUZI_CODING_API_KEY` | Codex 套餐 Key | Windows DPAPI 凭据 |
| `TUZI_API_KEY` | API 站 Key | Windows DPAPI 凭据 |
| `TUZI_IMAGE_OUTPUT_DIR` | 默认输出目录 | `outputs/tuzi-image` |
| `TUZI_IMAGE_TIMEOUT_MS` | 请求超时 | `180000` |
| `TUZI_IMAGE_MAX_BYTES` | 单图最大字节数 | `52428800` |

## 开发验证

```powershell
npm test
npm run check
```

运行时零第三方 npm 依赖。尚未包含真实计费接口测试；发布者应分别使用两类测试 Key 做一次最小合约测试。

## 为什么不直接修改官方 imagegen Skill

官方 Skill 的普通路径调用 Codex 内置 `image_gen`，其目标服务由 Codex 托管，不能改为第三方 `base_url`。备用 CLI 又固定检查 `OPENAI_API_KEY`，并通过 OpenAI SDK 请求；它还会检查 Python/SDK/环境，在部分批处理路径对瞬时生成错误自动重试。修改系统 Skill 会在 Codex 升级时被覆盖。

这个 Plugin 用独立 MCP 工具解决上述边界：固定 Tuzi 两个接口和 `gpt-image-2`，启动时只读一次凭据，并对计费 POST 禁止自动重试。它不会修改或绕过 Codex/OpenAI 的服务端权限，只是为用户自有的 Tuzi 凭据提供独立客户端。
