//! Voice typing: what is said into the microphone, typed into the note. cpal hears the computer's
//! microphone; NVIDIA's Parakeet TDT 0.6B v3 (int8 ONNX, 670 MB, downloaded once into the app's data
//! folder) turns it into text on this computer through ONNX Runtime (`transcribe-rs`), with
//! punctuation and capitals, in English and 24 other European languages.
//!
//! Speech is cut into parts at pauses while it is heard, and each part is written down while the
//! next is spoken, so stopping leaves only the last few seconds to do. The model is loaded when
//! listening starts (about a second, while the first words are said) and let go a few minutes after
//! the last use: it holds about a gigabyte.
//!
//! Left out on Intel Macs, which ONNX Runtime has no build for (`voice_none.rs` stands in). On
//! Linux ONNX Runtime is a file beside the app, loaded when the model first is (`engine`).

use crate::meaning::fetch;
use crate::tidy::{self, Tidy};
use crate::Res;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender, TryRecvError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use transcribe_rs::onnx::parakeet::ParakeetModel;
use transcribe_rs::onnx::Quantization;
use transcribe_rs::{SpeechModel, TranscribeOptions};

const MODEL_DIR: &str = "parakeet-tdt-0.6b-v3-int8";
/// istupakov's ONNX export of `nvidia/parakeet-tdt-0.6b-v3` (CC BY 4.0), at a fixed revision: our
/// copy (see `desktop/models-api`), then istupakov's own.
const MODEL_URLS: [&str; 2] = [
    "https://api.vbnotes.com/models/parakeet-tdt-0.6b-v3-8f23f0c0",
    "https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce",
];
/// The model's files: name, size and sha256. The big one last.
const FILES: [(&str, u64, &str); 4] = [
    ("nemo128.onnx", 139_764, "a9fde1486ebfcc08f328d75ad4610c67835fea58c73ba57e3209a6f6cf019e9f"),
    ("vocab.txt", 93_939, "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d"),
    ("decoder_joint-model.int8.onnx", 18_202_004, "eea7483ee3d1a30375daedc8ed83e3960c91b098812127a0d99d1c8977667a70"),
    ("encoder-model.int8.onnx", 652_183_999, "6139d2fa7e1b086097b277c7149725edbab89cc7c7ae64b23c741be4055aff09"),
];

/// The model hears 16 kHz mono.
const RATE: usize = 16_000;
/// Loudness is measured over 20 ms frames.
const FRAME: usize = RATE / 50;
/// A part is written down at the first pause once it is this long...
const PART_MIN: usize = 3 * RATE;
/// ...a pause being this much quiet...
const PAUSE: usize = RATE * 6 / 10;
/// ...and at the quietest moment of its last 3 s when nobody pauses for this long.
const PART_MAX: usize = 25 * RATE;
/// How often the page gets the loudness, for the waveform.
const LEVEL_EVERY: Duration = Duration::from_millis(50);
/// Nothing at all from the microphone (not even its hiss) this long: it is most likely not allowed.
const DEAF_AFTER: Duration = Duration::from_secs(3);
/// The loaded model is let go this long after the last use.
const KEEP: Duration = Duration::from_secs(5 * 60);

/// What Settings and the voice pill show.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    supported: bool,
    /// "missing", "downloading", "ready" or "error" (the download failed).
    model: &'static str,
    /// The download, 0 to 1.
    progress: f64,
    error: Option<String>,
    /// Bytes to download.
    size: u64,
    /// The clean-up model (`tidy.rs`), the same way.
    tidy: &'static str,
    tidy_progress: f64,
    tidy_error: Option<String>,
    tidy_size: u64,
}

enum Ctl {
    Finish(Sender<Res<String>>),
    Cancel,
}

type Model = Arc<Mutex<Option<ParakeetModel>>>;
type TidyModel = Arc<Mutex<Option<Tidy>>>;

pub struct Voice {
    status: Mutex<Status>,
    model: Model,
    tidy: TidyModel,
    /// The microphone is on: where to say stop.
    session: Mutex<Option<Sender<Ctl>>>,
    /// Counts sessions, so the model is only let go when none came since.
    uses: Arc<AtomicU64>,
}

impl Default for Voice {
    fn default() -> Self {
        Voice {
            status: Mutex::new(Status {
                supported: true,
                model: "missing",
                progress: 0.0,
                error: None,
                size: FILES.iter().map(|f| f.1).sum(),
                tidy: "missing",
                tidy_progress: 0.0,
                tidy_error: None,
                tidy_size: tidy::SIZE,
            }),
            model: Arc::new(Mutex::new(None)),
            tidy: Arc::new(Mutex::new(None)),
            session: Mutex::new(None),
            uses: Arc::new(AtomicU64::new(0)),
        }
    }
}

fn text(e: impl ToString) -> String {
    e.to_string()
}

fn model_dir(app: &AppHandle) -> Res<PathBuf> {
    Ok(app.path().app_data_dir().map_err(text)?.join("models").join(MODEL_DIR))
}

/// Every file is there at its full size (each was checked when it was downloaded).
fn model_there(dir: &Path) -> bool {
    FILES.iter().all(|(name, size, _)| fs::metadata(dir.join(name)).is_ok_and(|m| m.len() == *size))
}

/// Linux: ONNX Runtime is Microsoft's own library, among the app's resources (`linux/onnxruntime.sh`
/// fetches it for the build), loaded once before the first model is. `ORT_DYLIB_PATH` names another.
#[cfg(target_os = "linux")]
fn engine(app: &AppHandle) -> Res<()> {
    static LOADED: std::sync::OnceLock<Res<()>> = std::sync::OnceLock::new();
    LOADED
        .get_or_init(|| {
            if std::env::var_os("ORT_DYLIB_PATH").is_some_and(|p| !p.is_empty()) {
                return Ok(());
            }
            let file = app.path().resource_dir().map_err(text)?.join("libonnxruntime.so");
            ort::init_from(&file).map_err(|e| format!("Couldn't load the speech library ({}): {e}", file.display()))?.commit();
            Ok(())
        })
        .clone()
}

#[cfg(not(target_os = "linux"))]
fn engine(_: &AppHandle) -> Res<()> {
    Ok(())
}

/// The model, loaded first if it isn't.
fn loaded<'a>(app: &AppHandle, model: &'a Model, dir: &Path) -> Res<MutexGuard<'a, Option<ParakeetModel>>> {
    let mut m = model.lock().map_err(text)?;
    if m.is_none() {
        engine(app)?;
        *m = Some(ParakeetModel::load(dir, &Quantization::Int8).map_err(|e| format!("Couldn't load the voice model: {e}"))?);
    }
    Ok(m)
}

/// The clean-up model's file, beside the speech model's folder.
fn tidy_file(app: &AppHandle) -> Res<PathBuf> {
    Ok(app.path().app_data_dir().map_err(text)?.join("models").join(tidy::FILE))
}

fn tidy_there(file: &Path) -> bool {
    fs::metadata(file).is_ok_and(|m| m.len() == tidy::SIZE)
}

/// The clean-up model, loaded first if it isn't.
fn tidy_loaded<'a>(model: &'a TidyModel, file: &Path) -> Res<MutexGuard<'a, Option<Tidy>>> {
    let mut m = model.lock().map_err(text)?;
    if m.is_none() {
        *m = Some(Tidy::load(file)?);
    }
    Ok(m)
}

/// What was said, cleaned up when that was asked for; as heard if the clean-up fails.
fn cleaned(model: &TidyModel, file: Option<&Path>, said: String) -> String {
    let Some(file) = file else { return said };
    if said.is_empty() {
        return said;
    }
    let done = tidy_loaded(model, file).and_then(|m| m.as_ref().ok_or_else(|| "not loaded".to_string())?.clean(&said));
    match done {
        Ok(clean) => clean,
        Err(e) => {
            eprintln!("voice typing: the clean-up failed, so what was heard is typed: {e}");
            said
        }
    }
}

impl Voice {
    fn update(&self, app: &AppHandle, f: impl FnOnce(&mut Status)) {
        let snapshot = {
            let Ok(mut s) = self.status.lock() else { return };
            f(&mut s);
            s.clone()
        };
        let _ = app.emit("voice", snapshot);
    }

    /// Lets the models go after `KEEP`, unless voice typing is used again by then.
    fn let_go_later(&self) {
        let (model, tidy, uses) = (self.model.clone(), self.tidy.clone(), self.uses.clone());
        let at = uses.load(Ordering::Relaxed);
        let _ = thread::Builder::new().name("voice-idle".into()).spawn(move || {
            thread::sleep(KEEP);
            if uses.load(Ordering::Relaxed) == at {
                if let Ok(mut m) = model.lock() {
                    *m = None;
                }
                if let Ok(mut m) = tidy.lock() {
                    *m = None;
                }
            }
        });
    }

    /// Before the app quits: the clean-up model runs on llama.cpp, whose Metal backend aborts the
    /// app if a model still holds GPU memory when the process exits (see `Meaning::shutdown`).
    pub fn shutdown(&self) {
        if let Some(ctl) = self.session.lock().ok().and_then(|mut s| s.take()) {
            let _ = ctl.send(Ctl::Cancel);
        }
        if let Ok(mut m) = self.tidy.lock() {
            *m = None;
        }
    }
}

#[tauri::command]
pub fn voice_status(app: AppHandle) -> Res<Status> {
    let voice = app.state::<Voice>();
    let there = model_there(&model_dir(&app)?);
    let tidy = tidy_there(&tidy_file(&app)?);
    let mut s = voice.status.lock().map_err(text)?;
    if s.model != "downloading" {
        s.model = if there { "ready" } else if s.error.is_some() { "error" } else { "missing" };
    }
    if s.tidy != "downloading" {
        s.tidy = if tidy { "ready" } else if s.tidy_error.is_some() { "error" } else { "missing" };
    }
    Ok(s.clone())
}

/// Downloads the clean-up model in the background; progress comes as `voice` events.
#[tauri::command]
pub fn voice_tidy_download(app: AppHandle) -> Res<()> {
    let voice = app.state::<Voice>();
    if voice.status.lock().map_err(text)?.tidy == "downloading" {
        return Ok(());
    }
    voice.update(&app, |s| {
        s.tidy = "downloading";
        s.tidy_progress = 0.0;
        s.tidy_error = None;
    });
    let app2 = app.clone();
    thread::Builder::new()
        .name("voice-tidy-download".into())
        .spawn(move || {
            let voice = app2.state::<Voice>();
            let done = tidy_file(&app2).and_then(|file| {
                fs::create_dir_all(file.parent().ok_or("No models folder")?).map_err(text)?;
                fetch(&tidy::URLS, tidy::SIZE, tidy::SHA256, &file, "the clean-up model", |done| {
                    voice.update(&app2, |s| s.tidy_progress = done as f64 / tidy::SIZE as f64)
                })
            });
            voice.update(&app2, |s| match done {
                Ok(()) => {
                    s.tidy = "ready";
                    s.tidy_progress = 1.0;
                }
                Err(e) => {
                    s.tidy = "error";
                    s.tidy_error = Some(e);
                }
            });
        })
        .map_err(text)?;
    Ok(())
}

/// Deletes the downloaded clean-up model (Settings).
#[tauri::command]
pub fn voice_tidy_delete(app: AppHandle) -> Res<()> {
    let voice = app.state::<Voice>();
    if voice.session.lock().map_err(text)?.is_some() {
        return Err("Stop voice typing first".into());
    }
    if voice.status.lock().map_err(text)?.tidy == "downloading" {
        return Err("The clean-up model is still downloading".into());
    }
    *voice.tidy.lock().map_err(text)? = None;
    match fs::remove_file(tidy_file(&app)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(text(e)),
        _ => {}
    }
    voice.update(&app, |s| {
        s.tidy = "missing";
        s.tidy_progress = 0.0;
        s.tidy_error = None;
    });
    Ok(())
}

/// Downloads the model in the background; progress comes as `voice` events.
#[tauri::command]
pub fn voice_download(app: AppHandle) -> Res<()> {
    let voice = app.state::<Voice>();
    {
        let s = voice.status.lock().map_err(text)?;
        if s.model == "downloading" {
            return Ok(());
        }
    }
    voice.update(&app, |s| {
        s.model = "downloading";
        s.progress = 0.0;
        s.error = None;
    });
    let app2 = app.clone();
    thread::Builder::new()
        .name("voice-download".into())
        .spawn(move || {
            let voice = app2.state::<Voice>();
            let done = download(&app2, &voice);
            voice.update(&app2, |s| match done {
                Ok(()) => {
                    s.model = "ready";
                    s.progress = 1.0;
                }
                Err(e) => {
                    s.model = "error";
                    s.error = Some(e);
                }
            });
        })
        .map_err(text)?;
    Ok(())
}

fn download(app: &AppHandle, voice: &Voice) -> Res<()> {
    let dir = model_dir(app)?;
    fs::create_dir_all(&dir).map_err(text)?;
    let total: u64 = FILES.iter().map(|f| f.1).sum();
    let mut before = 0;
    for (name, size, sha) in FILES {
        let file = dir.join(name);
        if !fs::metadata(&file).is_ok_and(|m| m.len() == size) {
            fetch(&MODEL_URLS.map(|u| format!("{u}/{name}")), size, sha, &file, "the voice model", |done| {
                voice.update(app, |s| s.progress = (before + done) as f64 / total as f64)
            })?;
        }
        before += size;
    }
    Ok(())
}

/// Deletes the downloaded model (Settings).
#[tauri::command]
pub fn voice_delete(app: AppHandle) -> Res<()> {
    let voice = app.state::<Voice>();
    if voice.session.lock().map_err(text)?.is_some() {
        return Err("Stop voice typing first".into());
    }
    if voice.status.lock().map_err(text)?.model == "downloading" {
        return Err("The voice model is still downloading".into());
    }
    *voice.model.lock().map_err(text)? = None;
    match fs::remove_dir_all(model_dir(&app)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(text(e)),
        _ => {}
    }
    voice.update(&app, |s| {
        s.model = "missing";
        s.progress = 0.0;
        s.error = None;
    });
    Ok(())
}

/// Turns the microphone on. While it listens the page gets `voice-level` (loudness, 0 to 1),
/// `voice-heard` (the words so far), `voice-deaf` (true while nothing at all comes in) and, if the
/// microphone or the model fails, `voice-failed`. `tidy`: what was said is cleaned up at the end.
#[tauri::command]
pub async fn voice_start(app: AppHandle, tidy: bool) -> Res<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let voice = app.state::<Voice>();
        let dir = model_dir(&app)?;
        if !model_there(&dir) {
            return Err("The voice model isn't downloaded".into());
        }
        let tidy = Some(tidy_file(&app)?).filter(|f| tidy && tidy_there(f));
        let mut session = voice.session.lock().map_err(text)?;
        if session.is_some() {
            return Ok(());
        }
        voice.uses.fetch_add(1, Ordering::Relaxed);
        // Loading takes about a second; it happens while the first words are said.
        let (app2, model, dir2, tidy_model, tidy2) = (app.clone(), voice.model.clone(), dir.clone(), voice.tidy.clone(), tidy.clone());
        thread::Builder::new()
            .name("voice-load".into())
            .spawn(move || {
                drop(loaded(&app2, &model, &dir2));
                if let Some(file) = tidy2 {
                    drop(tidy_loaded(&tidy_model, &file));
                }
            })
            .map_err(text)?;
        let (ctl, ctl_rx) = channel();
        let (ready, ready_rx) = channel();
        let (app2, model, tidy_model) = (app.clone(), voice.model.clone(), voice.tidy.clone());
        thread::Builder::new()
            .name("voice-listen".into())
            .spawn(move || listen(app2, model, dir, (tidy_model, tidy), ready, ctl_rx))
            .map_err(text)?;
        ready_rx.recv_timeout(Duration::from_secs(10)).map_err(|_| "The microphone didn't start".to_string())??;
        *session = Some(ctl);
        Ok(())
    })
    .await
    .map_err(text)?
}

/// Turns the microphone off and returns everything said, once the last part is written down.
#[tauri::command]
pub async fn voice_stop(app: AppHandle) -> Res<String> {
    let voice = app.state::<Voice>();
    let ctl = voice.session.lock().map_err(text)?.take().ok_or("Voice typing isn't listening")?;
    let (tx, rx) = channel();
    let sent = ctl.send(Ctl::Finish(tx));
    voice.let_go_later();
    sent.map_err(|_| "The microphone stopped".to_string())?;
    tauri::async_runtime::spawn_blocking(move || rx.recv().map_err(|_| "The microphone stopped".to_string())?)
        .await
        .map_err(text)?
}

/// Turns the microphone off and forgets what was said.
#[tauri::command]
pub fn voice_cancel(app: AppHandle) -> Res<()> {
    let voice = app.state::<Voice>();
    if let Some(ctl) = voice.session.lock().map_err(text)?.take() {
        let _ = ctl.send(Ctl::Cancel);
        voice.let_go_later();
    }
    Ok(())
}

/// The microphone, or (debug builds) a WAV file played as if it were said: `VB_VOICE_WAV`.
enum Mic {
    Live(#[allow(dead_code)] cpal::Stream),
    #[cfg(debug_assertions)]
    File(Arc<AtomicBool>),
}

impl Drop for Mic {
    fn drop(&mut self) {
        #[cfg(debug_assertions)]
        if let Mic::File(stop) = self {
            stop.store(true, Ordering::Relaxed);
        }
    }
}

/// One mono sample per frame, from any channel count, as -1 to 1.
fn mono<T: Copy>(data: &[T], channels: usize, f: impl Fn(T) -> f32) -> Vec<f32> {
    data.chunks(channels.max(1)).map(|frame| frame.iter().map(|&x| f(x)).sum::<f32>() / frame.len() as f32).collect()
}

/// Starts the default microphone: its sound comes to `audio`, at the returned sample rate.
fn open_mic(audio: Sender<Vec<f32>>, errors: Sender<String>) -> Res<(Mic, u32)> {
    #[cfg(debug_assertions)]
    if let Ok(path) = std::env::var("VB_VOICE_WAV") {
        let samples = transcribe_rs::audio::read_wav_samples(Path::new(&path)).map_err(text)?;
        let stop = Arc::new(AtomicBool::new(false));
        let stop2 = stop.clone();
        thread::spawn(move || {
            // Real time, 20 ms at a time, then quiet.
            let mut at = 0;
            while !stop2.load(Ordering::Relaxed) {
                let end = (at + FRAME).min(samples.len());
                let chunk = if at < end { samples[at..end].to_vec() } else { vec![0.0001; FRAME] };
                at = end;
                if audio.send(chunk).is_err() {
                    break;
                }
                thread::sleep(Duration::from_millis(20));
            }
        });
        return Ok((Mic::File(stop), RATE as u32));
    }
    let device = cpal::default_host()
        .default_input_device()
        .ok_or("No microphone found. Plug one in, or pick one in the system's sound settings.")?;
    let supported = device.default_input_config().map_err(|e| format!("The microphone can't be used: {e}"))?;
    let rate = supported.sample_rate();
    let channels = supported.channels() as usize;
    let config = supported.config();
    let failed = move |e: cpal::Error| {
        // A glitch (the Mac reports one whenever the processor is busy, as while the model loads) or a
        // switch to another microphone leaves the stream running: only a stream that ends stops.
        if matches!(e.kind(), cpal::ErrorKind::Xrun | cpal::ErrorKind::DeviceChanged | cpal::ErrorKind::RealtimeDenied) {
            return;
        }
        let _ = errors.send(format!("The microphone stopped: {e}"));
    };
    let stream = match supported.sample_format() {
        SampleFormat::F32 => device.build_input_stream(config, move |d: &[f32], _: &cpal::InputCallbackInfo| drop(audio.send(mono(d, channels, |x| x))), failed, None),
        SampleFormat::I16 => device.build_input_stream(config, move |d: &[i16], _: &cpal::InputCallbackInfo| drop(audio.send(mono(d, channels, |x| x as f32 / 32_768.0))), failed, None),
        SampleFormat::I32 => device.build_input_stream(config, move |d: &[i32], _: &cpal::InputCallbackInfo| drop(audio.send(mono(d, channels, |x| x as f32 / 2_147_483_648.0))), failed, None),
        SampleFormat::U16 => device.build_input_stream(config, move |d: &[u16], _: &cpal::InputCallbackInfo| drop(audio.send(mono(d, channels, |x| (x as f32 - 32_768.0) / 32_768.0))), failed, None),
        other => return Err(format!("The microphone's sound format ({other:?}) isn't supported")),
    }
    .map_err(|e| format!("The microphone can't be used: {e}"))?;
    stream.play().map_err(|e| format!("The microphone can't be used: {e}"))?;
    Ok((Mic::Live(stream), rate))
}

/// Brings any sample rate to 16 kHz: each new sample is the mean of the ones it stands for, which
/// also keeps out sounds too high for 16 kHz (enough for speech).
struct Resample {
    step: f64,
    pos: f64,
    pending: Vec<f32>,
}

impl Resample {
    fn new(rate: u32) -> Self {
        Resample { step: rate as f64 / RATE as f64, pos: 0.0, pending: Vec::new() }
    }

    fn push(&mut self, input: &[f32]) -> Vec<f32> {
        self.pending.extend_from_slice(input);
        let mut out = Vec::with_capacity((input.len() as f64 / self.step) as usize + 1);
        while self.pos + self.step <= self.pending.len() as f64 {
            let (a, b) = (self.pos as usize, ((self.pos + self.step) as usize).max(self.pos as usize + 1));
            out.push(self.pending[a..b].iter().sum::<f32>() / (b - a) as f32);
            self.pos += self.step;
        }
        let used = self.pos as usize;
        self.pending.drain(..used);
        self.pos -= used as f64;
        out
    }
}

/// Quieter than this is no sound at all (a microphone's own hiss is about 0.001).
const SILENT: f32 = 0.002;

/// Cuts what is heard into parts at pauses. Stretches with no sound at all are left out; anything
/// else is kept, so soft speech is never lost.
struct Parts {
    buf: Vec<f32>,
    /// Loudness of each frame in `buf`.
    frames: Vec<f32>,
    /// Samples not yet making a whole frame.
    pending: Vec<f32>,
    /// The room's own sound: follows the quietest frames down at once, up slowly.
    noise: f32,
    /// Samples of quiet at the end of `buf`.
    quiet: usize,
    /// `buf` has speech in it.
    speech: bool,
}

fn rms(s: &[f32]) -> f32 {
    if s.is_empty() {
        return 0.0;
    }
    (s.iter().map(|x| x * x).sum::<f32>() / s.len() as f32).sqrt()
}

impl Parts {
    fn new() -> Self {
        Parts { buf: Vec::new(), frames: Vec::new(), pending: Vec::new(), noise: 0.003, quiet: 0, speech: false }
    }

    /// Louder than the room: someone is talking.
    fn loud(&self, level: f32) -> bool {
        level > (self.noise * 3.0).max(0.004)
    }

    /// Takes 16 kHz samples; returns the parts that are complete.
    fn push(&mut self, samples: &[f32]) -> Vec<Vec<f32>> {
        self.pending.extend_from_slice(samples);
        let mut parts = Vec::new();
        let whole = self.pending.len() / FRAME * FRAME;
        let frames: Vec<f32> = self.pending.drain(..whole).collect();
        for frame in frames.chunks(FRAME) {
            let level = rms(frame);
            self.noise = if level < self.noise { level } else { (self.noise + (level - self.noise) * 0.001).min(0.01) };
            self.buf.extend_from_slice(frame);
            self.frames.push(level);
            if self.loud(level) {
                self.speech = true;
                self.quiet = 0;
            } else {
                self.quiet += FRAME;
            }
            if self.buf.len() > 2 * RATE && self.frames.iter().all(|&l| l < SILENT) {
                // No sound so far: keep the last half second, as the lead-in to what comes.
                let keep = RATE / 2;
                self.buf.drain(..self.buf.len() - keep);
                self.frames.drain(..self.frames.len() - keep / FRAME);
            } else if self.speech && self.buf.len() >= PART_MIN && self.quiet >= PAUSE {
                parts.extend(self.take(self.buf.len()));
            } else if self.buf.len() >= PART_MAX {
                // Nobody paused: cut at the quietest frame of the last 3 s.
                let from = self.frames.len().saturating_sub(3 * RATE / FRAME);
                let quietest = (from..self.frames.len()).min_by(|&a, &b| self.frames[a].total_cmp(&self.frames[b])).unwrap_or(self.frames.len());
                parts.extend(self.take((quietest + 1) * FRAME));
            }
        }
        parts
    }

    /// The first `n` samples (whole frames) as a part, unless they have no sound at all.
    fn take(&mut self, n: usize) -> Option<Vec<f32>> {
        let part: Vec<f32> = self.buf.drain(..n).collect();
        let sound = self.frames.drain(..n / FRAME).any(|l| l >= SILENT);
        self.speech = self.frames.iter().any(|&l| self.loud(l));
        self.quiet = 0;
        sound.then_some(part)
    }

    /// What is left, unless it has no sound at all.
    fn finish(&mut self) -> Option<Vec<f32>> {
        self.buf.extend(self.pending.drain(..));
        let sound = self.frames.iter().any(|&l| l >= SILENT) || rms(&self.buf) >= SILENT;
        self.frames.clear();
        self.speech = false;
        let buf = std::mem::take(&mut self.buf);
        sound.then_some(buf)
    }
}

/// The microphone's thread: hears, cuts into parts, hands parts to the writer, and answers stop.
fn listen(app: AppHandle, model: Model, dir: PathBuf, tidy: (TidyModel, Option<PathBuf>), ready: Sender<Res<()>>, ctl: Receiver<Ctl>) {
    let (audio_tx, audio) = channel::<Vec<f32>>();
    let (fail_tx, fail) = channel::<String>();
    let (mic, rate) = match open_mic(audio_tx, fail_tx.clone()) {
        Ok(m) => m,
        Err(e) => {
            let _ = ready.send(Err(e));
            return;
        }
    };
    let _ = ready.send(Ok(()));

    // The writer turns parts into text, one after another, while more is heard.
    let (parts_tx, parts_rx) = channel::<Vec<f32>>();
    let cancelled = Arc::new(AtomicBool::new(false));
    let heard = Arc::new(Mutex::new(Vec::<String>::new()));
    let writer = {
        let (app, cancelled, heard) = (app.clone(), cancelled.clone(), heard.clone());
        thread::Builder::new().name("voice-write".into()).spawn(move || -> Res<()> {
            let options = TranscribeOptions::default();
            for part in parts_rx {
                if cancelled.load(Ordering::Relaxed) {
                    break;
                }
                let said = {
                    let mut m = loaded(&app, &model, &dir).inspect_err(|e| drop(fail_tx.send(e.clone())))?;
                    let Some(m) = m.as_mut() else { break };
                    m.transcribe(&part, &options).map_err(|e| format!("Couldn't make out the speech: {e}")).inspect_err(|e| drop(fail_tx.send(e.clone())))?.text
                };
                let said = said.trim();
                if said.is_empty() {
                    continue;
                }
                let so_far = {
                    let mut h = heard.lock().map_err(text)?;
                    h.push(said.to_string());
                    h.join(" ")
                };
                let _ = app.emit("voice-heard", so_far);
            }
            Ok(())
        })
    };
    let Ok(writer) = writer else { return };

    let mut resample = Resample::new(rate);
    let mut parts = Parts::new();
    let (mut level_at, mut level_sum, mut level_n) = (Instant::now(), 0f32, 0usize);
    let started = Instant::now();
    let (mut sound, mut deaf) = (false, false);
    // Once the microphone or the model fails, the page is told and stops: what was heard is still typed.
    let mut broken = false;
    loop {
        match ctl.try_recv() {
            Ok(Ctl::Finish(reply)) => {
                drop(mic);
                while let Ok(chunk) = audio.try_recv() {
                    for part in parts.push(&resample.push(&chunk)) {
                        let _ = parts_tx.send(part);
                    }
                }
                if let Some(last) = parts.finish() {
                    let _ = parts_tx.send(last);
                }
                drop(parts_tx);
                let done = writer.join().map_err(|_| "Voice typing stopped unexpectedly".to_string()).and_then(|r| r);
                let said = heard.lock().map(|h| h.join(" ")).map_err(text);
                let _ = reply.send(done.and(said).map(|said| cleaned(&tidy.0, tidy.1.as_deref(), said)));
                return;
            }
            Ok(Ctl::Cancel) | Err(TryRecvError::Disconnected) => {
                cancelled.store(true, Ordering::Relaxed);
                return;
            }
            Err(TryRecvError::Empty) => {}
        }
        if !broken {
            if let Ok(e) = fail.try_recv() {
                broken = true;
                let _ = app.emit("voice-failed", e);
            }
        }
        if broken {
            // Waits for the page's stop or cancel.
            thread::sleep(Duration::from_millis(20));
            continue;
        }
        match audio.recv_timeout(Duration::from_millis(20)) {
            Ok(chunk) => {
                if !sound && chunk.iter().any(|&x| x != 0.0) {
                    sound = true;
                }
                let samples = resample.push(&chunk);
                level_sum += samples.iter().map(|x| x * x).sum::<f32>();
                level_n += samples.len();
                for part in parts.push(&samples) {
                    let _ = parts_tx.send(part);
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                broken = true;
                let _ = app.emit("voice-failed", "The microphone stopped");
                continue;
            }
        }
        if level_at.elapsed() >= LEVEL_EVERY {
            let level = if level_n > 0 { (level_sum / level_n as f32).sqrt() } else { 0.0 };
            let _ = app.emit("voice-level", level);
            (level_at, level_sum, level_n) = (Instant::now(), 0.0, 0);
            // A microphone the system doesn't let the app use gives exact zeros, not even hiss.
            let now_deaf = !sound && started.elapsed() > DEAF_AFTER;
            if now_deaf != deaf {
                deaf = now_deaf;
                let _ = app.emit("voice-deaf", deaf);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resample_keeps_time() {
        for rate in [48_000, 44_100, 16_000, 8_000] {
            let mut r = Resample::new(rate);
            let mut n = 0;
            for _ in 0..100 {
                n += r.push(&vec![0.5; rate as usize / 100]).len();
            }
            assert!((n as i64 - RATE as i64).abs() <= 1, "{rate}: {n}");
        }
    }

    /// `VB_VOICE_TEST_WAV=… VB_VOICE_TEST_MODEL=… cargo test -- --ignored voice_hears`: the WAV, cut
    /// off at `VB_VOICE_TEST_SECS`, through the parts and the model as the microphone's thread does.
    #[test]
    #[ignore]
    fn voice_hears_a_wav() {
        let wav = std::env::var("VB_VOICE_TEST_WAV").unwrap();
        let dir = PathBuf::from(std::env::var("VB_VOICE_TEST_MODEL").unwrap());
        let secs: f32 = std::env::var("VB_VOICE_TEST_SECS").map_or(1000.0, |s| s.parse().unwrap());
        let mut samples = transcribe_rs::audio::read_wav_samples(Path::new(&wav)).unwrap();
        samples.truncate((secs * RATE as f32) as usize);
        let mut model = ParakeetModel::load(&dir, &Quantization::Int8).unwrap();
        let mut p = Parts::new();
        let mut parts = Vec::new();
        for chunk in samples.chunks(441) {
            parts.extend(p.push(chunk));
        }
        parts.extend(p.finish());
        let mut heard = Vec::new();
        for part in parts {
            let t = Instant::now();
            let said = model.transcribe(&part, &TranscribeOptions::default()).unwrap().text;
            println!("{:.1}s in {:?}: {said:?}", part.len() as f32 / RATE as f32, t.elapsed());
            heard.push(said.trim().to_string());
        }
        // And cleaned up, given the clean-up model: `VB_TIDY_TEST_MODEL=<s1-mini-q4_k_m.gguf>`.
        if let Ok(file) = std::env::var("VB_TIDY_TEST_MODEL") {
            let tidy = Tidy::load(Path::new(&file)).unwrap();
            let t = Instant::now();
            let clean = tidy.clean(&heard.join(" ")).unwrap();
            println!("cleaned in {:?}: {clean:?}", t.elapsed());
        }
    }

    #[test]
    fn parts_are_cut_at_pauses() {
        let tone = |secs: f32| (0..(secs * RATE as f32) as usize).map(|i| (i as f32 * 0.05).sin() * 0.2).collect::<Vec<f32>>();
        let hush = |secs: f32| vec![0.0005f32; (secs * RATE as f32) as usize];
        let mut p = Parts::new();
        assert!(p.push(&hush(5.0)).is_empty(), "quiet alone is no part");
        assert!(p.buf.len() <= 2 * RATE, "quiet is not kept");
        assert!(p.push(&tone(2.0)).is_empty());
        assert!(p.push(&hush(0.3)).is_empty(), "too short to cut yet");
        assert!(p.push(&tone(2.0)).is_empty());
        let cut = p.push(&hush(1.0));
        assert_eq!(cut.len(), 1, "cut at the pause");
        assert!(p.push(&tone(30.0)).len() == 1, "cut when nobody pauses");
        assert!(p.finish().is_some());
        assert!(p.finish().is_none());
    }
}
