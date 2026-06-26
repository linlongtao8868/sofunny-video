param(
  [string]$ApiKey = "",

  [string]$Prompt = "",

  [string]$ServiceUrl = "http://10.20.3.69:3001",
  [string]$ApiUrl = "",
  [string]$Model = "",
  [int]$Duration = 5,
  [string]$AspectRatio = "16:9",
  [string]$Resolution = "1080p",
  [string]$ImageUrl = "",
  [string]$VideoUrl = "",
  [string]$DownloadDir = "sofunny-video-downloads",
  [switch]$SkipProjectDownload,
  [int]$TimeoutSeconds = 600,
  [int]$PollIntervalMs = 3000
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$entry = Join-Path $scriptDir "sofunny-video.js"

$argsList = @(
  $entry
)

if ($ApiKey) { $argsList += @("--api-key", $ApiKey) }
if ($Prompt) { $argsList += @("--prompt", $Prompt) }
if ($ServiceUrl) { $argsList += @("--service-url", $ServiceUrl) }
if ($ApiUrl) { $argsList += @("--api-url", $ApiUrl) }
if ($Model) { $argsList += @("--model", $Model) }
if ($Duration) { $argsList += @("--duration", $Duration.ToString()) }
if ($AspectRatio) { $argsList += @("--aspect-ratio", $AspectRatio) }
if ($Resolution) { $argsList += @("--resolution", $Resolution) }
if ($ImageUrl) { $argsList += @("--image-url", $ImageUrl) }
if ($VideoUrl) { $argsList += @("--video-url", $VideoUrl) }
if ($DownloadDir) { $argsList += @("--download-dir", $DownloadDir) }
if ($TimeoutSeconds) { $argsList += @("--timeout-seconds", $TimeoutSeconds.ToString()) }
if ($PollIntervalMs) { $argsList += @("--poll-interval-ms", $PollIntervalMs.ToString()) }
if ($SkipProjectDownload) { $argsList += "--skip-project-download" }

& node @argsList
exit $LASTEXITCODE
