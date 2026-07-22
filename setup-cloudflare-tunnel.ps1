param(
  [string]$Hostname = "",
  [string]$TunnelName = "nova-studio",
  [int]$Port = 43219,
  [switch]$ManualDns
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSCommandPath
$cloudflared = Join-Path $root "cloudflared.exe"
$cfDir = Join-Path $env:USERPROFILE ".cloudflared"
$certPath = Join-Path $cfDir "cert.pem"
$configPath = Join-Path $root "cloudflared.yml"
$urlFile = Join-Path $root "server.url"

if (-not (Test-Path $cloudflared)) {
  Write-Host "cloudflared.exe not found in $root" -ForegroundColor Red
  exit 1
}

function Invoke-CloudflaredText([string[]]$Arguments) {
  $prev = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    return (& $cloudflared @Arguments 2>&1 | Out-String)
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Ensure-CloudflareLogin {
  if (Test-Path $certPath) { return }
  Write-Host ""
  Write-Host "Step 1: Cloudflare login" -ForegroundColor Cyan
  Write-Host "Browser will open. Log in and select your domain zone."
  Write-Host ""
  & $cloudflared tunnel login
  if (-not (Test-Path $certPath)) {
    throw "Cloudflare login not completed (cert.pem missing)."
  }
  Write-Host "Login OK." -ForegroundColor Green
}

function Get-OrCreateTunnel([string]$name) {
  $listJson = Invoke-CloudflaredText @("tunnel", "list", "--output", "json")
  if ($listJson) {
    try {
      $tunnels = $listJson | ConvertFrom-Json
      $existing = $tunnels | Where-Object { $_.name -eq $name } | Select-Object -First 1
      if ($existing) {
        Write-Host "Tunnel '$name' already exists (ID: $($existing.id))." -ForegroundColor Yellow
        return $existing.id
      }
    } catch {}
  }

  Write-Host ""
  Write-Host "Step 2: Creating tunnel '$name'..." -ForegroundColor Cyan
  $out = Invoke-CloudflaredText @("tunnel", "create", $name)
  Write-Host $out
  if ($out -match '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})') {
    return $Matches[1]
  }
  $info = Invoke-CloudflaredText @("tunnel", "info", $name, "--output", "json")
  if ($info) {
    try {
      $obj = $info | ConvertFrom-Json
      if ($obj.id) { return $obj.id }
    } catch {}
  }
  throw "Could not get tunnel ID for '$name'."
}

function Find-CredentialsFile([string]$tunnelId) {
  $byId = Join-Path $cfDir "$tunnelId.json"
  if (Test-Path $byId) { return $byId }
  $jsonFiles = Get-ChildItem -Path $cfDir -Filter "*.json" -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne "config.json" } |
    Sort-Object LastWriteTime -Descending
  if ($jsonFiles) { return $jsonFiles[0].FullName }
  throw "Credentials file not found in $cfDir"
}

function Write-TunnelConfig([string]$tunnelId, [string]$credFile, [string]$tunnelHost, [int]$port) {
  $credEsc = $credFile -replace '\\', '/'
  $yaml = @"
tunnel: $tunnelId
credentials-file: $credEsc

ingress:
  - hostname: $tunnelHost
    service: http://localhost:$port
  - service: http_status:404
"@
  Set-Content -Path $configPath -Value $yaml -Encoding UTF8
  $publicUrl = "https://$tunnelHost"
  Set-Content -Path $urlFile -Value $publicUrl -Encoding UTF8
  Write-Host ""
  Write-Host "Config written: $configPath" -ForegroundColor Green
  Write-Host "Public URL: $publicUrl" -ForegroundColor Yellow
}

function Restart-Tunnel {
  Get-Process -Name cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  $p = Start-Process -FilePath $cloudflared -ArgumentList @("tunnel", "--config", $configPath, "run") `
    -WorkingDirectory $root -WindowStyle Hidden -PassThru
  Write-Host "cloudflared started (PID $($p.Id))." -ForegroundColor Green
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Cloudflare Tunnel - permanent domain" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

Ensure-CloudflareLogin

if ([string]::IsNullOrWhiteSpace($Hostname)) {
  Write-Host ""
  Write-Host "Enter subdomain for your Cloudflare domain." -ForegroundColor Cyan
  Write-Host "Example: nova.example.com or app.mysite.ru"
  $Hostname = Read-Host "Hostname"
}

$Hostname = $Hostname.Trim().ToLower()
if ($Hostname -notmatch '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$') {
  throw "Invalid hostname: $Hostname"
}

$tunnelId = Get-OrCreateTunnel $TunnelName

$credFile = Find-CredentialsFile $tunnelId
Write-TunnelConfig $tunnelId $credFile $Hostname $Port
Restart-Tunnel

$cnameTarget = "$tunnelId.cfargotunnel.com"
$subName = $Hostname.Split('.')[0]

if ($ManualDns) {
  Write-Host ""
  Write-Host "========================================" -ForegroundColor Yellow
  Write-Host "  DNS at nic.ru (NS change NOT needed)" -ForegroundColor Yellow
  Write-Host "========================================" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "Add ONE record in nic.ru DNS for novastudio.ru:"
  Write-Host ""
  Write-Host "  Type:    CNAME" -ForegroundColor Cyan
  Write-Host "  Name:    $subName" -ForegroundColor Cyan
  Write-Host "  Target:  $cnameTarget" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "Link: https://www.nic.ru/manager/domains.cgi"
  Write-Host ""
  try { $cnameTarget | Set-Clipboard } catch {}
  Write-Host "CNAME target copied to clipboard." -ForegroundColor Gray
} else {
  Write-Host ""
  Write-Host "Step 3: DNS route $Hostname -> tunnel..." -ForegroundColor Cyan
  & $cloudflared tunnel route dns $TunnelName $Hostname
  Write-Host "DNS route OK." -ForegroundColor Green
}

Write-Host ""
$siteUrl = 'https://' + $Hostname + '/nova/'
Write-Host ('Done! Site: ' + $siteUrl) -ForegroundColor Green
Write-Host 'URL saved to server.url' -ForegroundColor Gray
try { Set-Clipboard -Value ('https://' + $Hostname) } catch {}
