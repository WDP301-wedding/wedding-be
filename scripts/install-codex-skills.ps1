[CmdletBinding(SupportsShouldProcess = $true)]
param()

$projectRoot = Split-Path -Parent $PSScriptRoot
$skillName = 'wedding-design-system'
$sourcePath = Join-Path $projectRoot ".codex\skills\$skillName"

if (-not (Test-Path -LiteralPath $sourcePath -PathType Container)) {
  throw "Canonical skill directory not found: $sourcePath"
}

$codexHomePath = if ($env:CODEX_HOME) {
  $env:CODEX_HOME
} else {
  Join-Path $env:USERPROFILE '.codex'
}

$skillsPath = Join-Path $codexHomePath 'skills'
$destinationPath = Join-Path $skillsPath $skillName

if ($PSCmdlet.ShouldProcess($destinationPath, "Install $skillName from the repository")) {
  New-Item -ItemType Directory -Force -Path $skillsPath | Out-Null
  New-Item -ItemType Directory -Force -Path $destinationPath | Out-Null
  Copy-Item -Path (Join-Path $sourcePath '*') -Destination $destinationPath -Recurse -Force
  Write-Host "Installed $skillName to $destinationPath"
}
