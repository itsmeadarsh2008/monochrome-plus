#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use discord_rich_presence::{
    activity::{Activity, Assets, Timestamps},
    DiscordIpc, DiscordIpcClient,
};
use serde::Deserialize;
use std::sync::Mutex;
use tauri::{Manager, State};

const DISCORD_CLIENT_ID: &str = "1466351059843809282";

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

#[tauri::command]
fn update_discord_presence(
    payload: DiscordPresencePayload,
    rpc_state: State<RpcState>,
) -> Result<(), String> {
    let mut client_guard = rpc_state
        .client
        .lock()
        .map_err(|_| "Failed to lock Discord RPC state".to_string())?;

    if client_guard.is_none() {
        let mut created = DiscordIpcClient::new(DISCORD_CLIENT_ID)
            .map_err(|e| format!("Failed to create Discord RPC client: {e}"))?;
        created
            .connect()
            .map_err(|e| format!("Failed to connect Discord RPC client: {e}"))?;
        *client_guard = Some(created);
    }

    let client = client_guard
        .as_mut()
        .ok_or_else(|| "Discord RPC client not available".to_string())?;

    let details = payload.details;
    let state = payload.state;
    let large_image_key = payload.large_image_key;
    let large_image_text = payload.large_image_text;
    let small_image_key = payload.small_image_key;
    let small_image_text = payload.small_image_text;

    let mut activity = Activity::new();

    if let Some(ref d) = details {
        activity = activity.details(d.as_str());
    }
    if let Some(ref s) = state {
        activity = activity.state(s.as_str());
    }

    if large_image_key.is_some()
        || large_image_text.is_some()
        || small_image_key.is_some()
        || small_image_text.is_some()
    {
        let mut assets = Assets::new();
        if let Some(ref k) = large_image_key {
            assets = assets.large_image(k.as_str());
        }
        if let Some(ref t) = large_image_text {
            assets = assets.large_text(t.as_str());
        }
        if let Some(ref k) = small_image_key {
            assets = assets.small_image(k.as_str());
        }
        if let Some(ref t) = small_image_text {
            assets = assets.small_text(t.as_str());
        }
        activity = activity.assets(assets);
    }

    if payload.start_timestamp.is_some() || payload.end_timestamp.is_some() {
        let mut timestamps = Timestamps::new();
        if let Some(start) = payload.start_timestamp {
            timestamps = timestamps.start(start);
        }
        if let Some(end) = payload.end_timestamp {
            timestamps = timestamps.end(end);
        }
        activity = activity.timestamps(timestamps);
    }

    match client.set_activity(activity.clone()) {
        Ok(()) => Ok(()),
        Err(first_error) => {
            *client_guard = None;

            let mut recreated = DiscordIpcClient::new(DISCORD_CLIENT_ID)
                .map_err(|e| format!("Failed to recreate Discord RPC client: {e}"))?;
            recreated
                .connect()
                .map_err(|e| format!("Failed to reconnect Discord RPC client: {e}"))?;
            recreated.set_activity(activity).map_err(|e| {
                format!("Failed to set Discord RPC activity after reconnect ({first_error}): {e}")
            })?;
            *client_guard = Some(recreated);
            Ok(())
        }
    }
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
