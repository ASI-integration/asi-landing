$ErrorActionPreference = 'Stop'
$app = 'H:\ASI-Cabins-Crawler\app'
$dir = 'H:\ASI-Cabins-Crawler\live-inventory'
$logs = 'H:\ASI-Cabins-Crawler\logs'
if (!(Test-Path (Join-Path $app 'municipal_campaign.py'))) { exit 4 }
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $logs ('hackney-' + $stamp + '.log')
& 'C:\Python314\python.exe' (Join-Path $app 'municipal_campaign.py') --config (Join-Path $app 'municipal_sources.json') --output $dir --execute *>> $log
$exitCode = $LASTEXITCODE
Get-ChildItem -Path $logs -Filter 'hackney-*.log' -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 60 |
    Remove-Item -Force
exit $exitCode
