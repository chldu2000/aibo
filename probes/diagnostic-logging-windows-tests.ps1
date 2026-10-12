#Requires -Version 7.0
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false # Expected pre-fix loader failure is checked below.
if (-not $IsWindows) { throw 'This probe requires Windows and the MSVC Windows SDK.' }
$repo = Split-Path $PSScriptRoot -Parent
Push-Location $repo
try {
    New-Item -ItemType Directory -Force artifacts | Out-Null
    # Tauri links its application manifest to app binaries, but not the lib unit-test
    # executable. Without Common Controls v6, the loader cannot find TaskDialogIndirect.
    # See https://github.com/tauri-apps/tauri/issues/13419.
    & cargo test --manifest-path src-tauri/Cargo.toml --lib --no-run --message-format=json 2>&1 |
        Tee-Object -FilePath artifacts/diagnostics-build.log
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $binaries = @(Get-Content artifacts/diagnostics-build.log | ForEach-Object {
        if ($_.StartsWith('{')) {
            $message = $_ | ConvertFrom-Json
            if ($message.reason -eq 'compiler-artifact' -and $message.profile.test -and
                $message.target.name -eq 'aibo_lib' -and $message.executable) {
                $message.executable
            }
        }
    } | Select-Object -Unique)
    if ($binaries.Count -ne 1) { throw 'Expected exactly one aibo_lib unit-test executable.' }
    $binary = $binaries[0]
    if (-not $binary.EndsWith('.exe')) { throw 'Expected a Windows MSVC test executable.' }

    # Keep the exact loader failure in the evidence before making the test-only fix.
    & $binary --list 2>&1 | Tee-Object -FilePath artifacts/diagnostics-loader-before.log
    $before = $LASTEXITCODE
    Write-Host "Unit-test loader exit before manifest: $before"
    if ($before -eq -1073741511) { # 0xc0000139: STATUS_ENTRYPOINT_NOT_FOUND
        $sdk = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
        $mt = Get-ChildItem $sdk -Directory | Sort-Object Name -Descending |
            ForEach-Object { Join-Path $_.FullName 'x64/mt.exe' } |
            Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
        if (-not $mt) { throw 'Windows SDK mt.exe is required to embed the test manifest.' }
        $manifest = Join-Path $PWD 'artifacts/diagnostics-test-manifest.xml'
        & $mt -nologo "-inputresource:$binary;#1" "-out:$manifest" 2>&1 |
            Tee-Object -FilePath artifacts/diagnostics-manifest-before.log
        if ($LASTEXITCODE -eq 0) {
            throw 'Test executable already has a manifest; investigate the unexpected loader failure.'
        }
        @'
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0" processorArchitecture="*"
        publicKeyToken="6595b64144ccf1df" language="*" />
    </dependentAssembly>
  </dependency>
</assembly>
'@ | Set-Content -LiteralPath $manifest -Encoding utf8NoBOM
        & $mt -nologo -manifest $manifest "-outputresource:$binary;#1" 2>&1 |
            Tee-Object -FilePath artifacts/diagnostics-manifest-embed.log
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } elseif ($before -ne 0) {
        throw "Unexpected test executable startup failure: $before"
    }
    & $binary --list 2>&1 | Tee-Object -FilePath artifacts/diagnostics-loader-after.log
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $binary diagnostics::tests --test-threads=1 2>&1 |
        Tee-Object -FilePath artifacts/diagnostics-rust.log
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $binary diagnostics_ipc::tests --test-threads=1 2>&1 |
        Tee-Object -FilePath artifacts/diagnostics-ipc-rust.log
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
