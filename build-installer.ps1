param(
    [switch]$SignedRelease,
    [switch]$UnsignedDevelopmentBuild,
    [string]$CodeSigningThumbprint = $env:BTX_CODE_SIGNING_THUMBPRINT,
    [string]$SignToolPath = $env:BTX_SIGNTOOL_PATH,
    [string]$TimestampUrl = 'http://timestamp.digicert.com',
    [string]$SeedDataPath = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($UnsignedDevelopmentBuild -and ($SignedRelease -or $CodeSigningThumbprint)) {
    throw 'UnsignedDevelopmentBuild imzali derleme secenekleriyle birlikte kullanilamaz.'
}
$signedRelease = $SignedRelease -or [bool]$CodeSigningThumbprint
if ($signedRelease) {
    if (-not $CodeSigningThumbprint) {
        throw 'Imzali kurulum icin guvenilir kod imzalama sertifikasinin thumbprint degeri gerekli. Imzasiz kisisel derleme icin -SignedRelease secenegini kullanmayin.'
    }
    $CodeSigningThumbprint = $CodeSigningThumbprint -replace '\s', ''
    if ($CodeSigningThumbprint -notmatch '^[0-9A-Fa-f]{40}$') { throw 'Kod imzalama sertifikasi thumbprint degeri 40 haneli SHA-1 hexadecimal olmali.' }
    if (-not $SignToolPath) {
        $signToolCommand = Get-Command signtool.exe -ErrorAction SilentlyContinue
        if ($signToolCommand) { $SignToolPath = $signToolCommand.Source }
    }
    if (-not $SignToolPath) {
        $localSignTool = Join-Path $env:LOCALAPPDATA 'BTXPrice\SigningTools\Microsoft.Windows.SDK.BuildTools.10.0.28000.2705\bin\10.0.28000.0\x64\signtool.exe'
        if (Test-Path -LiteralPath $localSignTool -PathType Leaf) { $SignToolPath = $localSignTool }
    }
    if (-not $SignToolPath -or -not (Test-Path -LiteralPath $SignToolPath -PathType Leaf)) {
        throw 'Windows SDK SignTool.exe bulunamadi. -SignToolPath ile tam yolunu belirtin.'
    }
    if ($TimestampUrl -notmatch '^https?://') { throw 'Gecerli bir RFC 3161 zaman damgasi URL adresi gerekli.' }
    $certificate = @(
        Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My |
            Where-Object { $_.Thumbprint -eq $CodeSigningThumbprint }
    ) | Select-Object -First 1
    if (-not $certificate -or -not $certificate.HasPrivateKey -or
        $certificate.NotAfter -le (Get-Date) -or
        $certificate.EnhancedKeyUsageList.Value -notcontains '1.3.6.1.5.5.7.3.3') {
        throw 'Gecerli, ozel anahtari bulunan bir Code Signing sertifikasi sertifika deposunda bulunamadi.'
    }
    $signStoreOption = @()
    if ($certificate.PSPath -like '*LocalMachine*') { $signStoreOption = @('/sm') }
    function Sign-BiotexFile([string]$FilePath) {
        & $SignToolPath sign @signStoreOption /sha1 $CodeSigningThumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 $FilePath
        if ($LASTEXITCODE -ne 0) { throw "Kod imzalama basarisiz: $FilePath" }
        & $SignToolPath verify /pa $FilePath
        if ($LASTEXITCODE -ne 0) { throw "Kod imzasi dogrulanamadi: $FilePath" }
    }
}

& (Join-Path $projectRoot 'installer\make-icon.ps1') | Out-Null
$stage = Join-Path $projectRoot 'build\installer-app'
$projectFull = [IO.Path]::GetFullPath($projectRoot).TrimEnd('\') + '\'
$stageFull = [IO.Path]::GetFullPath($stage)
if (-not $stageFull.StartsWith($projectFull, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Paketleme dizini proje dışında; işlem durduruldu.'
}
if (Test-Path -LiteralPath $stageFull) {
    Remove-Item -LiteralPath $stageFull -Recurse -Force
}
New-Item -Path $stageFull -ItemType Directory -Force | Out-Null

$utf8 = [Text.UTF8Encoding]::new($false)
$calc = [IO.File]::ReadAllText((Join-Path $projectRoot 'src\calc.js'), [Text.Encoding]::UTF8)
$tutorial = [IO.File]::ReadAllText((Join-Path $projectRoot 'src\tutorial.js'), [Text.Encoding]::UTF8)
$xlsx = [IO.File]::ReadAllText((Join-Path $projectRoot 'src\export-xlsx.js'), [Text.Encoding]::UTF8)
$app = [IO.File]::ReadAllText((Join-Path $projectRoot 'src\app.js'), [Text.Encoding]::UTF8)
$stripImports = '(?m)^import\s+.*?;\r?\n'
$stripExports = '(?m)^export\s+'
$bundle = @(
    [Text.RegularExpressions.Regex]::Replace($calc, $stripExports, ''),
    [Text.RegularExpressions.Regex]::Replace(([Text.RegularExpressions.Regex]::Replace($tutorial, $stripImports, '')), $stripExports, ''),
    [Text.RegularExpressions.Regex]::Replace(([Text.RegularExpressions.Regex]::Replace($xlsx, $stripImports, '')), $stripExports, ''),
    [Text.RegularExpressions.Regex]::Replace($app, $stripImports, '')
) -join "`r`n`r`n"
[IO.File]::WriteAllText((Join-Path $stageFull 'bundle.js'), $bundle, $utf8)

$html = [IO.File]::ReadAllText((Join-Path $projectRoot 'index.html'), [Text.Encoding]::UTF8)
$oldTag = '<script type="module" src="./src/app.js"></script>'
$bundleTag = '<script src="./bundle.js"></script>'
if ($html.Contains($oldTag)) { $html = $html.Replace($oldTag, $bundleTag) }
elseif (-not $html.Contains($bundleTag)) { throw 'index.html içindeki uygulama betiği bulunamadı.' }
if ($SeedDataPath) {
    $seedFull = [IO.Path]::GetFullPath((Join-Path $projectRoot $SeedDataPath))
    if (-not $seedFull.StartsWith($projectFull, [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $seedFull -PathType Leaf)) {
        throw 'Baslangic verisi proje icindeki gecerli bir JSON dosyasi olmali.'
    }
    $seedJson = [IO.File]::ReadAllText($seedFull, [Text.Encoding]::UTF8)
    try { $seed = $seedJson | ConvertFrom-Json -ErrorAction Stop }
    catch { throw 'Baslangic verisi gecerli JSON degil.' }
    if (-not $seed.settings -or $null -eq $seed.materials -or $null -eq $seed.recipes -or
        $null -eq $seed.profiles -or $null -eq $seed.sets) {
        throw 'Baslangic verisi BTXPrice kaydi degil.'
    }
    [IO.File]::WriteAllText((Join-Path $stageFull 'seed-data.js'),
        'globalThis.__BTXPRICE_SEED__ = ' + $seedJson.Trim() + ';', $utf8)
    $html = $html.Replace($bundleTag, '<script src="./seed-data.js"></script>' + "`r`n  " + $bundleTag)
}
[IO.File]::WriteAllText((Join-Path $stageFull 'index.html'), $html, $utf8)

foreach ($name in @('style.css', 'tutorial.css', 'branding.css', 'README.md', 'app.ico')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination (Join-Path $stageFull $name)
}
New-Item -Path (Join-Path $stageFull 'assets') -ItemType Directory -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'assets\biotex-price.png') -Destination (Join-Path $stageFull 'assets\biotex-price.png')
Copy-Item -LiteralPath (Join-Path $projectRoot 'desktop\main.cjs') -Destination (Join-Path $stageFull 'main.cjs')
Copy-Item -LiteralPath (Join-Path $projectRoot 'desktop\preload.cjs') -Destination (Join-Path $stageFull 'preload.cjs')
New-Item -Path (Join-Path $stageFull 'vendor') -ItemType Directory -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'vendor\exceljs.min.js') -Destination (Join-Path $stageFull 'vendor\exceljs.min.js')
$desktopPackage = @{ name = 'btx-price'; productName = 'Biotex Price'; version = '1.1.4'; main = 'main.cjs' } | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $stageFull 'package.json'), $desktopPackage, $utf8)

$nodeDirectory = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node -and (Test-Path -LiteralPath $nodeDirectory)) {
    $node = Get-ChildItem -LiteralPath $nodeDirectory -Filter node.exe -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -like '*OpenJS.NodeJS.LTS*' } | Select-Object -First 1
    if ($node) { $env:PATH = "$(Split-Path -Parent $node.FullName);$env:PATH" }
}
if (-not $node) { throw 'Node.js bulunamadi. Paketleme icin Node.js LTS kurun.' }
$packager = Join-Path $projectRoot 'node_modules\.bin\electron-packager.cmd'
if (-not (Test-Path -LiteralPath $packager)) { throw 'Electron paketleyici bulunamadi. npm ci komutunu calistirin.' }
$desktopOutput = Join-Path $projectRoot 'build\desktop'
$desktopFull = [IO.Path]::GetFullPath($desktopOutput)
if (-not $desktopFull.StartsWith($projectFull, [StringComparison]::OrdinalIgnoreCase)) { throw 'Masaustu cikti dizini proje disinda.' }
& $packager $stageFull 'Biotex Price' --platform=win32 --arch=x64 --out=$desktopFull --overwrite --asar --icon=(Join-Path $projectRoot 'app.ico') --executable-name='Biotex Price' --app-version=1.1.4
if ($LASTEXITCODE -ne 0) { throw "Electron paketleme basarisiz: $LASTEXITCODE" }
$desktopExecutable = Join-Path $desktopFull 'Biotex Price-win32-x64\Biotex Price.exe'
if (-not (Test-Path -LiteralPath $desktopExecutable)) { throw 'Masaustu uygulamasi olusturulamadi.' }
$desktopIcon = Join-Path $desktopFull 'Biotex Price-win32-x64\app.ico'
# Electron --asar simgeyi app.asar içine alır; Inno kısayolu ise {app}\app.ico yolunu kullanır.
Copy-Item -LiteralPath (Join-Path $projectRoot 'app.ico') -Destination $desktopIcon -Force
if (-not (Test-Path -LiteralPath $desktopIcon -PathType Leaf)) { throw 'Masaustu kisayolu simgesi paketlenemedi.' }
if ($signedRelease) {
    $appDirectory = Split-Path -Parent $desktopExecutable
    Get-ChildItem -LiteralPath $appDirectory -Recurse -File |
        Where-Object { $_.Extension -in @('.exe', '.dll', '.node') } |
        ForEach-Object {
            $signature = Get-AuthenticodeSignature -LiteralPath $_.FullName
            if ($signature.Status -eq 'NotSigned') { Sign-BiotexFile $_.FullName }
            elseif ($signature.Status -ne 'Valid') { throw "Gecersiz mevcut kod imzasi: $($_.FullName)" }
        }
}

$compilerCandidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
    'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
    'C:\Program Files\Inno Setup 6\ISCC.exe'
)
$compilerOnPath = Get-Command ISCC.exe -ErrorAction SilentlyContinue
if ($compilerOnPath) { $compilerCandidates = @($compilerOnPath.Source) + $compilerCandidates }
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $compiler) { throw 'Inno Setup 6 derleyicisi (ISCC.exe) bulunamadı.' }

$installerScript = Join-Path $projectRoot 'installer\BTXPrice.iss'
if ($signedRelease) {
    $innoSignCommand = '/Sbtx=$q' + $SignToolPath + '$q sign ' + ($signStoreOption -join ' ') + ' /sha1 ' + $CodeSigningThumbprint +
        ' /fd SHA256 /tr ' + $TimestampUrl + ' /td SHA256 $f'
    & $compiler '/DSIGNED_RELEASE=1' $innoSignCommand $installerScript
} else {
    & $compiler $installerScript
}
if ($LASTEXITCODE -ne 0) { throw "Inno Setup derlemesi başarısız oldu: $LASTEXITCODE" }
$setup = Join-Path $projectRoot 'dist\BTXPrice-Setup-1.1.4.exe'
if ($signedRelease) {
    & $SignToolPath verify /pa $setup
    if ($LASTEXITCODE -ne 0) { throw "Kurulum dosyasinin kod imzasi dogrulanamadi: $setup" }
}
Write-Output $setup
