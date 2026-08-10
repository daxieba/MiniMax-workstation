$ErrorActionPreference = 'Continue'

$durations = @()
$summary = @()

for ($i = 1; $i -le 5; $i++) {
  Write-Host ("=== Run " + $i + "/5 starting ===") -ForegroundColor Cyan
  $logPath = ".test-run-" + $i + ".log"
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  & pnpm.cmd test *> $logPath
  $sw.Stop()
  $exitCode = $LASTEXITCODE
  $sec = [math]::Round($sw.Elapsed.TotalSeconds, 2)
  $durations += $sec

  $lines = Get-Content $logPath
  $tf = ($lines | Where-Object { $_ -match 'Test Files' } | Select-Object -Last 1)
  $ts = ($lines | Where-Object { $_ -match 'Tests' }      | Select-Object -Last 1)
  $dr = ($lines | Where-Object { $_ -match 'Duration' }   | Select-Object -Last 1)

  $line = "Run " + $i + "/5 exit=" + $exitCode + " duration=" + $sec + "s | TF=" + $tf + " | TS=" + $ts + " | DR=" + $dr
  $summary += $line
  $color = if ($exitCode -eq 0) { 'Green' } else { 'Red' }
  Write-Host $line -ForegroundColor $color
  if ($exitCode -ne 0) { break }
}

Write-Host ""
Write-Host "=== Final Summary ===" -ForegroundColor Cyan
$summary | ForEach-Object { Write-Host $_ }
Write-Host ("Durations (s): " + ($durations -join " / "))
