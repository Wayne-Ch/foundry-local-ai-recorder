param(
  [Parameter(Mandatory = $true)]
  [string]$RequestPath
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$sourcePath = Join-Path $PSScriptRoot "windows-job-runner.cs"
Add-Type -Path $sourcePath

$request = Get-Content -LiteralPath $RequestPath -Raw | ConvertFrom-Json
$result = [AiRecorder.Probes.WindowsJobRunner]::Run(
  [string]$request.command,
  [string[]]@($request.args),
  [string]$request.cwd,
  [int]$request.timeoutMs,
  [int]$request.descendantExitTimeoutMs,
  [int]$request.pollIntervalMs,
  [int]$request.cleanupTimeoutMs
)

$json = $result | ConvertTo-Json -Compress -Depth 6
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText([string]$request.resultPath, $json, $utf8WithoutBom)
