$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
$bundledPnpm = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd'

if (Test-Path (Join-Path $bundledNode 'node.exe')) {
  $env:PATH = "$bundledNode;$env:PATH"
}

if (Get-Command pnpm -ErrorAction SilentlyContinue) {
  $pnpm = 'pnpm'
} elseif (Test-Path $bundledPnpm) {
  $pnpm = $bundledPnpm
} else {
  Write-Host '未找到运行环境，请先安装 Node.js 与 pnpm。' -ForegroundColor Red
  Read-Host '按回车键退出'
  exit 1
}

Set-Location $root
if (-not (Test-Path (Join-Path $root 'node_modules'))) {
  & $pnpm install
}
Write-Host ''
Write-Host '东尼菜市场正在启动…' -ForegroundColor Green
$lanAddress = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object {
    $_.IPAddress -notlike '127.*' -and
    $_.IPAddress -notlike '169.254.*' -and
    $_.PrefixOrigin -ne 'WellKnown'
  } |
  Sort-Object -Property @{ Expression = { if ($_.InterfaceAlias -match 'Wi-Fi|WLAN|无线|以太网|Ethernet') { 0 } else { 1 } } } |
  Select-Object -First 1 -ExpandProperty IPAddress

Write-Host '电脑地址：http://127.0.0.1:5173' -ForegroundColor Green
if ($lanAddress) {
  Write-Host "手机地址：http://${lanAddress}:5173" -ForegroundColor Cyan
} else {
  Write-Host '未检测到局域网地址，请先连接 Wi-Fi 或网线。' -ForegroundColor Yellow
}
Write-Host '手机与电脑需要连接同一个路由器网络。' -ForegroundColor DarkGray
Write-Host ''
& $pnpm start:local
