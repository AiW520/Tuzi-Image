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

$secret = Read-Host "Enter the $Channel channel API Key (input is hidden)" -AsSecureString
if ($secret.Length -eq 0) { throw "API Key cannot be empty" }
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

Write-Host "The credential was encrypted with DPAPI for the current Windows user."
Write-Host "Channel '$Channel' is selected. Fully exit and reopen Codex."
