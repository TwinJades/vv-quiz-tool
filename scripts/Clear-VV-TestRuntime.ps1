param([switch]$Apply)

$ErrorActionPreference = 'Stop'
$vvWorkspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$vvRuntime = (Resolve-Path -LiteralPath (Join-Path $vvWorkspace '.browser-regression-runtime')).Path.TrimEnd('\')
$vvPrefix = $vvRuntime + '\'
$vvRunPattern = '^(background|provider-mv3|site-audit|h5p-grading-probe|capture-probe|canvas-result-probe|canvas-surface-probe)-'
$vvChildren = @('profile', 'chrome', 'edge', 'extension')

function Assert-VVTarget([string]$Path) {
    $vvFull = [IO.Path]::GetFullPath($Path)
    if (-not $vvFull.StartsWith($vvPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Target outside the test runtime: $vvFull"
    }
    $vvItem = Get-Item -LiteralPath $vvFull -Force
    if ($vvItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse target refused: $vvFull" }
    for ($vvParent = [IO.DirectoryInfo][IO.Path]::GetDirectoryName($vvFull); $null -ne $vvParent; $vvParent = $vvParent.Parent) {
        if ($vvParent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse parent refused: $vvFull" }
    }
    return $vvFull
}

function Test-VVProcessPath($Processes, [string]$Path) {
    $vvNormalized = $Path.Replace('/', '\')
    return [bool]($Processes | Where-Object {
        $_.CommandLine -and $_.CommandLine.Replace('/', '\').IndexOf($vvNormalized, [StringComparison]::OrdinalIgnoreCase) -ge 0
    })
}

# Fail closed if the process inventory cannot be read. Never close a user app.
$vvProcesses = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('chrome.exe', 'msedge.exe', 'node.exe') })
$vvSkipped = [Collections.Generic.List[object]]::new()
$vvTargets = [Collections.Generic.List[object]]::new()
$vvEvidence = [Collections.Generic.List[object]]::new()
$vvBefore = [long](Get-ChildItem -LiteralPath $vvRuntime -File -Recurse -Force | Measure-Object Length -Sum).Sum
$vvRuns = @(Get-ChildItem -LiteralPath $vvRuntime -Directory -Force | Where-Object Name -match $vvRunPattern)

foreach ($vvRun in $vvRuns) {
    if (Test-VVProcessPath $vvProcesses $vvRun.FullName) {
        $vvSkipped.Add(@{ path = $vvRun.FullName; reason = 'in_use' }); continue
    }
    if (Test-Path -LiteralPath (Join-Path $vvRun.FullName 'KEEP_RUNTIME.md')) {
        $vvSkipped.Add(@{ path = $vvRun.FullName; reason = 'explicitly_retained' }); continue
    }
    foreach ($vvFile in Get-ChildItem -LiteralPath $vvRun.FullName -File -Force) {
        $vvEvidence.Add(@{ path = $vvFile.FullName; bytes = $vvFile.Length; sha256 = (Get-FileHash -LiteralPath $vvFile.FullName -Algorithm SHA256).Hash })
    }
    foreach ($vvChild in Get-ChildItem -LiteralPath $vvRun.FullName -Directory -Force | Where-Object Name -in $vvChildren) {
        $vvFull = Assert-VVTarget $vvChild.FullName
        $vvContents = @(Get-ChildItem -LiteralPath $vvFull -Recurse -Force)
        if ($vvContents | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) {
            $vvSkipped.Add(@{ path = $vvFull; reason = 'contains_reparse_point' }); continue
        }
        $vvTargets.Add(@{ path = $vvFull; kind = 'directory'; bytes = [long](($vvContents | Where-Object { -not $_.PSIsContainer }) | Measure-Object Length -Sum).Sum })
    }
}

# Keep the single installed test browser; recycle only its redundant download.
$vvZip = Join-Path $vvRuntime 'chrome-win64.zip'
if ((Test-Path -LiteralPath $vvZip) -and (Test-Path -LiteralPath (Join-Path $vvRuntime 'chrome-cft/chrome-win64/chrome.exe'))) {
    $vvFull = Assert-VVTarget $vvZip
    $vvTargets.Add(@{ path = $vvFull; kind = 'file'; bytes = (Get-Item -LiteralPath $vvFull).Length })
}

$vvPlannedBytes = [long]($vvTargets | Measure-Object bytes -Sum).Sum
$vvSummary = @{ apply = [bool]$Apply; before_bytes = $vvBefore; target_count = $vvTargets.Count; planned_bytes = $vvPlannedBytes; skipped = @($vvSkipped.ToArray()); retained_evidence_files = $vvEvidence.Count }
Write-Output ($vvSummary | ConvertTo-Json -Depth 4 -Compress)
if (-not $Apply) { return }

Add-Type -AssemblyName Microsoft.VisualBasic
$vvStamp = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH-mm-ss.fffZ')
$vvRecordDirectory = Join-Path $vvRuntime ('cleanup-' + $vvStamp)
New-Item -ItemType Directory -Path $vvRecordDirectory | Out-Null
$vvRecordPath = Join-Path $vvRecordDirectory 'report.json'
$vvRecord = @{ started_at = [DateTime]::UtcNow.ToString('o'); method = 'Windows Recycle Bin only'; runtime = $vvRuntime; before_bytes = $vvBefore; targets = @($vvTargets.ToArray()); evidence = @($vvEvidence.ToArray()); skipped = @($vvSkipped.ToArray()); recycled = @(); errors = @(); verified = $false }
function Save-VVRecord { $vvRecord | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $vvRecordPath -Encoding utf8 }
Save-VVRecord

try {
    $vvIndex = 0
    foreach ($vvTarget in $vvTargets) {
        $vvFull = Assert-VVTarget $vvTarget.path
        # Recheck just before moving each item; stop if a browser appeared.
        $vvCurrent = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('chrome.exe', 'msedge.exe', 'node.exe') })
        $vvRunPath = if ($vvTarget.kind -eq 'directory') { [IO.Path]::GetDirectoryName($vvFull) } else { $vvFull }
        if (Test-VVProcessPath $vvCurrent $vvRunPath) {
            throw "Target became active; stopped cleanup: $vvRunPath"
        }
        if ($vvTarget.kind -eq 'directory') {
            [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($vvFull, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin, [Microsoft.VisualBasic.FileIO.UICancelOption]::ThrowException)
        } else {
            [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($vvFull, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin, [Microsoft.VisualBasic.FileIO.UICancelOption]::ThrowException)
        }
        if (Test-Path -LiteralPath $vvFull) { throw "Original target still exists: $vvFull" }
        $vvRecord.recycled += @{ path = $vvFull; bytes = $vvTarget.bytes; at = [DateTime]::UtcNow.ToString('o') }
        Save-VVRecord
        $vvIndex++
        if ($vvIndex % 25 -eq 0) { Write-Output "RECYCLED $vvIndex / $($vvTargets.Count)" }
    }
    foreach ($vvFile in $vvEvidence) {
        if (-not (Test-Path -LiteralPath $vvFile.path) -or (Get-FileHash -LiteralPath $vvFile.path -Algorithm SHA256).Hash -ne $vvFile.sha256) {
            throw "Retained evidence changed or disappeared: $($vvFile.path)"
        }
    }
    $vvRecord.verified = $true
} catch {
    $vvRecord.errors += $_.Exception.Message
    throw
} finally {
    $vvRecord.after_bytes = [long](Get-ChildItem -LiteralPath $vvRuntime -File -Recurse -Force | Measure-Object Length -Sum).Sum
    $vvRecord.finished_at = [DateTime]::UtcNow.ToString('o')
    Save-VVRecord
    Write-Output (@{ report = $vvRecordPath; recycled_count = $vvRecord.recycled.Count; recycled_bytes = [long]($vvRecord.recycled | Measure-Object bytes -Sum).Sum; before_gib = [math]::Round($vvBefore/1GB,3); after_gib = [math]::Round($vvRecord.after_bytes/1GB,3); evidence_verified = $vvRecord.verified; errors = $vvRecord.errors } | ConvertTo-Json -Depth 4 -Compress)
}
