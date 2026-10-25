# Gundam tricolor paint v2: BGRA order fixed, nose before cyan, turbine zones protected
Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Bitmap]::FromFile("D:\2-Development\BoomThere-Deve\BoomThere\src\assets\jet.png")
$w = $src.Width; $h = $src.Height
$bmp = New-Object System.Drawing.Bitmap($w, $h)

$rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
$sd = $src.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$dd = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::WriteOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$bytes = [Math]::Abs($sd.Stride) * $h
$buf = New-Object byte[] $bytes
[System.Runtime.InteropServices.Marshal]::Copy($sd.Scan0, $buf, 0, $bytes)

function In-Rect([int]$x, [int]$y, [int]$x0, [int]$y0, [int]$x1, [int]$y1) {
  return ($x -ge $x0 -and $x -le $x1 -and $y -ge $y0 -and $y -le $y1)
}

$cx = [int]($w / 2)
for ($y = 0; $y -lt $h; $y++) {
  $row = $y * $sd.Stride
  for ($x = 0; $x -lt $w; $x++) {
    $i = $row + $x * 4
    $a = $buf[$i + 3]
    if ($a -eq 0) { continue }

    $r = [int]$buf[$i + 2]; $g = [int]$buf[$i + 1]; $b = [int]$buf[$i]
    $v = [Math]::Max($r, [Math]::Max($g, $b))
    $min = [Math]::Min($r, [Math]::Min($g, $b))
    $sat = 0; if ($v -gt 0) { $sat = ($v - $min) / $v }

    # 1) baked soft shadow -> untouched
    if ($a -lt 200 -and $v -lt 90) { continue }

    # zones
    $inNose = (In-Rect $x $y 292 26 350 140)                                  # teal nose cone -> RED
    $inSpine = ($x -ge ($cx - 42) -and $x -le ($cx + 42) -and $y -ge 140 -and $y -le 470)  # central spine -> BLUE
    $wingLtip = (In-Rect $x $y 75 335 148 452)                                # left wingtip -> RED
    $wingRtip = (In-Rect $x $y 492 335 565 452)                               # right wingtip -> RED
    $dTurL = [Math]::Pow(($x - 152), 2) + [Math]::Pow(($y - 398), 2)
    $dTurR = [Math]::Pow(($x - 452), 2) + [Math]::Pow(($y - 398), 2)
    $inTurbine = ($dTurL -lt 4225 -or $dTurR -lt 4225)                        # engine turbines -> keep

    # 2) red parts (nose + wingtips) — before cyan rule so teal nose gets painted
    if ($inNose) {
      $k = 0.5 + 0.5 * ($v / 255.0)
      $buf[$i] = [byte][Math]::Min(255, [int](52 * $k))      # B
      $buf[$i + 1] = [byte][Math]::Min(255, [int](48 * $k))  # G
      $buf[$i + 2] = [byte][Math]::Min(255, [int](226 * $k)) # R
      continue
    }
    if ($wingLtip -or $wingRtip) {
      $k = 0.55 + 0.45 * ($v / 255.0)
      $buf[$i] = [byte][Math]::Min(255, [int](58 * $k))
      $buf[$i + 1] = [byte][Math]::Min(255, [int](56 * $k))
      $buf[$i + 2] = [byte][Math]::Min(255, [int](226 * $k))
      continue
    }
    # 3) turbine rings: keep original cyan
    if ($inTurbine -and $sat -gt 0.15) { continue }
    # 4) cyan engine/nozzle/exhaust glow -> untouched
    $cyan = ($b -ge $g -and $g -gt $r -and $sat -gt 0.25)
    if ($cyan) { continue }

    # 5) blue fuselage spine
    if ($inSpine) {
      $k = 0.5 + 0.5 * ($v / 255.0)
      $buf[$i] = [byte][Math]::Min(255, [int](198 * $k))     # B
      $buf[$i + 1] = [byte][Math]::Min(255, [int](102 * $k)) # G
      $buf[$i + 2] = [byte][Math]::Min(255, [int](60 * $k))  # R
      continue
    }

    # 6) wings / everything else -> pure white armor
    $nv = 240 + [int](($v / 255.0) * 15)
    if ($nv -gt 255) { $nv = 255 }
    $buf[$i] = [byte]$nv
    $buf[$i + 1] = [byte]$nv
    $buf[$i + 2] = [byte][Math]::Min(255, ($nv + 3))
  }
}

[System.Runtime.InteropServices.Marshal]::Copy($buf, 0, $dd.Scan0, $bytes)
$bmp.UnlockBits($dd)
$src.UnlockBits($sd)

$bmp.Save("D:\2-Development\BoomThere-Deve\BoomThere\tools\gundam-full.png", [System.Drawing.Imaging.ImageFormat]::Png)
$small = New-Object System.Drawing.Bitmap($bmp, 150, 150)
$small.Save("D:\2-Development\BoomThere-Deve\BoomThere\tools\gundam-small.png", [System.Drawing.Imaging.ImageFormat]::Png)
$small.Dispose(); $bmp.Dispose(); $src.Dispose()
Write-Host "painted v2"
