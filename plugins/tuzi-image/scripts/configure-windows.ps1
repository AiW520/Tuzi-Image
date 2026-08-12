param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("coding", "api")]
  [string]$Channel
)

$ErrorActionPreference = "Stop"
$userProfile = [Environment]::GetFolderPath("UserProfile")
$configRoot = if ($env:TUZI_IMAGE_CONFIG_DIR) { $env:TUZI_IMAGE_CONFIG_DIR } else { Join-Path $userProfile ".tuzi-image" }
$credentialPath = Join-Path $configRoot "credential-$Channel.dpapi"
$configPath = Join-Path $configRoot "config.json"
New-Item -ItemType Directory -Path $configRoot -Force | Out-Null

$secret = Read-Host "请输入 $Channel 通道 API Key（输入不会显示）" -AsSecureString
if ($secret.Length -eq 0) { throw "API Key 不能为空" }
$encrypted = ConvertFrom-SecureString $secret
[IO.File]::WriteAllText($credentialPath, $encrypted + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))

$acl = Get-Acl -LiteralPath $credentialPath
$acl.SetAccessRuleProtection($true, $false)
$rule = [Security.AccessControl.FileSystemAccessRule]::new(
  [Security.Principal.WindowsIdentity]::GetCurrent().Name,
  [Security.AccessControl.FileSystemRights]::FullControl,
  [Security.AccessControl.AccessControlType]::Allow
)
$acl.SetAccessRule($rule)
Set-Acl -LiteralPath $credentialPath -AclObject $acl

$outputDir = $null
if (Test-Path -LiteralPath $configPath) {
  try { $outputDir = (Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json).outputDir } catch { }
}
$config = [ordered]@{ channel = $Channel; outputDir = $outputDir }
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))

Write-Host "凭据已使用当前 Windows 用户的 DPAPI 加密保存。"
Write-Host "已选择 $Channel 通道。请完全退出并重新打开 Codex。"
