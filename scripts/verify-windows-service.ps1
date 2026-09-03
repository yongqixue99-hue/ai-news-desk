[CmdletBinding()]
param(
  [string]$TaskName = "AI News Desk",
  [string]$HealthUri = "http://127.0.0.1:4317/api/health",
  [ValidateRange(1, 60)][int]$WaitSeconds = 10
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

function Get-NormalizedPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  return [IO.Path]::GetFullPath($Path).TrimEnd([char[]]@(92, 47))
}

function Test-SamePath {
  param(
    [string]$Left,
    [string]$Right
  )
  if ([string]::IsNullOrWhiteSpace($Left) -or [string]::IsNullOrWhiteSpace($Right)) {
    return $false
  }
  try {
    return [string]::Equals(
      (Get-NormalizedPath $Left),
      (Get-NormalizedPath $Right),
      [StringComparison]::OrdinalIgnoreCase
    )
  } catch {
    return $false
  }
}

function Test-TaskSchedulerAccessDenied {
  param(
    [Parameter(Mandatory = $true)]
    [System.Management.Automation.ErrorRecord]$ErrorRecord
  )
  return (
    $ErrorRecord.CategoryInfo.Category -eq [System.Management.Automation.ErrorCategory]::PermissionDenied -or
    $ErrorRecord.FullyQualifiedErrorId -match "0x80041003"
  )
}

function Get-HealthyResponse {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [int]$TimeoutSeconds = 5
  )
  try {
    $response = Invoke-WebRequest `
      -UseBasicParsing `
      -Uri $Uri `
      -Method Get `
      -TimeoutSec $TimeoutSeconds `
      -Proxy $null
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) {
      return $null
    }
    $payload = $response.Content | ConvertFrom-Json
    if ($payload.ok -ne $true) {
      return $null
    }
    return $payload
  } catch {
    return $null
  }
}

$failures = New-Object System.Collections.Generic.List[string]
$projectPath = Get-NormalizedPath ((Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path)
$serviceEntryPath = Get-NormalizedPath ((Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "windows-service-entry.mjs")).Path)
$expectedArguments = '--import tsx "{0}"' -f $serviceEntryPath
$nodeCommand = @(Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue)[0]
$expectedNodePath = if ($null -ne $nodeCommand) { $nodeCommand.Source } else { $null }

Write-Host "AI News Desk Windows service verification"
Write-Host ""
Write-Host "Scheduled task"
$task = $null
$taskLookupError = $null
try {
  # Do not use SilentlyContinue here. The ScheduledTasks CIM provider can return
  # AccessDenied as a non-terminating error, which otherwise looks exactly like
  # an absent task because the result is $null.
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
} catch {
  $taskLookupError = $_
}

if ($null -ne $taskLookupError) {
  if (Test-TaskSchedulerAccessDenied $taskLookupError) {
    Write-Host "  Access denied: Task Scheduler did not allow this process to inspect '$TaskName'."
    Write-Host "  Run this verifier from an elevated PowerShell window to validate the task definition."
    $failures.Add("Task Scheduler access was denied; task existence, state, action, arguments, and working directory could not be verified. This is not evidence that the task is missing.")
  } else {
    Write-Host "  Inspection failed: $($taskLookupError.Exception.Message)"
    $failures.Add("Scheduled task '$TaskName' could not be inspected: $($taskLookupError.Exception.Message)")
  }
} elseif ($null -eq $task) {
  Write-Host "  Missing: $TaskName"
  $failures.Add("Scheduled task '$TaskName' does not exist.")
} else {
  $taskInfo = $null
  try {
    $taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction Stop
  } catch {
    Write-Host "  Run info:   unavailable ($($_.Exception.Message))"
  }
  Write-Host "  Name:       $($task.TaskName)"
  Write-Host "  State:      $($task.State)"
  Write-Host "  User:       $($task.Principal.UserId)"
  if ($null -ne $taskInfo) {
    Write-Host "  Last run:   $($taskInfo.LastRunTime)"
    Write-Host "  Last result:$($taskInfo.LastTaskResult)"
  }
  $actions = @($task.Actions)
  if ($actions.Count -ne 1) {
    $failures.Add("Scheduled task must contain exactly one action; found $($actions.Count).")
  } else {
    $registeredAction = $actions[0]
    Write-Host "  Execute:    $($registeredAction.Execute)"
    Write-Host "  Arguments:  $($registeredAction.Arguments)"
    Write-Host "  Work dir:   $($registeredAction.WorkingDirectory)"
    if ($null -eq $expectedNodePath) {
      $failures.Add("node.exe is not available on PATH for definition verification.")
    } elseif (-not (Test-SamePath $registeredAction.Execute $expectedNodePath)) {
      $failures.Add("Scheduled task executable mismatch. Expected '$expectedNodePath'; found '$($registeredAction.Execute)'.")
    }
    $registeredArguments = [string]$registeredAction.Arguments
    if (-not [string]::Equals(
      $registeredArguments.Trim(),
      $expectedArguments.Trim(),
      [StringComparison]::Ordinal
    )) {
      $failures.Add("Scheduled task arguments mismatch. Expected '$expectedArguments'; found '$registeredArguments'.")
    }
    if (-not (Test-SamePath $registeredAction.WorkingDirectory $projectPath)) {
      $failures.Add("Scheduled task working directory mismatch. Expected '$projectPath'; found '$($registeredAction.WorkingDirectory)'.")
    }
  }
  if ($task.State -ne "Running") {
    $failures.Add("Scheduled task is not running (state: $($task.State)).")
  }
}

Write-Host ""
Write-Host "Port and process"
try {
  $healthAddress = [Uri]$HealthUri
  $port = $healthAddress.Port
  $listeners = @()
  $listenerSource = "Get-NetTCPConnection"
  try {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction Stop)
  } catch {
    # Get-NetTCPConnection may require an elevated token on some managed
    # Windows installations. netstat is read-only and works for normal users.
    $listenerSource = "netstat"
    $netstatPath = Join-Path $env:SystemRoot "System32\netstat.exe"
    $netstatLines = @(& $netstatPath -ano -p tcp)
    if ($LASTEXITCODE -ne 0) {
      throw "Both Get-NetTCPConnection and netstat failed."
    }
    foreach ($line in $netstatLines) {
      $parts = @($line.Trim() -split "\s+")
      if ($parts.Count -lt 5 -or $parts[0] -ne "TCP") {
        continue
      }
      if ($parts[1] -notmatch ":$port$") {
        continue
      }
      if ($parts[3] -ne "LISTENING") {
        continue
      }
      $listeners += [PSCustomObject]@{ OwningProcess = [int]$parts[4] }
    }
  }
  if ($listeners.Count -eq 0) {
    Write-Host "  Port ${port}: no listener"
    $failures.Add("No process is listening on port $port.")
  } else {
    $processIds = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
    Write-Host "  Port:       $port"
    Write-Host "  Listener:   $($listeners.Count) socket(s)"
    Write-Host "  Inspect via:$listenerSource"
    foreach ($processId in $processIds) {
      $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
      $processRecord = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
      if ($null -eq $process) {
        Write-Host "  PID ${processId}: process details unavailable"
        $failures.Add("Listener PID $processId could not be inspected.")
        continue
      }
      Write-Host "  PID:        $processId"
      Write-Host "  Process:    $($process.ProcessName)"
      if ($null -ne $processRecord) {
        Write-Host "  Command:    $($processRecord.CommandLine)"
      }
      if ($process.ProcessName -ne "node") {
        $failures.Add("Port $port is owned by '$($process.ProcessName)', not node.exe.")
      }
    }
  }
} catch {
  Write-Host "  Inspection failed: $($_.Exception.Message)"
  $failures.Add("Unable to inspect the listening port and process.")
}

Write-Host ""
Write-Host "Health"
$deadline = [DateTime]::UtcNow.AddSeconds($WaitSeconds)
$health = $null
do {
  $remaining = [Math]::Max(1, [Math]::Floor(($deadline - [DateTime]::UtcNow).TotalSeconds))
  $requestTimeout = [Math]::Min(5, $remaining)
  $health = Get-HealthyResponse -Uri $HealthUri -TimeoutSeconds $requestTimeout
  if ($null -ne $health) {
    break
  }
  if ([DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Seconds 1
  }
} while ([DateTime]::UtcNow -lt $deadline)

if ($null -eq $health) {
  Write-Host "  Failed: $HealthUri"
  $failures.Add("Health endpoint did not return HTTP 2xx with ok=true within $WaitSeconds second(s).")
} else {
  Write-Host "  URL:        $HealthUri"
  Write-Host "  Core:       ok"
  if ($null -ne $health.codex) {
    Write-Host "  Codex:      $($health.codex.ok) - $($health.codex.detail)"
  }
  if ($null -ne $health.publisher) {
    Write-Host "  Publisher:  $($health.publisher.ok) - $($health.publisher.detail)"
  }
  if ($null -ne $health.horizon) {
    Write-Host "  Horizon:    $($health.horizon.ok) - $($health.horizon.detail)"
  }
}

Write-Host ""
if ($failures.Count -gt 0) {
  Write-Host "Verification failed:"
  foreach ($failure in $failures) {
    Write-Host "  - $failure"
  }
  exit 1
}

Write-Host "Verification passed: the scheduled task, listener process, and health endpoint are ready."
exit 0
