$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
node (Join-Path $root "scripts/promptctl.mjs") @args

