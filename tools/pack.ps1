# pack.ps1 —— 一键打包 Chrome 扩展为 .crx
# 用法：
#   powershell -ExecutionPolicy Bypass -File .\tools\pack.ps1
# 可选参数：
#   -Key "D:\keys\my.pem"     指定已有私钥（升级扩展时必须复用同一私钥）

[CmdletBinding()]
param(
  [string]$Key = ""
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root      = Split-Path -Parent $ScriptDir
$BuildDir  = Join-Path $Root "_build"
$DistDir   = Join-Path $Root "dist"
$CrxOut    = Join-Path $DistDir "et-extension.crx"
$KeyOut    = Join-Path $DistDir "et-key.pem"

# 1. 浏览器查找
function Find-Browser {
  $candidates = @(
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "C:\Program Files\Google\Chrome\Application\chrome.exe"
  )
  foreach ($p in $candidates) {
    if ($p -and (Test-Path $p)) { return (Resolve-Path $p).Path }
  }
  return $null
}

# 2. 准备纯净构建目录
$Exclude = @('_build', 'dist', 'node_modules', '.git', '.idea', '.vscode', 'Thumbs.db', '.DS_Store', 'tools', '.gitignore')
if (Test-Path $BuildDir) { Remove-Item -Recurse -Force $BuildDir }
New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null
Write-Host "[1/4] 复制源文件到 $BuildDir ..."
Get-ChildItem -Path $Root -Force | Where-Object {
  -not ($Exclude -contains $_.Name)
} | ForEach-Object {
  Copy-Item -Path $_.FullName -Destination $BuildDir -Recurse -Force
}

# 3. 决定私钥
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
$UseKey = $null
if ($Key -and (Test-Path $Key)) {
  $UseKey = (Resolve-Path $Key).Path
} elseif (Test-Path $KeyOut) {
  $UseKey = $KeyOut
}

if ($UseKey) {
  Write-Host "[2/4] 使用现有私钥：$UseKey"
} else {
  Write-Host "[2/4] 首次打包将生成新私钥：$KeyOut"
}

# 4. 启动 Chrome 打包
$Browser = Find-Browser
if (-not $Browser) {
  Write-Error "未找到 Chrome 或 Edge，请先安装 Google Chrome 或新版 Edge。"
  exit 1
}
Write-Host "[3/4] 启动浏览器打包：$Browser"

$Args = @("--pack-extension=`"$BuildDir`"")
if ($UseKey) { $Args += "--pack-extension-key=`"$UseKey`"" }

# -Wait 确保打包完成再继续
$proc = Start-Process -FilePath $Browser -ArgumentList $Args -PassThru -Wait -NoNewWindow
if ($proc.ExitCode -ne 0) {
  Write-Warning "浏览器进程退出码 $($proc.ExitCode)，但通常仍会成功产出 .crx；以文件是否存在为准。"
}

# 5. 移动产物
#    注意：Chrome --pack-extension 会把 .crx/.pem 输出到源目录的**同级**位置
#    即 _build.crx / _build.pem（而不是 _build/ 内部），所以要从仓库根查找
Write-Host "[4/4] 整理产物 ..."
$crxBuilt = Get-ChildItem -Path $Root -Filter "_build.crx" -ErrorAction SilentlyContinue | Select-Object -First 1
$pemBuilt = Get-ChildItem -Path $Root -Filter "_build.pem" -ErrorAction SilentlyContinue | Select-Object -First 1

if (-not $crxBuilt) {
  Write-Error "打包失败：未在 $Root 中生成 _build.crx 文件。"
  exit 1
}

Move-Item -Force $crxBuilt.FullName $CrxOut
if ($pemBuilt) { Move-Item -Force $pemBuilt.FullName $KeyOut }

# 清理临时构建目录
Remove-Item -Recurse -Force $BuildDir

$sizeKb = [Math]::Round((Get-Item $CrxOut).Length / 1KB, 1)
Write-Host ""
Write-Host "打包成功" -ForegroundColor Green
Write-Host "  .crx : $CrxOut  ($sizeKb KB)"
if (Test-Path $KeyOut) {
  Write-Host "  .pem : $KeyOut"
  Write-Host ""
  Write-Host "[!] 升级扩展时必须复用同一私钥，否则 Chrome 会拒绝更新。" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "下一步："
Write-Host "  1) 把 .crx 文件拖入 chrome://extensions 页面（开发者模式开）安装"
Write-Host "  2) 或在扩展管理页面右上 '打包扩展程序' 按钮也可手动打包"