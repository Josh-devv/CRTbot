# Download Dukascopy 1m candle files (bi5) for index CFDs into data/indices/duka-raw.
# Usage: powershell -ExecutionPolicy Bypass -File scratch-fetch-duka.ps1 [-From 2025-10-20] [-To 2026-10-19]
param(
  [string]$From = "2025-10-20",
  [string]$To = "2026-10-19",
  [int]$Retries = 4,
  [int]$DelayMs = 200
)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$symbols = @("USATECHIDXUSD", "USA500IDXUSD")
$root = Join-Path $PSScriptRoot "data\indices\duka-raw"
$start = [DateTime]::ParseExact($From, "yyyy-MM-dd", $null)
$end = [DateTime]::ParseExact($To, "yyyy-MM-dd", $null)
$count = 0
$downloaded = 0
$missing = 0
$skipped = 0
$failed = 0

for ($day = $start; $day -le $end; $day = $day.AddDays(1)) {
  if ($day.DayOfWeek -eq [DayOfWeek]::Saturday) { continue }
  $month = ($day.Month - 1).ToString("00")
  $dayText = $day.Day.ToString("00")
  foreach ($symbol in $symbols) {
    $dir = Join-Path $root "$symbol\$($day.Year)\$month"
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $out = Join-Path $dir "$dayText.bi5"
    $marker = "$out.missing"
    if (Test-Path $out) { $skipped++; continue }

    $url = "https://datafeed.dukascopy.com/datafeed/$symbol/$($day.Year)/$month/$dayText/BID_candles_min_1.bi5"
    $ok = $false
    for ($attempt = 1; $attempt -le $Retries; $attempt++) {
      try {
        Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing -TimeoutSec 30 -Headers @{ "User-Agent" = "Mozilla/5.0" } | Out-Null
        if ((Get-Item $out).Length -eq 0) {
          Remove-Item -LiteralPath $out -Force
          New-Item -ItemType File -Path $marker -Force | Out-Null
          $missing++
        } else {
          $downloaded++
        }
        $ok = $true
        break
      } catch {
        $status = $null
        try { $status = [int]$_.Exception.Response.StatusCode } catch { }
        if ($status -eq 404) {
          New-Item -ItemType File -Path $marker -Force | Out-Null
          $missing++
          $ok = $true
          break
        }
        if (Test-Path $out) { Remove-Item -LiteralPath $out -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Milliseconds (500 * $attempt)
      }
    }
    if (-not $ok) { $failed++; Write-Output "failed: $url" }
    $count++
    if ($count % 50 -eq 0) {
      Write-Output "progress: files=$count downloaded=$downloaded missing=$missing failed=$failed skipped=$skipped"
    }
    Start-Sleep -Milliseconds $DelayMs
  }
}

Write-Output "done: files=$count downloaded=$downloaded missing=$missing (errors=$failed) skipped=$skipped"
