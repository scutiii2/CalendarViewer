# ICS Calendar Viewer control script. calendar.bat starts it; run it directly with an action to skip the menu:
#   calendar.ps1 start [-NoBrowser] | run [-NoBrowser] | stop | startup-on [-Browser] | startup-off | zip | toast
param(
    [Parameter(Position = 0)]
    [ValidateSet('menu', 'start', 'run', 'stop', 'startup-on', 'startup-off', 'zip', 'toast')]
    [string]$Action = 'menu',
    [switch]$NoBrowser,      # start: do not open the browser
    [switch]$Browser,        # startup-on: also open the browser at sign-in
    [string]$Title,          # toast: base64 UTF-8 text (the server passes it this way so no quoting can break the call)
    [string]$Body = '',
    [string]$Url = '',
    [string]$SnoozeUrl = '' # toast: base64 local single-use snooze link
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$serverPath = Join-Path $root 'src\server\server.js'
$self = $PSCommandPath

# Matches only a Node process whose script argument is this application's server.js, never other Node apps.
$serverPattern = '^\s*(?:"[^"]+"|\S+)\s+(?:"' + [regex]::Escape($serverPath) + '"|' + [regex]::Escape($serverPath) + ')\s*$'

function Get-CalendarPort {
    $port = 3000
    if ($env:PORT) { $port = [int]$env:PORT }
    if ($port -lt 1 -or $port -gt 65535) { throw 'PORT must be between 1 and 65535.' }
    $port
}

function Start-Calendar {
    $port = Get-CalendarPort
    $nodePath = (Get-Command node -ErrorAction Stop).Source
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    foreach ($processId in @($listeners.OwningProcess | Select-Object -Unique)) {
        $running = Get-CimInstance Win32_Process -Filter "ProcessId = $processId"
        if ($running.Name -ne 'node.exe' -or $running.CommandLine -notmatch $serverPattern) {
            throw "Port $port is already in use by a process this launcher cannot safely restart. Close the previous server window or the application using that port, then start the calendar again."
        }
        Write-Host 'Restarting calendar server...'
        Stop-Process -Id $processId -ErrorAction Stop
        Wait-Process -Id $processId -Timeout 10 -ErrorAction SilentlyContinue
    }
    $started = Start-Process -FilePath $nodePath -ArgumentList ('"' + $serverPath + '"') -WorkingDirectory $root -WindowStyle Hidden -PassThru
    $ready = $false
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        $started.Refresh()
        if ($started.HasExited) { throw 'Calendar server exited before it was ready.' }
        $client = New-Object System.Net.Sockets.TcpClient
        try {
            $client.Connect('127.0.0.1', $port)
            $ready = $true
        } catch { } finally { $client.Dispose() }
        if ($ready) { break }
        Start-Sleep -Milliseconds 100
    }
    if (-not $ready) {
        Stop-Process -Id $started.Id -ErrorAction SilentlyContinue
        throw 'Calendar server did not become ready in time.'
    }
    $calendarUrl = "http://localhost:$port"
    Write-Host "Calendar ready: $calendarUrl"
    if (-not $NoBrowser) { Start-Process $calendarUrl }
}

# run.bat: start the server if it is stopped, restart it if it is older than the files on disk, then open the calendar.
function Invoke-Calendar {
    $port = Get-CalendarPort
    $servers = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -match $serverPattern })
    if (-not $servers.Count) {
        Write-Host 'Calendar server is not running. Starting it...'
        Start-Calendar
        return
    }
    $diskVersion = if (Test-Path (Join-Path $root 'VERSION')) { (Get-Content (Join-Path $root 'VERSION') -Raw).Trim() } else { 'unknown' }
    $runningVersion = $null
    try { $runningVersion = (Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/version" -TimeoutSec 3).version } catch { }
    # Also catch edited files (for example a pulled update that kept the same version number).
    $newest = Get-ChildItem -Path (Join-Path $root 'src'), (Join-Path $root 'vendor') -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $startedAt = ($servers | Measure-Object -Property CreationDate -Minimum).Minimum
    if ($runningVersion -ne $diskVersion -or $newest.LastWriteTime -gt $startedAt) {
        $was = if ($runningVersion) { $runningVersion } else { 'an older build' }
        Write-Host "Running server is $was, files on disk are $diskVersion. Restarting..."
        Start-Calendar
        return
    }
    Write-Host "Calendar server is running (version $runningVersion)."
    if (-not $NoBrowser) { Start-Process "http://localhost:$port" }
}

function Stop-Calendar {
    $servers = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -match $serverPattern })
    if (-not $servers.Count) {
        Write-Host 'Calendar server is already stopped.'
        return
    }
    foreach ($server in $servers) {
        Stop-Process -Id $server.ProcessId -ErrorAction Stop
        Wait-Process -Id $server.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
        # Windows can report a just-stopped process for a moment; give it a few seconds before failing.
        for ($attempt = 0; $attempt -lt 20 -and (Get-Process -Id $server.ProcessId -ErrorAction SilentlyContinue); $attempt++) {
            Start-Sleep -Milliseconds 150
        }
        if (Get-Process -Id $server.ProcessId -ErrorAction SilentlyContinue) {
            throw "Calendar server process $($server.ProcessId) has not stopped yet."
        }
    }
    Write-Host 'Calendar server stopped.'
}

function Get-StartupShortcut {
    $folder = [Environment]::GetFolderPath('Startup')
    if (-not $folder) { throw 'Windows Startup folder could not be found.' }
    Join-Path $folder 'ICS Calendar Viewer.lnk'
}

function Enable-Startup {
    Get-Command node -ErrorAction Stop | Out-Null
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut((Get-StartupShortcut))
    $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $self + '" start'
    if (-not $Browser) { $arguments += ' -NoBrowser' }
    $shortcut.Arguments = $arguments
    $shortcut.WorkingDirectory = $root
    $shortcut.Description = 'Start ICS Calendar Viewer at sign-in'
    $shortcut.WindowStyle = 7
    $shortcut.Save()
    Write-Host 'Automatic startup enabled for your Windows account.'
    if ($Browser) { Write-Host 'The calendar server and browser will open when you next sign in.' }
    else { Write-Host 'The calendar server will start when you next sign in.' }
    Write-Host 'Keep this application folder in its current location.'
}

function Disable-Startup {
    $path = Get-StartupShortcut
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path }
    Write-Host 'Automatic startup disabled. The running server is unchanged.'
}

function New-Zip {
    $script = Join-Path $PSScriptRoot 'make_zip.py'
    if (Get-Command py -ErrorAction SilentlyContinue) { & py -3 $script }
    elseif (Get-Command python -ErrorAction SilentlyContinue) { & python $script }
    else { throw 'Python 3 was not found. Install Python 3, then try again.' }
    if ($LASTEXITCODE -ne 0) { throw 'ZIP creation failed.' }
}

function Show-Toast {
    function Decode([string]$value) {
        if (-not $value) { return '' }
        [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($value))
    }
    $text = Decode $Title
    $message = Decode $Body
    $link = Decode $Url
    $snoozeLink = Decode $SnoozeUrl

    # A per-user registration gives the toast its own app name instead of "Windows PowerShell".
    $appId = 'ICSCalendarViewer'
    $key = "HKCU:\Software\Classes\AppUserModelId\$appId"
    if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
    New-ItemProperty -Path $key -Name DisplayName -Value 'ICS Calendar Viewer' -PropertyType String -Force | Out-Null

    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

    $esc = { param($value) [Security.SecurityElement]::Escape($value) }
    $join = ''
    if ($link) { $join = '<action content="Join" arguments="' + (& $esc $link) + '" activationType="protocol"/>' }
    if ($snoozeLink) { $join += '<action content="Snooze 5 min" arguments="' + (& $esc $snoozeLink) + '" activationType="protocol"/>' }
    # scenario="reminder" keeps the toast on screen until it is dismissed.
    $xml = '<toast scenario="reminder"><visual><binding template="ToastGeneric"><text>' + (& $esc $text) + '</text><text>' + (& $esc $message) + '</text></binding></visual><actions>' + $join + '<action content="Dismiss" arguments="dismiss" activationType="system"/></actions></toast>'

    $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
    $doc.LoadXml($xml)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show([Windows.UI.Notifications.ToastNotification]::new($doc))
}

function Show-Menu {
    while ($true) {
        Clear-Host
        Write-Host 'ICS Calendar Viewer'
        Write-Host ''
        Write-Host '  1. Start or restart the server and open the calendar'
        Write-Host '  2. Stop the server'
        Write-Host '  3. Start the server automatically at Windows sign-in'
        Write-Host '  4. Turn off automatic startup'
        Write-Host '  5. Create a distribution ZIP'
        Write-Host '  Q. Quit'
        Write-Host ''
        $choice = (Read-Host 'Choose an option [1]').Trim()
        if (-not $choice) { $choice = '1' }
        if ($choice -eq 'q') { return }
        try {
            switch ($choice) {
                '1' { Start-Calendar }
                '2' { Stop-Calendar }
                '3' { Enable-Startup }
                '4' { Disable-Startup }
                '5' { New-Zip }
                default { Write-Host 'Unknown option.' }
            }
        } catch { Write-Host $_.Exception.Message -ForegroundColor Red }
        Write-Host ''
        Read-Host 'Press Enter to continue' | Out-Null
    }
}

try {
    switch ($Action) {
        'menu' { Show-Menu }
        'start' { Start-Calendar }
        'run' { Invoke-Calendar }
        'stop' { Stop-Calendar }
        'startup-on' { Enable-Startup }
        'startup-off' { Disable-Startup }
        'zip' { New-Zip }
        'toast' { Show-Toast }
    }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
