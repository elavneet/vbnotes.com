import React, { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { Icon } from './Icon';
import {
  THIS_COMPUTER, cancelVoice, downloadVoice, hideVoice, sizeText, startVoice, stopVoice, useVoice, voiceKeyLabel, voiceLevel,
} from './voice';

const BARS = 15;
/** Speech is about 0.02 to 0.15 RMS: the gain puts loud speech at the top, the curve keeps soft speech visible. */
const barHeight = (level: number) => 3 + Math.min(1, Math.pow(Math.max(0, level) * 9, 0.7)) * 17;

/** Bars that scroll right to left with the microphone's loudness; they rest flat when it stops. */
function Waveform({ live }: { live: boolean }) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    if (!live) return;
    const levels = new Array<number>(BARS).fill(0);
    let frame = 0;
    let last = 0;
    const paint = (now: number) => {
      // Every 70 ms: neighbouring bars fall on different syllables, so the wave looks like speech.
      if (now - last >= 70) {
        last = now;
        levels.shift();
        levels.push(voiceLevel.now);
        levels.forEach((l, i) => { const b = bars.current[i]; if (b) b.style.height = `${barHeight(l)}px`; });
      }
      frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [live]);
  return (
    <span className="voice-wave" aria-hidden="true">
      {Array.from({ length: BARS }, (_, i) => <span key={i} ref={(el) => { bars.current[i] = el; }} />)}
    </span>
  );
}

function Clock({ since, running }: { since: number; running: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [running]);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return <span className="voice-clock">{since ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '0:00'}</span>;
}

/** The last words heard, as one or two lines over the pill. */
const tail = (text: string) => (text.length > 150 ? `…${text.slice(text.length - 150).replace(/^\S*\s/, '')}` : text);

/** Over the open note while voice typing listens, writes, or has something to say. */
export function VoicePill() {
  const v = useVoice();
  if (v.phase === 'idle') return null;
  if (v.phase === 'offer') return <div className="voice-wrap"><VoiceOffer /></div>;
  if (v.phase === 'notice') {
    return (
      <div className="voice-wrap">
        <div className="voice-pill voice-note" role="status">
          <span>{v.notice?.text}</span>
          <button className="voice-x" onClick={hideVoice} title="Close" aria-label="Close"><Icon name="close" size={14} weight={2} /></button>
        </div>
      </div>
    );
  }
  const writing = v.phase === 'writing';
  const key = voiceKeyLabel();
  return (
    <div className="voice-wrap">
      {v.deaf && !writing ? (
        <div className="voice-bubble warn">
          Hearing nothing. Is VB Notes allowed to use the microphone?
          <button className="text-btn" onClick={() => void api.micSettings()}>Open Settings</button>
        </div>
      ) : v.heard ? (
        <div className="voice-bubble">{tail(v.heard)}</div>
      ) : !writing ? (
        <div className="voice-bubble hint">Talk. <b>{key}</b> again types it, Esc cancels.</div>
      ) : null}
      <div className={`voice-pill ${v.phase}`} role="status" aria-label={writing ? 'Typing what you said' : 'Listening'}>
        <button className="voice-x" onClick={cancelVoice} disabled={writing} title="Cancel (Esc)" aria-label="Cancel"><Icon name="close" size={14} weight={2} /></button>
        <Waveform live={v.phase === 'listening'} />
        <Clock since={v.since} running={v.phase === 'listening'} />
        {writing ? <span className="voice-spin" aria-hidden="true" /> : (
          <button className="voice-stop" onClick={() => void stopVoice()} title={`Type it (${key})`} aria-label="Type what you said"><span /></button>
        )}
      </div>
    </div>
  );
}

/**
 * The first time: what voice typing is and its one download (the speech model, then the clean-up
 * model if the clean-up is on); then the download, as one bar; then ready.
 */
function VoiceOffer() {
  const st = useVoice((s) => s.status);
  const tidy = useVoice((s) => s.tidy);
  const key = voiceKeyLabel();
  const total = st.size + (tidy ? st.tidySize : 0);
  const done = (st.model === 'ready' ? st.size : st.progress * st.size)
    + (!tidy ? 0 : st.tidy === 'ready' ? st.tidySize : st.tidy === 'downloading' ? st.tidyProgress * st.tidySize : 0);
  const downloading = st.model === 'downloading' || (tidy && st.model === 'ready' && st.tidy === 'downloading');
  const progress = total ? done / total : 0;
  const size = sizeText(total || 670e6);
  const body = downloading ? `Downloading the speech models… ${Math.round(progress * 100)}%`
    : st.model === 'error' ? `${st.error ?? 'The download failed.'}`
    : st.model === 'ready' ? `Ready. Press ${key} and start talking.`
    : `Talk, and VB Notes types it into the note${tidy ? ', without the um and uh' : ''}. The speech models run on ${THIS_COMPUTER}, so nothing you say leaves it. It is a one-time ${size} download.`;
  return (
    <div className="voice-card" role="dialog" aria-label="Voice typing">
      <div className="voice-card-head">
        <span className="voice-badge"><Icon name="mic" size={16} weight={2} /></span>
        <strong>Voice typing</strong>
        <button className="voice-x" onClick={hideVoice} title={downloading ? 'Hide (the download goes on)' : 'Close'} aria-label="Close"><Icon name="close" size={14} weight={2} /></button>
      </div>
      <p>{body}</p>
      {downloading ? <div className="voice-progress"><span style={{ width: `${Math.max(2, progress * 100)}%` }} /></div> : null}
      {st.model === 'missing' || st.model === 'error' ? (
        <div className="voice-card-actions">
          <button className="text-btn" onClick={hideVoice}>Not now</button>
          <button className="voice-go" onClick={downloadVoice}>{st.model === 'error' ? 'Try again' : `Download (${size})`}</button>
        </div>
      ) : st.model === 'ready' && !downloading ? (
        <div className="voice-card-actions">
          <button className="voice-go" onClick={() => void startVoice()}>Start talking</button>
        </div>
      ) : null}
    </div>
  );
}
