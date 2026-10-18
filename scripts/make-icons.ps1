# Generates the PWA/app icons: full-bleed brand teal with a white rupee glyph.
# The glyph sits inside the maskable safe zone, so the same files serve
# purpose "any" and "maskable". Run from the project root:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-icons.ps1
Add-Type -AssemblyName System.Drawing

$public = Join-Path $PSScriptRoot "..\public"
if (-not (Test-Path $public)) { New-Item -ItemType Directory -Path $public | Out-Null }

function New-Icon([int]$size, [string]$path) {
  $master = 1024
  $bmp = New-Object System.Drawing.Bitmap($master, $master)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::FromArgb(255, 0x0F, 0x76, 0x6E)) # --primary #0f766e

  $font = New-Object System.Drawing.Font("Segoe UI", 600, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rupee = [string][char]0x20B9
  $box = New-Object System.Drawing.RectangleF(0, -20, $master, $master)
  $g.DrawString($rupee, $font, [System.Drawing.Brushes]::White, $box, $format)
  $g.Dispose()

  $out = New-Object System.Drawing.Bitmap($size, $size)
  $g2 = [System.Drawing.Graphics]::FromImage($out)
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g2.DrawImage($bmp, 0, 0, $size, $size)
  $g2.Dispose()
  $out.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $out.Dispose()
  $bmp.Dispose()
  Write-Host "wrote $path ($size x $size)"
}

New-Icon 512 (Join-Path $public "icon-512.png")
New-Icon 192 (Join-Path $public "icon-192.png")
New-Icon 180 (Join-Path $public "apple-touch-icon.png")
