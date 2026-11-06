# Render local store drafts from WinDock's existing vector mark. No publishing.
param([string]$OutputDirectory = (Join-Path $PSScriptRoot '..\docs\play-assets'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
[xml]$mark = Get-Content (Join-Path $PSScriptRoot '..\website\assets\windock.svg') -Raw
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
function Draw-Mark($graphics, [single]$left, [single]$top, [single]$size) {
    foreach ($rect in $mark.svg.rect) {
        $x = $left + [single]$rect.x * $size / 256
        $y = $top + [single]$rect.y * $size / 256
        $w = [single]$rect.width * $size / 256
        $h = [single]$rect.height * $size / 256
        $d = [single]$rect.rx * 2 * $size / 256
        $path = [Drawing.Drawing2D.GraphicsPath]::new()
        $brush = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml($rect.fill))
        try {
            $path.AddArc($x, $y, $d, $d, 180, 90)
            $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
            $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
            $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
            $path.CloseFigure()
            $graphics.FillPath($brush, $path)
        } finally { $brush.Dispose(); $path.Dispose() }
    }
}
function Draw-Label($graphics, [string]$label, [single]$x, [single]$y, [single]$size, [string]$color, [bool]$bold = $false) {
    $style = if ($bold) { [Drawing.FontStyle]::Bold } else { [Drawing.FontStyle]::Regular }
    $font = [Drawing.Font]::new('Segoe UI', $size, $style, [Drawing.GraphicsUnit]::Pixel)
    $brush = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml($color))
    try { $graphics.DrawString($label, $font, $brush, $x, $y) }
    finally { $font.Dispose(); $brush.Dispose() }
}
foreach ($kind in @('store-icon', 'feature-graphic')) {
    $isIcon = $kind -eq 'store-icon'
    $width = if ($isIcon) { 512 } else { 1024 }
    $height = if ($isIcon) { 512 } else { 500 }
    $format = if ($isIcon) { [Drawing.Imaging.PixelFormat]::Format32bppArgb } else { [Drawing.Imaging.PixelFormat]::Format24bppRgb }
    $bitmap = [Drawing.Bitmap]::new($width, $height, $format)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        $graphics.Clear([Drawing.ColorTranslator]::FromHtml('#0B1019'))
        if ($isIcon) {
            # Full square background: Google Play supplies the outer mask and shadow.
            Draw-Mark $graphics 88 88 336
        } else {
            Draw-Mark $graphics 672 138 256
            Draw-Label $graphics 'WinDock' 68 78 26 '#82E7BF' $true
            Draw-Label $graphics "Your PC.`nWithin reach." 64 130 58 '#F0F5F8' $true
            Draw-Label $graphics 'Dock, touchpad and keyboard' 68 310 25 '#B6C8D6'
            Draw-Label $graphics 'Windows companion required' 68 370 18 '#8EA4B4'
        }
        $bitmap.Save((Join-Path $OutputDirectory "$kind.png"), [Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
}
Write-Output "Local store drafts rendered to $OutputDirectory"
