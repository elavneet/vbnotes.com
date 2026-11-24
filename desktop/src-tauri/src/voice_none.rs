//! Voice typing's commands on Intel Macs and Linux, where ONNX Runtime (which runs the speech
//! model) has no build that fits: the page is told it isn't there and hides it. See `voice.rs`.

use crate::Res;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    supported: bool,
    model: &'static str,
    progress: f64,
    error: Option<String>,
    size: u64,
    tidy: &'static str,
    tidy_progress: f64,
    tidy_error: Option<String>,
    tidy_size: u64,
}

#[derive(Default)]
pub struct Voice;

impl Voice {
    pub fn shutdown(&self) {}
}

const NONE: &str = "Voice typing needs a Mac with Apple silicon";

#[tauri::command]
pub fn voice_status() -> Res<Status> {
    Ok(Status { supported: false, model: "missing", progress: 0.0, error: None, size: 0, tidy: "missing", tidy_progress: 0.0, tidy_error: None, tidy_size: 0 })
}

#[tauri::command]
pub fn voice_download() -> Res<()> {
    Err(NONE.into())
}

#[tauri::command]
pub fn voice_delete() -> Res<()> {
    Ok(())
}

#[tauri::command]
pub fn voice_tidy_download() -> Res<()> {
    Err(NONE.into())
}

#[tauri::command]
pub fn voice_tidy_delete() -> Res<()> {
    Ok(())
}

#[tauri::command]
pub async fn voice_start(tidy: bool) -> Res<()> {
    let _ = tidy;
    Err(NONE.into())
}

#[tauri::command]
pub async fn voice_stop() -> Res<String> {
    Err(NONE.into())
}

#[tauri::command]
pub fn voice_cancel() -> Res<()> {
    Ok(())
}
