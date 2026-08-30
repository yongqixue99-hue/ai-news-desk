$ErrorActionPreference = "Stop"
$projectPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$workflowPath = if ($env:AI_NEWS_DESK_WORKFLOW_ROOT) {
  if ([IO.Path]::IsPathRooted($env:AI_NEWS_DESK_WORKFLOW_ROOT)) {
    [IO.Path]::GetFullPath($env:AI_NEWS_DESK_WORKFLOW_ROOT)
  } else {
    [IO.Path]::GetFullPath((Join-Path $projectPath $env:AI_NEWS_DESK_WORKFLOW_ROOT))
  }
} else {
  Join-Path $projectPath ".workflow"
}
$logDirectory = Join-Path $workflowPath "logs"
$logPath = Join-Path $logDirectory "windows-service.log"
$maximumLogBytes = 5MB
$retainedLogs = 3

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -ge $maximumLogBytes) {
  for ($index = $retainedLogs - 1; $index -ge 1; $index--) {
    $source = "$logPath.$index"
    $destination = "$logPath.$($index + 1)"
    if (Test-Path -LiteralPath $source) {
      Move-Item -LiteralPath $source -Destination $destination -Force
    }
  }
  Move-Item -LiteralPath $logPath -Destination "$logPath.1" -Force
}
Set-Location -LiteralPath $projectPath

& npm.cmd run start *>> $logPath
