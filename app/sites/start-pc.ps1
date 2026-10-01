param([string]$EnvFile = $env:ENSEMBLE_ENV_FILE)
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path $PSScriptRoot -Parent
$runtimeDir = Join-Path $appRoot 'data/sites'
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$tokenFile = Join-Path $runtimeDir 'gateway.json'
if (!(Test-Path -LiteralPath $tokenFile)) {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $rng.Dispose()
  @{ token = [Convert]::ToBase64String($bytes) } | ConvertTo-Json | Set-Content -LiteralPath $tokenFile -Encoding utf8
}
$nodeExe = (Get-Command node).Source
if (!(Get-NetTCPConnection -LocalPort 3410 -State Listen -ErrorAction SilentlyContinue)) {
  if (!$EnvFile -or !(Test-Path -LiteralPath $EnvFile)) { throw 'Pass -EnvFile with the existing Ensemble environment file path.' }
  $env:ENSEMBLE_ENV_FILE = $EnvFile
  $env:ENSEMBLE_AGENT_RUNTIME = 'codex'
  $env:ENSEMBLE_DATA_DIR = Join-Path $appRoot 'data/local-test'
  Start-Process -FilePath $nodeExe -ArgumentList @('"' + (Join-Path $appRoot 'node_modules/next/dist/bin/next') + '"', 'dev', '--hostname', '127.0.0.1', '--port', '3410') -WorkingDirectory (Join-Path $appRoot 'apps/web') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDir 'server.out.log') -RedirectStandardError (Join-Path $runtimeDir 'server.err.log') | Out-Null
}
if (!(Get-NetTCPConnection -LocalPort 3411 -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process -FilePath $nodeExe -ArgumentList @('"' + (Join-Path $PSScriptRoot 'gateway.mjs') + '"', '"' + $tokenFile + '"') -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDir 'gateway.out.log') -RedirectStandardError (Join-Path $runtimeDir 'gateway.err.log') | Out-Null
}
$tunnelExe = Join-Path $runtimeDir 'bin/cloudflared-windows-amd64.exe'
if (!(Test-Path -LiteralPath $tunnelExe)) { throw 'Download the official cloudflared Windows executable into data/sites/bin first.' }
$pidFile = Join-Path $runtimeDir 'tunnel.pid'
if (Test-Path -LiteralPath $pidFile) {
  $old = Get-Process -Id ([int](Get-Content -LiteralPath $pidFile)) -ErrorAction SilentlyContinue
  if ($old -and $old.Path -eq $tunnelExe) { Write-Output 'Existing tunnel remains active. Its URL is in data/sites/tunnel.err.log.'; exit }
}
$tunnel = Start-Process -FilePath $tunnelExe -ArgumentList @('tunnel', '--url', 'http://127.0.0.1:3411', '--no-autoupdate') -WorkingDirectory $runtimeDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir 'tunnel.out.log') -RedirectStandardError (Join-Path $runtimeDir 'tunnel.err.log')
$tunnel.Id | Set-Content -LiteralPath $pidFile
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  Start-Sleep -Seconds 1
  if ($tunnel.HasExited) { throw 'Tunnel failed to start. Check data/sites/tunnel.err.log; do not bypass network access policy.' }
  $log = Get-Content -LiteralPath (Join-Path $runtimeDir 'tunnel.err.log') -Raw -ErrorAction SilentlyContinue
  if ($log -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
    Write-Output ('Tunnel URL: ' + $matches[0])
    Write-Output 'Update ENSEMBLE_BACKEND_URL in Sites and redeploy. Keep these processes running.'
    exit
  }
}
throw 'Tunnel startup has not been confirmed. Inspect data/sites/tunnel.err.log before deployment.'
