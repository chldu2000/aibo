#Requires -Version 7.0
param([string]$EvidencePath = (Join-Path ([IO.Path]::GetTempPath()) 'aibo-diagnostic-logging-windows-release.json'))
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'This probe requires an interactive Windows desktop.' }
$repo = Split-Path $PSScriptRoot -Parent
$token = [Guid]::NewGuid().ToString('N')
$identifier = "local.aibo.diagnosticrelease.$token"
$product = "AiboDiagnosticProbe-$token"
$root = Join-Path ([IO.Path]::GetTempPath()) "aibo-diagnostic-release-$token"
$data = Join-Path ([Environment]::GetFolderPath('ApplicationData')) $identifier
$logs = Join-Path $data 'logs'
$installed = Join-Path $root 'installed'
$child = $null
$evidence = @()
function Assert-Probe($Condition, $Message) { if (-not $Condition) { throw $Message } }
function Read-Rows([switch]$AllowIncompleteTail) {
    $rows = @()
    if (Test-Path -LiteralPath $logs) {
        foreach ($file in Get-ChildItem -LiteralPath $logs -Filter '*.jsonl') {
            # ReadAllText uses FileShare.Read and conflicts with the live writer.
            # A polling reader must permit its existing write handle to stay open.
            $stream = [IO.File]::Open($file.FullName, [IO.FileMode]::Open,
                [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
            try {
                $reader = [IO.StreamReader]::new($stream)
                try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
            } finally { $stream.Dispose() }
            $lines = @($text -split "`n")
            if ($AllowIncompleteTail -and $text.Length -and -not $text.EndsWith("`n")) {
                $lines = @($lines | Select-Object -SkipLast 1)
            }
            foreach ($line in $lines) {
                if ($line.Length) { $rows += $line | ConvertFrom-Json }
            }
        }
    }
    return $rows
}
Assert-Probe (-not (Test-Path -LiteralPath $data)) 'The isolated profile must not already exist.'
New-Item -ItemType Directory -Path $root | Out-Null
$configPath = Join-Path $root 'tauri.json'
@{ identifier = $identifier; productName = $product; mainBinaryName = $product; app = @{ windows = @(@{ label = 'main'; title = $product; width = 1100; height = 740 }) } } |
    ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $configPath -Encoding utf8NoBOM
$consoleHelper = Join-Path $root 'check-console.ps1'
@'
param([uint32]$TargetPid, [string]$OutputPath)
$ErrorActionPreference = 'Stop'
Add-Type @"
using System.Runtime.InteropServices;
public static class DiagnosticConsoleProbe {
    [DllImport("kernel32.dll", SetLastError=true)] public static extern bool FreeConsole();
    [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint processId);
}
"@
$null = [DiagnosticConsoleProbe]::FreeConsole()
$attached = [DiagnosticConsoleProbe]::AttachConsole($TargetPid)
$errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
@{ pid = $TargetPid; attached = $attached; errorCode = $errorCode } | ConvertTo-Json |
    Set-Content -LiteralPath $OutputPath -Encoding utf8NoBOM
if ($attached) { $null = [DiagnosticConsoleProbe]::FreeConsole(); exit 1 }
if ($errorCode -ne 6) { exit 2 }
exit 0
'@ | Set-Content -LiteralPath $consoleHelper -Encoding utf8NoBOM
Push-Location $repo
try {
    & pnpm tauri build --bundles nsis --config $configPath
    Assert-Probe ($LASTEXITCODE -eq 0) 'Windows NSIS build failed.'
    $packages = @(Get-ChildItem 'src-tauri/target/release/bundle/nsis' -Filter "$product*-setup.exe")
    Assert-Probe ($packages.Count -eq 1) 'Expected one installer for this unique probe product.'
    # NSIS requires /D to be last; its unquoted remainder is the install path.
    $installer = Start-Process -FilePath $packages[0].FullName -ArgumentList @('/S', "/D=$installed") -PassThru -Wait
    Assert-Probe ($installer.ExitCode -eq 0) 'Installing the isolated package failed.'
    $binary = Join-Path $installed "$product.exe"
    Assert-Probe (Test-Path -LiteralPath $binary) 'Installed application binary is missing.'
    $reader = [IO.BinaryReader]::new([IO.File]::OpenRead($binary))
    try {
        $null = $reader.BaseStream.Seek(0x3c, [IO.SeekOrigin]::Begin)
        $header = $reader.ReadInt32()
        $null = $reader.BaseStream.Seek($header + 4, [IO.SeekOrigin]::Begin)
        $arch = switch ($reader.ReadUInt16()) { 0x8664 { 'x86_64' } 0xaa64 { 'aarch64' } 0x014c { 'x86' } default { throw 'Unknown PE architecture.' } }
    } finally { $reader.Dispose() }
    $version = (Get-Content 'src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json).version
    for ($run = 0; $run -lt 2; $run++) {
        $child = Start-Process -FilePath $binary -PassThru
        $deadline = [DateTime]::UtcNow.AddSeconds(45)
        $ready = $null
        while ([DateTime]::UtcNow -lt $deadline) {
            $child.Refresh()
            Assert-Probe (-not $child.HasExited) 'Application exited before app.ready.'
            $ready = Read-Rows -AllowIncompleteTail | Where-Object { $_.pid -eq $child.Id -and $_.event -eq 'app.ready' } | Select-Object -First 1
            if ($ready -and $child.MainWindowHandle -ne 0) { break }
            Start-Sleep -Milliseconds 100
        }
        Assert-Probe ($ready -and $child.MainWindowHandle -ne 0) 'Packaged frontend did not become ready.'
        $consoleProof = Join-Path $root "console-$run.json"
        $helper = Start-Process -FilePath (Get-Command pwsh).Source -WindowStyle Hidden -Wait -PassThru -ArgumentList @(
            '-NoProfile', '-NonInteractive', '-File', ('"' + $consoleHelper + '"'), '-TargetPid', $child.Id,
            '-OutputPath', ('"' + $consoleProof + '"'))
        Assert-Probe ($helper.ExitCode -eq 0) 'The live application must have no console (AttachConsole error 6).'
        Assert-Probe ($child.CloseMainWindow()) 'Could not request normal window close.'
        Assert-Probe ($child.WaitForExit(15000)) 'Normal application exit timed out.'
        Assert-Probe ($child.ExitCode -eq 0) 'Normal application exit failed.'
        $rows = @(Read-Rows | Where-Object { $_.boot_id -eq $ready.boot_id } | Sort-Object sequence)
        Assert-Probe (@($rows | Where-Object event -eq 'app.stopped').Count -eq 1) 'Missing normal exit evidence.'
        Assert-Probe (@($rows | Where-Object event -eq 'app.previous_exit_unknown').Count -eq 0) 'Clean restart was classified as abnormal.'
        Assert-Probe (@($rows | Where-Object { $_.schema -ne 'aibo.diagnostic/v1' -or $_.pid -ne $child.Id -or $_.build_channel -ne 'release' -or $_.os -ne 'windows' -or $_.arch -ne $arch -or $_.app_version -ne $version }).Count -eq 0) 'Incorrect packaged environment fields.'
        Assert-Probe (-not (Test-Path (Join-Path $data 'development/logs'))) 'Release wrote development logs.'
        $evidence += @{ boot_id = $ready.boot_id; directory = $logs; console = (Get-Content $consoleProof -Raw | ConvertFrom-Json); exitCode = $child.ExitCode; events = @($rows.event) }
        $child.Dispose(); $child = $null
    }
    Assert-Probe ($evidence[0].boot_id -ne $evidence[1].boot_id) 'Restart reused boot_id.'
    @{ passed = $true; platform = 'windows'; installer = $packages[0].FullName; evidence = $evidence;
        notCovered = @('native directory opening', 'junction boundary', 'frontend IPC security') } |
        ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $EvidencePath -Encoding utf8NoBOM
    Write-Output "Windows packaged profile, no-console and normal exit passed: $EvidencePath"
} finally {
    if ($child -and -not $child.HasExited) { $child.Kill($true); $child.WaitForExit(); $child.Dispose() }
    $uninstaller = Join-Path $installed 'uninstall.exe'
    if (Test-Path -LiteralPath $uninstaller) { Start-Process $uninstaller -ArgumentList @('/S', "_?=$installed") -Wait | Out-Null }
    if (Test-Path -LiteralPath $data) { Remove-Item -LiteralPath $data -Recurse -Force }
    Remove-Item -LiteralPath $root -Recurse -Force
    Pop-Location
}
