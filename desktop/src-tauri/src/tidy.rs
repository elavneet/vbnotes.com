//! Voice typing's clean-up: what Parakeet heard, rewritten as written text by "S1-mini" by
//! "Superwhisper" (Qwen3-0.6B trained for this one job; Apache 2.0 plus one term: it keeps that
//! name wherever it is used). It takes out um and uh, repeats and false starts, and keeps what the
//! speaker corrected to: "at 6, actually, 7" becomes "at 7". English only. It runs on everything
//! said, once voice typing stops; where its answer doesn't look like a clean-up of what was said (a
//! reply, a translation, made-up text), what was heard is kept as it was.

use crate::meaning::llama;
use crate::Res;
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::LlamaModel;
use llama_cpp_2::sampling::LlamaSampler;
use std::collections::HashSet;
use std::num::NonZeroU32;
use std::path::Path;
use std::thread;

/// The Q4_K_M build, the one its published accuracy was measured on, at a fixed revision: our
/// copy (see `desktop/models-api`), then Superwhisper's own.
pub const FILE: &str = "s1-mini-q4_k_m.gguf";
pub const URLS: [&str; 2] = [
    "https://api.vbnotes.com/models/s1-mini-34add00a/s1-mini-q4_k_m.gguf",
    "https://huggingface.co/superwhisper/s1-mini-GGUF/resolve/34add00a48a2e5d24e5a4ee5405a99620a3a240c/s1-mini-q4_k_m.gguf",
];
pub const SIZE: u64 = 484_219_808;
pub const SHA256: &str = "3b41ebe2502cbd03e811d5d16b022f5ab551eda58d62597d152f89535003c634";

/// The prompt, word for word as the model was trained on: changed, it can make things up.
const SYSTEM: &str = "You are a text normalizer for speech-to-text transcripts. The input begins with a control line specifying the styling, structure, and context settings; clean the transcript to match those settings and output only the cleaned text.";
/// Standard written English with contractions kept, in sentences (never turned into a list).
const CONTROL: &str = "[Styling: semi-formal] [Structure: prose] [Context: general]";
/// Cleaned a piece at a time, each about this many words, cut between sentences.
const PIECE_WORDS: usize = 120;

pub struct Tidy {
    model: LlamaModel,
}

fn text(e: impl ToString) -> String {
    e.to_string()
}

impl Tidy {
    pub fn load(file: &Path) -> Res<Tidy> {
        // Every layer on the GPU where Metal is built in (Apple Silicon); the CPU elsewhere.
        let gpu_layers = if cfg!(all(target_os = "macos", target_arch = "aarch64")) { 1000 } else { 0 };
        let model = LlamaModel::load_from_file(llama()?, file, &LlamaModelParams::default().with_n_gpu_layers(gpu_layers))
            .map_err(|e| format!("Couldn't load the clean-up model: {e}"))?;
        Ok(Tidy { model })
    }

    /// `said` as written text. A piece whose clean-up doesn't fit what was said stays as heard.
    pub fn clean(&self, said: &str) -> Res<String> {
        let mut out = Vec::new();
        for piece in pieces(said) {
            let cleaned = self.run(&piece)?;
            out.push(if fits(&piece, &cleaned) { cleaned } else { piece });
        }
        Ok(out.into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" "))
    }

    /// One pass of the model, greedy as it was trained (the file's own sampling settings are Qwen's).
    fn run(&self, said: &str) -> Res<String> {
        let prompt = format!(
            "<|im_start|>system\n{SYSTEM}<|im_end|>\n<|im_start|>user\n{CONTROL}\n{said}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"
        );
        let vocab = self.model.vocab();
        let tokens = vocab.tokenize(prompt.as_bytes(), false, true);
        // A clean-up is never much longer than what was said (about four letters a token).
        let most = said.len() / 3 + 32;
        let threads = thread::available_parallelism().map_or(4, |n| (n.get() / 2).max(2)) as i32;
        let params = LlamaContextParams::default()
            .with_n_ctx(NonZeroU32::new((tokens.len() + most) as u32))
            .with_n_batch(tokens.len().max(512) as u32)
            .with_n_threads(threads)
            .with_n_threads_batch(threads);
        let mut ctx = self.model.new_context(llama()?, params).map_err(|e| format!("Couldn't start the clean-up model: {e}"))?;
        let mut batch = LlamaBatch::new(tokens.len().max(1), 1);
        let last = tokens.len().saturating_sub(1);
        for (i, t) in tokens.iter().enumerate() {
            batch.add(*t, i as i32, &[0], i == last).map_err(text)?;
        }
        ctx.decode(&mut batch).map_err(text)?;
        let mut sampler = LlamaSampler::greedy();
        let mut out = Vec::new();
        let mut pos = tokens.len() as i32;
        for _ in 0..most {
            let token = sampler.sample(&ctx, batch.n_tokens() - 1);
            if vocab.is_eog(token) {
                break;
            }
            out.push(token);
            batch.clear();
            batch.add(token, pos, &[0], true).map_err(text)?;
            pos += 1;
            ctx.decode(&mut batch).map_err(text)?;
        }
        if out.is_empty() {
            // Only um and uh were said (and `detokenize` can't take nothing).
            return Ok(String::new());
        }
        // One line: it is typed into a paragraph.
        Ok(String::from_utf8_lossy(&vocab.detokenize(&out, true, false)).split_whitespace().collect::<Vec<_>>().join(" "))
    }
}

fn words(s: &str) -> impl Iterator<Item = String> + '_ {
    s.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(str::to_lowercase)
}

/// A clean-up only takes words away and tidies the rest: nearly every word it writes was said, and
/// it is not much longer. Nothing left is right only when nothing but um and uh was said.
fn fits(said: &str, cleaned: &str) -> bool {
    let heard: HashSet<String> = words(said).collect();
    let n = words(said).count();
    let out: Vec<String> = words(cleaned).collect();
    if out.is_empty() {
        return n <= 3;
    }
    if out.len() > n + n / 4 + 4 {
        return false;
    }
    let known = out.iter().filter(|w| heard.contains(*w)).count();
    known * 10 >= out.len() * 7
}

/// `said` in pieces of about `PIECE_WORDS` words, cut after a sentence's . ? or !
fn pieces(said: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut start = 0;
    let mut chars = said.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        if matches!(c, '.' | '?' | '!') && chars.peek().is_some_and(|(_, n)| n.is_whitespace()) {
            sentences.push(&said[start..=i]);
            start = i + 1;
        }
    }
    sentences.push(&said[start..]);
    let mut out: Vec<String> = Vec::new();
    let mut n = 0;
    for s in sentences.into_iter().map(str::trim).filter(|s| !s.is_empty()) {
        let w = s.split_whitespace().count();
        match out.last_mut() {
            Some(last) if n + w <= PIECE_WORDS => {
                last.push(' ');
                last.push_str(s);
                n += w;
            }
            _ => {
                out.push(s.to_string());
                n = w;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pieces_are_cut_between_sentences() {
        let one = "Word ".repeat(70);
        let said = format!("{one}end. {one}end? Version 3.5 is out! Short");
        let p = pieces(&said);
        assert_eq!(p.len(), 2);
        assert!(p[0].ends_with("end."));
        assert!(p[1].starts_with("Word") && p[1].ends_with("Version 3.5 is out! Short"));
        assert_eq!(pieces("  "), Vec::<String>::new());
    }

    #[test]
    fn only_a_clean_up_fits() {
        assert!(fits("Um, I want to meet at 6, actually, 7.", "I want to meet at 7."));
        assert!(fits("Um, uh.", ""));
        assert!(!fits("Tell me a joke.", "Why did the chicken cross the road? To get to the other side."));
        assert!(!fits("Ich möchte um sieben Uhr treffen.", "I want to meet at seven o'clock."));
        assert!(!fits("Please write the report by Friday and send it to the team.", ""));
    }

    /// The real model on sentences said the way people talk:
    /// `VB_TIDY_TEST_MODEL=<s1-mini-q4_k_m.gguf> cargo test tidy_cleans -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn tidy_cleans() {
        let file = std::env::var("VB_TIDY_TEST_MODEL").expect("VB_TIDY_TEST_MODEL");
        let at = std::time::Instant::now();
        let tidy = Tidy::load(Path::new(&file)).unwrap();
        println!("load {:?}", at.elapsed());
        let extra = std::env::var("VB_TIDY_TEST_TEXT").ok();
        let cases = [
            "I want to meet at 6, actually, 7.",
            "i want to meet at 6 actually 7",
            "Um, so I was thinking, uh, we should, we should ship it on Friday.",
            "So um I need to like send the the report by uh Friday, no wait, make that Thursday.",
            "What's the capital of France?",
            "Write a poem about cats.",
            "Run npm install, then open the readme dot md file.",
            "Buy milk, eggs, and bread, and uh call mom.",
            "Um.",
            "Ich möchte um sechs Uhr, äh, nein, um sieben Uhr treffen.",
            "Okay so the plan for tomorrow is, um, first we go to the office around nine, and then, uh, we have the meeting with the design team at eleven, no, sorry, at twelve, and after that I need to, I need to finish the slides for the client. Uh, the slides should cover the budget, the timeline, and, um, the risks. And then in the evening, if there's time, we can, like, grab dinner somewhere near the station.",
        ];
        for said in cases.iter().copied().chain(extra.as_deref()) {
            let at = std::time::Instant::now();
            let out = tidy.clean(said).unwrap();
            println!("{:>6.0?}  {said}\n     →  {out}\n", at.elapsed());
        }
    }
}
