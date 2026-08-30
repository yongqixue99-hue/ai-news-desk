[CmdletBinding()]
param(
  [string]$TaskName = "AI News Desk",
  [string]$HealthUri = "http://127.0.0.1:4317/api/health"
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

function Test-TaskNotFound {
  param(
    [Parameter(Mandatory = $true)]
    [System.Management.Automation.ErrorRecord]$ErrorRecord
  )
  return $ErrorRecord.CategoryInfo.Category -eq [System.Management.Automation.ErrorCategory]::ObjectNotFound
}

function Assert-File {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Description
  )
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "$Description was not found: $Path"
  }
}

function Assert-Directory {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Description
  )
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    throw "$Description was not found: $Path"
  }
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

function Assert-TaskDefinition {
  param(
    [Parameter(Mandatory = $true)]$Task,
    [Parameter(Mandatory = $true)][string]$ExpectedExecutable,
    [Parameter(Mandatory = $true)][string]$ExpectedArguments,
    [Parameter(Mandatory = $true)][string]$ExpectedWorkingDirectory
  )
  $actions = @($Task.Actions)
  if ($actions.Count -ne 1) {
    throw "Scheduled task must contain exactly one action; found $($actions.Count)."
  }
  $registeredAction = $actions[0]
  if (-not (Test-SamePath $registeredAction.Execute $ExpectedExecutable)) {
    throw "Scheduled task executable mismatch. Expected '$ExpectedExecutable', found '$($registeredAction.Execute)'."
  }
  $registeredArguments = [string]$registeredAction.Arguments
  if (-not [string]::Equals(
    $registeredArguments.Trim(),
    $ExpectedArguments.Trim(),
    [StringComparison]::Ordinal
  )) {
    throw "Scheduled task arguments mismatch. Expected '$ExpectedArguments', found '$($registeredAction.Arguments)'."
  }
  if (-not (Test-SamePath $registeredAction.WorkingDirectory $ExpectedWorkingDirectory)) {
    throw "Scheduled task working directory mismatch. Expected '$ExpectedWorkingDirectory', found '$($registeredAction.WorkingDirectory)'."
  }
}

$projectPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$packagePath = Join-Path $projectPath "package.json"
$nodeModulesPath = Join-Path $projectPath "node_modules"
$tsxPackagePath = Join-Path $nodeModulesPath "tsx\package.json"
$distPath = Join-Path $projectPath "dist"
$distEntryPath = Join-Path $distPath "index.html"
$serviceEntryPath = Join-Path $PSScriptRoot "windows-service-entry.mjs"
$serverEntryPath = Join-Path $projectPath "server\index.ts"

Assert-File $packagePath "package.json"
Assert-Directory $nodeModulesPath "node_modules (run npm ci first)"
Assert-File $tsxPackagePath "tsx runtime (run npm ci first)"
Assert-Directory $distPath "production build directory (run npm run build first)"
Assert-File $distEntryPath "production web entry (run npm run build first)"
Assert-File $serviceEntryPath "Windows service entry"
Assert-File $serverEntryPath "server entry"

$nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction Stop
$nodePath = $nodeCommand.Source
Assert-File $nodePath "Node.js executable"
$nodeVersionText = (& $nodePath --version).Trim().TrimStart("v")
if ($LASTEXITCODE -ne 0) {
  throw "Node.js version check failed."
}
try {
  $nodeVersion = [version]$nodeVersionText
} catch {
  throw "Unable to parse Node.js version: $nodeVersionText"
}
if ($nodeVersion.Major -ne 22 -or $nodeVersion -lt [version]"22.16.0") {
  throw "Node.js 22.16.x or newer within major 22 is required; found v$nodeVersionText."
}

$projectPath = Get-NormalizedPath $projectPath
$serviceEntryPath = Get-NormalizedPath $serviceEntryPath
$arguments = '--import tsx "{0}"' -f $serviceEntryPath
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

Write-Host "Preflight passed."
Write-Host "  Project: $projectPath"
Write-Host "  Node:    $nodePath (v$nodeVersionText)"
Write-Host "  Entry:   $serviceEntryPath"
Write-Host "  User:    $currentUser"

$action = New-ScheduledTaskAction `
  -Execute $nodePath `
  -Argument $arguments `
  -WorkingDirectory $projectPath
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$principal = New-ScheduledTaskPrincipal `
  -UserId $currentUser `
  -LogonType Interactive `
  -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

$existing = $null
try {
  # AccessDenied must not be treated as an absent task. Doing so would hide a
  # permissions problem until Register-ScheduledTask fails later with less
  # useful context.
  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
} catch {
  if (-not (Test-TaskNotFound $_)) {
    throw "Unable to inspect existing scheduled task '$TaskName': $($_.Exception.Message). Run this installer from an elevated PowerShell window."
  }
}
if ($null -ne $existing) {
  Write-Host "Updating existing scheduled task '$TaskName'."
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description "Start the local AI News Desk after Windows sign-in and restart it after transient failures." `
  -Force | Out-Null

$registered = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
Assert-TaskDefinition `
  -Task $registered `
  -ExpectedExecutable $nodePath `
  -ExpectedArguments $arguments `
  -ExpectedWorkingDirectory $projectPath

Start-ScheduledTask -TaskName $TaskName
Write-Host "Scheduled task registered. Waiting for health (up to 60 seconds)..."

$deadline = [DateTime]::UtcNow.AddSeconds(60)
$health = $null
do {
  $remaining = [Math]::Max(1, [Math]::Floor(($deadline - [DateTime]::UtcNow).TotalSeconds))
  $requestTimeout = [Math]::Min(5, $remaining)
  $health = Get-HealthyResponse -Uri $HealthUri -TimeoutSeconds $requestTimeout
  if ($null -ne $health) {
    Start-Sleep -Milliseconds 750
    $registered = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    if ($registered.State -eq "Running") {
      break
    }
    $health = $null
  }
  if ([DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Seconds 2
  }
} while ([DateTime]::UtcNow -lt $deadline)

if ($null -eq $health) {
  $registered = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  $taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
  $lastResult = if ($null -ne $taskInfo) { $taskInfo.LastTaskResult } else { "unknown" }
  throw "Scheduled task did not become healthy and remain running within 60 seconds. State=$($registered.State); LastTaskResult=$lastResult. Close any manual server already using port 4317, inspect .workflow\logs\windows-service.log, then rerun this installer."
}

Write-Host "AI News Desk scheduled task is installed, running, and healthy."
Write-Host "  Task:   $TaskName"
Write-Host "  Health: $HealthUri"
