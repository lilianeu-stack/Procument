# Renews the public Cloudflare tunnel used by emailed response forms.
# Run this after a computer restart or whenever response links stop opening.
# It starts a detached tunnel, updates backend/.env, and restarts the backend.

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$envPath = Join-Path $root 'backend\.env'
$tempDir = Join-Path $env:TEMP 'opencode'
$cloudflared = Join-Path $tempDir 'cloudflared.exe'
$outLog = Join-Path $tempDir 'cloudflared-detached.log'
$errLog = Join-Path $tempDir 'cloudflared-detached.err'

if (-not (Test-Path $tempDir)) { New-Item -ItemType Directory -Path $tempDir | Out-Null }

if (-not (Test-Path $cloudflared)) {
  Write-Host 'Downloading cloudflared...'
  Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $cloudflared
}

$existing = Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" |
  Where-Object { $_.CommandLine -like '*--url*localhost:5173*' }
foreach ($process in $existing) {
  Write-Host "Stopping old tunnel process $($process.ProcessId)..."
  Stop-Process -Id $process.ProcessId -Force
}

Remove-Item $outLog, $errLog -ErrorAction SilentlyContinue
$process = Start-Process -FilePath $cloudflared `
  -ArgumentList @('tunnel', '--url', 'http://localhost:5173', '--no-autoupdate') `
  -WindowStyle Hidden `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -PassThru

Write-Host "Started tunnel process $($process.Id). Waiting for public URL..."
$url = $null
$deadline = (Get-Date).AddSeconds(90)
while (-not $url -and (Get-Date) -lt $deadline) {
  $logs = @()
  foreach ($log in @($outLog, $errLog)) {
    if (Test-Path $log) { $logs += Get-Content $log -ErrorAction SilentlyContinue }
  }
  $url = $logs | Select-String -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' |
    ForEach-Object { $_.Matches[0].Value } | Select-Object -First 1
  if (-not $url) { Start-Sleep -Seconds 1 }
}
if (-not $url) {
  throw "Cloudflare did not publish a public URL. Check $errLog"
}

$lines = Get-Content $envPath
$lines = $lines -replace '^CLIENT_ORIGIN=.*$', "CLIENT_ORIGIN=$url"
$lines = $lines -replace '^APP_BASE_URL=.*$', "APP_BASE_URL=$url"
[System.IO.File]::WriteAllText(
  $envPath,
  (($lines -join [Environment]::NewLine) + [Environment]::NewLine),
  (New-Object System.Text.UTF8Encoding($false))
)

Push-Location $root
try {
  docker compose restart backend
  $null = curl.exe --retry 12 --retry-delay 2 --retry-connrefused --silent http://localhost:4000/api/health
}
finally { Pop-Location }

Write-Host "Public response links now use: $url/response/<token>"
Write-Host 'Backend restarted. Older emailed links must be resent from Response links to get the new URL.'
