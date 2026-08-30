$ErrorActionPreference = "Stop"
$taskName = "AI News Desk"
$projectPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$serviceEntry = (Resolve-Path (Join-Path $PSScriptRoot "windows-service-entry.mjs")).Path
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$arguments = "--import tsx `"$serviceEntry`""

$action = New-ScheduledTaskAction -Execute $nodePath -Argument $arguments -WorkingDirectory $projectPath
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Start the local AI News Desk after Windows sign-in and restart it after transient failures." `
  -Force | Out-Null

Start-ScheduledTask -TaskName $taskName
Write-Host "AI News Desk scheduled task installed and started."
