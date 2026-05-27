# ---------------------------------------------------------------------------
# start.ps1 — Windows equivalent of start.sh. Launches the framing stack:
#   1. grove-server.exe (--project) on :3000   handles writes via route.grove
#   2. grove-server.exe (--module)  on :3010   exposes dev console endpoints
#   3. python serve.py              on :8080   static + GET projections + POST proxy
#
# Usage:
#   .\start.ps1                     # all 3 services, persist to framing.sqlite
#   .\start.ps1 -NoBrowser          # don't auto-open the demo
#   .\start.ps1 -NoDb               # in-memory (dev console will be empty)
#   .\start.ps1 -AppPort 3100       # override grove-server (project) port
#   .\start.ps1 -DevPort 3110       # override grove-server (module) port
#   .\start.ps1 -WebPort 8090       # override serve.py port
#
# Ctrl+C stops everything.
# ---------------------------------------------------------------------------
param(
    [int]$AppPort = 3000,
    [int]$DevPort = 3010,
    [int]$WebPort = 8080,
    [switch]$NoDb,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$ScriptDir = $PSScriptRoot
$GroveDir = (Resolve-Path (Join-Path $ScriptDir "..\grove")).Path

$GroveServer = Join-Path $GroveDir "target\release\grove-server.exe"
if (-not (Test-Path $GroveServer)) {
    $GroveServer = Join-Path $GroveDir "target\debug\grove-server.exe"
}
if (-not (Test-Path $GroveServer)) {
    Write-Host "Error: grove-server.exe not found." -ForegroundColor Red
    Write-Host "  Build it: cd $GroveDir; cargo build --release --bin grove-server"
    exit 1
}

$PythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $PythonCmd) { $PythonCmd = Get-Command python3 -ErrorAction SilentlyContinue }
if (-not $PythonCmd) {
    Write-Host "Error: python not found." -ForegroundColor Red
    Write-Host "  Install: winget install Python.Python.3.12"
    exit 1
}
$Python = $PythonCmd.Source

$DbFile = Join-Path $ScriptDir "framing.sqlite"
$LogDir = Join-Path $ScriptDir "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

foreach ($p in @(@{name='app';port=$AppPort}, @{name='dev';port=$DevPort}, @{name='web';port=$WebPort})) {
    $conn = Get-NetTCPConnection -LocalPort $p.port -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        Write-Host "Error: port $($p.port) ($($p.name)) is already in use." -ForegroundColor Red
        Write-Host "  Free it: Get-Process -Id (Get-NetTCPConnection -LocalPort $($p.port) -State Listen).OwningProcess | Stop-Process"
        exit 1
    }
}

if (-not $env:ANTHROPIC_API_KEY) {
    Write-Host "Note: ANTHROPIC_API_KEY not set - /api/order/scan_ticket will return 500."
}
if (-not $env:TWILIO_SID -or -not $env:TWILIO_TOKEN) {
    Write-Host "Note: TWILIO_SID / TWILIO_TOKEN not set - ready-for-pickup SMS disabled."
}

Write-Host "+-----------------------------------------------------+"
Write-Host "|           Framing -- full dev stack                 |"
Write-Host "+-----------------------------------------------------+"
Write-Host ""
Write-Host "  Project        : $ScriptDir"
Write-Host "  Grove          : $GroveDir ($GroveServer)"
if ($NoDb) {
    Write-Host "  Database       : in-memory (records will not persist; dev console empty)"
} else {
    Write-Host "  Database       : $DbFile"
}
Write-Host "  Logs           : $LogDir\{grove-app,grove-dev,serve}.log"
Write-Host ""

$dbArgs = @()
if (-not $NoDb) { $dbArgs = @('--db', $DbFile) }

$processes = @()

try {
    Write-Host "> grove-server (project) -> http://127.0.0.1:$AppPort"
    $p1 = Start-Process -FilePath $GroveServer `
        -ArgumentList (@('--project', $ScriptDir, '--listen', "127.0.0.1:$AppPort") + $dbArgs) `
        -RedirectStandardOutput "$LogDir\grove-app.log" `
        -RedirectStandardError  "$LogDir\grove-app.err.log" `
        -NoNewWindow -PassThru
    $processes += $p1

    Write-Host "> grove-server (dev)     -> http://127.0.0.1:$DevPort"
    $p2 = Start-Process -FilePath $GroveServer `
        -ArgumentList (@('--module', (Join-Path $ScriptDir 'modules\order'), '--listen', "127.0.0.1:$DevPort") + $dbArgs) `
        -RedirectStandardOutput "$LogDir\grove-dev.log" `
        -RedirectStandardError  "$LogDir\grove-dev.err.log" `
        -NoNewWindow -PassThru
    $processes += $p2

    Start-Sleep -Milliseconds 1500

    Write-Host "> serve.py               -> http://127.0.0.1:$WebPort"
    $env:GROVE_SERVER = "http://127.0.0.1:$AppPort"
    $env:DEV_GROVE_SERVER = "http://127.0.0.1:$DevPort"
    # Force Python UTF-8 mode so serve.py's box-drawing banner doesn't crash
    # stdout on Windows (default cp1252 codec can't encode it).
    $env:PYTHONUTF8 = "1"
    $p3 = Start-Process -FilePath $Python `
        -ArgumentList @((Join-Path $ScriptDir 'serve.py'), $WebPort) `
        -RedirectStandardOutput "$LogDir\serve.log" `
        -RedirectStandardError  "$LogDir\serve.err.log" `
        -NoNewWindow -PassThru
    $processes += $p3

    Start-Sleep -Seconds 1

    foreach ($url in @(
        "http://127.0.0.1:$AppPort/",
        "http://127.0.0.1:$DevPort/api/_modules",
        "http://127.0.0.1:$WebPort/healthz"
    )) {
        try {
            $null = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
        } catch {
            Write-Host ""
            Write-Host "Warning: health check failed for $url"
            Write-Host "  Check $LogDir\ for details."
        }
    }

    Write-Host ""
    Write-Host "Ready."
    Write-Host ""
    Write-Host "  Demo         : http://127.0.0.1:$WebPort/"
    Write-Host "  Dev console  : http://127.0.0.1:$WebPort/dev.html"
    Write-Host ""
    Write-Host "Press Ctrl+C to stop."
    Write-Host ""

    if (-not $NoBrowser) {
        Start-Process "http://127.0.0.1:$WebPort/" | Out-Null
        Start-Process "http://127.0.0.1:$WebPort/dev.html" | Out-Null
    }

    Wait-Process -Id ($processes | ForEach-Object { $_.Id })
} finally {
    Write-Host ""
    Write-Host "Stopping services..."
    foreach ($proc in $processes) {
        if ($proc -and -not $proc.HasExited) {
            try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch { }
        }
    }
    Write-Host "Done."
}
