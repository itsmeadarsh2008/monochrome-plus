use discord_presence::models::ActivityType;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
use discord_presence::{Client, DiscordError, Event};
use once_cell::sync::Lazy;
use serde::Deserialize;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

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
    button_label: Option<String>,
    button_url: Option<String>,
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
    for _ in 0..20 {
        match client.set_activity(|activity| {
            activity
                .activity_type(ActivityType::Listening)
                .details("Monochrome+")
                .state("Listening on Monochrome+")
                .append_buttons(|button| {
                    button
                        .label("Try Monochrome+")
                        .url("https://github.com/itsmeadarsh2008/monochrome-plus")
                })
        }) {
            Ok(_) => return Ok(()),
            Err(DiscordError::NotStarted) => {
                thread::sleep(Duration::from_millis(120));
            }
            Err(err) => return Err(err.to_string()),
        }
    }

    Err("Discord RPC did not become ready in time".to_string())
}

fn wait_for_rpc_ready(client: &mut Client) -> Result<(), String> {
    match client.block_until_event(Event::Ready) {
        Ok(_) => Ok(()),
        Err(err) => Err(format!("Discord RPC did not become ready: {err}")),
    }
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
    wait_for_rpc_ready(&mut client)?;
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
    let _small_image_key = payload.small_image_key.unwrap_or_default();
    let _small_image_text = payload.small_image_text.unwrap_or_default();
    let button_label = payload
        .button_label
        .unwrap_or_else(|| "Try Monochrome+".to_string());
    let button_url = payload
        .button_url
        .unwrap_or_else(|| "https://github.com/itsmeadarsh2008/monochrome-plus".to_string());
    let start_timestamp =
        payload
            .start_timestamp
            .and_then(|ts| if ts >= 0 { Some(ts as u64) } else { None });
    let end_timestamp =
        payload
            .end_timestamp
            .and_then(|ts| if ts >= 0 { Some(ts as u64) } else { None });

    let safe_large_image =
        if large_image_key.starts_with("http://") || large_image_key.starts_with("https://") {
            "monochrome".to_string()
        } else {
            large_image_key.clone()
        };

    for _ in 0..20 {
        let details_value = details.clone();
        let state_value = state.clone();
        let large_image_value = safe_large_image.clone();
        let large_image_text_value = large_image_text.clone();
        let button_label_value = button_label.clone();
        let button_url_value = button_url.clone();
        let start_value = start_timestamp;
        let end_value = end_timestamp;

        match bridge.client.set_activity(|activity| {
            let activity = activity
                .activity_type(ActivityType::Listening)
                .details(details_value)
                .state(state_value)
                .assets(|assets| {
                    assets
                        .large_image(large_image_value)
                        .large_text(large_image_text_value)
                })
                .append_buttons(|button| button.label(button_label_value).url(button_url_value));

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
                thread::sleep(Duration::from_millis(120));
            }
            Err(err) => return Err(err.to_string()),
        }
    }

    Err("Discord RPC update timed out waiting for ready state".to_string())
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
