$ErrorActionPreference = "Stop"
$taskName = "AI News Desk"
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

if ($existing) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Host "AI News Desk scheduled task removed. Project data was not deleted."
} else {
  Write-Host "AI News Desk scheduled task was not found."
}
