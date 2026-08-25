$ErrorActionPreference = "Stop"
$OracleRepoRoot = Split-Path -Parent $PSScriptRoot
$PreviousTestVenv = $env:GENLAYER_TEST_VENV
$env:GENLAYER_TEST_VENV = Join-Path $OracleRepoRoot ".venv"

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)]
    [scriptblock]$Command,
    [Parameter(Mandatory = $true)]
    [string]$FailureMessage
  )

  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw $FailureMessage
  }
}

Push-Location $OracleRepoRoot
try {
  Write-Host "`n[1/3] Verifying the unified Oracle interface"
  Invoke-CheckedCommand { npm install } "Oracle npm install failed."
  Invoke-CheckedCommand { npm run check } "Oracle interface tests or build failed."
  Invoke-CheckedCommand { npm audit --audit-level=high } "Oracle dependency audit failed."

  Write-Host "`n[2/3] Verifying the Evidence contract and component"
  & (Join-Path $OracleRepoRoot "components\evidence\scripts\test.ps1")
  if ($LASTEXITCODE -ne 0) {
    throw "Evidence verification failed."
  }

  Write-Host "`n[3/3] Verifying the Governance contract, registry, and component"
  & (Join-Path $OracleRepoRoot "components\governance\scripts\test.ps1")
  if ($LASTEXITCODE -ne 0) {
    throw "Governance verification failed."
  }

  Write-Host "`nAll Oracle checks passed. No network transactions were created."
} finally {
  Pop-Location
  if ($null -eq $PreviousTestVenv) {
    Remove-Item Env:GENLAYER_TEST_VENV -ErrorAction SilentlyContinue
  } else {
    $env:GENLAYER_TEST_VENV = $PreviousTestVenv
  }
}
