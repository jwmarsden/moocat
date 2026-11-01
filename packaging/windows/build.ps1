# moocat for Windows: dist\moocat.exe, launcher.exe and frontend\, zipped.
# Run on Windows (x64), from anywhere:
#
#   powershell -ExecutionPolicy Bypass -File packaging\windows\build.ps1
#     -> dist\publish\moocat-<ver>-windows-x64.zip
#
# Needs the WebView2 runtime (part of Windows 11) to run, nothing to build.
$ErrorActionPreference = 'Stop'
$root = Resolve-Path "$PSScriptRoot\..\.."
Set-Location $root
$version = (Get-Content packaging\TINYJS_VERSION -Raw).Trim()

# the pinned tinyjs, in its own home so it leaves any other install alone
$env:TINYJS_HOME = "$root\.tinyjs\$version"
$env:TINYJS_VERSION = "v$version"
$tinyjs = "$env:TINYJS_HOME\tinyjs.cmd"
if (-not (Test-Path $tinyjs)) {
  Invoke-RestMethod https://tinyjs.app/install.ps1 | Invoke-Expression
}

& $tinyjs build
if ($LASTEXITCODE) { throw "tinyjs build failed" }

$app = (Get-Content tinyjs.json -Raw | ConvertFrom-Json).version
New-Item -ItemType Directory -Force dist\publish | Out-Null
$zip = "dist\publish\moocat-$app-windows-x64.zip"
Get-ChildItem dist -Exclude publish | Compress-Archive -DestinationPath $zip -Force
Get-Item $zip
