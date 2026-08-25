param(
  [switch]$Integration,
  [ValidateSet("localnet", "studionet", "testnet_asimov", "testnet_bradbury")]
  [string]$Network = "localnet"
)

$ErrorActionPreference = "Stop"
$TestRepoRoot = Split-Path -Parent $PSScriptRoot
$TestVenvDir = if ($env:GENLAYER_TEST_VENV) {
  $env:GENLAYER_TEST_VENV
} else {
  Join-Path $TestRepoRoot ".venv"
}
$TestVenvPython = Join-Path $TestVenvDir "Scripts\python.exe"
$TestArtifactsDir = Join-Path ([System.IO.Path]::GetTempPath()) "livingconstitution-gltest-artifacts"

if (-not (Test-Path -LiteralPath $TestVenvPython)) {
  $TestBundledPython = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
  if (Test-Path -LiteralPath $TestBundledPython) {
    $TestPython = $TestBundledPython
  } else {
    $TestPythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if (-not $TestPythonCommand) {
      throw "Python 3.12 was not found. Install it, then run this script again."
    }
    $TestPython = $TestPythonCommand.Source
  }
  & $TestPython -m venv $TestVenvDir
  if ($LASTEXITCODE -ne 0) { throw "Could not create the Python virtual environment." }
}

Push-Location $TestRepoRoot
try {
  & $TestVenvPython -m pip install --disable-pip-version-check -q -r requirements-dev.txt
  if ($LASTEXITCODE -ne 0) { throw "Python dependency installation failed." }
  & (Join-Path $TestVenvDir "Scripts\genvm-lint.exe") check contracts\living_constitution.py --json
  if ($LASTEXITCODE -ne 0) { throw "GenVM lint failed." }
  if ($Integration) {
    $env:RUN_GENLAYER_INTEGRATION = "1"
    & $TestVenvPython -m pytest -c pytest.ini -v -s -m integration --network $Network --artifacts-dir $TestArtifactsDir
  } else {
    & $TestVenvPython -m pytest -c pytest.ini -q -m "not integration" --artifacts-dir $TestArtifactsDir
  }
  if ($LASTEXITCODE -ne 0) { throw "Contract tests failed." }

  Push-Location (Join-Path $TestRepoRoot "frontend")
  try {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
    npm run check
    if ($LASTEXITCODE -ne 0) { throw "Frontend tests or build failed." }
    npm audit --audit-level=high
    if ($LASTEXITCODE -ne 0) { throw "npm dependency audit failed." }
  } finally {
    Pop-Location
  }
} finally {
  Pop-Location
}
