# Sequential vitest runner (collect FAIL list)
$log = "$env:TEMP\v-sequential.log"
Remove-Item $log -ErrorAction SilentlyContinue
$passed = 0
$failed = 0
$total = 0
$failedList = @()
Get-ChildItem tests -Filter "*.test.*" -Name | Sort-Object | ForEach-Object {
  $f = $_
  $total++
  $p = Start-Process -FilePath ".\node_modules\.bin\vitest.CMD" -ArgumentList "run",$f,"--reporter=basic" -NoNewWindow -PassThru -RedirectStandardOutput "$env:TEMP\v-tmp.out" -RedirectStandardError "$env:TEMP\v-tmp.err"
  $done = $false
  for ($i=0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    if (-not (Get-Process -Id $p.Id -ErrorAction SilentlyContinue)) {
      $done = $true
      break
    }
  }
  if (-not $done) {
    Stop-Process -Id $p.Id -Force
    $failed++
    $failedList += "$f TIMEOUT"
  } else {
    $out = Get-Content "$env:TEMP\v-tmp.out" -Raw
    if ($out -match 'failed\s+\|\s+\d+ failed') {
      $failed++
      $failedList += $f
    } elseif ($out -match '\d+ passed') {
      $passed++
    } else {
      $failedList += "$f UNKNOWN"
    }
  }
}
"PASS=$passed FAIL=$failed TOTAL=$total" | Out-File -FilePath $log -Append
"=== FAILED ===" | Out-File -FilePath $log -Append
$failedList | ForEach-Object { $_ | Out-File -FilePath $log -Append }
