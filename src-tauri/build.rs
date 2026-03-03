use std::env;

fn main() {
    // Detect if we're building for a different target (cross-compilation)
    let target = env::var("TARGET").unwrap_or_default();
    let host = env::var("HOST").unwrap_or_default();

    // Check if this is a release build
    let profile = env::var("PROFILE").unwrap_or_default();
    let is_release = profile == "release";

    // For cross-compilation or release builds, ensure static assets are used
    if is_release {
        println!("cargo:rustc-cfg=tauri_production");
        println!("cargo:rustc-cfg=tauri_custom_protocol");

        // Set environment variable to tell Tauri to use production settings
        println!("cargo:rustc-env=TAURI_ENV=production");
    }

    println!("cargo:warning=Building for target: {}", target);
    println!("cargo:warning=Host: {}", host);
    println!("cargo:warning=Profile: {}", profile);

    // Run the standard Tauri build
    tauri_build::build()
}
