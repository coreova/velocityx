param(
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
$rootFull = [System.IO.Path]::GetFullPath($root).TrimEnd('\')
$releaseDir = Join-Path $root "release"
$releaseFull = [System.IO.Path]::GetFullPath($releaseDir).TrimEnd('\')
$stagingRoot = Join-Path $releaseDir ".staging"

if (-not $releaseFull.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Release directory safety check failed: $releaseFull is not inside $rootFull"
}

function Read-JsonFile {
  param([string]$Path)
  Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Assert-File {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Missing required file: $Path"
  }
}

function Copy-ExtensionPayload {
  param([string]$Destination)

  New-Item -ItemType Directory -Force -Path $Destination | Out-Null

  $dirs = @(
    "_locales",
    "devtools",
    "icons",
    "options",
    "popup",
    "shared"
  )

  $files = @(
    "background.js",
    "content-bridge.js",
    "content.js",
    "inject.js",
    "manifest.json",
    "LICENSE",
    "PRIVACY_POLICY.md",
    "README.md",
    "AUTHORS.md"
  )

  foreach ($dir in $dirs) {
    $source = Join-Path $root $dir
    if (-not (Test-Path -LiteralPath $source -PathType Container)) {
      throw "Missing required directory: $dir"
    }
    Copy-Item -LiteralPath $source -Destination $Destination -Recurse -Force
  }

  foreach ($file in $files) {
    $source = Join-Path $root $file
    Assert-File $source
    Copy-Item -LiteralPath $source -Destination $Destination -Force
  }
}

function Write-FirefoxManifest {
  param(
    [string]$SourceManifest,
    [string]$DestinationManifest
  )

  $manifest = Read-JsonFile $SourceManifest
  $manifest.PSObject.Properties.Remove("minimum_chrome_version")
  $manifest.PSObject.Properties.Remove("background")
  $manifest.PSObject.Properties.Remove("browser_specific_settings")

  $manifest | Add-Member -NotePropertyName "background" -NotePropertyValue ([ordered]@{
    scripts = @("background.js")
  })
  $manifest | Add-Member -NotePropertyName "browser_specific_settings" -NotePropertyValue ([ordered]@{
    gecko = [ordered]@{
      id = "velocityx@coreova.github.io"
      strict_min_version = "109.0"
    }
  })

  $manifest | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $DestinationManifest -Encoding UTF8
}

function New-ZipFromDirectory {
  param(
    [string]$SourceDirectory,
    [string]$ZipPath
  )

  if (Test-Path -LiteralPath $ZipPath) {
    Remove-Item -LiteralPath $ZipPath -Force
  }

  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::Open(
    $ZipPath,
    [System.IO.Compression.ZipArchiveMode]::Create
  )
  try {
    $base = [System.IO.Path]::GetFullPath($SourceDirectory).TrimEnd('\') + '\'
    Get-ChildItem -LiteralPath $SourceDirectory -Recurse -File | ForEach-Object {
      $full = [System.IO.Path]::GetFullPath($_.FullName)
      $relative = $full.Substring($base.Length).Replace('\', '/')
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $archive,
        $_.FullName,
        $relative,
        [System.IO.Compression.CompressionLevel]::Optimal
      ) | Out-Null
    }
  } finally {
    $archive.Dispose()
  }
}

function Assert-ZipHasRootManifest {
  param([string]$ZipPath)

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    $rootManifest = $archive.Entries | Where-Object { $_.FullName -eq "manifest.json" } | Select-Object -First 1
    if (-not $rootManifest) {
      throw "$ZipPath does not contain manifest.json at the ZIP root"
    }
    $nestedManifest = $archive.Entries | Where-Object { $_.FullName -match "/manifest\.json$" } | Select-Object -First 1
    if ($nestedManifest) {
      throw "$ZipPath contains a nested manifest: $($nestedManifest.FullName)"
    }
  } finally {
    $archive.Dispose()
  }
}

function Assert-LinkHygiene {
  param([string]$Directory)

  $banned = @("github.com", ("maruf" + "ahmed" + "limon"), "velocityx") -join "/"
  $textExtensions = @(".json", ".js", ".html", ".css", ".md", ".txt")
  Get-ChildItem -LiteralPath $Directory -Recurse -File | ForEach-Object {
    if ($textExtensions -contains $_.Extension.ToLowerInvariant()) {
      $text = Get-Content -LiteralPath $_.FullName -Raw
      if ($text.Contains($banned)) {
        throw "Old personal repo link found in $($_.FullName)"
      }
    }
  }
}

function Assert-Attribution {
  param([string]$Directory)

  $licensePath = Join-Path $Directory "LICENSE"
  $authorsPath = Join-Path $Directory "AUTHORS.md"
  Assert-File $licensePath
  Assert-File $authorsPath

  $licenseText = Get-Content -LiteralPath $licensePath -Raw
  if (-not $licenseText.Contains("Copyright (c) 2026 Coreova")) {
    throw "LICENSE should use Coreova as the 2026 MIT copyright holder"
  }
  if ($licenseText.Contains("Copyright (c) 2026 Maruf Ahmed Limon")) {
    throw "LICENSE still contains the old individual copyright holder line"
  }

  $authorsText = Get-Content -LiteralPath $authorsPath -Raw
  if (-not $authorsText.Contains("Coreova - public publisher, project maintainer, and MIT license holder.")) {
    throw "AUTHORS.md is missing Coreova publisher/license attribution"
  }
  if (-not $authorsText.Contains("Maruf Ahmed Limon - original creator of VelocityX.")) {
    throw "AUTHORS.md is missing creator attribution"
  }
}

function Assert-Manifest {
  param([string]$ManifestPath)

  $manifest = Read-JsonFile $ManifestPath
  $permissions = @($manifest.permissions)
  $expected = @("storage", "tabs", "scripting")
  if (($permissions -join "|") -ne ($expected -join "|")) {
    throw "Manifest permissions changed in ${ManifestPath}: $($permissions -join ', ')"
  }
  foreach ($size in @("16", "32", "48", "128")) {
    $iconPath = $manifest.icons.PSObject.Properties[$size].Value
    Assert-File (Join-Path (Split-Path -Parent $ManifestPath) $iconPath)
  }
  foreach ($size in @("16", "24", "32", "48")) {
    $iconPath = $manifest.action.default_icon.PSObject.Properties[$size].Value
    Assert-File (Join-Path (Split-Path -Parent $ManifestPath) $iconPath)
  }
}

$manifestPath = Join-Path $root "manifest.json"
$manifest = Read-JsonFile $manifestPath
if (-not $Version) {
  $Version = $manifest.version
}
$versionTag = "v$Version"

if (Test-Path -LiteralPath $releaseDir) {
  Remove-Item -LiteralPath $releaseDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null

$packageSpecs = @(
  [ordered]@{ Name = "chrome-web-store"; Browser = "Chrome Web Store"; Zip = "velocityx-chrome-web-store-$versionTag.zip"; Firefox = $false },
  [ordered]@{ Name = "edge-addons"; Browser = "Microsoft Edge Add-ons"; Zip = "velocityx-edge-addons-$versionTag.zip"; Firefox = $false },
  [ordered]@{ Name = "brave-opera-chromium"; Browser = "Brave, Opera, Vivaldi, Chromium"; Zip = "velocityx-brave-opera-chromium-$versionTag.zip"; Firefox = $false },
  [ordered]@{ Name = "firefox-amo"; Browser = "Firefox AMO"; Zip = "velocityx-firefox-amo-$versionTag.zip"; Firefox = $true }
)

$results = @()

foreach ($spec in $packageSpecs) {
  $packageDir = Join-Path $stagingRoot $spec.Name
  Copy-ExtensionPayload $packageDir

  if ($spec.Firefox) {
    $firefoxManifest = Join-Path $packageDir "manifest.json"
    Write-FirefoxManifest -SourceManifest (Join-Path $root "manifest.json") -DestinationManifest $firefoxManifest
    Copy-Item -LiteralPath $firefoxManifest -Destination (Join-Path $releaseDir "firefox-manifest.generated.json") -Force
  }

  Assert-Manifest (Join-Path $packageDir "manifest.json")
  Assert-LinkHygiene $packageDir
  Assert-Attribution $packageDir

  $zipPath = Join-Path $releaseDir $spec.Zip
  New-ZipFromDirectory -SourceDirectory $packageDir -ZipPath $zipPath
  Assert-ZipHasRootManifest $zipPath

  $item = Get-Item -LiteralPath $zipPath
  $results += [pscustomobject]@{
    Browser = $spec.Browser
    Package = $item.Name
    SizeKB = [math]::Round($item.Length / 1KB, 1)
  }
}

Remove-Item -LiteralPath $stagingRoot -Recurse -Force

$results | Format-Table -AutoSize
Write-Host "Release packages created in $releaseDir"
