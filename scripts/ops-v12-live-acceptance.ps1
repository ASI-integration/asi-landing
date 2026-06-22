#requires -Version 5.1
[CmdletBinding()]
param(
  [ValidateSet('local', 'production')]
  [string]$Target = 'local',

  [string]$Confirm = '',

  [switch]$KeepData
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if ([string]::IsNullOrWhiteSpace($Confirm) -or $Confirm -ne 'RUN_OPS_ACCEPTANCE') {
  Write-Host '[ops-v12-acceptance] SKIPPED: no changes. Use -Confirm RUN_OPS_ACCEPTANCE to run live acceptance.'
  exit 0
}

$env:OPS_ACCEPTANCE_CONFIRM = 'RUN_OPS_ACCEPTANCE'

if ($KeepData) {
  $env:KEEP_OPS_ACCEPTANCE_DATA = '1'
} else {
  Remove-Item Env:KEEP_OPS_ACCEPTANCE_DATA -ErrorAction SilentlyContinue
}

if ($Target -eq 'production') {
  $env:NODE_ENV = 'production'
}

npm run acceptance:ops-v12
$exitCode = $LASTEXITCODE
Write-Host "[ops-v12-acceptance] npm exit code: $exitCode"
exit $exitCode
