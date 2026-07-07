$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
& (Join-Path $PSScriptRoot "ensure-venv.ps1")
$VenvPython = Join-Path $Root ".venv\Scripts\python.exe"
$ProxyScript = Join-Path $Root "nninteractive_proxy.py"

& $VenvPython $ProxyScript @args
