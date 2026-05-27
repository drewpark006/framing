# windows-claude-setup.ps1 — bring a fresh Windows Claude Code install in
# line with the Mac config. Idempotent (safe to re-run).
#
# Sets:
#   - Theme: dark-daltonized
#   - defaultMode: auto, skipAutoPermissionPrompt: true
#   - permissions.allow: mcp__chrome-devtools__*
#   - Stop + Notification hooks → Windows system notification sound
#   - statusLine → scripts/claude-statusline.ps1 (copied to ~/.claude/)
#
# Preserves any existing hooks (including the framing-sync-check hook).
# Run via:
#   cd $HOME\manzano\framing
#   .\scripts\windows-claude-setup.ps1
#
# After it finishes, in Claude Code on Windows run:
#   /plugin install clangd-lsp@claude-plugins-official
# Then restart Claude Code.

$ErrorActionPreference = 'Stop'
$ScriptDir = $PSScriptRoot
$ClaudeDir = Join-Path $HOME ".claude"
New-Item -ItemType Directory -Force -Path $ClaudeDir | Out-Null

# Copy statusline script into ~/.claude/ so settings.json can reference a
# stable user-level path (not the repo path).
$statuslineSource = Join-Path $ScriptDir "claude-statusline.ps1"
$statuslineDest   = Join-Path $ClaudeDir "statusline-command.ps1"
Copy-Item $statuslineSource $statuslineDest -Force
Write-Host "statusline installed: $statuslineDest"

$settingsPath = Join-Path $ClaudeDir "settings.json"
if (Test-Path $settingsPath) {
    $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json -AsHashtable
} else {
    $settings = @{}
}

$settings.theme = "dark-daltonized"
$settings.skipAutoPermissionPrompt = $true

if (-not $settings.ContainsKey('permissions')) { $settings.permissions = @{} }
$settings.permissions.defaultMode = "auto"
if (-not $settings.permissions.ContainsKey('allow')) { $settings.permissions.allow = @() }
if ($settings.permissions.allow -notcontains "mcp__chrome-devtools__*") {
    $settings.permissions.allow = @($settings.permissions.allow) + "mcp__chrome-devtools__*"
}

$pingCmd = 'powershell -NoProfile -c "[System.Media.SystemSounds]::Notification.Play()"'

if (-not $settings.ContainsKey('hooks')) { $settings.hooks = @{} }
$settings.hooks.Stop = @(@{
    hooks = @(@{
        type    = 'command'
        command = $pingCmd
        async   = $true
    })
})
$settings.hooks.Notification = @(@{
    matcher = 'permission_prompt|elicitation_dialog'
    hooks   = @(@{
        type    = 'command'
        command = $pingCmd
        async   = $true
    })
})

# Note: any existing UserPromptSubmit entry (e.g. the framing-sync-check
# hook) is preserved because we only assign to Stop/Notification.

$settings.statusLine = @{
    type    = 'command'
    command = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$statuslineDest`""
}

$settings | ConvertTo-Json -Depth 10 | Out-File -Encoding utf8 $settingsPath
Write-Host "settings.json updated: $settingsPath"

Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. In Claude Code on Windows, run: /plugin install clangd-lsp@claude-plugins-official"
Write-Host "  2. Restart Claude Code so the new statusline + hooks take effect"
