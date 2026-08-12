[CmdletBinding()]
param(
    [string]$Ref = "main"
)

$ErrorActionPreference = "Stop"
$skillName = "tuzi-image-generation"
$codexHome = if ($env:CODEX_HOME) { [IO.Path]::GetFullPath($env:CODEX_HOME) } else { Join-Path $env:USERPROFILE ".codex" }
$skillsRoot = Join-Path $codexHome "skills"
New-Item -ItemType Directory -Path $skillsRoot -Force | Out-Null

$rootItem = Get-Item -LiteralPath $skillsRoot -Force
if (($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Refusing to install into a reparse-point skills directory."
}

$target = Join-Path $skillsRoot $skillName
if (Test-Path -LiteralPath $target) {
    $targetItem = Get-Item -LiteralPath $target -Force
    if (($targetItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Refusing to replace a reparse-point skill directory."
    }
}

$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("tuzi-image-install-" + [guid]::NewGuid().ToString("N"))
$archive = Join-Path $temporaryRoot "repo.zip"
$expanded = Join-Path $temporaryRoot "repo"
$stage = Join-Path $skillsRoot ("." + $skillName + "-" + [guid]::NewGuid().ToString("N"))
$backup = Join-Path $skillsRoot ("." + $skillName + "-backup-" + [guid]::NewGuid().ToString("N"))

try {
    New-Item -ItemType Directory -Path $temporaryRoot, $expanded | Out-Null
    $archiveUrl = "https://codeload.github.com/AiW520/Tuzi-Image/zip/$Ref"
    Invoke-WebRequest -Uri $archiveUrl -OutFile $archive -UseBasicParsing
    Expand-Archive -LiteralPath $archive -DestinationPath $expanded -Force
    $source = Get-ChildItem -LiteralPath $expanded -Directory | Select-Object -First 1 | ForEach-Object {
        Join-Path $_.FullName "skills\tuzi-image-generation"
    }
    if (-not $source -or -not (Test-Path -LiteralPath (Join-Path $source "SKILL.md"))) {
        throw "Downloaded repository does not contain the expected Skill."
    }
    Copy-Item -LiteralPath $source -Destination $stage -Recurse

    if (Test-Path -LiteralPath $target) {
        Move-Item -LiteralPath $target -Destination $backup
    }
    try {
        Move-Item -LiteralPath $stage -Destination $target
    }
    catch {
        if (Test-Path -LiteralPath $backup) {
            Move-Item -LiteralPath $backup -Destination $target
        }
        throw
    }
    if (Test-Path -LiteralPath $backup) {
        Remove-Item -LiteralPath $backup -Recurse -Force
    }
    Write-Host "Installed $skillName. Fully restart Codex, then ask it to generate an image."
}
finally {
    if (Test-Path -LiteralPath $stage) {
        Remove-Item -LiteralPath $stage -Recurse -Force
    }
    if (Test-Path -LiteralPath $temporaryRoot) {
        Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
    }
}
