/**
 * A recording as the speech model wants it: the samples of a 16-bit WAV file, and long recordings
 * cut where the speaker paused, so each part is short enough to write down at once.
 */

export const RATE = 16000;
/** Loudness is measured over 20 ms frames. */
const FRAME = RATE / 50;
/** No part is longer than this... */
const PART_MAX = 25 * RATE;
/** ...and a cut is made at the quietest moment of a part's last seconds. */
const LOOK_BACK = 8 * RATE;
/** Quieter than this all through: nothing was said. */
const SILENT = 0.002;

/** The samples (-1…1, first channel) and rate of a 16-bit PCM WAV file. */
export function wavSamples(bytes: Uint8Array): { samples: Float32Array; rate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file');
  let rate = RATE;
  let channels = 1;
  for (let at = 12; at + 8 <= bytes.length;) {
    const size = view.getUint32(at + 4, true);
    if (tag(at) === 'fmt ') {
      channels = view.getUint16(at + 10, true);
      rate = view.getUint32(at + 12, true);
      if (view.getUint16(at + 22, true) !== 16) throw new Error('Not a 16-bit WAV file');
    } else if (tag(at) === 'data') {
      // A recording that was cut short can claim more than the file holds.
      const n = Math.floor(Math.min(size, bytes.length - at - 8) / (2 * channels));
      const samples = new Float32Array(n);
      for (let i = 0; i < n; i++) samples[i] = view.getInt16(at + 8 + i * 2 * channels, true) / 32768;
      return { samples, rate };
    }
    at += 8 + size + (size & 1);
  }
  throw new Error('The WAV file has no sound in it');
}

function level(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return to > from ? Math.sqrt(sum / (to - from)) : 0;
}

/** `samples` (16 kHz) in parts of at most 25 s, cut at the quietest moment near each part's end. */
export function cutAtPauses(samples: Float32Array): Float32Array[] {
  const parts: Float32Array[] = [];
  let start = 0;
  while (samples.length - start > PART_MAX) {
    const end = start + PART_MAX;
    let cut = end;
    let quietest = Infinity;
    for (let at = end - LOOK_BACK; at + FRAME <= end; at += FRAME) {
      const l = level(samples, at, at + FRAME);
      if (l < quietest) { quietest = l; cut = at + FRAME / 2; }
    }
    parts.push(samples.subarray(start, cut));
    start = cut;
  }
  parts.push(samples.subarray(start));
  return parts.filter((p) => level(p, 0, p.length) >= SILENT);
}

/** `samples` at 16 kHz: each new sample is the average of the old ones it covers. */
export function to16k(samples: Float32Array, rate: number): Float32Array {
  if (rate === RATE) return samples;
  const step = rate / RATE;
  const out = new Float32Array(Math.floor(samples.length / step));
  for (let i = 0; i < out.length; i++) {
    const from = Math.floor(i * step);
    const to = Math.max(from + 1, Math.floor((i + 1) * step));
    let sum = 0;
    for (let j = from; j < to; j++) sum += samples[j];
    out[i] = sum / (to - from);
  }
  return out;
}
