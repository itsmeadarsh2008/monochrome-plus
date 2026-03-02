#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use discord_rich_presence::{
    activity::{Activity, Assets, Timestamps},
    DiscordIpc, DiscordIpcClient,
};
use serde::Deserialize;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{Manager, State};

const DISCORD_CLIENT_ID: &str = "1466351059843809282";
const RPC_CONNECT_RETRIES: usize = 3;
const RPC_UPDATE_RETRIES: usize = 3;

#[derive(Default)]
struct RpcState {
    client: Mutex<Option<DiscordIpcClient>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscordPresencePayload {
    details: Option<String>,
    state: Option<String>,
    large_image_key: Option<String>,
    large_image_text: Option<String>,
    small_image_key: Option<String>,
    small_image_text: Option<String>,
    start_timestamp: Option<i64>,
    end_timestamp: Option<i64>,
}

struct NormalizedPresence {
    details: String,
    state: String,
    large_image_key: String,
    large_image_text: String,
    small_image_key: Option<String>,
    small_image_text: Option<String>,
    start_timestamp: Option<i64>,
    end_timestamp: Option<i64>,
}

fn clamp_text(value: Option<String>, max_len: usize) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return None;
        }

        let mut out = String::with_capacity(trimmed.len().min(max_len));
        for ch in trimmed.chars().take(max_len) {
            out.push(ch);
        }
        Some(out)
    })
}

fn connect_client(client_guard: &mut Option<DiscordIpcClient>) -> Result<(), String> {
    if client_guard.is_some() {
        return Ok(());
    }

    let mut last_error = String::from("Unknown Discord RPC init error");
    for attempt in 0..RPC_CONNECT_RETRIES {
        match DiscordIpcClient::new(DISCORD_CLIENT_ID) {
            Ok(mut created) => match created.connect() {
                Ok(()) => {
                    *client_guard = Some(created);
                    return Ok(());
                }
                Err(e) => {
                    last_error = format!("Failed to connect Discord RPC client: {e}");
                }
            },
            Err(e) => {
                last_error = format!("Failed to create Discord RPC client: {e}");
            }
        }

        if attempt + 1 < RPC_CONNECT_RETRIES {
            thread::sleep(Duration::from_millis(300));
        }
    }

    Err(last_error)
}

fn normalize_presence_payload(
    payload: &DiscordPresencePayload,
    allow_external_cover: bool,
) -> NormalizedPresence {
    let details =
        clamp_text(payload.details.clone(), 128).unwrap_or_else(|| "Monochrome+".to_string());
    let state = clamp_text(payload.state.clone(), 128)
        .unwrap_or_else(|| "Listening on Monochrome+".to_string());

    let mut large_image_key = clamp_text(payload.large_image_key.clone(), 300);
    if !allow_external_cover {
        if large_image_key
            .as_deref()
            .is_some_and(|key| key.starts_with("mp:"))
        {
            large_image_key = None;
        }
    }

    if large_image_key.is_none() {
        large_image_key = Some("appicon".to_string());
    }

    let large_image_text = clamp_text(payload.large_image_text.clone(), 128)
        .unwrap_or_else(|| "Monochrome+".to_string());
    let small_image_key = clamp_text(payload.small_image_key.clone(), 64);
    let small_image_text = clamp_text(payload.small_image_text.clone(), 128);

    NormalizedPresence {
        details,
        state,
        large_image_key: large_image_key.unwrap_or_else(|| "appicon".to_string()),
        large_image_text,
        small_image_key,
        small_image_text,
        start_timestamp: payload.start_timestamp,
        end_timestamp: payload.end_timestamp,
    }
}

#[tauri::command]
fn update_discord_presence(
    payload: DiscordPresencePayload,
    rpc_state: State<RpcState>,
) -> Result<(), String> {
    let mut client_guard = rpc_state
        .client
        .lock()
        .map_err(|_| "Failed to lock Discord RPC state".to_string())?;

    let mut last_error = String::from("Failed to update Discord RPC activity");

    for attempt in 0..RPC_UPDATE_RETRIES {
        connect_client(&mut client_guard)?;

        let allow_external_cover = attempt == 0;
        let normalized = normalize_presence_payload(&payload, allow_external_cover);
        let mut activity = Activity::new()
            .details(normalized.details.as_str())
            .state(normalized.state.as_str());

        let mut assets = Assets::new()
            .large_image(normalized.large_image_key.as_str())
            .large_text(normalized.large_image_text.as_str());

        if let Some(ref key) = normalized.small_image_key {
            assets = assets.small_image(key.as_str());
        }
        if let Some(ref text) = normalized.small_image_text {
            assets = assets.small_text(text.as_str());
        }

        activity = activity.assets(assets);

        if normalized.start_timestamp.is_some() || normalized.end_timestamp.is_some() {
            let mut timestamps = Timestamps::new();
            if let Some(start) = normalized.start_timestamp {
                timestamps = timestamps.start(start);
            }
            if let Some(end) = normalized.end_timestamp {
                timestamps = timestamps.end(end);
            }
            activity = activity.timestamps(timestamps);
        }

        let update_result = client_guard
            .as_mut()
            .ok_or_else(|| "Discord RPC client not available".to_string())?
            .set_activity(activity);

        match update_result {
            Ok(()) => return Ok(()),
            Err(error) => {
                last_error = format!("Failed to set Discord RPC activity: {error}");
                *client_guard = None;
                if attempt + 1 < RPC_UPDATE_RETRIES {
                    thread::sleep(Duration::from_millis(300));
                }
            }
        }
    }

    Err(last_error)
}

#[tauri::command]
fn clear_discord_presence(rpc_state: State<RpcState>) -> Result<(), String> {
    let mut client_guard = rpc_state
        .client
        .lock()
        .map_err(|_| "Failed to lock Discord RPC state".to_string())?;

    if let Some(client) = client_guard.as_mut() {
        client
            .clear_activity()
            .map_err(|e| format!("Failed to clear Discord RPC activity: {e}"))?;
    }

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .manage(RpcState::default())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("Monochrome+");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            update_discord_presence,
            clear_discord_presence
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
