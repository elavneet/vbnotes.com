fn main() {
    // llama.cpp's Metal code checks the macOS version (`@available`); that check lives in clang's
    // runtime library, which a Rust link leaves out.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let out = std::process::Command::new("xcrun").args(["clang", "--print-resource-dir"]).output();
        if let Some(out) = out.ok().filter(|o| o.status.success()) {
            let dir = String::from_utf8_lossy(&out.stdout).trim().to_string();
            println!("cargo:rustc-link-search=native={dir}/lib/darwin");
            println!("cargo:rustc-link-lib=static=clang_rt.osx");
        }
    }
    tauri_build::build()
}
