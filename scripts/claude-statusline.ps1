# Claude Code statusline for Windows. Mirrors statusline-command.sh on Mac.
# Reads JSON from stdin, prints: model | $cost | %ctx | tokens | duration
$json = [Console]::In.ReadToEnd()
try {
    $data = $json | ConvertFrom-Json -ErrorAction Stop
} catch {
    Write-Output "claude"
    exit 0
}

$model       = $data.model.display_name
$cost        = if ($data.cost.total_cost_usd       ) { $data.cost.total_cost_usd       } else { 0 }
$duration_ms = if ($data.cost.total_duration_ms    ) { $data.cost.total_duration_ms    } else { 0 }
$used_pct    = if ($data.context_window.used_percentage     ) { $data.context_window.used_percentage     } else { 0 }
$total_in    = if ($data.context_window.total_input_tokens  ) { $data.context_window.total_input_tokens  } else { 0 }
$total_out   = if ($data.context_window.total_output_tokens ) { $data.context_window.total_output_tokens } else { 0 }
$ctx_size    = if ($data.context_window.context_window_size ) { $data.context_window.context_window_size } else { 200000 }

$cost_fmt     = "{0:F2}" -f [double]$cost
$duration_s   = [int]([double]$duration_ms / 1000)
$mins         = [int]($duration_s / 60)
$secs         = $duration_s % 60
$duration_fmt = "${mins}m ${secs}s"
$total_tokens = [int]$total_in + [int]$total_out
$fmt_tokens   = "{0:N0}" -f [int]$total_tokens
$fmt_ctx      = "{0:N0}" -f [int]$ctx_size

Write-Output "$model  |  `$$cost_fmt  |  $used_pct% ctx  |  $fmt_tokens / $fmt_ctx tokens  |  $duration_fmt"
