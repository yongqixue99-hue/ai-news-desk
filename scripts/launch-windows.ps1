[CmdletBinding()]
param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$projectPath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $projectPath
try {
  $runtimeRoot = Join-Path $projectPath '.runtime'
  $nodePath = $null
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command) {
    $candidate = $command.Source
    $versionText = & $candidate -p process.versions.node
    $version = [Version]$versionText
    if ($version.Major -eq 22 -and $version.Minor -ge 16) { $nodePath = $candidate }
  }
  if (!$nodePath) {
    $cached = Join-Path $runtimeRoot 'node/node.exe'
    if (Test-Path -LiteralPath $cached) { $nodePath = $cached }
    else {
      Write-Host 'Preparing verified Node.js 22 runtime (first launch only)...'
      New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
      $base = 'https://nodejs.org/dist/latest-v22.x/'
      $checksums = (Invoke-WebRequest -UseBasicParsing -Uri ($base + 'SHASUMS256.txt')).Content
      $entry = @($checksums -split "`n" | Where-Object { $_ -match "\s+node-v22\.\d+\.\d+-win-$arch\.zip\s*$" })
      if ($entry.Count -ne 1) { throw 'Official Node checksum entry was not found.' }
      $parts = $entry[0].Trim() -split '\s+'
      $archive = Join-Path $runtimeRoot $parts[1]
      Invoke-WebRequest -UseBasicParsing -Uri ($base + $parts[1]) -OutFile $archive
      if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $parts[0].ToLowerInvariant()) { throw 'Node download checksum mismatch; runtime was not executed.' }
      $unpack = Join-Path $runtimeRoot ('unpack-' + [Guid]::NewGuid().ToString('N'))
      Expand-Archive -LiteralPath $archive -DestinationPath $unpack
      Move-Item -LiteralPath (Join-Path $unpack ([IO.Path]::GetFileNameWithoutExtension($parts[1]))) -Destination (Join-Path $runtimeRoot 'node')
      $nodePath = $cached
    }
  }
  $env:PATH = (Split-Path $nodePath) + ';' + $env:PATH
  # Upgrade a pre-desktop Scheduled Task only when its action belongs to this checkout.
  try { $identity = Invoke-RestMethod 'http://127.0.0.1:4317/api/desktop/status' -TimeoutSec 2 } catch { $identity = $null }
  if (!$identity) {
    $task = Get-ScheduledTask -TaskName 'AI News Desk' -ErrorAction SilentlyContinue
    if ($task -and @($task.Actions | Where-Object { $_.Arguments -and $_.Arguments.IndexOf($projectPath, [StringComparison]::OrdinalIgnoreCase) -ge 0 }).Count -gt 0) {
      Write-Host 'Updating the existing local service...'
      & (Join-Path (Split-Path $nodePath) 'npm.cmd') run build
      if ($LASTEXITCODE -ne 0) { throw 'Build failed; the existing service was left running.' }
      Stop-ScheduledTask -TaskName 'AI News Desk'
      Start-ScheduledTask -TaskName 'AI News Desk'
      for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Seconds 1
        try { $identity = Invoke-RestMethod 'http://127.0.0.1:4317/api/desktop/status' -TimeoutSec 2; break } catch {}
      }
    }
  }
  $arguments = @((Join-Path $PSScriptRoot 'desktop-launch.mjs'))
  if ($NoOpen) { $arguments += '--no-open' }
  & $nodePath @arguments
  if ($LASTEXITCODE -ne 0) { throw 'AI News Desk did not start. See the message above or .workflow/logs/desktop-service.log.' }
  if (!$NoOpen) {
    $shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'AI News Desk.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
    $shortcut.Arguments = '-NoProfile -ExecutionPolicy RemoteSigned -File "' + $PSCommandPath + '"'
    $shortcut.WorkingDirectory = $projectPath
    $shortcut.WindowStyle = 7
    $shortcut.Save()
  }
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  if (!$NoOpen) { Read-Host 'Press Enter to close' | Out-Null }
  exit 1
}
