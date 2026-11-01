import React, { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { openUrl } from '@tauri-apps/plugin-opener';
import { namedSources } from '@/ai/prompt';
import { destinationOf } from '@/ai/providers';
import { openableUrl } from '@/utils/links';
import { openNote } from './actions';
import { aiReady, useAi, useChat, type Turn } from './ai';
import { Icon } from './Icon';
import { useSettingsOpen } from './Settings';
import { useNote, useNotes } from './store';

/** A reply as markdown. It comes from outside, so it is sanitised, pictures included (a picture could track). */
function Reply({ text }: { text: string }) {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(text, { async: false, breaks: true }), { FORBID_TAGS: ['img', 'style', 'iframe', 'form', 'input', 'video', 'audio'], FORBID_ATTR: ['style'] }),
    [text],
  );
  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as Element).closest('a');
    if (!a) return;
    e.preventDefault();
    const url = openableUrl(a.getAttribute('href'));
    if (url) void openUrl(url);
  };
  return <div className="ai-md" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}

function TurnView({ turn, busy }: { turn: Turn; busy: boolean }) {
  const [copied, setCopied] = useState(false);
  if (turn.role === 'user') return <div className="turn user">{turn.content}</div>;
  const sources = namedSources(turn);
  const copy = () => { void navigator.clipboard.writeText(turn.content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }); };
  return (
    <div className="turn assistant">
      {turn.content ? <Reply text={turn.content} /> : busy ? <span className="thinking">Thinking…</span> : null}
      {turn.error ? <p className="turn-error">{turn.error}</p> : null}
      {sources.length && (turn.content || turn.error) ? (
        <div className="sources">
          {sources.map((s) => <button key={s.path} className="source" onClick={() => void openNote(s.path)} title={s.path}>{s.title}</button>)}
        </div>
      ) : null}
      {turn.content && !busy ? <button className="text-btn copy" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button> : null}
    </div>
  );
}

/** Chat with AI beside the note (⇧⌘J): about the open note, or about all notes. Shown only once it is set up in Settings. */
export function ChatPanel() {
  const chat = useChat();
  const view = useAi((s) => s.view);
  const selected = useNotes((s) => s.selected);
  const note = useNote(chat.scope === 'note' ? chat.path : null);
  const [draft, setDraft] = useState('');
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // A chat about one note follows the note that is open.
  const { open, scope, path } = chat;
  useEffect(() => {
    if (open && scope === 'note' && selected !== path) useChat.getState().show(selected ? 'note' : 'all');
  }, [open, scope, path, selected]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [chat.turns]);
  useEffect(() => { if (open) input.current?.focus(); }, [open, scope]);

  if (!chat.open) return null;
  const ready = aiReady(view);
  const provider = destinationOf(view?.provider ?? '');
  const send = () => {
    const q = draft.trim();
    if (!q || chat.busy || !ready) return;
    setDraft('');
    void chat.ask(q);
  };
  const title = note?.title || 'this note';

  return (
    <aside className="chat-pane" aria-label="Chat with AI">
      <header className="chat-head" data-tauri-drag-region>
        <div className="segmented chat-scope">
          <button className={chat.scope === 'note' ? 'on' : undefined} disabled={!selected} onClick={() => chat.setScope('note')}>This note</button>
          <button className={chat.scope === 'all' ? 'on' : undefined} onClick={() => chat.setScope('all')}>All notes</button>
        </div>
        {chat.turns.length ? <button className="icon-btn" onClick={chat.clear} title="New chat" aria-label="New chat"><Icon name="plus" /></button> : null}
        <button className="icon-btn" onClick={chat.hide} title="Close the chat (⇧⌘J)" aria-label="Close the chat"><span className="close-x">×</span></button>
      </header>
      <div className="chat-log" ref={log}>
        {!ready ? (
          <div className="chat-empty">
            <p>Finish setting up AI chat: pick a provider and a model, and add your API key.</p>
            <button className="text-btn" onClick={() => useSettingsOpen.getState().set(true)}>Open Settings</button>
          </div>
        ) : chat.turns.length === 0 ? (
          <div className="chat-empty">
            {chat.scope === 'note'
              ? <p>Ask about <b>{title}</b>: sum it up, find what's missing, turn it into a checklist.</p>
              : <p>Ask anything about your notes. VB Notes finds the notes that fit each question and sends them along.</p>}
          </div>
        ) : chat.turns.map((t, i) => <TurnView key={t.id ?? i} turn={t} busy={chat.busy === t.id} />)}
      </div>
      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea
          ref={input}
          value={draft}
          rows={2}
          placeholder={chat.scope === 'note' ? 'Ask about this note…' : 'Ask your notes…'}
          disabled={!ready}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
        />
        {chat.busy
          ? <button type="button" className="chat-send stop" onClick={chat.stop} title="Stop">■</button>
          : <button type="submit" className="chat-send" disabled={!draft.trim() || !ready} title="Send (Return)"><Icon name="send" /></button>}
      </form>
      {ready ? <p className="chat-foot">{chat.scope === 'note' ? 'This note' : 'The notes that match'} and your question go to {provider} ({view?.model}).</p> : null}
    </aside>
  );
}
