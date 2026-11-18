$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $projectRoot 'assets\biotex-price.png'
$outputPath = Join-Path $projectRoot 'app.ico'
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$pngImages = @()
$source = [Drawing.Image]::FromFile($sourcePath)

try {
    foreach ($size in $sizes) {
        $bitmap = [Drawing.Bitmap]::new($size, $size, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        $memory = [IO.MemoryStream]::new()
        try {
            $graphics.Clear([Drawing.Color]::Transparent)
            $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::HighQuality
            $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $height = [int][Math]::Round($size * $source.Height / $source.Width)
            $rectangle = [Drawing.Rectangle]::new(0, [int](($size - $height) / 2), $size, $height)
            $graphics.DrawImage($source, $rectangle)
            $bitmap.Save($memory, [Drawing.Imaging.ImageFormat]::Png)
            $pngImages += ,$memory.ToArray()
        }
        finally {
            $memory.Dispose()
            $graphics.Dispose()
            $bitmap.Dispose()
        }
    }
}
finally { $source.Dispose() }

$stream = [IO.FileStream]::new($outputPath, [IO.FileMode]::Create)
$writer = [IO.BinaryWriter]::new($stream)
try {
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]$sizes.Count)
    $offset = 6 + 16 * $sizes.Count
    for ($i = 0; $i -lt $sizes.Count; $i++) {
        $iconSize = if ($sizes[$i] -eq 256) { 0 } else { $sizes[$i] }
        $writer.Write([byte]$iconSize)
        $writer.Write([byte]$iconSize)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]32)
        $writer.Write([uint32]$pngImages[$i].Length)
        $writer.Write([uint32]$offset)
        $offset += $pngImages[$i].Length
    }
    foreach ($png in $pngImages) { $writer.Write($png) }
}
finally { $writer.Dispose() }

Write-Output $outputPath
