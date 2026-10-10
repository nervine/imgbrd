$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) {
  Write-Error "Der C#-Compiler wurde nicht gefunden."
  exit 1
}
$root = Split-Path $PSScriptRoot -Parent
& $csc /nologo /target:winexe /optimize+ /r:System.Windows.Forms.dll /r:System.Drawing.dll "/out:$root\imgbrd.exe" "$PSScriptRoot\ImgbrdTray.cs"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output "imgbrd.exe erstellt"
