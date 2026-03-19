use discord_presence::models::ActivityType;
use discord_presence::Client;
use quick_xml::events::Event;
use quick_xml::Reader;
use rodio::{Decoder, OutputStream, OutputStreamBuilder, Sink, Source};
use serde::Deserialize;
use serde::Serialize;
use std::fs::File;
use std::io::{BufReader, Cursor, Read};
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

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

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AudioSourceDescriptor {
    source_type: String,
    url: Option<String>,
    local_path: Option<String>,
    mpd_xml: Option<String>,
    start_position_ms: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioEngineState {
    initialized: bool,
    playing: bool,
    position_ms: u64,
    duration_ms: u64,
    volume: f32,
    source_type: Option<String>,
    last_error: Option<String>,
}

struct AudioEngineInner {
    stream: Option<OutputStream>,
    sink: Option<Sink>,
    source_type: Option<String>,
    start_at: Option<Instant>,
    paused_at_ms: u64,
    duration_ms: u64,
    volume: f32,
    last_error: Option<String>,
}

impl AudioEngineInner {
    fn new() -> Self {
        Self {
            stream: None,
            sink: None,
            source_type: None,
            start_at: None,
            paused_at_ms: 0,
            duration_ms: 0,
            volume: 1.0,
            last_error: None,
        }
    }

    fn is_playing(&self) -> bool {
        self.sink
            .as_ref()
            .map(|sink| !sink.is_paused())
            .unwrap_or(false)
    }

    fn current_position_ms(&self) -> u64 {
        if let Some(sink) = &self.sink {
            return sink.get_pos().as_millis() as u64;
        }
        self.paused_at_ms
    }

    fn to_state(&self) -> AudioEngineState {
        AudioEngineState {
            initialized: self.stream.is_some(),
            playing: self.is_playing(),
            position_ms: self.current_position_ms(),
            duration_ms: self.duration_ms,
            volume: self.volume,
            source_type: self.source_type.clone(),
            last_error: self.last_error.clone(),
        }
    }
}

struct AudioEngineHandle {
    inner: Arc<Mutex<AudioEngineInner>>,
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
            DesiredPresence::None => client
                .clear_activity()
                .map(|_| ())
                .map_err(|e| e.to_string()),
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

fn emit_audio_state(app: &tauri::AppHandle, inner: &AudioEngineInner) {
    let _ = app.emit("audio-engine-state", inner.to_state());
}

fn ensure_audio_output(inner: &mut AudioEngineInner) -> Result<(), String> {
    if inner.stream.is_some() {
        return Ok(());
    }
    let stream = OutputStreamBuilder::open_default_stream().map_err(|e| e.to_string())?;
    inner.stream = Some(stream);
    Ok(())
}

fn read_local_file_bytes(path: &str) -> Result<Vec<u8>, String> {
    let resolved = PathBuf::from(path);
    let mut file = File::open(&resolved).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes)
}

fn parse_mpd_urls(mpd_xml: &str) -> Result<Vec<String>, String> {
    let mut reader = Reader::from_str(mpd_xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();

    let mut init_url: Option<String> = None;
    let mut media_tpl: Option<String> = None;
    let mut start_number: u64 = 1;
    let mut total_segments: u64 = 0;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).to_string();
                if name == "SegmentTemplate" {
                    for attr in e.attributes().flatten() {
                        let key = String::from_utf8_lossy(attr.key.as_ref()).to_string();
                        let value = String::from_utf8_lossy(attr.value.as_ref()).to_string();
                        if key == "initialization" {
                            init_url = Some(value);
                        } else if key == "media" {
                            media_tpl = Some(value);
                        } else if key == "startNumber" {
                            start_number = value.parse::<u64>().unwrap_or(1);
                        }
                    }
                }
                if name == "S" {
                    let mut repeat = 0_i64;
                    for attr in e.attributes().flatten() {
                        if attr.key.as_ref() == b"r" {
                            repeat = String::from_utf8_lossy(attr.value.as_ref())
                                .parse::<i64>()
                                .unwrap_or(0);
                        }
                    }
                    total_segments += 1 + u64::try_from(repeat.max(0)).unwrap_or(0);
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(e.to_string()),
            _ => {}
        }
        buf.clear();
    }

    let init = init_url.ok_or_else(|| "MPD initialization URL missing".to_string())?;
    let media = media_tpl.ok_or_else(|| "MPD media template missing".to_string())?;
    let segment_count = if total_segments > 0 {
        total_segments
    } else {
        160
    };

    let mut urls = Vec::new();
    urls.push(init);
    for n in start_number..(start_number + segment_count) {
        urls.push(media.replace("$Number$", &n.to_string()));
    }
    Ok(urls)
}

fn download_audio_bytes(url: &str) -> Result<Vec<u8>, String> {
    let response = reqwest::blocking::get(url).map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    response
        .bytes()
        .map(|b| b.to_vec())
        .map_err(|e| e.to_string())
}

fn download_mpd_audio_bytes(mpd_xml: &str) -> Result<Vec<u8>, String> {
    let urls = parse_mpd_urls(mpd_xml)?;
    let client = reqwest::blocking::Client::builder()
        .user_agent("MonochromePlus/AudioEngine")
        .build()
        .map_err(|e| e.to_string())?;

    let mut merged = Vec::new();
    for url in urls {
        let response = client.get(url).send().map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!("MPD segment HTTP {}", response.status()));
        }
        let bytes = response.bytes().map_err(|e| e.to_string())?;
        merged.extend_from_slice(&bytes);
    }

    Ok(merged)
}

fn resolve_source_bytes(desc: &AudioSourceDescriptor) -> Result<Vec<u8>, String> {
    if let Some(local_path) = &desc.local_path {
        return read_local_file_bytes(local_path);
    }

    if let Some(mpd_xml) = &desc.mpd_xml {
        return download_mpd_audio_bytes(mpd_xml);
    }

    if let Some(url) = &desc.url {
        return download_audio_bytes(url);
    }

    Err("No playable source in descriptor".to_string())
}

fn load_into_sink(
    inner: &mut AudioEngineInner,
    desc: &AudioSourceDescriptor,
) -> Result<(), String> {
    ensure_audio_output(inner)?;
    if let Some(existing) = inner.sink.take() {
        existing.stop();
    }

    let stream = inner
        .stream
        .as_ref()
        .ok_or_else(|| "Output stream not initialized".to_string())?;
    let sink = Sink::connect_new(stream.mixer());
    sink.set_volume(inner.volume);

    let bytes = resolve_source_bytes(desc)?;
    let cursor = Cursor::new(bytes);
    let decoder = Decoder::new(BufReader::new(cursor)).map_err(|e| e.to_string())?;
    let duration_ms = decoder
        .total_duration()
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default();

    let start_position_ms = desc.start_position_ms.unwrap_or(0);
    if start_position_ms > 0 {
        sink.append(decoder.skip_duration(Duration::from_millis(start_position_ms)));
    } else {
        sink.append(decoder);
    }

    sink.play();
    inner.duration_ms = duration_ms;
    inner.paused_at_ms = start_position_ms;
    inner.start_at = Some(Instant::now());
    inner.source_type = Some(desc.source_type.clone());
    inner.last_error = None;
    inner.sink = Some(sink);
    Ok(())
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

#[tauri::command]
fn audio_engine_init(
    app: tauri::AppHandle,
    state: tauri::State<'_, AudioEngineHandle>,
) -> Result<AudioEngineState, String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Audio engine lock poisoned".to_string())?;
    ensure_audio_output(&mut inner)?;
    let snapshot = inner.to_state();
    emit_audio_state(&app, &inner);
    Ok(snapshot)
}

#[tauri::command]
fn audio_engine_load(
    app: tauri::AppHandle,
    state: tauri::State<'_, AudioEngineHandle>,
    source_descriptor: AudioSourceDescriptor,
) -> Result<AudioEngineState, String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Audio engine lock poisoned".to_string())?;
    match load_into_sink(&mut inner, &source_descriptor) {
        Ok(_) => {
            let snapshot = inner.to_state();
            emit_audio_state(&app, &inner);
            Ok(snapshot)
        }
        Err(e) => {
            inner.last_error = Some(e.clone());
            emit_audio_state(&app, &inner);
            Err(e)
        }
    }
}

#[tauri::command]
fn audio_engine_play(
    app: tauri::AppHandle,
    state: tauri::State<'_, AudioEngineHandle>,
) -> Result<AudioEngineState, String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Audio engine lock poisoned".to_string())?;
    if let Some(sink) = inner.sink.as_ref() {
        sink.play();
        let current_pos = sink.get_pos().as_millis() as u64;
        inner.paused_at_ms = current_pos;
        inner.start_at = Some(Instant::now() - Duration::from_millis(current_pos));
    }
    let snapshot = inner.to_state();
    emit_audio_state(&app, &inner);
    Ok(snapshot)
}

#[tauri::command]
fn audio_engine_pause(
    app: tauri::AppHandle,
    state: tauri::State<'_, AudioEngineHandle>,
) -> Result<AudioEngineState, String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Audio engine lock poisoned".to_string())?;
    if let Some(sink) = inner.sink.as_ref() {
        inner.paused_at_ms = sink.get_pos().as_millis() as u64;
        sink.pause();
    }
    let snapshot = inner.to_state();
    emit_audio_state(&app, &inner);
    Ok(snapshot)
}

#[tauri::command]
fn audio_engine_stop(
    app: tauri::AppHandle,
    state: tauri::State<'_, AudioEngineHandle>,
) -> Result<AudioEngineState, String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Audio engine lock poisoned".to_string())?;
    if let Some(existing) = inner.sink.take() {
        existing.stop();
    }
    inner.start_at = None;
    inner.paused_at_ms = 0;
    inner.duration_ms = 0;
    let snapshot = inner.to_state();
    emit_audio_state(&app, &inner);
    Ok(snapshot)
}

#[tauri::command]
fn audio_engine_seek(
    app: tauri::AppHandle,
    state: tauri::State<'_, AudioEngineHandle>,
    position_ms: u64,
) -> Result<AudioEngineState, String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Audio engine lock poisoned".to_string())?;
    if let Some(sink) = inner.sink.as_ref() {
        let _ = sink.try_seek(Duration::from_millis(position_ms));
        inner.paused_at_ms = position_ms;
        if !sink.is_paused() {
            inner.start_at = Some(Instant::now() - Duration::from_millis(position_ms));
        }
    }
    let snapshot = inner.to_state();
    emit_audio_state(&app, &inner);
    Ok(snapshot)
}

#[tauri::command]
fn audio_engine_set_volume(
    app: tauri::AppHandle,
    state: tauri::State<'_, AudioEngineHandle>,
    volume: f32,
) -> Result<AudioEngineState, String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Audio engine lock poisoned".to_string())?;
    let normalized = volume.clamp(0.0, 1.0);
    inner.volume = normalized;
    if let Some(sink) = inner.sink.as_ref() {
        sink.set_volume(normalized);
    }
    let snapshot = inner.to_state();
    emit_audio_state(&app, &inner);
    Ok(snapshot)
}

#[tauri::command]
fn audio_engine_get_state(
    state: tauri::State<'_, AudioEngineHandle>,
) -> Result<AudioEngineState, String> {
    let inner = state
        .inner
        .lock()
        .map_err(|_| "Audio engine lock poisoned".to_string())?;
    Ok(inner.to_state())
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
            audio_engine_init,
            audio_engine_load,
            audio_engine_play,
            audio_engine_pause,
            audio_engine_stop,
            audio_engine_seek,
            audio_engine_set_volume,
            audio_engine_get_state,
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
            app.manage(AudioEngineHandle {
                inner: Arc::new(Mutex::new(AudioEngineInner::new())),
            });

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
