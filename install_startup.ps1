param([switch]$Remove, [switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
try {
    $startupFolder = [Environment]::GetFolderPath('Startup')
    if (-not $startupFolder) { throw 'Windows Startup folder could not be found.' }
    $shortcutPath = Join-Path $startupFolder 'ICS Calendar Viewer.lnk'
    if ($Remove) {
        if (Test-Path -LiteralPath $shortcutPath) {
            Remove-Item -LiteralPath $shortcutPath
        }
        Write-Host 'Automatic startup disabled. The running server is unchanged.'
    } else {
        Get-Command node -ErrorAction Stop | Out-Null
        $launcher = Join-Path $PSScriptRoot 'run.ps1'
        if (-not (Test-Path -LiteralPath $launcher)) { throw 'run.ps1 is missing. Extract the complete application first.' }
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launcher + '"'
        if ($NoBrowser) { $shortcut.Arguments += ' -NoBrowser' }
        $shortcut.WorkingDirectory = $PSScriptRoot
        $shortcut.Description = 'Start ICS Calendar Viewer and open the calendar at sign-in'
        $shortcut.WindowStyle = 7
        $shortcut.Save()
        Write-Host 'Automatic startup enabled for your Windows account.'
        if ($NoBrowser) { Write-Host 'The calendar server will start when you next sign in.' }
        else { Write-Host 'The calendar server and browser will open when you next sign in.' }
        Write-Host 'Keep this application folder in its current location.'
    }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
