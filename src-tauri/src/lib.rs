#[cfg_attr(mobile, tauri::mobile_entry_point)]
use discord_presence::Client;
use once_cell::sync::Lazy;
use serde::Deserialize;
use std::sync::Mutex;

const DEFAULT_DISCORD_CLIENT_ID: &str = "1466351059843809282";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscordBridgePayload {
    details: Option<String>,
    state: Option<String>,
    large_image_key: Option<String>,
    large_image_text: Option<String>,
    small_image_key: Option<String>,
    small_image_text: Option<String>,
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
    client
        .set_activity(|activity| activity.details("Idling").state("Monochrome+"))
        .map(|_| ())
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn discord_bridge_start(client_id: Option<String>) -> Result<bool, String> {
    let desired_client_id = parse_client_id(client_id)?;
    let mut guard = DISCORD_BRIDGE
        .lock()
        .map_err(|_| "Bridge lock poisoned".to_string())?;

    if let Some(existing) = guard.as_ref() {
        if existing.client_id == desired_client_id {
            return Ok(true);
        }
    }

    if let Some(mut existing) = guard.take() {
        let _ = existing.client.clear_activity();
        let _ = existing.client.shutdown();
    }

    let mut client = Client::new(desired_client_id);
    client.start();
    set_idle_activity(&mut client)?;

    *guard = Some(DiscordRpc {
        client,
        client_id: desired_client_id,
    });
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

    let details = payload.details.unwrap_or_else(|| "Idling".to_string());
    let state = payload.state.unwrap_or_else(|| "Monochrome+".to_string());
    let large_image_key = payload
        .large_image_key
        .unwrap_or_else(|| "monochrome".to_string());
    let large_image_text = payload
        .large_image_text
        .unwrap_or_else(|| "Monochrome+".to_string());
    let small_image_key = payload.small_image_key.unwrap_or_default();
    let small_image_text = payload.small_image_text.unwrap_or_default();
    let start_timestamp =
        payload
            .start_timestamp
            .and_then(|ts| if ts >= 0 { Some(ts as u64) } else { None });
    let end_timestamp =
        payload
            .end_timestamp
            .and_then(|ts| if ts >= 0 { Some(ts as u64) } else { None });

    bridge
        .client
        .set_activity(|activity| {
            let activity = activity.details(details).state(state).assets(|assets| {
                let assets = assets
                    .large_image(large_image_key)
                    .large_text(large_image_text);

                if small_image_key.is_empty() {
                    assets
                } else {
                    assets
                        .small_image(small_image_key)
                        .small_text(small_image_text)
                }
            });

            if start_timestamp.is_some() || end_timestamp.is_some() {
                activity.timestamps(|timestamps| {
                    let timestamps = if let Some(start) = start_timestamp {
                        timestamps.start(start)
                    } else {
                        timestamps
                    };

                    if let Some(end) = end_timestamp {
                        timestamps.end(end)
                    } else {
                        timestamps
                    }
                })
            } else {
                activity
            }
        })
        .map(|_| ())
        .map_err(|err| err.to_string())
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
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Debug)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
