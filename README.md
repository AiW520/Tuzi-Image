# Tuzi Image for Codex

不依赖 MCP 的 Codex 生图 Skill，固定使用 `gpt-image-2`。安装后，普通“生成一张图片”请求会优先走 Tuzi，并把图片保存为本地文件。

| 通道 | 默认行为 | 固定接口 |
| --- | --- | --- |
| `coding` | 默认；优先使用显式 `TUZI_CODING_API_KEY`，其次当前进程 `OPENAI_API_KEY`，再读取 `auth.json` 中 `auth_mode=apikey` 的 Key | `https://api.tu-zi.com/coding/images/generations` |
| `api` | 仅在用户明确选择 API 站余额时使用 `TUZI_API_KEY` | `https://api.tu-zi.com/v1/images/generations` |

两个通道完全隔离，失败后不会自动切换，避免误扣另一账户余额。

## 一键安装（推荐）

在 PowerShell 执行：

```powershell
irm https://raw.githubusercontent.com/AiW520/Tuzi-Image/main/install-skill.ps1 | iex
```

该命令也用于更新。安装完成后，完全退出并重新打开 Codex。

希望先审查脚本时：

```powershell
irm https://raw.githubusercontent.com/AiW520/Tuzi-Image/main/install-skill.ps1 -OutFile install-skill.ps1
powershell -ExecutionPolicy Bypass -File .\install-skill.ps1
```

也可以在 Codex 中直接说：

```text
从 GitHub 仓库 AiW520/Tuzi-Image 安装 skills/tuzi-image-generation
```

## 使用

如果当前 Codex 暴露的是可兼容的 API Key，订阅套餐无需再次输入 Key，重启后直接说：

```text
生成一张 1536x1024 的赛博朋克城市夜景，high 质量
```

检查配置不会发起计费请求：

```text
检查 Tuzi 生图是否配置完成
```

默认保存到当前项目的 `outputs/tuzi-image/`。生成请求只发送一次；即使超时也不会自动重试。

注意：如果 Codex 使用 OAuth/订阅会话令牌，Skill 无法安全导出它作为 Tuzi API Key；这时请显式设置 `TUZI_CODING_API_KEY`。Skill 不会猜测或转发内部会话令牌。

## API 站余额

API 站用户需设置一次 `TUZI_API_KEY`。Windows PowerShell 可隐藏输入：

```powershell
$Secret = Read-Host "Tuzi API Key" -AsSecureString
$Plain = [Net.NetworkCredential]::new("", $Secret).Password
[Environment]::SetEnvironmentVariable("TUZI_API_KEY", $Plain, "User")
Remove-Variable Secret, Plain
```

重启 Codex 后说“使用 API 站余额生成图片”。如需长期默认使用 API 站，再设置：

```powershell
[Environment]::SetEnvironmentVariable("TUZI_IMAGE_CHANNEL", "api", "User")
```

恢复套餐默认通道：

```powershell
[Environment]::SetEnvironmentVariable("TUZI_IMAGE_CHANNEL", $null, "User")
```

## 安全与资源限制

- Python 标准库实现，无第三方运行时依赖，不启动 MCP 服务
- 固定模型、端点和单次 `n=1`，禁止跨通道和计费 POST 自动重试
- 图片流式下载，单图最大 `50 MiB`
- 拒绝 HTTP、私网、环回地址和 DNS 重绑定
- 校验 MIME 与 PNG/JPEG/WebP 文件头
- 临时文件排他创建、原子发布，不覆盖同名文件
- 不打印或记录 Key、提示词及完整供应商响应

## 可选 Plugin

仓库仍保留原 MCP Plugin，供需要显式工具注册和有界全局队列的高级场景使用。普通客户只安装上面的 Skill 即可。

## 开发验证

```powershell
npm test
npm run check
```

测试不调用真实计费接口。发布前仍建议分别使用两类测试凭据做一次最小合约测试。
