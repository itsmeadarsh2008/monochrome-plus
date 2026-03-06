use discord_presence::models::ActivityType;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
use discord_presence::{Client, DiscordError};
use once_cell::sync::Lazy;
use serde::Deserialize;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::Manager;

const DEFAULT_DISCORD_CLIENT_ID: &str = "1478608904609857576";
// Quick timeout to prevent app hanging when Discord is not available
const RPC_START_TIMEOUT_MS: u64 = 300;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscordBridgePayload {
    details: Option<String>,
    state: Option<String>,
    large_image_key: Option<String>,
    large_image_base64: Option<String>,
    large_image_fallback_base64: Option<Vec<String>>,
    large_image_text: Option<String>,
    small_image_key: Option<String>,
    small_image_text: Option<String>,
    // Support for Apple Music-style second button
    button_two_label: Option<String>,
    button_two_url: Option<String>,
    start_timestamp: Option<i64>,
    end_timestamp: Option<i64>,
}

struct DiscordRpc {
    client: Client,
    client_id: u64,
}

static DISCORD_BRIDGE: Lazy<Mutex<Option<DiscordRpc>>> = Lazy::new(|| Mutex::new(None));

fn parse_client_id(client_id: Option<String>) -> Result<u64, String> {
    let raw = client_id.unwrap_or_else(|| DEFAULT_DISCORD_CLIENT_ID.to_string());
    raw.parse::<u64>()
        .map_err(|_| format!("Invalid Discord client ID: {raw}"))
}

fn set_idle_activity(client: &mut Client) -> Result<(), String> {
    // Only try once - fail quickly if Discord isn't running
    match client.set_activity(|activity| {
        activity
            .activity_type(ActivityType::Listening)
            .details("Monochrome+")
            .state("Idling")
            .assets(|assets| {
                assets
                    .large_image("monochrome")
                    .large_text("Monochrome+")
                    .small_image("paused_icon")
                    .small_text("Idling")
            })
            .append_buttons(|button| {
                button
                    .label("Listen on Monochrome+")
                    .url("https://github.com/itsmeadarsh2008/monochrome-plus")
            })
    }) {
        Ok(_) => Ok(()),
        Err(DiscordError::NotStarted) => {
            Err("Discord RPC not started (Discord may be closed)".to_string())
        }
        Err(err) => Err(err.to_string()),
    }
}

/// Percent-encode a string for use in Discord's mp:external/ format
fn percent_encode_component(input: &str) -> String {
    let mut encoded = String::with_capacity(input.len() * 3);
    for byte in input.bytes() {
        let is_unreserved = matches!(byte,
            b'A'..=b'Z' |
            b'a'..=b'z' |
            b'0'..=b'9' |
            b'-' | b'_' | b'.' | b'~'
        );

        if is_unreserved {
            encoded.push(char::from(byte));
        } else {
            encoded.push('%');
            encoded.push_str(&format!("{:02X}", byte));
        }
    }
    encoded
}

/// Convert an external URL to Discord's mp:external/ format
fn external_url_to_discord_format(url: &str) -> String {
    if url.starts_with("mp:external/") {
        return url.to_string();
    }
    format!("mp:external/{}", percent_encode_component(url))
}

fn normalize_discord_large_image_key(value: &str) -> String {
    if value.starts_with("http://") || value.starts_with("https://") {
        return external_url_to_discord_format(value);
    }

    if value.trim().is_empty() {
        return "monochrome".to_string();
    }

    if value.starts_with("mp:external/") {
        return value.to_string();
    }

    value.to_string()
}

fn decode_base64_value(byte: u8) -> Option<u8> {
    match byte {
        b'A'..=b'Z' => Some(byte - b'A'),
        b'a'..=b'z' => Some(byte - b'a' + 26),
        b'0'..=b'9' => Some(byte - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

fn decode_base64_to_string(input: &str) -> Option<String> {
    let bytes: Vec<u8> = input.bytes().filter(|b| !b"\r\n\t ".contains(b)).collect();
    if bytes.is_empty() || bytes.len() % 4 != 0 {
        return None;
    }

    let mut decoded = Vec::with_capacity((bytes.len() / 4) * 3);

    for chunk in bytes.chunks(4) {
        let c0 = decode_base64_value(chunk[0])?;
        let c1 = decode_base64_value(chunk[1])?;

        let pad2 = chunk[2] == b'=';
        let pad3 = chunk[3] == b'=';

        let c2 = if pad2 {
            0
        } else {
            decode_base64_value(chunk[2])?
        };
        let c3 = if pad3 {
            0
        } else {
            decode_base64_value(chunk[3])?
        };

        decoded.push((c0 << 2) | (c1 >> 4));

        if !pad2 {
            decoded.push(((c1 & 0x0F) << 4) | (c2 >> 2));
        }

        if !pad3 {
            decoded.push(((c2 & 0x03) << 6) | c3);
        }
    }

    String::from_utf8(decoded).ok()
}

fn resolve_discord_large_image_key(
    large_image_key: &str,
    large_image_base64: Option<&str>,
) -> String {
    if let Some(encoded) = large_image_base64 {
        if let Some(decoded) = decode_base64_to_string(encoded) {
            let normalized = normalize_discord_large_image_key(decoded.trim());
            if normalized != "monochrome" {
                return normalized;
            }
        }
    }

    normalize_discord_large_image_key(large_image_key)
}

fn resolve_discord_large_image_candidates(
    large_image_key: &str,
    large_image_base64: Option<&str>,
    large_image_fallback_base64: Option<&Vec<String>>,
) -> Vec<String> {
    let mut candidates: Vec<String> = Vec::new();

    let primary = resolve_discord_large_image_key(large_image_key, large_image_base64);
    if !primary.trim().is_empty() {
        candidates.push(primary);
    }

    if let Some(fallbacks) = large_image_fallback_base64 {
        for encoded in fallbacks {
            if let Some(decoded) = decode_base64_to_string(encoded) {
                let normalized = normalize_discord_large_image_key(decoded.trim());
                if !normalized.trim().is_empty() && !candidates.contains(&normalized) {
                    candidates.push(normalized);
                }
            }
        }
    }

    candidates.push("monochrome".to_string());

    candidates
}

#[tauri::command]
fn discord_bridge_start(client_id: Option<String>) -> Result<bool, String> {
    let desired_client_id = parse_client_id(client_id)?;

    // Check if already running with same client ID
    {
        let guard = DISCORD_BRIDGE
            .lock()
            .map_err(|_| "Bridge lock poisoned".to_string())?;

        if let Some(existing) = guard.as_ref() {
            if existing.client_id == desired_client_id {
                return Ok(true);
            }
        }
    }

    // Clean up existing connection
    {
        let mut guard = DISCORD_BRIDGE
            .lock()
            .map_err(|_| "Bridge lock poisoned".to_string())?;
        if let Some(mut existing) = guard.take() {
            let _ = existing.client.clear_activity();
            let _ = existing.client.shutdown();
        }
    }

    // Create client - start in background thread to not block the app
    let client = Client::new(desired_client_id);

    // Use a channel to communicate result from background thread
    let (tx, rx) = std::sync::mpsc::channel();

    // Spawn background thread for Discord RPC initialization
    thread::spawn(move || {
        let mut client = client;
        client.start();

        let result = set_idle_activity(&mut client);
        if let Err(error) = result {
            eprintln!("[Discord RPC] Startup skipped: {}", error);
            let _ = client.shutdown();
            let _ = tx.send(None);
            return;
        }

        let _ = tx.send(Some(DiscordRpc {
            client,
            client_id: desired_client_id,
        }));
    });

    // Wait for initialization with short timeout
    let start_time = std::time::Instant::now();
    while start_time.elapsed().as_millis() < RPC_START_TIMEOUT_MS as u128 {
        if let Ok(result) = rx.try_recv() {
            if let Some(discord_rpc) = result {
                let mut guard = DISCORD_BRIDGE
                    .lock()
                    .map_err(|_| "Bridge lock poisoned".to_string())?;
                *guard = Some(discord_rpc);
                return Ok(true);
            }
            return Ok(false);
        }
        thread::sleep(Duration::from_millis(10));
    }

    // Timeout - still return true to not block app, Discord will init lazily on next track
    Ok(true)
}

#[tauri::command]
fn discord_bridge_update(payload: DiscordBridgePayload) -> Result<(), String> {
    let mut guard = DISCORD_BRIDGE
        .lock()
        .map_err(|_| "Bridge lock poisoned".to_string())?;
    let bridge = guard
        .as_mut()
        .ok_or_else(|| "Discord bridge is not running".to_string())?;

    let details = payload
        .details
        .unwrap_or_else(|| "Unknown Track".to_string());
    let state = payload.state.unwrap_or_else(|| "Monochrome+".to_string());

    let large_image_key = payload
        .large_image_key
        .unwrap_or_else(|| "monochrome".to_string());
    let large_image_base64 = payload.large_image_base64;
    let large_image_fallback_base64 = payload.large_image_fallback_base64;
    let large_image_text = payload
        .large_image_text
        .unwrap_or_else(|| "Monochrome+".to_string());

    let small_image_key = payload
        .small_image_key
        .unwrap_or_else(|| "playing_icon".to_string());
    let small_image_text = payload
        .small_image_text
        .unwrap_or_else(|| "Playing".to_string());

    let button_label = "Listen to this song".to_string();
    let button_url = payload
        .button_two_url
        .clone()
        .unwrap_or_else(|| "https://github.com/itsmeadarsh2008/monochrome-plus".to_string());

    let has_second_button = payload.button_two_label.is_some() && payload.button_two_url.is_some();
    let button_two_label = payload.button_two_label;
    let button_two_url = payload.button_two_url;

    let start_timestamp =
        payload
            .start_timestamp
            .and_then(|ts| if ts >= 0 { Some(ts as u64) } else { None });
    let end_timestamp =
        payload
            .end_timestamp
            .and_then(|ts| if ts >= 0 { Some(ts as u64) } else { None });

    let safe_large_image_candidates = resolve_discord_large_image_candidates(
        &large_image_key,
        large_image_base64.as_deref(),
        large_image_fallback_base64.as_ref(),
    );

    let mut last_error: Option<String> = None;

    for safe_large_image in safe_large_image_candidates {
        for _ in 0..3 {
            let details_value = details.clone();
            let state_value = state.clone();
            let large_image_value = safe_large_image.clone();
            let large_image_text_value = large_image_text.clone();
            let small_image_value = small_image_key.clone();
            let small_image_text_value = small_image_text.clone();
            let button_label_value = button_label.clone();
            let button_url_value = button_url.clone();
            let button_two_label_value = button_two_label.clone();
            let button_two_url_value = button_two_url.clone();
            let start_value = start_timestamp;
            let end_value = end_timestamp;
            let has_second = has_second_button;

            match bridge.client.set_activity(|activity| {
                let activity = activity
                    .activity_type(ActivityType::Listening)
                    .details(&details_value)
                    .state(&state_value)
                    .assets(|assets| {
                        assets
                            .large_image(&large_image_value)
                            .large_text(&large_image_text_value)
                            .small_image(&small_image_value)
                            .small_text(&small_image_text_value)
                    })
                    .append_buttons(|button| {
                        let button = button.label(&button_label_value).url(&button_url_value);
                        button
                    });

                let activity = if has_second {
                    if let (Some(label), Some(url)) =
                        (&button_two_label_value, &button_two_url_value)
                    {
                        activity.append_buttons(|button| button.label(label).url(url))
                    } else {
                        activity
                    }
                } else {
                    activity
                };

                if start_value.is_some() || end_value.is_some() {
                    activity.timestamps(|timestamps| {
                        let timestamps = if let Some(start) = start_value {
                            timestamps.start(start)
                        } else {
                            timestamps
                        };

                        if let Some(end) = end_value {
                            timestamps.end(end)
                        } else {
                            timestamps
                        }
                    })
                } else {
                    activity
                }
            }) {
                Ok(_) => return Ok(()),
                Err(DiscordError::NotStarted) => {
                    last_error = Some("Discord RPC not started".to_string());
                    thread::sleep(Duration::from_millis(50));
                }
                Err(err) => {
                    last_error = Some(err.to_string());
                    break;
                }
            }
        }
    }

    Err(last_error
        .unwrap_or_else(|| "Discord RPC update timed out waiting for ready state".to_string()))
}

#[tauri::command]
fn discord_bridge_clear() -> Result<(), String> {
    let mut guard = DISCORD_BRIDGE
        .lock()
        .map_err(|_| "Bridge lock poisoned".to_string())?;
    let bridge = guard
        .as_mut()
        .ok_or_else(|| "Discord bridge is not running".to_string())?;

    bridge
        .client
        .clear_activity()
        .map_err(|err| err.to_string())?;
    set_idle_activity(&mut bridge.client)
}

#[tauri::command]
fn discord_bridge_stop() -> Result<(), String> {
    let mut guard = DISCORD_BRIDGE
        .lock()
        .map_err(|_| "Bridge lock poisoned".to_string())?;
    let mut bridge = match guard.take() {
        Some(bridge) => bridge,
        None => return Ok(()),
    };

    let _ = bridge.client.clear_activity();
    let _ = bridge.client.shutdown();
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            discord_bridge_start,
            discord_bridge_update,
            discord_bridge_clear,
            discord_bridge_stop,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            if cfg!(debug_assertions) {
                handle.plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Debug)
                        .build(),
                )?;
            }

            // Close splash screen and show main window - reduced timeout for faster startup
            let handle_clone = handle.clone();
            std::thread::spawn(move || {
                // Give the main window minimal time to render
                std::thread::sleep(std::time::Duration::from_millis(500));
                if let Some(splash) = handle_clone.get_webview_window("splashscreen") {
                    let _ = splash.close();
                }
                if let Some(main) = handle_clone.get_webview_window("main") {
                    let _ = main.show();
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
