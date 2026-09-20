Add-Type -AssemblyName System.Drawing

$Root = (Get-Location).Path
$Src = Join-Path $Root "Atrium.png"
$master = [Drawing.Image]::FromFile($Src)
Write-Output "source: $($master.Width)x$($master.Height)"

function Save-Size($size, $dest) {
  $bmp = New-Object Drawing.Bitmap($size, $size)
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
  [void]$g.DrawImage($script:master, 0, 0, $size, $size)
  $g.Dispose()
  $dir = Split-Path $dest -Parent
  if ($dir -and -not (Test-Path $dir)) { $null = New-Item -ItemType Directory $dir }
  [void]$bmp.Save($dest, [Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "wrote $size x $size -> $dest"
}

function Save-PngBytes($size) {
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("atrium_{0}.png" -f $size)
  $null = Save-Size $size $tmp
  $b = [IO.File]::ReadAllBytes($tmp)
  Remove-Item $tmp
  Write-Host ("png {0}x{0}: {1} bytes" -f $size, $b.Length)
  return $b
}

# ── 1. plain PNG targets: size -> relative paths ──
$targets = @{
  512 = @("public/logo.png", "public/favicon.png", "src-tauri/icons/icon.png");
  256 = @("src-tauri/icons/128x128@2x.png");
  128 = @("src-tauri/icons/128x128.png");
  64  = @("src-tauri/icons/64x64.png");
  32  = @("public/favicon-32x32.png", "src-tauri/icons/32x32.png");
  50  = @("src-tauri/icons/StoreLogo.png");
  30  = @("src-tauri/icons/Square30x30Logo.png");
  44  = @("src-tauri/icons/Square44x44Logo.png");
  71  = @("src-tauri/icons/Square71x71Logo.png");
  89  = @("src-tauri/icons/Square89x89Logo.png");
  107 = @("src-tauri/icons/Square107x107Logo.png");
  142 = @("src-tauri/icons/Square142x142Logo.png");
  150 = @("src-tauri/icons/Square150x150Logo.png");
  284 = @("src-tauri/icons/Square284x284Logo.png");
  310 = @("src-tauri/icons/Square310x310Logo.png");
}
foreach ($size in $targets.Keys) {
  foreach ($rel in $targets[$size]) {
    Save-Size $size (Join-Path $Root $rel)
  }
}

# ── 2. Android mipmap (launcher / round / foreground) ──
$dens = @{ "mipmap-mdpi" = 48; "mipmap-hdpi" = 72; "mipmap-xhdpi" = 96; "mipmap-xxhdpi" = 144; "mipmap-xxxhdpi" = 192 }
foreach ($d in $dens.Keys) {
  $s = $dens[$d]
  Save-Size $s (Join-Path $Root "src-tauri/icons/android/$d/ic_launcher.png")
  Save-Size $s (Join-Path $Root "src-tauri/icons/android/$d/ic_launcher_round.png")
  Save-Size ($s * 3) (Join-Path $Root "src-tauri/icons/android/$d/ic_launcher_foreground.png")
}

# ── 3. iOS AppIcon set ──
$ios = @{
  "AppIcon-20x20@1x.png" = 20; "AppIcon-20x20@2x.png" = 40; "AppIcon-20x20@2x-1.png" = 40;
  "AppIcon-20x20@3x.png" = 60; "AppIcon-29x29@1x.png" = 29; "AppIcon-29x29@2x.png" = 58;
  "AppIcon-29x29@2x-1.png" = 58; "AppIcon-29x29@3x.png" = 87; "AppIcon-40x40@1x.png" = 40;
  "AppIcon-40x40@2x.png" = 80; "AppIcon-40x40@2x-1.png" = 80; "AppIcon-40x40@3x.png" = 120;
  "AppIcon-60x60@2x.png" = 120; "AppIcon-60x60@3x.png" = 180; "AppIcon-76x76@1x.png" = 76;
  "AppIcon-76x76@2x.png" = 152; "AppIcon-83.5x83.5@2x.png" = 167; "AppIcon-512@2x.png" = 1024;
}
foreach ($name in $ios.Keys) {
  Save-Size $ios[$name] (Join-Path $Root "src-tauri/icons/ios/$name")
}

# ── 4. Windows .ico (PNG-compressed entries Vista+) ──
$icoSizes = @(16, 24, 32, 48, 64, 128, 256)
$blobs = New-Object Collections.ArrayList
foreach ($s in $icoSizes) { [void]$blobs.Add((Save-PngBytes $s)) }
$ms = New-Object IO.MemoryStream
$bw = New-Object IO.BinaryWriter($ms)
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$icoSizes.Count)
$off = 6 + 16 * $icoSizes.Count
for ($i = 0; $i -lt $icoSizes.Count; $i++) {
  $s = $icoSizes[$i]
  if ($s -eq 256) { $bb = [byte]0 } else { $bb = [byte]$s }
  $bw.Write($bb)
  $bw.Write($bb)
  $bw.Write([byte]0); $bw.Write([byte]0)
  $bw.Write([uint16]1); $bw.Write([uint16]32)
  $bw.Write([uint32]$blobs[$i].Length); $bw.Write([uint32]$off)
  $off += $blobs[$i].Length
}
foreach ($bb in $blobs) { $bw.Write($bb, 0, $bb.Length) }
$bw.Flush()
$icoBytes = $ms.ToArray(); $bw.Close()
[IO.File]::WriteAllBytes((Join-Path $Root "src-tauri/icons/icon.ico"), $icoBytes)
[IO.File]::WriteAllBytes((Join-Path $Root "public/favicon.ico"), $icoBytes)
Write-Output ("wrote icon.ico + favicon.ico ({0} entries, {1} bytes)" -f $icoSizes.Count, $icoBytes.Length)

# ── 5. macOS .icns (PNG-compressed ic07..ic10) ──
function BE($writer, $u) {
  $bytes = [BitConverter]::GetBytes([uint32]$u)
  [Array]::Reverse($bytes)
  $writer.Write($bytes, 0, $bytes.Length)
}
$types = @{ "ic07" = 128; "ic08" = 256; "ic09" = 512; "ic10" = 1024 }
$entries = New-Object IO.MemoryStream
$ebw = New-Object IO.BinaryWriter($entries)
foreach ($t in @("ic07", "ic08", "ic09", "ic10")) {
  $png = Save-PngBytes $types[$t]
  [void]$ebw.Write([Text.Encoding]::ASCII.GetBytes($t))
  BE $ebw ($png.Length + 8)
  $ebw.Write($png, 0, $png.Length)
}
$ebw.Flush()
$eb = $entries.ToArray(); $ebw.Close()
$ms2 = New-Object IO.MemoryStream
$bw2 = New-Object IO.BinaryWriter($ms2)
[void]$bw2.Write([Text.Encoding]::ASCII.GetBytes("icns"))
BE $bw2 ($eb.Length + 8)
$bw2.Write($eb, 0, $eb.Length)
$bw2.Flush()
[IO.File]::WriteAllBytes((Join-Path $Root "src-tauri/icons/icon.icns"), $ms2.ToArray())
$bw2.Close()
Write-Output "wrote icon.icns"

$master.Dispose()
Write-Output "DONE"
