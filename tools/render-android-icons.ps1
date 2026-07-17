# Renders the OCTA octagon mark into the Android launcher icons (adaptive +
# legacy) for every density, so the installed app shows the favicon mark
# instead of the default Capacitor logo. Re-run if the mark design changes,
# then rebuild the APK. Uses System.Drawing (same approach as render-icons.ps1).
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$res  = Join-Path $root 'android\app\src\main\res'

# ── Mark geometry in a 100-unit space (matches icon.svg safe area) ──────────
$outer   = @(84.65,64.35, 64.35,84.65, 35.65,84.65, 15.35,64.35, 15.35,35.65, 35.65,15.35, 64.35,15.35, 84.65,35.65)
$inner   = @(74.25,60.05, 60.05,74.25, 39.95,74.25, 25.75,60.05, 25.75,39.95, 39.95,25.75, 60.05,25.75, 74.25,39.95)
$ledPts  = @(35.65,15.35, 64.35,15.35, 84.65,35.65, 84.65,64.35, 64.35,84.65, 35.65,84.65, 15.35,64.35, 15.35,35.65)
$ledCols = @('e0453a','e0453a','f08a24','f08a24','f2c94c','f2c94c','f5f0e6','f5f0e6')

$BG = '16181c'  # app background / adaptive background colour

function HexColor([string]$hex) {
  [System.Drawing.Color]::FromArgb(
    [Convert]::ToInt32($hex.Substring(0,2),16),
    [Convert]::ToInt32($hex.Substring(2,2),16),
    [Convert]::ToInt32($hex.Substring(4,2),16))
}

# Map 100-unit design coords -> pixel PointF[] via scale k (px/unit) about centre.
function ToPoints($coords, [double]$k, [double]$cx0, [double]$cy0) {
  $pts = New-Object System.Collections.Generic.List[System.Drawing.PointF]
  for ($i = 0; $i -lt $coords.Count; $i += 2) {
    $pts.Add([System.Drawing.PointF]::new([float]($cx0 + $coords[$i]*$k), [float]($cy0 + $coords[$i+1]*$k)))
  }
  return [System.Drawing.PointF[]]$pts.ToArray()
}

# Draw the octagon mark (no background). k = px per design-unit; the design is
# centred so unit (50,50) lands at the canvas centre.
function Draw-Mark($g, [int]$size, [double]$k) {
  $cx0 = $size/2.0 - 50*$k
  $cy0 = $size/2.0 - 50*$k

  [System.Drawing.PointF[]]$outerPts = ToPoints $outer $k $cx0 $cy0
  $fill = New-Object System.Drawing.SolidBrush((HexColor '22252b'))
  $g.FillPolygon($fill, $outerPts)
  $penOuter = New-Object System.Drawing.Pen((HexColor 'f5f0e6'), [float](3*$k))
  $penOuter.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $g.DrawPolygon($penOuter, $outerPts)

  [System.Drawing.PointF[]]$innerPts = ToPoints $inner $k $cx0 $cy0
  $penInner = New-Object System.Drawing.Pen((HexColor '3a3f47'), [float](1.5*$k))
  $penInner.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $g.DrawPolygon($penInner, $innerPts)

  $r = 3.3 * $k
  for ($i = 0; $i -lt 8; $i++) {
    $cx = $cx0 + $ledPts[$i*2]   * $k
    $cy = $cy0 + $ledPts[$i*2+1] * $k
    $b = New-Object System.Drawing.SolidBrush((HexColor $ledCols[$i]))
    $g.FillEllipse($b, [float]($cx-$r), [float]($cy-$r), [float]($r*2), [float]($r*2))
  }
  $rc = 4.7 * $k
  $centre = New-Object System.Drawing.SolidBrush((HexColor 'ffb84d'))
  $g.FillEllipse($centre, [float]($size/2.0-$rc), [float]($size/2.0-$rc), [float]($rc*2), [float]($rc*2))
}

function NewGraphics($bmp) {
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  return $g
}

# Adaptive foreground: transparent, mark shrunk into the central safe zone so
# Android's mask (circle/squircle/…) never clips the corner LEDs.
function Save-Foreground([int]$size, [string]$path) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = NewGraphics $bmp
  Draw-Mark $g $size ([double](0.86 * $size / 100.0))
  $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
}

# Legacy square/round icon: dark background (rounded-rect or circle) + full mark.
function Save-Legacy([int]$size, [string]$path, [bool]$round) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = NewGraphics $bmp
  $clip = New-Object System.Drawing.Drawing2D.GraphicsPath
  if ($round) {
    $clip.AddEllipse(0, 0, $size, $size)
  } else {
    $r = [float]($size * 0.18); $d = $r * 2
    $clip.AddArc(0, 0, $d, $d, 180, 90)
    $clip.AddArc($size-$d, 0, $d, $d, 270, 90)
    $clip.AddArc($size-$d, $size-$d, $d, $d, 0, 90)
    $clip.AddArc(0, $size-$d, $d, $d, 90, 90)
    $clip.CloseFigure()
  }
  $g.SetClip($clip)
  $g.Clear((HexColor $BG))
  Draw-Mark $g $size ([double]($size / 100.0))
  $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
}

# Density buckets: [foreground(108dp), legacy(48dp)].
$dens = @{
  'mdpi'    = @(108, 48)
  'hdpi'    = @(162, 72)
  'xhdpi'   = @(216, 96)
  'xxhdpi'  = @(324, 144)
  'xxxhdpi' = @(432, 192)
}

foreach ($d in $dens.Keys) {
  $fg = $dens[$d][0]; $lg = $dens[$d][1]
  $dir = Join-Path $res "mipmap-$d"
  Save-Foreground $fg (Join-Path $dir 'ic_launcher_foreground.png')
  Save-Legacy $lg (Join-Path $dir 'ic_launcher.png')       $false
  Save-Legacy $lg (Join-Path $dir 'ic_launcher_round.png') $true
  Write-Host "wrote mipmap-$d  (fg $fg, legacy $lg)"
}
Write-Host 'Android launcher icons rendered.'
