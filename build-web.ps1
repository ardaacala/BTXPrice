$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$output = Join-Path $root 'web'
$rootFull = [IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
$outputFull = [IO.Path]::GetFullPath($output)
if (-not $outputFull.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Web cikti dizini proje disinda.'
}

$utf8 = [Text.UTF8Encoding]::new($false)
$calc = [IO.File]::ReadAllText((Join-Path $root 'src\calc.js'), [Text.Encoding]::UTF8)
$tutorial = [IO.File]::ReadAllText((Join-Path $root 'src\tutorial.js'), [Text.Encoding]::UTF8)
$xlsx = [IO.File]::ReadAllText((Join-Path $root 'src\export-xlsx.js'), [Text.Encoding]::UTF8)
$app = [IO.File]::ReadAllText((Join-Path $root 'src\app.js'), [Text.Encoding]::UTF8)
$stripImports = '(?m)^import\s+.*?;\r?\n'
$stripExports = '(?m)^export\s+'
$bundle = @(
    [Text.RegularExpressions.Regex]::Replace($calc, $stripExports, ''),
    [Text.RegularExpressions.Regex]::Replace(([Text.RegularExpressions.Regex]::Replace($tutorial, $stripImports, '')), $stripExports, ''),
    [Text.RegularExpressions.Regex]::Replace(([Text.RegularExpressions.Regex]::Replace($xlsx, $stripImports, '')), $stripExports, ''),
    [Text.RegularExpressions.Regex]::Replace($app, $stripImports, '')
) -join "`r`n`r`n"

New-Item -Path $outputFull -ItemType Directory -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $outputFull 'bundle.js'), $bundle, $utf8)
[IO.File]::WriteAllText((Join-Path $root 'bundle.js'), $bundle, $utf8)
$html = [IO.File]::ReadAllText((Join-Path $root 'index.html'), [Text.Encoding]::UTF8)
$moduleTag = '<script type="module" src="./src/app.js"></script>'
$bundleTag = '<script src="./bundle.js"></script>'
if ($html.Contains($moduleTag)) { $html = $html.Replace($moduleTag, $bundleTag) }
elseif (-not $html.Contains($bundleTag)) { throw 'index.html icindeki uygulama betigi bulunamadi.' }
[IO.File]::WriteAllText((Join-Path $outputFull 'index.html'), $html, $utf8)

foreach ($name in @('style.css', 'tutorial.css', 'branding.css', 'app.ico')) {
    Copy-Item -LiteralPath (Join-Path $root $name) -Destination (Join-Path $outputFull $name) -Force
}
foreach ($folder in @('assets', 'vendor')) {
    New-Item -Path (Join-Path $outputFull $folder) -ItemType Directory -Force | Out-Null
}
Copy-Item -LiteralPath (Join-Path $root 'assets\biotex-price.png') -Destination (Join-Path $outputFull 'assets\biotex-price.png') -Force
Copy-Item -LiteralPath (Join-Path $root 'vendor\exceljs.min.js') -Destination (Join-Path $outputFull 'vendor\exceljs.min.js') -Force
Write-Output "Tarayici surumu hazir: $(Join-Path $outputFull 'index.html')"
