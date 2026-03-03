#[cfg_attr(mobile, tauri::mobile_entry_point)]
use once_cell::sync::Lazy;
use serde::Deserialize;
use std::fs;
use std::io::Write;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
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

struct DiscordBridgeProcess {
    child: Child,
    stdin: ChildStdin,
}

impl DiscordBridgeProcess {
    fn send_json_line(&mut self, value: serde_json::Value) -> Result<(), String> {
        let mut payload = serde_json::to_string(&value).map_err(|err| err.to_string())?;
        payload.push('\n');
        self.stdin
            .write_all(payload.as_bytes())
            .and_then(|_| self.stdin.flush())
            .map_err(|err| err.to_string())
    }
}

static DISCORD_BRIDGE: Lazy<Mutex<Option<DiscordBridgeProcess>>> = Lazy::new(|| Mutex::new(None));

const BRIDGE_PY: &str = include_str!("../scripts/bridge.py");
const BRIDGE_PS1: &str = include_str!("../scripts/bridge.ps1");

fn write_bridge_script_to_temp(name: &str, content: &str) -> Result<PathBuf, String> {
    let mut path = std::env::temp_dir();
    path.push(name);
    fs::write(&path, content).map_err(|err| err.to_string())?;
    Ok(path)
}

#[cfg(target_os = "windows")]
fn spawn_discord_bridge(client_id: &str) -> Result<DiscordBridgeProcess, String> {
    let script_path = write_bridge_script_to_temp("monochrome-discord-bridge.ps1", BRIDGE_PS1)?;

    let mut child = Command::new("powershell.exe")
        .arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-File")
        .arg(script_path)
        .arg("-ClientId")
        .arg(client_id)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(0x08000000)
        .spawn()
        .map_err(|err| err.to_string())?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open bridge stdin".to_string())?;

    Ok(DiscordBridgeProcess { child, stdin })
}

#[cfg(not(target_os = "windows"))]
fn spawn_discord_bridge(client_id: &str) -> Result<DiscordBridgeProcess, String> {
    let script_path = write_bridge_script_to_temp("monochrome-discord-bridge.py", BRIDGE_PY)?;

    let mut last_error = None;
    for python in ["python3", "python"] {
        match Command::new(python)
            .arg(&script_path)
            .arg(client_id)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(mut child) => {
                let stdin = child
                    .stdin
                    .take()
                    .ok_or_else(|| "Failed to open bridge stdin".to_string())?;
                return Ok(DiscordBridgeProcess { child, stdin });
            }
            Err(err) => {
                last_error = Some(err.to_string());
            }
        }
    }

    Err(last_error.unwrap_or_else(|| "Could not launch Python interpreter".to_string()))
}

#[tauri::command]
fn discord_bridge_start(client_id: Option<String>) -> Result<bool, String> {
    let mut guard = DISCORD_BRIDGE
        .lock()
        .map_err(|_| "Bridge lock poisoned".to_string())?;

    if let Some(existing) = guard.as_mut() {
        if existing
            .child
            .try_wait()
            .map_err(|err| err.to_string())?
            .is_none()
        {
            return Ok(true);
        }
        *guard = None;
    }

    let bridge = spawn_discord_bridge(client_id.as_deref().unwrap_or(DEFAULT_DISCORD_CLIENT_ID))?;
    *guard = Some(bridge);
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

    let payload_json = serde_json::json!({
        "cmd": "update",
        "details": payload.details,
        "state": payload.state,
        "largeImageKey": payload.large_image_key,
        "largeImageText": payload.large_image_text,
        "smallImageKey": payload.small_image_key,
        "smallImageText": payload.small_image_text,
        "startTimestamp": payload.start_timestamp,
        "endTimestamp": payload.end_timestamp,
        "pid": std::process::id(),
    });

    bridge.send_json_line(payload_json)
}

#[tauri::command]
fn discord_bridge_clear() -> Result<(), String> {
    let mut guard = DISCORD_BRIDGE
        .lock()
        .map_err(|_| "Bridge lock poisoned".to_string())?;
    let bridge = guard
        .as_mut()
        .ok_or_else(|| "Discord bridge is not running".to_string())?;
    bridge.send_json_line(serde_json::json!({
        "cmd": "clear",
        "pid": std::process::id(),
    }))
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

    let _ = bridge.send_json_line(serde_json::json!({ "cmd": "stop" }));
    let _ = bridge.child.kill();
    let _ = bridge.child.wait();
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
