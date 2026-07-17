# Renders the OCTA octagon mark to PNGs (192 + 512) using System.Drawing.
# Re-run this if the mark design changes. Output goes to the project root.
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot

# Mark geometry in a 100-unit space (matches icon.svg safe area, r=37.5 / 26.25).
$outer = @(84.65,64.35, 64.35,84.65, 35.65,84.65, 15.35,64.35, 15.35,35.65, 35.65,15.35, 64.35,15.35, 84.65,35.65)
$inner = @(74.25,60.05, 60.05,74.25, 39.95,74.25, 25.75,60.05, 25.75,39.95, 39.95,25.75, 60.05,25.75, 74.25,39.95)
# One LED per vertex, clockwise from top-left: 2x red, 2x orange, 2x yellow, 2x cream.
$ledPts = @(35.65,15.35, 64.35,15.35, 84.65,35.65, 84.65,64.35, 64.35,84.65, 35.65,84.65, 15.35,64.35, 15.35,35.65)
$ledCols = @('e0453a','e0453a','f08a24','f08a24','f2c94c','f2c94c','f5f0e6','f5f0e6')

function HexColor([string]$hex) {
  [System.Drawing.Color]::FromArgb(
    [Convert]::ToInt32($hex.Substring(0,2),16),
    [Convert]::ToInt32($hex.Substring(2,2),16),
    [Convert]::ToInt32($hex.Substring(4,2),16))
}

function ToPoints($coords, $scale) {
  $pts = New-Object System.Collections.Generic.List[System.Drawing.PointF]
  for ($i = 0; $i -lt $coords.Count; $i += 2) {
    $pts.Add([System.Drawing.PointF]::new([float]($coords[$i]*$scale), [float]($coords[$i+1]*$scale)))
  }
  # Return as a typed PointF[] so method overload resolution doesn't pick Point.
  return [System.Drawing.PointF[]]$pts.ToArray()
}

function Render([int]$size) {
  $s = $size / 100.0
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

  # Background
  $g.Clear((HexColor '16181c'))

  # Outer octagon: fill + 3px stroke (scaled).
  [System.Drawing.PointF[]]$outerPts = ToPoints $outer $s
  $fill = New-Object System.Drawing.SolidBrush((HexColor '22252b'))
  $g.FillPolygon($fill, $outerPts)
  $penOuter = New-Object System.Drawing.Pen((HexColor 'f5f0e6'), [float](3*$s))
  $penOuter.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $g.DrawPolygon($penOuter, $outerPts)

  # Inner concentric octagon: 1.5px stroke.
  [System.Drawing.PointF[]]$innerPts = ToPoints $inner $s
  $penInner = New-Object System.Drawing.Pen((HexColor '3a3f47'), [float](1.5*$s))
  $penInner.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $g.DrawPolygon($penInner, $innerPts)

  # Vertex LEDs.
  $r = 3.3 * $s
  for ($i = 0; $i -lt 8; $i++) {
    $cx = $ledPts[$i*2] * $s
    $cy = $ledPts[$i*2+1] * $s
    $b = New-Object System.Drawing.SolidBrush((HexColor $ledCols[$i]))
    $g.FillEllipse($b, [float]($cx-$r), [float]($cy-$r), [float]($r*2), [float]($r*2))
  }

  # Centre LED.
  $rc = 4.7 * $s
  $centre = New-Object System.Drawing.SolidBrush((HexColor 'ffb84d'))
  $g.FillEllipse($centre, [float](50*$s-$rc), [float](50*$s-$rc), [float]($rc*2), [float]($rc*2))

  $g.Dispose()
  $out = Join-Path $root "icon-$size.png"
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "wrote $out"
}

Render 192
Render 512
