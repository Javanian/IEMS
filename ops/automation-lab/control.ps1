param([ValidateSet('status','stop','stop-n8n','start-n8n')][string]$Action = 'status', [string]$LabRoot = 'D:\IEMS-Automation-Lab\n8n-corrective-acceptance-20261027')
$ErrorActionPreference = 'Stop'
$LabRoot = [IO.Path]::GetFullPath($LabRoot)
if (-not $LabRoot.StartsWith('D:\IEMS-Automation-Lab\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected lab root' }
$statusPath = Join-Path $LabRoot 'status.json'
if (-not (Test-Path -LiteralPath $statusPath)) { throw 'No owned supervisor state. Run start.ps1 first.' }
$state = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
$runtimeScript = Join-Path $PSScriptRoot 'lab-runtime.mjs'
$process = Get-CimInstance Win32_Process -Filter "ProcessId=$($state.supervisorPid)" -ErrorAction SilentlyContinue
if (-not $process -or -not $process.CommandLine.Contains($runtimeScript)) {
  if ($Action -eq 'status') { Write-Output 'Owned supervisor is stopped (stored state is historical).'; exit 0 }
  throw 'Stored PID does not identify the owned supervisor. No process was stopped.'
}
if ($Action -eq 'status') { $state | Select-Object phase,ready,base,webBase,n8nBase,n8nVersion,observedAt | Format-List; exit 0 }
$config = Get-Content -LiteralPath (Join-Path $LabRoot 'config.json') -Raw | ConvertFrom-Json
$id = [guid]::NewGuid().ToString()
$command = @{ marker=$config.marker; supervisorPid=$state.supervisorPid; supervisorRunId=$state.supervisorRunId; id=$id; action=$Action } | ConvertTo-Json
$temp = Join-Path $LabRoot 'control.tmp'
[IO.File]::WriteAllText($temp,$command)
Move-Item -LiteralPath $temp -Destination (Join-Path $LabRoot 'control.json') -Force
$deadline = (Get-Date).AddMinutes(3)
while ((Get-Date) -lt $deadline) {
  try { $latest = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json } catch { Start-Sleep -Milliseconds 500; continue }
  if ($latest.lastControl.id -eq $id) {
    if (-not $latest.lastControl.ok) { throw $latest.lastControl.error }
    if ($Action -eq 'stop') {
      $exitDeadline = (Get-Date).AddSeconds(20)
      do {
        $remaining = Get-CimInstance Win32_Process -Filter "ProcessId=$($state.supervisorPid)" -ErrorAction SilentlyContinue
        if (-not $remaining -or -not $remaining.CommandLine.Contains($runtimeScript)) { break }
        Start-Sleep -Milliseconds 500
      } while ((Get-Date) -lt $exitDeadline)
      if ($remaining -and $remaining.CommandLine.Contains($runtimeScript)) { throw 'Owned services stopped but supervisor has not exited; inspect its log before starting again.' }
    }
    Write-Output "$Action completed; phase $($latest.phase)"; exit 0
  }
  Start-Sleep -Milliseconds 500
}
throw 'Control result unconfirmed. Inspect owned status/logs before another command.'
