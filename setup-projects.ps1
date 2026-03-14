$ErrorActionPreference = "Stop"

$root = "C:\Projects"

$repos = @(
    @{
        Name = "asi-landing"
        Url  = "https://github.com/ASI-integration/asi-landing.git"
    }
)

if (-not (Test-Path $root)) {
    New-Item -ItemType Directory -Path $root | Out-Null
    Write-Host "Created folder: $root"
}

foreach ($repo in $repos) {
    $target = Join-Path $root $repo.Name
    $gitFolder = Join-Path $target ".git"

    if (Test-Path $gitFolder) {
        Write-Host "Updating existing repo: $($repo.Name)"
        git -C $target pull
    }
    elseif (Test-Path $target) {
        Write-Host "Folder exists but is not a git repo: $target"
        Write-Host "Skipping."
    }
    else {
        Write-Host "Cloning: $($repo.Name)"
        git clone $repo.Url $target
    }
}

Write-Host ""
Write-Host "Done. Root folder: $root"