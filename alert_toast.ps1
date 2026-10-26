# Shows one Windows toast. Called by alerts.js with base64 (UTF-8) arguments so no quoting can break the call.
param(
  [Parameter(Mandatory)][string]$Title,
  [string]$Body = '',
  [string]$Url = ''
)
$ErrorActionPreference = 'Stop'

function Decode([string]$value) {
  if (-not $value) { return '' }
  [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($value))
}
$title = Decode $Title
$body = Decode $Body
$url = Decode $Url

# A per-user registration gives the toast its own app name instead of "Windows PowerShell".
$appId = 'ICSCalendarViewer'
$key = "HKCU:\Software\Classes\AppUserModelId\$appId"
if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
New-ItemProperty -Path $key -Name DisplayName -Value 'ICS Calendar Viewer' -PropertyType String -Force | Out-Null

[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

$esc = { param($text) [Security.SecurityElement]::Escape($text) }
$join = ''
if ($url) { $join = '<action content="Join" arguments="' + (& $esc $url) + '" activationType="protocol"/>' }
# scenario="reminder" keeps the toast on screen until it is dismissed.
$xml = '<toast scenario="reminder"><visual><binding template="ToastGeneric"><text>' + (& $esc $title) + '</text><text>' + (& $esc $body) + '</text></binding></visual><actions>' + $join + '<action content="Dismiss" arguments="dismiss" activationType="system"/></actions></toast>'

$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show([Windows.UI.Notifications.ToastNotification]::new($doc))
