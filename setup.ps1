# Windows setup: puts a private copy of Node.js in .node\ and installs the kit's two
# packages next to it. No admin rights, no PATH change, nothing installed system-wide.
# Safe to run again.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # the progress bar makes Invoke-WebRequest very slow in PowerShell 5.1

$NodeVersion = 'v24.22.0'
# From https://nodejs.org/dist/v24.22.0/SHASUMS256.txt
$NodeSha256 = 'f9683a19877e12a9b167305c8db71040d812876359de21f0d2e97c3f321f80c3'

$Kit = $PSScriptRoot
$NodeDir = Join-Path $Kit '.node'
$NodeExe = Join-Path $NodeDir 'node.exe'
$Name = "node-$NodeVersion-win-x64"

[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$have = ''
if (Test-Path $NodeExe) { $have = (& $NodeExe --version) }
if ($have -ne $NodeVersion) {
  # Download inside the kit folder so the final move never crosses drives.
  $tmp = Join-Path $Kit '.node-download'
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  New-Item -ItemType Directory $tmp | Out-Null
  try {
    $zip = Join-Path $tmp "$Name.zip"
    Write-Host "Downloading Node.js $NodeVersion ..."
    Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$NodeVersion/$Name.zip" -OutFile $zip
    $hash = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLower()
    if ($hash -ne $NodeSha256) { throw "The Node.js download does not match its published checksum (got $hash). Nothing was installed." }
    Write-Host 'Unpacking Node.js ...'
    $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
    if (Test-Path $tar) {
      & $tar -xf $zip -C $tmp
      if ($LASTEXITCODE -ne 0) { throw "Unpacking Node.js failed (tar exit $LASTEXITCODE)." }
    } else {
      Expand-Archive -Path $zip -DestinationPath $tmp
    }
    if (Test-Path $NodeDir) { Remove-Item -Recurse -Force $NodeDir }
    Move-Item (Join-Path $tmp $Name) $NodeDir
  } finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
}

Write-Host "Installing the kit's packages ..."
Push-Location $Kit
try {
  # --ignore-scripts: no package gets to run code at install time.
  # --cache inside .node\ keeps everything in the kit folder, so deleting it removes all.
  & $NodeExe (Join-Path $NodeDir 'node_modules\npm\bin\npm-cli.js') ci --ignore-scripts --no-audit --no-fund --no-update-notifier --cache (Join-Path $NodeDir 'npm-cache')
  if ($LASTEXITCODE -ne 0) { throw "Installing packages failed (npm exit $LASTEXITCODE)." }
} finally {
  Pop-Location
}
Write-Host 'Setup finished.'
