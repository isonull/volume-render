param(
  [string]$Platform = "win-x64"
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
& (Join-Path $PSScriptRoot "ensure-venv.ps1") -WithBuild
$VenvPython = Join-Path $Root ".venv\Scripts\python.exe"
$Entry = Join-Path $Root "nninteractive_proxy.py"
$DistPath = Join-Path $Root "dist\$Platform"
$WorkPath = Join-Path $Root "build\pyinstaller"
$SpecPath = Join-Path $Root "build\pyinstaller"

& $VenvPython -m PyInstaller `
  --clean `
  --onefile `
  --name nninteractive-proxy `
  --distpath $DistPath `
  --workpath $WorkPath `
  --specpath $SpecPath `
  --collect-all blosc2 `
  $Entry
if ($LASTEXITCODE -ne 0) {
  throw "PyInstaller failed with exit code $LASTEXITCODE"
}

$ExePath = Join-Path $DistPath "nninteractive-proxy.exe"
if (-not (Test-Path $ExePath)) {
  throw "Expected exe was not created: $ExePath"
}

& $ExePath --help | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Packaged proxy help check failed with exit code $LASTEXITCODE"
}
Write-Output $ExePath
