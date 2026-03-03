$ErrorActionPreference = "SilentlyContinue"

function Get-DiscordPipe {
    for ($i = 0; $i -le 9; $i++) {
        try {
            $name = "discord-ipc-$i"
            $pipe = New-Object System.IO.Pipes.NamedPipeClientStream(".", $name, [System.IO.Pipes.PipeDirection]::InOut)
            $pipe.Connect(150)
            return $pipe
        } catch {}
    }
    return $null
}

function Send-Packet($pipe, [int]$op, [string]$json) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    [byte[]]$pkt = [BitConverter]::GetBytes($op) + [BitConverter]::GetBytes([int]$bytes.Length) + $bytes
    $pipe.Write($pkt, 0, $pkt.Length)
    $pipe.Flush()
}

function Send-Handshake($pipe, [string]$clientId) {
    $payload = @{ v = 1; client_id = $clientId } | ConvertTo-Json -Compress
    Send-Packet $pipe 0 $payload

    $header = New-Object byte[] 8
    if ($pipe.Read($header, 0, 8) -eq 8) {
        $len = [BitConverter]::ToInt32($header, 4)
        if ($len -gt 0) {
            $body = New-Object byte[] $len
            $pipe.Read($body, 0, $len) | Out-Null
        }
    }
}

function Set-Activity(
    $pipe,
    [int]$pid,
    [string]$details,
    [string]$state,
    [string]$largeImageKey,
    $startTimestamp,
    $endTimestamp,
    [string]$largeImageText,
    [string]$smallImageKey,
    [string]$smallImageText
) {
    $activity = @{
        details = if ($details) { $details } else { "Idling" }
        state = if ($state) { $state } else { "Monochrome+" }
        type = 2
        assets = @{
            large_image = if ($largeImageKey -and $largeImageKey.StartsWith("http")) { $largeImageKey } else { "Monochrome+" }
            large_text = if ($largeImageText) { $largeImageText } else { "Monochrome+" }
        }
    }

    if ($smallImageKey) {
        $activity.assets.small_image = $smallImageKey
        $activity.assets.small_text = if ($smallImageText) { $smallImageText } else { "" }
    }

    if ($startTimestamp -or $endTimestamp) {
        $activity.timestamps = @{}
        if ($startTimestamp) { $activity.timestamps.start = [long]$startTimestamp }
        if ($endTimestamp) { $activity.timestamps.end = [long]$endTimestamp }
    }

    $payload = @{
        cmd = "SET_ACTIVITY"
        args = @{ pid = [int]$pid; activity = $activity }
        nonce = [Guid]::NewGuid().ToString()
    } | ConvertTo-Json -Compress -Depth 10

    Send-Packet $pipe 1 $payload
}

function Clear-Activity($pipe, [int]$pid) {
    $payload = @{
        cmd = "SET_ACTIVITY"
        args = @{ pid = [int]$pid; activity = $null }
        nonce = [Guid]::NewGuid().ToString()
    } | ConvertTo-Json -Compress -Depth 10

    Send-Packet $pipe 1 $payload
}

$clientId = "1462186088184549661"
$pidToUse = [System.Diagnostics.Process]::GetCurrentProcess().Id

$pipe = Get-DiscordPipe
if (-not $pipe) { exit }

Send-Handshake $pipe $clientId
Start-Sleep -Milliseconds 200
Set-Activity $pipe $pidToUse "Idling" "Monochrome+" $null $null $null $null $null $null

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ([string]::IsNullOrWhiteSpace($line)) { continue }

    try {
        $msg = $line | ConvertFrom-Json
        if (-not $msg) { continue }

        if ($msg.pid) { $pidToUse = [int]$msg.pid }

        if ($msg.cmd -eq "update") {
            Set-Activity $pipe $pidToUse $msg.details $msg.state $msg.largeImageKey $msg.startTimestamp $msg.endTimestamp $msg.largeImageText $msg.smallImageKey $msg.smallImageText
        }
        elseif ($msg.cmd -eq "clear") {
            Clear-Activity $pipe $pidToUse
            Set-Activity $pipe $pidToUse "Idling" "Monochrome+" $null $null $null $null $null $null
        }
        elseif ($msg.cmd -eq "stop") {
            break
        }
    } catch {}
}

try {
    Clear-Activity $pipe $pidToUse
    Start-Sleep -Milliseconds 100
    $pipe.Dispose()
} catch {}
