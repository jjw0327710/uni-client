# UNI Client 릴리즈 스크립트 - 버전 자동 올리고 빌드 후 GitHub 업로드

$pkg = Get-Content "package.json" -Raw | ConvertFrom-Json
$ver = $pkg.version -split '\.'
$ver[2] = [int]$ver[2] + 1
$newVersion = $ver -join '.'

# package.json 버전 업데이트
$pkgRaw = Get-Content "package.json" -Raw
$pkgRaw = $pkgRaw -replace '"version": ".*?"', "`"version`": `"$newVersion`""
[System.IO.File]::WriteAllText((Resolve-Path "package.json"), $pkgRaw, [System.Text.UTF8Encoding]::new($false))

Write-Host "버전: $($pkg.version) -> $newVersion" -ForegroundColor Cyan

# 빌드
Write-Host "빌드 중..." -ForegroundColor Yellow
npm run build

if ($LASTEXITCODE -ne 0) { Write-Host "빌드 실패" -ForegroundColor Red; exit 1 }

# 포터블 exe를 zip으로 압축
Write-Host "ZIP 압축 중..." -ForegroundColor Yellow
$portableExe = "dist\UNI Client $newVersion.exe"
$zipPath = "dist\UNI.Client.$newVersion.zip"
if (Test-Path $portableExe) {
    Compress-Archive -Path $portableExe -DestinationPath $zipPath -Force
}

# GitHub Release 생성 및 업로드
Write-Host "GitHub Release 업로드 중..." -ForegroundColor Yellow
$setupExe = "dist\UNI Client Setup $newVersion.exe"
$assets = @()
if (Test-Path $setupExe) { $assets += "`"$setupExe`"" }
if (Test-Path $zipPath)   { $assets += "`"$zipPath`"" }

# latest.yml도 포함 (자동 업데이트용)
$latestYml = "dist\latest.yml"
if (Test-Path $latestYml) { $assets += "`"$latestYml`"" }

$assetStr = $assets -join ' '
Invoke-Expression "gh release create v$newVersion $assetStr --title `"UNI Client v$newVersion`" --notes `"UNI Client v$newVersion 업데이트`""

# 웹사이트 다운로드 링크 버전 업데이트
$websiteDir = "..\uni-website"
if (Test-Path "$websiteDir\index.html") {
    Write-Host "웹사이트 링크 업데이트 중..." -ForegroundColor Yellow
    $html = Get-Content "$websiteDir\index.html" -Raw
    $html = $html -replace 'UNI\.Client\.Setup\.\d+\.\d+\.\d+\.exe', "UNI.Client.Setup.$newVersion.exe"
    $html = $html -replace 'UNI\.Client\.\d+\.\d+\.\d+\.zip', "UNI.Client.$newVersion.zip"
    $html = $html -replace 'v\d+\.\d+\.\d+ · Windows', "v$newVersion · Windows"
    [System.IO.File]::WriteAllText((Resolve-Path "$websiteDir\index.html"), $html, [System.Text.UTF8Encoding]::new($false))

    Push-Location $websiteDir
    git add index.html
    git commit -m "v$newVersion"
    git push origin main:gh-pages
    Pop-Location
    Write-Host "웹사이트 업데이트 완료" -ForegroundColor Green
}

# git에도 버전 커밋
git add package.json
git commit -m "v$newVersion"
git push origin main

Write-Host "완료! v$newVersion 릴리즈됨" -ForegroundColor Green
