//! Search by meaning, with the phone's "Standard" model (LFM2.5-Embedding-350M) run by llama.cpp: on
//! the CPU, or on the GPU through Metal on Apple Silicon. The model is downloaded once into the app's
//! data folder. Notes' chunks (made by the shared `chunkNote`) wait in the index's `meaning` table;
//! a background thread gives each a vector, newest notes first. A question gets one the same way
//! and is compared with every chunk.

use crate::index::{Chunks, MeaningHit, Stale, Todo};
use crate::{with, Open, Res};
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::context::LlamaContext;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::LlamaModel;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

/// Saved with the vectors: another model's can't be compared with this one's.
const MODEL_ID: &str = "lfm2.5-embedding-350m-q8_0";
const MODEL_FILE: &str = "LFM2.5-Embedding-350M-Q8_0.gguf";
const MODEL_URL: &str = "https://huggingface.co/LiquidAI/LFM2.5-Embedding-350M-GGUF/resolve/main/LFM2.5-Embedding-350M-Q8_0.gguf";
const MODEL_SIZE: u64 = 379_216_640;
const MODEL_SHA256: &str = "6ec5f8e8750dbc8a0e40c431fd1b7b07a13688136b2244c5a1364b54d9032599";
/// The model reads at most this many tokens of a chunk (its training length).
const MAX_TOKENS: usize = 512;
/// Tokens in one pass; every chunk of a pass must fit, as attention looks both ways.
const BATCH_TOKENS: usize = 2048;
/// llama.cpp splits the context between sequences: four chunks of 512 tokens fill it.
const MAX_SEQS: usize = BATCH_TOKENS / MAX_TOKENS;
/// Chunks per job, so a question waits for little.
const CHUNKS_PER_JOB: i64 = 4;

/// What Settings and search show.
#[derive(Clone, Serialize)]
pub struct Status {
    /// "off", "downloading", "loading", "ready" or "error".
    state: &'static str,
    /// The model download, 0 to 1.
    progress: f64,
    /// Chunks waiting for the model.
    pending: i64,
    /// Notes the meaning search covers.
    indexed: i64,
    error: Option<String>,
}

type Job = (Vec<String>, Sender<Res<Vec<Vec<f32>>>>);

pub struct Meaning {
    on: AtomicBool,
    started: AtomicBool,
    status: Mutex<Status>,
    engine: Mutex<Option<Sender<Job>>>,
    /// Signalled by the model's thread once it has let go of the model (`shutdown`).
    stopped: Mutex<Option<Receiver<()>>>,
    wake: Mutex<Option<Sender<()>>>,
}

impl Default for Meaning {
    fn default() -> Self {
        Meaning {
            on: AtomicBool::new(false),
            started: AtomicBool::new(false),
            status: Mutex::new(Status { state: "off", progress: 0.0, pending: 0, indexed: 0, error: None }),
            engine: Mutex::new(None),
            stopped: Mutex::new(None),
            wake: Mutex::new(None),
        }
    }
}

fn text(e: impl ToString) -> String {
    e.to_string()
}

impl Meaning {
    fn update(&self, app: &AppHandle, f: impl FnOnce(&mut Status)) {
        let snapshot = {
            let Ok(mut s) = self.status.lock() else { return };
            f(&mut s);
            s.clone()
        };
        let _ = app.emit("meaning", snapshot);
    }

    fn poke(&self) {
        if let Ok(w) = self.wake.lock() {
            if let Some(w) = w.as_ref() {
                let _ = w.send(());
            }
        }
    }

    /// Before the app quits: lets the model go and waits (a few seconds at most) for its thread to
    /// free it. Left to the process's exit, llama.cpp's Metal backend was torn down while the model
    /// still held GPU memory, and it aborted: "VB Notes quit unexpectedly" on every quit on a Mac.
    /// False if the thread didn't finish in time.
    pub fn shutdown(&self) -> bool {
        self.on.store(false, Ordering::Relaxed);
        let Some(stopped) = self.stopped.lock().ok().and_then(|mut s| s.take()) else { return true };
        drop(self.engine.lock().ok().and_then(|mut e| e.take()));
        !matches!(stopped.recv_timeout(Duration::from_secs(3)), Err(RecvTimeoutError::Timeout))
    }

    /// Vectors for `texts`, from the model's thread.
    fn embed(&self, texts: Vec<String>) -> Res<Vec<Vec<f32>>> {
        let engine = self.engine.lock().map_err(text)?.clone().ok_or("The search model isn't ready")?;
        let (tx, rx) = channel();
        engine.send((texts, tx)).map_err(text)?;
        rx.recv().map_err(text)?
    }
}

/// A vector as stored: one f32 scale, then int8 values (a quarter of the size, cosine barely moves).
fn pack(v: &[f32]) -> Vec<u8> {
    let max = v.iter().fold(0f32, |m, x| m.max(x.abs()));
    let scale = if max > 0.0 { max / 127.0 } else { 1.0 };
    let mut out = Vec::with_capacity(v.len() + 4);
    out.extend_from_slice(&scale.to_le_bytes());
    out.extend(v.iter().map(|x| (x / scale).round() as i8 as u8));
    out
}

/// Cosine of a question's vector with a stored one (both unit length).
pub fn score(q: &[f32], blob: &[u8]) -> f32 {
    if blob.len() != q.len() + 4 {
        return -1.0;
    }
    let scale = f32::from_le_bytes([blob[0], blob[1], blob[2], blob[3]]);
    q.iter().zip(&blob[4..]).map(|(a, b)| a * (*b as i8) as f32).sum::<f32>() * scale
}

fn normalize(v: &[f32]) -> Vec<f32> {
    let n = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(f32::EPSILON);
    v.iter().map(|x| x / n).collect()
}

/// Fetches the model, carrying on from a part already downloaded, and checks it before use.
fn download(file: &Path, progress: impl Fn(f64)) -> Res<()> {
    let part = file.with_extension("gguf.partial");
    let have = fs::metadata(&part).map_or(0, |m| m.len());
    let mut req = ureq::get(MODEL_URL);
    if have > 0 && have < MODEL_SIZE {
        req = req.header("Range", &format!("bytes={have}-"));
    }
    let res = req.call().map_err(|e| format!("Couldn't download the search model: {e}"))?;
    let resumed = res.status() == 206;
    let mut out = OpenOptions::new().create(true).write(true).append(resumed).truncate(!resumed).open(&part).map_err(text)?;
    let mut done = if resumed { have } else { 0 };
    let mut reader = res.into_body().into_with_config().limit(MODEL_SIZE + 1).reader();
    let mut buf = vec![0u8; 1 << 16];
    let mut shown = Instant::now();
    loop {
        let n = reader.read(&mut buf).map_err(|e| format!("The search model download stopped: {e}"))?;
        if n == 0 {
            break;
        }
        out.write_all(&buf[..n]).map_err(text)?;
        done += n as u64;
        if shown.elapsed() > Duration::from_millis(250) {
            shown = Instant::now();
            progress(done as f64 / MODEL_SIZE as f64);
        }
    }
    out.sync_all().map_err(text)?;
    drop(out);
    let mut hasher = Sha256::new();
    let mut f = File::open(&part).map_err(text)?;
    loop {
        let n = f.read(&mut buf).map_err(text)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let hex: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if done != MODEL_SIZE || hex != MODEL_SHA256 {
        let _ = fs::remove_file(&part);
        return Err("The search model download was damaged; it will start again".into());
    }
    fs::rename(&part, file).map_err(text)
}

/// Starts llama.cpp on a thread of its own (a context can't be shared). Returns where to send texts,
/// and what says the thread has freed the model once the sender is dropped.
fn start_engine(file: PathBuf) -> Res<(Sender<Job>, Receiver<()>)> {
    let (tx, jobs) = channel::<Job>();
    let (ready_tx, ready) = channel::<Res<()>>();
    let (stopped_tx, stopped) = channel::<()>();
    thread::Builder::new()
        .name("meaning-model".into())
        .spawn(move || {
            if let Err(e) = run_engine(&file, jobs, &ready_tx) {
                let _ = ready_tx.send(Err(e));
            }
            // The context, the model and the backend are dropped by now.
            let _ = stopped_tx.send(());
        })
        .map_err(text)?;
    ready.recv().map_err(text)??;
    Ok((tx, stopped))
}

fn run_engine(file: &Path, jobs: Receiver<Job>, ready: &Sender<Res<()>>) -> Res<()> {
    let mut backend = LlamaBackend::init().map_err(text)?;
    backend.void_logs();
    // Every layer on the GPU where Metal is built in (Apple Silicon); the CPU elsewhere.
    let gpu_layers = if cfg!(all(target_os = "macos", target_arch = "aarch64")) { 1000 } else { 0 };
    let model = LlamaModel::load_from_file(&backend, file, &LlamaModelParams::default().with_n_gpu_layers(gpu_layers))
        .map_err(|e| format!("Couldn't load the search model: {e}"))?;
    // Half the cores, so typing stays quick while notes are read.
    let threads = thread::available_parallelism().map_or(4, |n| (n.get() / 2).max(2)) as i32;
    let params = LlamaContextParams::default()
        .with_embeddings(true)
        .with_n_ctx(NonZeroU32::new(BATCH_TOKENS as u32))
        .with_n_batch(BATCH_TOKENS as u32)
        .with_n_ubatch(BATCH_TOKENS as u32)
        .with_n_seq_max(MAX_SEQS as u32)
        .with_n_threads(threads)
        .with_n_threads_batch(threads);
    let mut ctx = model.new_context(&backend, params).map_err(|e| format!("Couldn't start the search model: {e}"))?;
    let _ = ready.send(Ok(()));
    for (texts, reply) in jobs {
        let _ = reply.send(embed_texts(&model, &mut ctx, &texts));
    }
    Ok(())
}

/// One vector per text: the first token's (the model's pooling), unit length. Texts share passes.
fn embed_texts(model: &LlamaModel, ctx: &mut LlamaContext, texts: &[String]) -> Res<Vec<Vec<f32>>> {
    let vocab = model.vocab();
    let mut out = Vec::with_capacity(texts.len());
    let mut batch = LlamaBatch::new(BATCH_TOKENS, MAX_SEQS as i32);
    let (mut seqs, mut used) = (0, 0);
    for t in texts {
        let mut tokens = vocab.tokenize(t.as_bytes(), true, false);
        tokens.truncate(MAX_TOKENS);
        if seqs == MAX_SEQS || used + tokens.len() > BATCH_TOKENS {
            run_pass(ctx, &mut batch, seqs, &mut out)?;
            (seqs, used) = (0, 0);
        }
        batch.add_sequence(&tokens, seqs as i32, false).map_err(text)?;
        seqs += 1;
        used += tokens.len();
    }
    run_pass(ctx, &mut batch, seqs, &mut out)?;
    Ok(out)
}

fn run_pass(ctx: &mut LlamaContext, batch: &mut LlamaBatch, seqs: usize, out: &mut Vec<Vec<f32>>) -> Res<()> {
    if seqs == 0 {
        return Ok(());
    }
    ctx.clear_kv_cache();
    ctx.decode(batch).map_err(text)?;
    for i in 0..seqs {
        out.push(normalize(ctx.embeddings_seq_ith(i as i32).map_err(text)?));
    }
    batch.clear();
    Ok(())
}

/// Downloads and loads the model, then reads waiting chunks until switched off. Errors are shown in
/// Settings; the next change to a note, or switching it on again, tries again.
fn worker(app: AppHandle, wake: Receiver<()>) {
    let meaning = app.state::<Meaning>();
    loop {
        if meaning.on.load(Ordering::Relaxed) {
            if let Err(e) = work(&app, &meaning, &wake) {
                meaning.update(&app, |s| {
                    s.state = "error";
                    s.error = Some(e);
                });
            }
        }
        // Off, or failed: wait to be woken.
        if wake.recv().is_err() {
            return;
        }
    }
}

fn work(app: &AppHandle, meaning: &Meaning, wake: &Receiver<()>) -> Res<()> {
    if meaning.engine.lock().map_err(text)?.is_none() {
        let dir = app.path().app_data_dir().map_err(text)?.join("models");
        fs::create_dir_all(&dir).map_err(text)?;
        let file = dir.join(MODEL_FILE);
        if !file.exists() {
            meaning.update(app, |s| {
                s.state = "downloading";
                s.error = None;
            });
            download(&file, |p| meaning.update(app, |s| s.progress = p))?;
        }
        meaning.update(app, |s| {
            s.state = "loading";
            s.progress = 1.0;
            s.error = None;
        });
        let (engine, stopped) = start_engine(file)?;
        *meaning.engine.lock().map_err(text)? = Some(engine);
        *meaning.stopped.lock().map_err(text)? = Some(stopped);
    }
    meaning.update(app, |s| s.state = "ready");
    let open = app.state::<Open>();
    let mut shown = Instant::now();
    while meaning.on.load(Ordering::Relaxed) {
        let todo = with(&open, |f| {
            f.index.meaning_model(MODEL_ID)?;
            f.index.meaning_todo(CHUNKS_PER_JOB)
        })
        .unwrap_or_default();
        if todo.is_empty() {
            let counts = with(&open, |f| f.index.meaning_counts()).unwrap_or((0, 0));
            meaning.update(app, |s| (s.pending, s.indexed) = counts);
            // Woken when chunks arrive; also looks again now and then (another folder opened).
            let _ = wake.recv_timeout(Duration::from_secs(30));
            continue;
        }
        let texts: Vec<String> = todo.iter().map(|t| format!("document: {}", t.chunk)).collect();
        let vecs = match meaning.embed(texts.clone()) {
            Ok(v) => v,
            // One by one, so a chunk the model can't read doesn't stop the rest: it gets an empty
            // vector, which never matches. If none can be read, the model itself is broken.
            Err(e) => {
                let one: Vec<Option<Vec<f32>>> = texts.into_iter().map(|t| meaning.embed(vec![t]).ok().and_then(|mut v| v.pop())).collect();
                if one.iter().all(Option::is_none) {
                    return Err(e);
                }
                one.into_iter().map(Option::unwrap_or_default).collect()
            }
        };
        let done: Vec<(Todo, Vec<u8>)> = todo.into_iter().zip(vecs.iter().map(|v| pack(v))).collect();
        with(&open, |f| f.index.meaning_store(&done))?;
        if shown.elapsed() > Duration::from_millis(500) {
            shown = Instant::now();
            let counts = with(&open, |f| f.index.meaning_counts()).unwrap_or((0, 0));
            meaning.update(app, |s| (s.pending, s.indexed) = counts);
        }
    }
    meaning.update(app, |s| s.state = "off");
    Ok(())
}

/// Turns search by meaning on or off (Settings). On for the first time starts the download.
#[tauri::command]
pub fn meaning_enable(app: AppHandle, meaning: State<'_, Meaning>, on: bool) -> Res<()> {
    meaning.on.store(on, Ordering::Relaxed);
    if on && !meaning.started.swap(true, Ordering::Relaxed) {
        let (tx, rx) = channel();
        *meaning.wake.lock().map_err(text)? = Some(tx);
        let app2 = app.clone();
        thread::Builder::new().name("meaning-index".into()).spawn(move || worker(app2, rx)).map_err(text)?;
    }
    if !on {
        meaning.update(&app, |s| s.state = "off");
    }
    meaning.poke();
    Ok(())
}

#[tauri::command]
pub fn meaning_status(meaning: State<'_, Meaning>) -> Res<Status> {
    meaning.status.lock().map(|s| s.clone()).map_err(text)
}

#[tauri::command]
pub async fn meaning_stale(open: State<'_, Open>) -> Res<Vec<Stale>> {
    with(&open, |f| f.index.meaning_stale())
}

#[tauri::command]
pub async fn meaning_set(open: State<'_, Open>, meaning: State<'_, Meaning>, notes: Vec<Chunks>) -> Res<()> {
    with(&open, |f| f.index.meaning_set(notes))?;
    meaning.poke();
    Ok(())
}

/// Notes of a section closest in meaning to `q`, best first; none while the model isn't ready.
#[tauri::command]
pub async fn meaning_search(app: AppHandle, q: String, section: String, limit: usize) -> Res<Vec<MeaningHit>> {
    tauri::async_runtime::spawn_blocking(move || {
        let meaning = app.state::<Meaning>();
        if !meaning.on.load(Ordering::Relaxed) || meaning.engine.lock().map_err(text)?.is_none() {
            return Ok(vec![]);
        }
        let q = meaning.embed(vec![format!("query: {q}")])?.pop().unwrap_or_default();
        with(&app.state::<Open>(), |f| f.index.meaning_search(&q, &section, limit))
    })
    .await
    .map_err(text)?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `cargo test -- --ignored meaning`, with the model downloaded by the app.
    #[test]
    #[ignore]
    fn meaning_ranks_the_right_text_first() {
        let file = std::env::var("HOME").map(PathBuf::from).unwrap()
            .join("Library/Application Support/com.lavneet.vbnotes.desktop/models")
            .join(MODEL_FILE);
        let (engine, _stopped) = start_engine(file).unwrap();
        let embed = |texts: Vec<String>| {
            let (tx, rx) = channel();
            engine.send((texts, tx)).unwrap();
            rx.recv().unwrap().unwrap()
        };
        let docs = [
            "hi",
            "it is a bear",
            "The giant panda (Ailuropoda melanoleuca), sometimes called a panda bear or simply panda, is a bear species endemic to China.",
            "Rent split with Arjun\nOctober rent paid in full. Arjun owes his half of the electricity bill, settle on the 5th.",
        ];
        let d = embed(docs.iter().map(|t| format!("document: {t}")).collect());
        // Four long chunks in one pass, as the indexer sends them.
        let long = "Notes kept as plain files in a folder can be read by any editor. ".repeat(40);
        assert_eq!(embed(vec![long; 4]).len(), 4);
        for q in ["What is panda?", "what does my flatmate owe me"] {
            let qv = embed(vec![format!("query: {q}")]).pop().unwrap();
            for (t, v) in docs.iter().zip(&d) {
                let exact: f32 = qv.iter().zip(v).map(|(a, b)| a * b).sum();
                println!("{q:32} {:.4} (int8 {:.4})  {}", exact, score(&qv, &pack(v)), &t[..t.len().min(50)]);
            }
        }
    }
}
