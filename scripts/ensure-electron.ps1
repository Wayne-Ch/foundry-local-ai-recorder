$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$electronRoot = Join-Path $repositoryRoot "node_modules\electron"
$electronExecutable = Join-Path $electronRoot "dist\electron.exe"
$pathFile = Join-Path $electronRoot "path.txt"

if ((Test-Path $electronExecutable) -and (Test-Path $pathFile)) {
  Write-Output "ELECTRON_RUNTIME_OK $electronExecutable"
  exit 0
}

$installScript = Join-Path $electronRoot "install.js"
if (!(Test-Path $installScript)) {
  throw "Electron package is not installed. Run npm install again."
}

& node $installScript
if ((Test-Path $electronExecutable) -and (Test-Path $pathFile)) {
  Write-Output "ELECTRON_RUNTIME_OK $electronExecutable"
  exit 0
}

$electronPackage = Get-Content (Join-Path $electronRoot "package.json") | ConvertFrom-Json
$archiveName = "electron-v$($electronPackage.version)-win32-x64.zip"
$cacheRoot = Join-Path $env:LOCALAPPDATA "electron\Cache"
$archive = Get-ChildItem $cacheRoot -Recurse -Filter $archiveName -ErrorAction SilentlyContinue |
  Sort-Object Length -Descending |
  Select-Object -First 1
if ($null -eq $archive) {
  throw "Electron $($electronPackage.version) archive was not found after install.js completed."
}

Expand-Archive -LiteralPath $archive.FullName -DestinationPath (Join-Path $electronRoot "dist") -Force
Set-Content -Path $pathFile -Value "electron.exe" -NoNewline
if (!(Test-Path $electronExecutable)) {
  throw "Electron runtime extraction did not create $electronExecutable."
}

Write-Output "ELECTRON_RUNTIME_REPAIRED $electronExecutable"
