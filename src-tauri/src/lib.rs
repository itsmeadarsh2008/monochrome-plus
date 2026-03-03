#[cfg_attr(mobile, tauri::mobile_entry_point)]

// Discord App ID for Monochrome+ (hardcoded as requested)
const DISCORD_APP_ID: &str = "1466351059843809282";

#[tauri::command]
fn get_discord_app_id() -> String {
    DISCORD_APP_ID.to_string()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_drpc::init())
        .invoke_handler(tauri::generate_handler![get_discord_app_id])
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
