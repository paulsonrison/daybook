$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$source = Join-Path $projectRoot 'docs/design/figma/main/Daybook — Native component library.svg'
$svg = [xml](Get-Content -LiteralPath $source -Raw -Encoding utf8)
$assetRoot = Join-Path $projectRoot 'packages/ui/src/assets/icons'
New-Item -ItemType Directory -Force $assetRoot | Out-Null
$icons = $svg.SelectSingleNode('//*[local-name()="g" and @id="Daybook/Icon"]')
$names = @()
$index = 0
foreach ($node in $icons.SelectNodes('./*[local-name()="g"]')) {
    $name = $node.GetAttribute('id').Replace('Variant=', '').ToLowerInvariant()
    $x = 72 + 56 * $index
    $markup = $node.OuterXml
    $defs = ''
    foreach ($match in [regex]::Matches($markup, 'url\(#([^)]+)\)')) {
        $definition = $svg.SelectSingleNode('//*[local-name()="defs"]/*[@id="' + $match.Groups[1].Value + '"]')
        if ($null -ne $definition) { $defs += $definition.OuterXml }
    }
    $result = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="' + $x + ' 1141 32 32" fill="none">' + $markup + '<defs>' + $defs + '</defs></svg>'
    Set-Content -LiteralPath (Join-Path $assetRoot ($name + '.svg')) -Value $result -Encoding utf8
    $names += $name
    $index++
}
# Preserve the original loading glyph and its 12 px export box.
$loader = $svg.SelectSingleNode('//*[local-name()="g" and @id="loader-circle"]')
$loaderClip = $svg.SelectSingleNode('//*[local-name()="clipPath" and @id="clip1_11_3687"]')
Set-Content -LiteralPath (Join-Path $assetRoot 'loader.svg') -Encoding utf8 -Value ('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="517 238 12 12" fill="none">' + $loader.OuterXml + '<defs>' + $loaderClip.OuterXml + '</defs></svg>')
$names += 'loader'
$overview = [xml](Get-Content -LiteralPath (Join-Path $projectRoot 'docs/design/figma/main/Agency overview.svg') -Raw -Encoding utf8)
$brand = $overview.SelectSingleNode('//*[local-name()="g" and @id="Brand mark"]')
Set-Content -LiteralPath (Join-Path $assetRoot 'brand.svg') -Encoding utf8 -Value ('<svg xmlns="http://www.w3.org/2000/svg" width="33" height="36" viewBox="24 28.5 33 36" fill="none">' + $brand.OuterXml + '</svg>')
$names += 'brand'
function Write-VectorAsset($document, $nodeId, $name, $box, $width, $height) {
    $node = $document.SelectSingleNode('//*[local-name()="g" and @id="' + $nodeId + '"]')
    if ($null -eq $node) { throw "Missing source node: $nodeId" }
    $markup = $node.OuterXml
    $defs = ''
    foreach ($match in [regex]::Matches($markup, 'url\(#([^)]+)\)')) {
        $definition = $document.SelectSingleNode('//*[local-name()="defs"]/*[@id="' + $match.Groups[1].Value + '"]')
        if ($null -ne $definition) { $defs += $definition.OuterXml }
    }
    Set-Content -LiteralPath (Join-Path $assetRoot ($name + '.svg')) -Encoding utf8 -Value ('<svg xmlns="http://www.w3.org/2000/svg" width="' + $width + '" height="' + $height + '" viewBox="' + $box + '" fill="none">' + $markup + '<defs>' + $defs + '</defs></svg>')
}
# Original navigation slots, read from the overview export and checked in Chrome.
$additional = @(
    @('layout-dashboard','dashboard','26 125 17 17',17),
    @('users','nav-residents','26 171 17 17',17),
    @('route','nav-route','26 217 17 17',17),
    @('newspaper_2','publications','26 263 17 17',17),
    @('receipt-text','nav-billing','26 344 17 17',17),
    @('wallet','ledger','26 390 17 17',17),
    @('landmark','cash','26 436 17 17',17),
    @('chart-no-axes-combined','analytics','26 482 17 17',17),
    @('contact-round','staff','26 563 17 17',17),
    @('package','packages','26 609 17 17',17),
    @('messages-square','messages','26 655 17 17',17),
    @('settings-2','nav-settings','26 721.5 17 17',17),
    @('circle-help','help','26 768 17 17',17),
    @('search','global-search','1046 29 16 16',16),
    @('bell','bell','1253 28 18 18',18),
    @('calendar-clock','schedule','665 960 18 18',18),
    @('shield-check','shield','1051.33 960 18 18',18)
)
foreach ($entry in $additional) {
    Write-VectorAsset $overview $entry[0] $entry[1] $entry[2] $entry[3] $entry[3]
    $names += $entry[1]
}
foreach ($entry in @(@('search','search','86 2272 12 12',12), @('Icon_49','success','88 4885 18 18',18), @('Icon_51','info','90 4979 14 14',14), @('Icon_53','warning','90 5071 14 14',14), @('Icon_55','error','90 5163 14 14',14), @('chevron-down','chevron-down','1383 1794 12 12',12), @('Icon_50','close','1387 4886 12 12',12))) {
    Write-VectorAsset $svg $entry[0] $entry[1] $entry[2] $entry[3] $entry[3]
    $names += $entry[1]
}
$dark = [xml](Get-Content -LiteralPath (Join-Path $projectRoot 'docs/design/figma/main/Appearance — Nord dark and large type.svg') -Raw -Encoding utf8)
Write-VectorAsset $dark 'Brand mark' 'brand-dark' '24 28.5 33 36' 33 36
$names += 'brand-dark'
$lines = @('// Generated from the checked-in Figma exports by scripts/extract-figma-assets.ps1.', 'export const iconAssets = {')
foreach ($name in $names) { $lines += "  '$name': new URL('./assets/icons/$name.svg', import.meta.url).href," }
$lines += '} as const;', 'export type IconName = keyof typeof iconAssets;'
Set-Content -LiteralPath (Join-Path $projectRoot 'packages/ui/src/assets.ts') -Value $lines -Encoding utf8

$referenceRoot = Join-Path $projectRoot 'docs/design/figma'
$inventory = @(Get-ChildItem -LiteralPath $referenceRoot -Filter '*.svg' -Recurse | ForEach-Object {
    $document = [xml](Get-Content -LiteralPath $_.FullName -Raw -Encoding utf8)
    [ordered]@{
        reference = $_.FullName.Substring($referenceRoot.Length + 1).Replace('\', '/')
        width = $document.DocumentElement.GetAttribute('width')
        height = $document.DocumentElement.GetAttribute('height')
        text = @($document.SelectNodes('//*[local-name()="text"]') | ForEach-Object { $_.InnerText })
        states = @($document.SelectNodes('//*[local-name()="g" and starts-with(@id,"State=")]') | ForEach-Object { $_.GetAttribute('id').Replace('State=', '') })
        rasterImages = $document.SelectNodes('//*[local-name()="image"]').Count
    }
})
$inventory | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $referenceRoot 'inventory.json') -Encoding utf8
$recovery = @(Get-ChildItem -LiteralPath (Join-Path $referenceRoot 'edge-cases') -Recurse -Filter '*.svg' |
    Where-Object { $_.Directory.Name -match '^\d{2}$' } | ForEach-Object {
        $document = [xml](Get-Content -LiteralPath $_.FullName -Raw -Encoding utf8)
        $inline = $document.SelectSingleNode('//*[local-name()="g" and starts-with(@id,"Inline state /")]')
        $progress = $document.SelectSingleNode('//*[local-name()="g" and @id="Progress status"]')
        $behavior = @($document.SelectSingleNode('//*[local-name()="g" and @id="Behavior specification"]').SelectNodes('./*[local-name()="text"]') | ForEach-Object { $_.InnerText })
        $texts = if ($null -ne $inline) { @($inline.SelectNodes('./*[local-name()="text"]') | ForEach-Object { $_.InnerText }) } else { @('INFO', $progress.InnerText, $behavior[1]) }
        [string[]]$actions = @(if ($null -ne $inline) { $inline.SelectNodes('.//*[local-name()="g" and starts-with(@id,"Action /")]') | ForEach-Object { $_.SelectSingleNode('.//*[local-name()="text"]').InnerText } })
        [ordered]@{ id=$_.Directory.Name; name=$_.BaseName; tone=$texts[0].ToLowerInvariant(); title=$texts[1]; description=$texts[2]; actions=$actions; loading=($null -ne $progress); behavior=$behavior[1] }
    })
$recovery | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $projectRoot 'packages/ui/src/recovery-presets.json') -Encoding utf8
$formatterName = if ($env:OS -eq 'Windows_NT') { 'prettier.cmd' } else { 'prettier' }
$formatter = Join-Path $projectRoot ('node_modules/.bin/' + $formatterName)
if (Test-Path -LiteralPath $formatter) {
    & $formatter --write (Join-Path $projectRoot 'packages/ui/src/assets.ts') (Join-Path $referenceRoot 'inventory.json') (Join-Path $projectRoot 'packages/ui/src/recovery-presets.json')
    if ($LASTEXITCODE -ne 0) { throw 'Generated source formatting failed.' }
}
Write-Output "Extracted $($names.Count) vector assets and indexed $($inventory.Count) reference frames."
