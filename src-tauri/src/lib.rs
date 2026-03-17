use discord_presence::models::ActivityType;
use discord_presence::Client;
use serde::Deserialize;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::Manager;

const DEFAULT_DISCORD_CLIENT_ID: u64 = 1478608904609857576;
const WORKER_POLL_INTERVAL_MS: u64 = 500;
const INITIAL_RECONNECT_DELAY_MS: u64 = 2000;
const MAX_RECONNECT_DELAY_MS: u64 = 30000;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscordPresencePayload {
    details: Option<String>,
    state: Option<String>,
    large_image_key: Option<String>,
    large_image_text: Option<String>,
    small_image_key: Option<String>,
    small_image_text: Option<String>,
    button_two_label: Option<String>,
    button_two_url: Option<String>,
    start_timestamp: Option<i64>,
    end_timestamp: Option<i64>,
}

enum RpcCommand {
    Start { client_id: u64 },
    Update(DiscordPresencePayload),
    Clear,
    Stop,
    Shutdown,
}

struct DiscordRpcHandle {
    tx: mpsc::Sender<RpcCommand>,
}

enum DesiredPresence {
    None,
    Idle,
    Track(DiscordPresencePayload),
}

struct WorkerState {
    enabled: bool,
    client_id: u64,
    client: Option<Client>,
    desired: DesiredPresence,
    dirty: bool,
    next_attempt_at: Instant,
    reconnect_delay: Duration,
}

impl WorkerState {
    fn new() -> Self {
        Self {
            enabled: false,
            client_id: DEFAULT_DISCORD_CLIENT_ID,
            client: None,
            desired: DesiredPresence::None,
            dirty: false,
            next_attempt_at: Instant::now(),
            reconnect_delay: Duration::from_millis(INITIAL_RECONNECT_DELAY_MS),
        }
    }

    fn handle(&mut self, cmd: RpcCommand) {
        match cmd {
            RpcCommand::Start { client_id } => {
                if self.enabled && self.client_id == client_id && self.client.is_some() {
                    return;
                }
                self.disconnect();
                self.client_id = client_id;
                self.enabled = true;
                self.desired = DesiredPresence::Idle;
                self.dirty = true;
                self.next_attempt_at = Instant::now();
                self.reconnect_delay = Duration::from_millis(INITIAL_RECONNECT_DELAY_MS);
            }
            RpcCommand::Update(payload) => {
                self.desired = DesiredPresence::Track(payload);
                self.dirty = true;
            }
            RpcCommand::Clear => {
                self.desired = DesiredPresence::Idle;
                self.dirty = true;
            }
            RpcCommand::Stop => {
                self.enabled = false;
                self.desired = DesiredPresence::None;
                self.dirty = false;
                self.disconnect();
            }
            RpcCommand::Shutdown => {}
        }
    }

    fn disconnect(&mut self) {
        if let Some(mut client) = self.client.take() {
            let _ = client.clear_activity();
            let _ = client.shutdown();
        }
    }

    fn tick(&mut self) {
        if !self.enabled {
            if self.client.is_some() {
                self.disconnect();
            }
            return;
        }

        if self.client.is_none() {
            if Instant::now() < self.next_attempt_at {
                return;
            }

            if !Self::discord_ipc_available() {
                self.schedule_reconnect();
                return;
            }

            self.try_connect();
            return;
        }

        if self.dirty {
            self.apply_presence();
        }
    }

    fn try_connect(&mut self) {
        let mut client = Client::new(self.client_id);

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.start();
        }));

        match result {
            Ok(()) => {
                log::info!("[Discord RPC] Connected successfully");
                self.client = Some(client);
                self.reconnect_delay = Duration::from_millis(INITIAL_RECONNECT_DELAY_MS);
                self.dirty = true;
            }
            Err(_) => {
                log::warn!("[Discord RPC] Connection failed (panic caught)");
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    client.shutdown();
                }));
                self.schedule_reconnect();
            }
        }
    }

    fn schedule_reconnect(&mut self) {
        self.next_attempt_at = Instant::now() + self.reconnect_delay;
        self.reconnect_delay = std::cmp::min(
            self.reconnect_delay * 2,
            Duration::from_millis(MAX_RECONNECT_DELAY_MS),
        );
    }

    fn apply_presence(&mut self) {
        let client = match self.client.as_mut() {
            Some(c) => c,
            None => return,
        };

        let result = match &self.desired {
            DesiredPresence::None => client.clear_activity().map(|_| ()).map_err(|e| e.to_string()),
            DesiredPresence::Idle => client
                .set_activity(|activity| {
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
                })
                .map(|_| ())
                .map_err(|e| e.to_string()),
            DesiredPresence::Track(payload) => Self::set_track_activity(client, payload),
        };

        match result {
            Ok(_) => {
                self.dirty = false;
            }
            Err(e) => {
                log::warn!("[Discord RPC] Failed to set activity: {}", e);
                self.disconnect();
                self.schedule_reconnect();
            }
        }
    }

    fn set_track_activity(
        client: &mut Client,
        payload: &DiscordPresencePayload,
    ) -> Result<(), String> {
        let details = payload
            .details
            .clone()
            .unwrap_or_else(|| "Unknown Track".to_string());
        let state = payload
            .state
            .clone()
            .unwrap_or_else(|| "Monochrome+".to_string());
        let large_image = normalize_image_key(payload.large_image_key.as_deref());
        let large_text = payload
            .large_image_text
            .clone()
            .unwrap_or_else(|| "Monochrome+".to_string());
        let small_image = payload
            .small_image_key
            .clone()
            .unwrap_or_else(|| "playing_icon".to_string());
        let small_text = payload
            .small_image_text
            .clone()
            .unwrap_or_else(|| "Playing".to_string());

        let button_url = payload
            .button_two_url
            .clone()
            .unwrap_or_else(|| "https://github.com/itsmeadarsh2008/monochrome-plus".to_string());
        let has_second_button =
            payload.button_two_label.is_some() && payload.button_two_url.is_some();
        let btn2_label = payload.button_two_label.clone();
        let btn2_url = payload.button_two_url.clone();

        let start_ts =
            payload
                .start_timestamp
                .and_then(|ts| if ts >= 0 { Some(ts as u64) } else { None });
        let end_ts = payload
            .end_timestamp
            .and_then(|ts| if ts >= 0 { Some(ts as u64) } else { None });

        client
            .set_activity(|activity| {
                let activity = activity
                    .activity_type(ActivityType::Listening)
                    .details(&details)
                    .state(&state)
                    .assets(|assets| {
                        assets
                            .large_image(&large_image)
                            .large_text(&large_text)
                            .small_image(&small_image)
                            .small_text(&small_text)
                    })
                    .append_buttons(|button| button.label("Listen to this song").url(&button_url));

                let activity = if has_second_button {
                    if let (Some(label), Some(url)) = (&btn2_label, &btn2_url) {
                        activity.append_buttons(|button| button.label(label).url(url))
                    } else {
                        activity
                    }
                } else {
                    activity
                };

                if start_ts.is_some() || end_ts.is_some() {
                    activity.timestamps(|timestamps| {
                        let timestamps = if let Some(start) = start_ts {
                            timestamps.start(start)
                        } else {
                            timestamps
                        };
                        if let Some(end) = end_ts {
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
            .map_err(|e| e.to_string())
    }

    fn discord_ipc_available() -> bool {
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            let dirs_to_check: Vec<String> = vec![
                std::env::var("XDG_RUNTIME_DIR").unwrap_or_default(),
                std::env::var("TMPDIR").unwrap_or_default(),
                "/tmp".to_string(),
                format!("/run/user/{}", unsafe { libc::getuid() }),
            ];

            for dir in &dirs_to_check {
                if dir.is_empty() {
                    continue;
                }
                for i in 0..10 {
                    let path = format!("{}/discord-ipc-{}", dir, i);
                    if std::path::Path::new(&path).exists() {
                        return true;
                    }
                    let snap_path = format!("{}/snap.discord/discord-ipc-{}", dir, i);
                    if std::path::Path::new(&snap_path).exists() {
                        return true;
                    }
                }
            }
            return false;
        }

        #[cfg(windows)]
        {
            for i in 0..10 {
                let pipe_name = format!(r"\\.\pipe\discord-ipc-{}", i);
                if std::path::Path::new(&pipe_name).exists() {
                    return true;
                }
            }
            return false;
        }

        #[cfg(target_os = "macos")]
        {
            let dirs_to_check: Vec<String> = vec![
                std::env::var("TMPDIR").unwrap_or_default(),
                "/tmp".to_string(),
            ];

            for dir in &dirs_to_check {
                if dir.is_empty() {
                    continue;
                }
                for i in 0..10 {
                    let path = format!("{}/discord-ipc-{}", dir, i);
                    if std::path::Path::new(&path).exists() {
                        return true;
                    }
                }
            }
            return false;
        }

        #[cfg(not(any(unix, windows)))]
        {
            return true;
        }
    }
}

fn percent_encode_component(input: &str) -> String {
    let mut encoded = String::with_capacity(input.len() * 3);
    for byte in input.bytes() {
        let is_unreserved = matches!(
            byte,
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~'
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

fn external_url_to_discord_format(url: &str) -> String {
    if url.starts_with("mp:external/") {
        return url.to_string();
    }
    format!("mp:external/{}", percent_encode_component(url))
}

fn normalize_image_key(value: Option<&str>) -> String {
    match value.map(str::trim) {
        Some(v) if v.starts_with("mp:external/") => v.to_string(),
        Some(v) if v.starts_with("https://") || v.starts_with("http://") => {
            external_url_to_discord_format(&v.replace("http://", "https://"))
        }
        Some(v) if !v.is_empty() => v.to_string(),
        _ => "monochrome".to_string(),
    }
}

fn spawn_discord_rpc_worker() -> DiscordRpcHandle {
    let (tx, rx) = mpsc::channel::<RpcCommand>();

    thread::Builder::new()
        .name("discord-rpc-worker".to_string())
        .spawn(move || {
            let mut state = WorkerState::new();

            loop {
                match rx.recv_timeout(Duration::from_millis(WORKER_POLL_INTERVAL_MS)) {
                    Ok(RpcCommand::Shutdown) => {
                        state.disconnect();
                        break;
                    }
                    Ok(cmd) => state.handle(cmd),
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        state.disconnect();
                        break;
                    }
                }

                while let Ok(cmd) = rx.try_recv() {
                    match cmd {
                        RpcCommand::Shutdown => {
                            state.disconnect();
                            return;
                        }
                        other => state.handle(other),
                    }
                }

                state.tick();
            }
        })
        .expect("Failed to spawn Discord RPC worker thread");

    DiscordRpcHandle { tx }
}

fn parse_client_id(client_id: Option<String>) -> u64 {
    client_id
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(DEFAULT_DISCORD_CLIENT_ID)
}

#[tauri::command]
fn discord_bridge_start(
    state: tauri::State<'_, DiscordRpcHandle>,
    client_id: Option<String>,
) -> Result<(), String> {
    let id = parse_client_id(client_id);
    state
        .tx
        .send(RpcCommand::Start { client_id: id })
        .map_err(|_| "Discord RPC worker is not running".to_string())
}

#[tauri::command]
fn discord_bridge_update(
    state: tauri::State<'_, DiscordRpcHandle>,
    payload: DiscordPresencePayload,
) -> Result<(), String> {
    state
        .tx
        .send(RpcCommand::Update(payload))
        .map_err(|_| "Discord RPC worker is not running".to_string())
}

#[tauri::command]
fn discord_bridge_clear(state: tauri::State<'_, DiscordRpcHandle>) -> Result<(), String> {
    state
        .tx
        .send(RpcCommand::Clear)
        .map_err(|_| "Discord RPC worker is not running".to_string())
}

#[tauri::command]
fn discord_bridge_stop(state: tauri::State<'_, DiscordRpcHandle>) -> Result<(), String> {
    state
        .tx
        .send(RpcCommand::Stop)
        .map_err(|_| "Discord RPC worker is not running".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
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

            let rpc_handle = spawn_discord_rpc_worker();
            app.manage(rpc_handle);

            let handle_clone = handle.clone();
            std::thread::spawn(move || {
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