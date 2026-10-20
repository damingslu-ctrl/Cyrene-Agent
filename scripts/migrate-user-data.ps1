# Mochi 用户数据迁移脚本
# 作用：把旧数据目录 %APPDATA%\live2d-cyrene 与上一代 fork 目录 %APPDATA%\cyrene-verge 依次并入
#       当前目录 %APPDATA%\Mochi。顺序与合并语义都与应用内一致：后搬的那份同名文件覆盖先搬的。
# 场景：应用内的自动迁移搬不完时应用会拒绝启动（被备份程序永久占着文件时没有应用内的退路），
#       这里是没有应用参与的手动兜底。双击同目录的 migrate-user-data.cmd 即可运行。
# 规则：旧数据优先覆盖新目录同名文件；被覆盖的新目录条目先移进
#       .legacy-migration-overwritten\<UTC 时间戳> 备份目录，绝不直接删除；lockfile 等运行时
#       文件保留新目录版本；任何文件搬不动都会留在旧目录，不丢数据，可重跑本脚本重试。
# 禁写：%APPDATA%\Cyrene 是上游 Cyrene 的真实用户数据，本 fork 全程只读禁写：appData、两个源、
#       目标里任何一条路径的任何一个完整路径段等于 cyrene（不分大小写）就整脚本拒绝，拒绝发生在
#       任何文件操作之前。与 src/main/user-data-migration.ts 的 assertMigratable 同一规则，
#       那三条判据由 src/main/user-data-migration.test.ts 末尾的文本锁钉住。

$ErrorActionPreference = 'Stop'
$appData = [Environment]::GetFolderPath('ApplicationData')
$target = Join-Path $appData 'Mochi'
$backupDirName = '.legacy-migration-overwritten'
$runtimeFiles = @('lockfile', 'SingletonLock', 'SingletonSocket', 'SingletonCookie')
# 搬运顺序 = 应用内 pre-ready 的顺序：先历史 live2d-cyrene，再上一代 cyrene-verge（后者同名文件赢）
$sources = @('live2d-cyrene', 'cyrene-verge')

function Test-ForbiddenPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    foreach ($segment in ($Path -split '[\\/]+')) {
        if ($segment.ToLower() -eq 'cyrene') { return $true }
    }
    return $false
}

Write-Host "== Mochi 用户数据迁移 ==" -ForegroundColor Cyan
Write-Host "目标目录: $target"

# 硬闸门：先于任何文件操作，按路径段拒绝上游 Cyrene
$guarded = @($appData, $target)
foreach ($sourceName in $sources) { $guarded += (Join-Path $appData $sourceName) }
foreach ($candidate in $guarded) {
    if (Test-ForbiddenPath -Path $candidate) {
        Write-Host "迁移被拒绝：'$candidate' 命中上游 Cyrene 目录。%APPDATA%\Cyrene 是上游 Cyrene 的真实用户数据，本 fork 全程只读禁写：不搬运、不删除、不覆盖。" -ForegroundColor Red
        exit 1
    }
}

$running = Get-Process -Name 'Mochi', 'cyrene-verge', 'Cyrene' -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "$($running[0].ProcessName) 正在运行，文件会被占用。请先完全退出应用（含托盘图标）再运行本脚本。" -ForegroundColor Red
    exit 1
}

foreach ($sourceName in $sources) {
    $legacy = Join-Path $appData $sourceName
    if (-not (Test-Path -LiteralPath $legacy)) {
        Write-Host "未发现旧数据目录 $legacy，跳过。"
        continue
    }

    Write-Host ""
    Write-Host "-- $legacy -> $target --" -ForegroundColor Cyan

    if (-not (Test-Path -LiteralPath $target)) {
        Move-Item -LiteralPath $legacy -Destination $target
        Write-Host "整体移动完成：旧目录已改名成新目录。" -ForegroundColor Green
        continue
    }

    # 两者并存：逐项搬入，旧数据优先；新目录里的同名条目先移进时间戳备份目录
    foreach ($entry in Get-ChildItem -LiteralPath $legacy -Force) {
        if ($runtimeFiles -contains $entry.Name) {
            # 陈旧的运行时文件直接丢弃，保住新目录里已有的版本
            Remove-Item -LiteralPath $entry.FullName -Recurse -Force -ErrorAction SilentlyContinue
            continue
        }
        $dest = Join-Path $target $entry.Name
        if (Test-Path -LiteralPath $dest) {
            $stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd'T'HH-mm-ss-fff'Z'")
            $backupDir = Join-Path (Join-Path $target $backupDirName) $stamp
            New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
            Move-Item -LiteralPath $dest -Destination (Join-Path $backupDir $entry.Name)
        }
        Move-Item -LiteralPath $entry.FullName -Destination $dest
    }

    # 旧目录搬空后删除；仍有残留说明有文件被占用，保留待下次重试
    $leftover = Get-ChildItem -LiteralPath $legacy -Force -ErrorAction SilentlyContinue
    if (-not $leftover) {
        Remove-Item -LiteralPath $legacy -Force
        Write-Host "$sourceName 的数据已全部并入新目录。" -ForegroundColor Green
    } else {
        Write-Host "部分文件未能迁移（被其他程序占用），已保留在 $legacy，关闭占用程序后重跑本脚本即可。" -ForegroundColor Yellow
        $leftover | ForEach-Object { Write-Host "  - $($_.Name)" }
    }
}
