param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
try {
    $serverPath = Join-Path $PSScriptRoot 'server.js'
    $calendarPort = 3000
    if ($env:PORT) { $calendarPort = [int]$env:PORT }
    if ($calendarPort -lt 1 -or $calendarPort -gt 65535) { throw 'PORT must be between 1 and 65535.' }
    $nodePath = (Get-Command node -ErrorAction Stop).Source
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $calendarPort -ErrorAction SilentlyContinue)
    foreach ($processId in @($listeners.OwningProcess | Select-Object -Unique)) {
        $running = Get-CimInstance Win32_Process -Filter "ProcessId = $processId"
        # Only restart Node with this exact absolute server path as its script argument.
        $scriptPattern = '^\s*(?:"[^"]+"|\S+)\s+(?:"' + [regex]::Escape($serverPath) + '"|' + [regex]::Escape($serverPath) + ')\s*$'
        if ($running.Name -ne 'node.exe' -or $running.CommandLine -notmatch $scriptPattern) {
            throw "Port $calendarPort is already in use by a process this launcher cannot safely restart. Close the previous server window or the application using that port, then start the calendar again from calendar.bat."
        }
        Write-Host 'Restarting calendar server...'
        Stop-Process -Id $processId -ErrorAction Stop
        Wait-Process -Id $processId -Timeout 10 -ErrorAction SilentlyContinue
    }
    $started = Start-Process -FilePath $nodePath -ArgumentList ('"' + $serverPath + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
    $ready = $false
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        $started.Refresh()
        if ($started.HasExited) { throw 'Calendar server exited before it was ready.' }
        $client = New-Object System.Net.Sockets.TcpClient
        try {
            $client.Connect('127.0.0.1', $calendarPort)
            $ready = $true
        } catch { } finally { $client.Dispose() }
        if ($ready) { break }
        Start-Sleep -Milliseconds 100
    }
    if (-not $ready) {
        Stop-Process -Id $started.Id -ErrorAction SilentlyContinue
        throw 'Calendar server did not become ready in time.'
    }
    $calendarUrl = "http://localhost:$calendarPort"
    Write-Host "Calendar ready: $calendarUrl"
    if (-not $NoBrowser) { Start-Process $calendarUrl }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
