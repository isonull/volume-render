param(
  [switch]$WithBuild
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$VenvPath = Join-Path $Root ".venv"
$VenvPython = Join-Path $VenvPath "Scripts\python.exe"
$BundledPython = Join-Path $Root "runtime\python\win-x64\python.exe"

function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)]
    [string]$File,
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  & $File @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$File $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function New-ProxyVenv {
  if (Test-Path $BundledPython) {
    Invoke-Native $BundledPython @("-m", "venv", $VenvPath)
    return
  }

  $uv = Get-Command uv -ErrorAction SilentlyContinue
  if ($uv) {
    Invoke-Native $uv.Source @("venv", "--python", "3.11", "--managed-python", "--seed", $VenvPath)
    return
  }

  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) {
    Invoke-Native $py.Source @("-3.11", "-m", "venv", $VenvPath)
    return
  }

  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) {
    Invoke-Native $python.Source @("-m", "venv", $VenvPath)
    return
  }

  throw "No Python bootstrap found. Install uv or place Python at runtime\python\win-x64\python.exe."
}

function Test-PythonImport {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Modules
  )

  $PreviousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    foreach ($Module in $Modules) {
      & $VenvPython -c "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('$Module') is not None else 1)" *> $null
      if ($LASTEXITCODE -ne 0) {
        return $false
      }
    }
    return $true
  } finally {
    $ErrorActionPreference = $PreviousErrorActionPreference
  }
}

function Ensure-Pip {
  if (Test-PythonImport @("pip")) {
    return
  }

  $PreviousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $VenvPython -m ensurepip --upgrade
    $EnsurePipExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $PreviousErrorActionPreference
  }

  if (($EnsurePipExitCode -ne 0) -or -not (Test-PythonImport @("pip"))) {
    $uv = Get-Command uv -ErrorAction SilentlyContinue
    if ($uv) {
      Invoke-Native $uv.Source @("pip", "install", "--python", $VenvPython, "pip")
    }
  }

  if (-not (Test-PythonImport @("pip"))) {
    throw "Proxy venv is missing pip and it could not be bootstrapped with ensurepip or uv."
  }
}

if (-not (Test-Path $VenvPython)) {
  New-ProxyVenv
}

$Requirements = @((Join-Path $Root "requirements.txt"))
if ($WithBuild) {
  $Requirements += (Join-Path $Root "requirements-build.txt")
}

$StampInput = @()
foreach ($Requirement in $Requirements) {
  $hash = Get-FileHash $Requirement -Algorithm SHA256
  $StampInput += "$($hash.Path):$($hash.Hash)"
}
$StampText = $StampInput -join "`n"
$StampName = if ($WithBuild) { "requirements-build.stamp" } else { "requirements.stamp" }
$StampPath = Join-Path $VenvPath $StampName
$ExistingStamp = if (Test-Path $StampPath) { Get-Content $StampPath -Raw } else { "" }
$RequiredModules = @("numpy", "blosc2")
if ($WithBuild) {
  $RequiredModules += "PyInstaller"
}

if (($ExistingStamp -ne $StampText) -or -not (Test-PythonImport $RequiredModules)) {
  Ensure-Pip
  Invoke-Native $VenvPython @("-m", "pip", "install", "--upgrade", "pip")
  foreach ($Requirement in $Requirements) {
    Invoke-Native $VenvPython @("-m", "pip", "install", "-r", $Requirement)
  }
  if (-not (Test-PythonImport $RequiredModules)) {
    throw "Proxy venv is missing one or more required Python modules: $($RequiredModules -join ', ')"
  }
  Set-Content -Path $StampPath -Value $StampText -Encoding ASCII -NoNewline
}
