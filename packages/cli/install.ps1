# tppv CLI — one-line installer (Windows 11 / PowerShell 5+)
#
#   irm https://tppv.dev/cli/install.ps1 | iex
#
$ErrorActionPreference = "Stop"

function Need-Command($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    Write-Error "$name is required. Install Node.js 18+ from https://nodejs.org"
  }
}

Need-Command node
Need-Command npm

$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 18) {
  Write-Error "Node.js 18+ required (found $(node -v))"
}

Write-Host "-> Installing @tppv-dev/cli"
npm install -g @tppv-dev/cli
if ($LASTEXITCODE -ne 0) {
  Write-Error "npm install -g @tppv-dev/cli failed"
}

Write-Host ""
Write-Host "tppv installed"
Write-Host "  Run:  tppv"
Write-Host "  Help: tppv --help"
Write-Host "  Site: https://tppv.dev"
Write-Host ""
