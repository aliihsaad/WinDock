# Rasterize the tray's simple vector mark into a multi-resolution Windows ICO.
# Run only when changing Assets/WinDock.svg; the generated ICO is checked in.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = Split-Path -Parent $PSScriptRoot
$assetDir = Join-Path $projectRoot 'native\tray\Assets'
[xml]$source = Get-Content -LiteralPath (Join-Path $assetDir 'WinDock.svg') -Raw
$frames = @()
foreach ($size in @(16, 20, 24, 32, 40, 48, 64, 128, 256)) {
    # Render each size from vectors, with pixel-aligned edges and antialiased corners.
    $bitmap = [Drawing.Bitmap]::new($size, $size, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([Drawing.Color]::Transparent)
    foreach ($rect in $source.svg.rect) {
        $x = [single][Math]::Round([double]$rect.x * $size / 256)
        $y = [single][Math]::Round([double]$rect.y * $size / 256)
        $width = [single][Math]::Round([double]$rect.width * $size / 256)
        $height = [single][Math]::Round([double]$rect.height * $size / 256)
        $diameter = [single][Math]::Max(2, [Math]::Round([double]$rect.rx * 2 * $size / 256))
        $shape = [Drawing.Drawing2D.GraphicsPath]::new()
        $shape.AddArc($x, $y, $diameter, $diameter, 180, 90)
        $shape.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
        $shape.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
        $shape.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
        $shape.CloseFigure()
        $brush = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml($rect.fill))
        $graphics.FillPath($brush, $shape)
        $brush.Dispose()
        $shape.Dispose()
    }
    $png = [IO.MemoryStream]::new()
    $bitmap.Save($png, [Drawing.Imaging.ImageFormat]::Png)
    $frames += @{ Size = $size; Bytes = $png.ToArray() }
    $png.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}
$output = [IO.File]::Create((Join-Path $assetDir 'WinDock.ico'))
$writer = [IO.BinaryWriter]::new($output)
try {
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]$frames.Count)
    $offset = 6 + 16 * $frames.Count
    foreach ($frame in $frames) {
        $dimension = if ($frame.Size -eq 256) { 0 } else { $frame.Size }
        $writer.Write([byte]$dimension)
        $writer.Write([byte]$dimension)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]32)
        $writer.Write([uint32]$frame.Bytes.Length)
        $writer.Write([uint32]$offset)
        $offset += $frame.Bytes.Length
    }
    foreach ($frame in $frames) { $writer.Write([byte[]]$frame.Bytes) }
} finally { $writer.Dispose(); $output.Dispose() }
Write-Output 'WinDock.ico generated: 16, 20, 24, 32, 40, 48, 64, 128, 256 pixels.'
