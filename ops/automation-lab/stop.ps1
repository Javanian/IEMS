param([string]$LabRoot = 'D:\IEMS-Automation-Lab\n8n-corrective-acceptance-20261027')
& (Join-Path $PSScriptRoot 'control.ps1') -Action stop -LabRoot $LabRoot
exit $LASTEXITCODE
