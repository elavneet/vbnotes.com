//! Chat with your notes, through the AI provider picked in Settings. Requests go out from here, so
//! the API key never reaches the page; it is kept in `ai.json` in the app's config folder (never in
//! the notes folder, which syncs). Replies stream back as `ai-delta` events, and `ai-done` ends one.

use crate::Res;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

/// How a provider is spoken to: the OpenAI chat API (most of them, and OpenRouter) or Anthropic's own.
#[derive(Clone, Copy, PartialEq)]
enum Wire {
    OpenAi,
    Anthropic,
}

struct Provider {
    id: &'static str,
    base: &'static str,
    wire: Wire,
    /// Ollama runs on this computer and the custom one may be anything: neither needs a key.
    needs_key: bool,
}

const PROVIDERS: &[Provider] = &[
    Provider { id: "openrouter", base: "https://openrouter.ai/api/v1", wire: Wire::OpenAi, needs_key: true },
    Provider { id: "openai", base: "https://api.openai.com/v1", wire: Wire::OpenAi, needs_key: true },
    Provider { id: "anthropic", base: "https://api.anthropic.com/v1", wire: Wire::Anthropic, needs_key: true },
    Provider { id: "gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai", wire: Wire::OpenAi, needs_key: true },
    Provider { id: "groq", base: "https://api.groq.com/openai/v1", wire: Wire::OpenAi, needs_key: true },
    Provider { id: "mistral", base: "https://api.mistral.ai/v1", wire: Wire::OpenAi, needs_key: true },
    Provider { id: "deepseek", base: "https://api.deepseek.com/v1", wire: Wire::OpenAi, needs_key: true },
    Provider { id: "xai", base: "https://api.x.ai/v1", wire: Wire::OpenAi, needs_key: true },
    Provider { id: "ollama", base: "http://localhost:11434/v1", wire: Wire::OpenAi, needs_key: false },
    Provider { id: "custom", base: "", wire: Wire::OpenAi, needs_key: false },
];

/// What Settings shows and changes. `base_url` overrides the provider's address (Ollama elsewhere, a custom server).
#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct AiSettings {
    enabled: bool,
    provider: String,
    model: String,
    base_url: String,
}

/// The settings plus whether a key is saved for the chosen provider; the key itself never goes back.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiView {
    #[serde(flatten)]
    settings: AiSettings,
    has_key: bool,
    needs_key: bool,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
struct Stored {
    settings: AiSettings,
    /// One key per provider, so switching back and forth keeps them.
    keys: HashMap<String, String>,
}

#[derive(Deserialize, Serialize)]
pub struct Message {
    role: String,
    content: String,
}

/// Replies being streamed, by id: setting the flag stops one (`ai_cancel`).
#[derive(Default)]
pub struct Chats(Mutex<HashMap<String, Arc<AtomicBool>>>);

fn text(e: impl ToString) -> String {
    e.to_string()
}

fn file(app: &AppHandle) -> Res<PathBuf> {
    Ok(app.path().app_config_dir().map_err(text)?.join("ai.json"))
}

fn load(app: &AppHandle) -> Stored {
    file(app).ok().and_then(|f| fs::read_to_string(f).ok()).and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn store(app: &AppHandle, stored: &Stored) -> Res<()> {
    let path = file(app)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(text)?;
    }
    fs::write(&path, serde_json::to_string_pretty(stored).map_err(text)?).map_err(text)?;
    // Only this user can read the keys.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn provider(id: &str) -> &'static Provider {
    PROVIDERS.iter().find(|p| p.id == id).unwrap_or(&PROVIDERS[0])
}

fn view(stored: &Stored) -> AiView {
    let p = provider(&stored.settings.provider);
    AiView {
        settings: AiSettings { provider: p.id.to_string(), ..stored.settings.clone() },
        has_key: stored.keys.get(p.id).is_some_and(|k| !k.is_empty()),
        needs_key: p.needs_key,
    }
}

#[tauri::command]
pub fn ai_settings(app: AppHandle) -> AiView {
    view(&load(&app))
}

/// Saves the settings; `key` replaces the chosen provider's key (an empty one removes it), none keeps it.
#[tauri::command]
pub fn ai_save(app: AppHandle, settings: AiSettings, key: Option<String>) -> Res<AiView> {
    let mut stored = load(&app);
    let id = provider(&settings.provider).id.to_string();
    if let Some(key) = key.map(|k| k.trim().to_string()) {
        if key.is_empty() {
            stored.keys.remove(&id);
        } else {
            stored.keys.insert(id, key);
        }
    }
    stored.settings = settings;
    store(&app, &stored)?;
    Ok(view(&stored))
}

/// Where to send requests, and the key, for the saved settings.
struct Target {
    base: String,
    key: Option<String>,
    wire: Wire,
    model: String,
}

fn target(app: &AppHandle) -> Res<Target> {
    let stored = load(app);
    let p = provider(&stored.settings.provider);
    let custom = stored.settings.base_url.trim().trim_end_matches('/');
    let base = if custom.is_empty() { p.base } else { custom };
    if base.is_empty() {
        return Err("Add the server's address in Settings › AI chat.".into());
    }
    let key = stored.keys.get(p.id).filter(|k| !k.is_empty()).cloned();
    if p.needs_key && key.is_none() {
        return Err("Add your API key in Settings › AI chat.".into());
    }
    Ok(Target { base: base.to_string(), key, wire: p.wire, model: stored.settings.model.trim().to_string() })
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_connect(Some(Duration::from_secs(20)))
        .timeout_global(Some(Duration::from_secs(600)))
        .build()
        .into()
}

fn with_auth<B>(mut req: ureq::RequestBuilder<B>, t: &Target) -> ureq::RequestBuilder<B> {
    if let Some(key) = &t.key {
        req = match t.wire {
            Wire::Anthropic => req.header("x-api-key", key),
            Wire::OpenAi => req.header("Authorization", &format!("Bearer {key}")),
        };
    }
    if t.wire == Wire::Anthropic {
        req = req.header("anthropic-version", "2023-06-01");
    }
    // OpenRouter shows where requests come from on its dashboard.
    if t.base.contains("openrouter.ai") {
        req = req.header("HTTP-Referer", "https://vbnotes.com").header("X-Title", "VB Notes");
    }
    req
}

/// A provider's error as a sentence: its own message when the body has one.
fn failure(status: u16, body: &str) -> String {
    let said = serde_json::from_str::<Value>(body).ok().and_then(|v| {
        v.pointer("/error/message").or_else(|| v.pointer("/message")).or_else(|| v.get("error")).and_then(|m| m.as_str()).map(str::to_string)
    });
    match (status, said) {
        (401 | 403, _) => "The provider didn't accept the API key. Check it in Settings › AI chat.".into(),
        (_, Some(said)) => format!("The provider said: {said} ({status})"),
        _ => format!("The provider answered with an error ({status})."),
    }
}

/// The models the provider offers, for the list in Settings.
#[tauri::command]
pub async fn ai_models(app: AppHandle) -> Res<Vec<String>> {
    let t = target(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let res = with_auth(agent().get(&format!("{}/models", t.base)), &t).call().map_err(|e| format!("Couldn't reach the provider: {e}"))?;
        let status = res.status().as_u16();
        let body = res.into_body().read_to_string().map_err(text)?;
        if status >= 400 {
            return Err(failure(status, &body));
        }
        let v: Value = serde_json::from_str(&body).map_err(text)?;
        let mut ids: Vec<String> = v["data"].as_array().or_else(|| v["models"].as_array()).into_iter().flatten()
            .filter_map(|m| m["id"].as_str().or_else(|| m["name"].as_str()))
            .map(|id| id.trim_start_matches("models/").to_string())
            .collect();
        ids.sort();
        ids.dedup();
        Ok(ids)
    })
    .await
    .map_err(text)?
}

/// What the OpenRouter key has used and has left (GET /key), all apps together, as OpenRouter returns it.
#[tauri::command]
pub async fn ai_key_usage(app: AppHandle) -> Res<Value> {
    let t = target(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let res = with_auth(agent().get(&format!("{}/key", t.base)), &t).call().map_err(|e| format!("Couldn't reach the provider: {e}"))?;
        let status = res.status().as_u16();
        let body = res.into_body().read_to_string().map_err(text)?;
        if status >= 400 {
            return Err(failure(status, &body));
        }
        serde_json::from_str(&body).map_err(text)
    })
    .await
    .map_err(text)?
}

#[derive(Serialize, Clone)]
struct Delta<'a> {
    id: &'a str,
    text: &'a str,
}

#[derive(Serialize, Clone)]
struct Done<'a> {
    id: &'a str,
    error: Option<String>,
    /// What the reply cost in dollars, where the provider says (OpenRouter's last chunk).
    cost: Option<f64>,
}

/// Asks the model, with `system` (the notes it may use) ahead of the conversation. The reply
/// streams back as `ai-delta` events; `ai-done` ends it, with an error if one stopped it.
#[tauri::command]
pub fn ai_chat(app: AppHandle, chats: State<'_, Chats>, id: String, system: String, messages: Vec<Message>) -> Res<()> {
    let t = target(&app)?;
    if t.model.is_empty() {
        return Err("Pick a model in Settings › AI chat.".into());
    }
    let stop = Arc::new(AtomicBool::new(false));
    chats.0.lock().map_err(text)?.insert(id.clone(), stop.clone());
    std::thread::spawn(move || {
        let mut cost = None;
        let error = stream(&app, &t, &id, &system, &messages, &stop, &mut cost).err();
        if let Ok(mut chats) = app.state::<Chats>().0.lock() {
            chats.remove(&id);
        }
        let _ = app.emit("ai-done", Done { id: &id, error, cost });
    });
    Ok(())
}

#[tauri::command]
pub fn ai_cancel(chats: State<'_, Chats>, id: String) {
    if let Some(stop) = chats.0.lock().ok().and_then(|c| c.get(&id).cloned()) {
        stop.store(true, Ordering::Relaxed);
    }
}

fn stream(app: &AppHandle, t: &Target, id: &str, system: &str, messages: &[Message], stop: &AtomicBool, cost: &mut Option<f64>) -> Res<()> {
    let (url, body) = match t.wire {
        Wire::OpenAi => {
            let mut all = vec![json!({ "role": "system", "content": system })];
            all.extend(messages.iter().map(|m| json!(m)));
            (format!("{}/chat/completions", t.base), json!({ "model": t.model, "stream": true, "messages": all }))
        }
        Wire::Anthropic => (
            format!("{}/messages", t.base),
            json!({ "model": t.model, "stream": true, "max_tokens": 4096, "system": system, "messages": messages }),
        ),
    };
    let res = with_auth(agent().post(&url), t)
        .header("Content-Type", "application/json")
        .send(body.to_string())
        .map_err(|e| format!("Couldn't reach the provider: {e}"))?;
    let status = res.status().as_u16();
    let mut reader = BufReader::new(res.into_body().into_reader());
    if status >= 400 {
        let mut body = String::new();
        let _ = std::io::Read::read_to_string(&mut reader, &mut body);
        return Err(failure(status, &body));
    }
    // Server-sent events: one `data: {json}` line per piece of the reply.
    let mut line = String::new();
    loop {
        if stop.load(Ordering::Relaxed) {
            return Ok(());
        }
        line.clear();
        if reader.read_line(&mut line).map_err(|e| format!("The reply stopped: {e}"))? == 0 {
            return Ok(());
        }
        let Some(data) = line.trim().strip_prefix("data:").map(str::trim) else { continue };
        if data == "[DONE]" {
            return Ok(());
        }
        let Ok(v) = serde_json::from_str::<Value>(data) else { continue };
        if let Some(message) = v.pointer("/error/message").and_then(|m| m.as_str()) {
            return Err(format!("The provider said: {message}"));
        }
        if let Some(dollars) = v.pointer("/usage/cost").and_then(|c| c.as_f64()) {
            *cost = Some(dollars);
        }
        let piece = match t.wire {
            Wire::OpenAi => v.pointer("/choices/0/delta/content"),
            Wire::Anthropic => v.pointer("/delta/text"),
        };
        if let Some(piece) = piece.and_then(|p| p.as_str()).filter(|p| !p.is_empty()) {
            let _ = app.emit("ai-delta", Delta { id, text: piece });
        }
    }
}
