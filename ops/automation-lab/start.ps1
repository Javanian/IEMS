param([string]$LabRoot = 'D:\IEMS-Automation-Lab\n8n-corrective-acceptance-20261027')
$ErrorActionPreference = 'Stop'
$nodeMajor = & node -p "process.versions.node.split('.')[0]"
if ($LASTEXITCODE -ne 0 -or $nodeMajor -ne '24') { throw 'IEMS requires Node 24.x. Install Node 24 before starting this lab.' }
$LabRoot = [IO.Path]::GetFullPath($LabRoot)
if (-not $LabRoot.StartsWith('D:\IEMS-Automation-Lab\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Lab root must be an explicit child of D:\IEMS-Automation-Lab' }
$env:IEMS_AUTOMATION_LAB_ROOT = $LabRoot
$runtimeScript = Join-Path $PSScriptRoot 'lab-runtime.mjs'
$statusPath = Join-Path $LabRoot 'status.json'
if (Test-Path -LiteralPath $statusPath) {
  $state = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
  $existing = Get-CimInstance Win32_Process -Filter "ProcessId=$($state.supervisorPid)" -ErrorAction SilentlyContinue
  if ($existing -and $existing.CommandLine.Contains($runtimeScript)) {
    if ($state.ready) { Write-Output "Owned lab already ready: $($state.webBase)/portfolio/service/automation"; exit 0 }
    throw "Owned supervisor is already running, phase $($state.phase). Inspect status/logs; do not launch a duplicate."
  }
}
$memory = (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024
if ($memory -lt 3584) { throw "Resource guard: need 3584 MiB free before starting lab; available $([int]$memory) MiB. No user process was stopped." }
New-Item -ItemType Directory -Force -Path $LabRoot,(Join-Path $LabRoot 'runtime'),(Join-Path $LabRoot 'logs') | Out-Null
$runtimePackage = Join-Path $LabRoot 'runtime\node_modules\n8n\package.json'
$installMarker = Join-Path $LabRoot 'runtime\iems-install-complete.json'
if (-not (Test-Path -LiteralPath $runtimePackage) -or -not (Test-Path -LiteralPath $installMarker)) {
  $installing = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'npm' -and $_.CommandLine.Contains((Join-Path $LabRoot 'runtime')) }
  if ($installing) { throw 'An npm install for this owned runtime is already running. Inspect its log and wait; do not start a duplicate.' }
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'runtime-package.json') -Destination (Join-Path $LabRoot 'runtime\package.json')
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'runtime-package-lock.json') -Destination (Join-Path $LabRoot 'runtime\package-lock.json')
  & npm ci --prefix (Join-Path $LabRoot 'runtime') --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) { throw 'Pinned n8n install failed; inspect npm output. Existing lab data retained.' }
  @{ version='1.121.3'; lockHash=(Get-FileHash -LiteralPath (Join-Path $LabRoot 'runtime\package-lock.json') -Algorithm SHA256).Hash; completedAt=[DateTime]::UtcNow.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $installMarker
}
$installed = Get-Content -LiteralPath $runtimePackage -Raw | ConvertFrom-Json
if ($installed.version -ne '1.121.3') { throw "Expected n8n1.121.3, found $($installed.version)" }
$node = (Get-Command node -ErrorAction Stop).Source
$version = & $node (Join-Path $LabRoot 'runtime\node_modules\n8n\bin\n8n') --version
if ($LASTEXITCODE -ne 0 -or $version -ne '1.121.3') { throw 'Installed n8n is incomplete. Run npm ci in the owned runtime folder, then retry.' }
$process = Start-Process -FilePath $node -ArgumentList @('"'+$runtimeScript+'"') -WorkingDirectory (Split-Path (Split-Path $PSScriptRoot)) -RedirectStandardOutput (Join-Path $LabRoot 'logs\supervisor.out.log') -RedirectStandardError (Join-Path $LabRoot 'logs\supervisor.err.log') -WindowStyle Hidden -PassThru
$deadline = (Get-Date).AddMinutes(8)
while ((Get-Date) -lt $deadline) {
  if ($process.HasExited) { throw "Lab startup exited. Inspect $LabRoot\logs\supervisor.*.log" }
  if (Test-Path -LiteralPath $statusPath) {
    try { $state = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json } catch { Start-Sleep -Milliseconds 500; continue }
    if ($state.supervisorPid -eq $process.Id -and $state.ready) { Write-Output "Ready: $($state.webBase)/portfolio/service/automation"; Write-Output "n8n: $($state.n8nBase). Private synthetic sign-in: $LabRoot\config.json"; exit 0 }
    if ($state.supervisorPid -eq $process.Id -and $state.phase -eq 'failed') { throw $state.error }
  }
  Start-Sleep -Seconds 1
}
throw "Startup still pending. Inspect $statusPath and owned logs before retry."
