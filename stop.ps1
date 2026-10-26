$ErrorActionPreference = 'Stop'
try {
    $serverPath = Join-Path $PSScriptRoot 'server.js'
    # Match the absolute script argument used by run.bat, never other Node apps.
    $scriptPattern = '^\s*(?:"[^"]+"|\S+)\s+(?:"' + [regex]::Escape($serverPath) + '"|' + [regex]::Escape($serverPath) + ')\s*$'
    $servers = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
        $_.CommandLine -match $scriptPattern
    })
    if (-not $servers.Count) {
        Write-Host 'Calendar server is already stopped.'
    } else {
        foreach ($server in $servers) {
            Stop-Process -Id $server.ProcessId -ErrorAction Stop
            Wait-Process -Id $server.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
            if (Get-Process -Id $server.ProcessId -ErrorAction SilentlyContinue) {
                throw "Calendar server process $($server.ProcessId) has not stopped yet."
            }
        }
        Write-Host 'Calendar server stopped.'
    }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
