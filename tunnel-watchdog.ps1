$ErrorActionPreference = "SilentlyContinue"

$root = Split-Path -Parent $PSCommandPath
$cloudflaredExe = Join-Path $root "cloudflared.exe"
$logFile = Join-Path $root ".tunnel-watchdog.txt"
$cloudflaredLog = Join-Path $root ".cloudflared.log"
$pidFile = Join-Path $root ".cloudflared.pid"
$urlFile = Join-Path $root "server.url"
$LOCAL_URL = "http://localhost:43219/nova/"
$configFile = Join-Path $root "cloudflared.yml"
$PUBLIC_HEALTH_PATH = "/api/public-status"
$CHECK_INTERVAL_SECONDS = 20
$PUBLIC_FAILURE_THRESHOLD = 3
$PUBLIC_RESTART_GRACE_SECONDS = 60

function Get-ConfiguredTunnelUrl {
  if (-not (Test-Path $configFile)) { return $null }
  try {
    $text = Get-Content $configFile -Raw -Encoding UTF8
    if ($text -match '(?m)^\s*-\s*hostname:\s*(\S+)') {
      return "https://$($Matches[1].Trim())"
    }
  } catch {}
  return $null
}

function Add-WatchdogLog([string]$message) {
  try {
    Add-Content $logFile "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $message" -Encoding UTF8
  } catch {}
}

function Test-LocalServer {
  try {
    $res = Invoke-WebRequest -Uri $LOCAL_URL -UseBasicParsing -TimeoutSec 4 -ErrorAction Stop
    return ($res.StatusCode -ge 200 -and $res.StatusCode -lt 500)
  } catch {
    return $false
  }
}

function Get-TunnelUrlFromMetrics {
  $configured = Get-ConfiguredTunnelUrl
  if ($configured) { return $configured }
  try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:20241/metrics" -UseBasicParsing -TimeoutSec 4 -ErrorAction Stop
    if ($resp.Content -match 'userHostname="(https?://[^"]+)"') {
      return $Matches[1]
    }
  } catch {}
  return $null
}

function Save-TunnelUrl([string]$url) {
  if ([string]::IsNullOrWhiteSpace($url)) { return }
  try {
    Set-Content -Path $urlFile -Value $url.Trim() -Encoding UTF8
  } catch {}
}

function Test-PublicTunnelUrl([string]$url) {
  if ([string]::IsNullOrWhiteSpace($url)) { return $false }
  # Probe a tiny JSON endpoint instead of the full app page to avoid false negatives.
  $probeUrl = $url.TrimEnd('/') + $PUBLIC_HEALTH_PATH
  try {
    $res = Invoke-WebRequest -Uri $probeUrl -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    return ($res.StatusCode -ge 200 -and $res.StatusCode -lt 500)
  } catch {
    return $false
  }
}

function Test-IsQuickTunnel([string]$url) {
  if ([string]::IsNullOrWhiteSpace($url)) { return $false }
  return $url -match 'trycloudflare\.com'
}

function Start-CloudflaredTunnel {
  Get-Process -Name cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 1500

  if (-not (Test-Path $cloudflaredExe)) {
    Add-WatchdogLog "cloudflared.exe not found"
    return $null
  }

  if (Test-Path $configFile) {
    $args = @("tunnel", "--config", $configFile, "run")
  } else {
    $args = @(
      "tunnel", "--url", "http://localhost:43219",
      "--metrics", "localhost:20241",
      "--logfile", $cloudflaredLog,
      "--loglevel", "info"
    )
  }

  $p = Start-Process -FilePath $cloudflaredExe -ArgumentList $args -WorkingDirectory $root -WindowStyle Hidden -PassThru
  try { Set-Content -Path $pidFile -Value $p.Id -Encoding ASCII } catch {}

  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    $url = Get-TunnelUrlFromMetrics
    if ($url) {
      Save-TunnelUrl $url
      return $url
    }
  }
  return $null
}

Write-Host "[tunnel-watchdog] Started. Watching Cloudflare Tunnel..."
Add-WatchdogLog "watchdog started"

$publicFailureCount = 0
$lastRestartAt = Get-Date

while ($true) {
  Start-Sleep -Seconds $CHECK_INTERVAL_SECONDS

  if (-not (Test-LocalServer)) {
    Write-Host "[tunnel-watchdog] local server unavailable, waiting..."
    Add-WatchdogLog "local server unavailable"
    $publicFailureCount = 0
    continue
  }

  $running = Get-Process -Name cloudflared -ErrorAction SilentlyContinue
  $url = Get-TunnelUrlFromMetrics

  if ($null -eq $running) {
    Write-Host "[tunnel-watchdog] tunnel down, restarting..."
    Add-WatchdogLog "cloudflared process missing, restarting"
    $url = Start-CloudflaredTunnel
    $lastRestartAt = Get-Date
    $publicFailureCount = 0
    if ($url) {
      Write-Host "[tunnel-watchdog] tunnel up: $url"
      Add-WatchdogLog "tunnel up: $url"
    } else {
      Write-Host "[tunnel-watchdog] failed to start tunnel"
      Add-WatchdogLog "failed to start tunnel"
    }
    continue
  }

  if (-not $url) {
    Add-WatchdogLog "tunnel URL missing from metrics, keeping current process"
    continue
  }

  Save-TunnelUrl $url

  $secondsSinceRestart = ((Get-Date) - $lastRestartAt).TotalSeconds
  if ($secondsSinceRestart -lt $PUBLIC_RESTART_GRACE_SECONDS) {
    continue
  }

  if (Test-IsQuickTunnel $url) {
    # Quick tunnels often fail DNS/HTTP checks briefly after creation.
    # Restarting them creates a new hostname and usually makes stability worse.
    continue
  }

  if (Test-PublicTunnelUrl $url) {
    if ($publicFailureCount -gt 0) {
      Add-WatchdogLog "public tunnel recovered: $url"
    }
    $publicFailureCount = 0
    continue
  }

  $publicFailureCount++
  Add-WatchdogLog "public tunnel check failed ($publicFailureCount/$PUBLIC_FAILURE_THRESHOLD): $url"
  if ($publicFailureCount -lt $PUBLIC_FAILURE_THRESHOLD) {
    continue
  }

  Write-Host "[tunnel-watchdog] tunnel unhealthy, restarting..."
  Add-WatchdogLog "public tunnel unhealthy after threshold, restarting"
  $url = Start-CloudflaredTunnel
  $lastRestartAt = Get-Date
  $publicFailureCount = 0
  if ($url) {
    Write-Host "[tunnel-watchdog] tunnel up: $url"
    Add-WatchdogLog "tunnel up: $url"
  } else {
    Write-Host "[tunnel-watchdog] failed to start tunnel"
    Add-WatchdogLog "failed to start tunnel"
  }
}
