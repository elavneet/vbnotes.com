import type { ChatMessage } from './prompt';
import type { Wire } from './providers';

/**
 * Talking to a provider from JavaScript (the phone; the desktop does it in Rust). `fetch` is passed
 * in: the phone's streams (`expo/fetch`), and plain `fetch` works the same for a test.
 */
export interface Target {
  base: string;
  key?: string;
  wire: Wire;
  model: string;
}

type Fetch = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  body: ReadableStream<Uint8Array> | null;
}>;

export function headersFor(t: Target): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (t.key) {
    if (t.wire === 'anthropic') h['x-api-key'] = t.key;
    else h.Authorization = `Bearer ${t.key}`;
  }
  if (t.wire === 'anthropic') h['anthropic-version'] = '2023-06-01';
  // OpenRouter shows where requests come from on its dashboard.
  if (t.base.includes('openrouter.ai')) {
    h['HTTP-Referer'] = 'https://vbnotes.com';
    h['X-Title'] = 'VB Notes';
  }
  return h;
}

/** A provider's error as a sentence: its own message when the body has one. */
export function failureMessage(status: number, body: string): string {
  let said: string | undefined;
  try {
    const v = JSON.parse(body);
    said = v?.error?.message ?? v?.message ?? (typeof v?.error === 'string' ? v.error : undefined);
  } catch {}
  if (status === 401 || status === 403) return 'The provider didn\'t accept the API key. Check it in Settings › AI chat.';
  return said ? `The provider said: ${said} (${status})` : `The provider answered with an error (${status}).`;
}

/** The models the provider offers. */
export async function listModels(fetch: Fetch, t: Target): Promise<string[]> {
  const res = await fetch(`${t.base}/models`, { headers: headersFor(t) }).catch((e) => { throw new Error(`Couldn't reach the provider: ${e?.message ?? e}`); });
  const body = await res.text();
  if (!res.ok) throw new Error(failureMessage(res.status, body));
  const v = JSON.parse(body);
  const list: { id?: string; name?: string }[] = v.data ?? v.models ?? [];
  return [...new Set(list.map((m) => (m.id ?? m.name ?? '').replace(/^models\//, '')).filter(Boolean))].sort();
}

/** Asks the model; each piece of the reply goes to `onText` as it streams in. Throws with a sentence on failure. */
export async function streamChat(fetch: Fetch, t: Target, system: string, messages: ChatMessage[], onText: (piece: string) => void, signal?: AbortSignal) {
  const [url, body] = t.wire === 'anthropic'
    ? [`${t.base}/messages`, { model: t.model, stream: true, max_tokens: 4096, system, messages }]
    : [`${t.base}/chat/completions`, { model: t.model, stream: true, messages: [{ role: 'system', content: system }, ...messages] }];
  const res = await fetch(url, { method: 'POST', headers: headersFor(t), body: JSON.stringify(body), signal }).catch((e) => {
    if (signal?.aborted) return null;
    throw new Error(`Couldn't reach the provider: ${e?.message ?? e}`);
  });
  if (!res) return;
  if (!res.ok) throw new Error(failureMessage(res.status, await res.text()));
  if (!res.body) throw new Error('The provider sent no reply.');
  // Server-sent events: one `data: {json}` line per piece of the reply.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let rest = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest += decoder.decode(value, { stream: true });
      const lines = rest.split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) {
        const data = line.trim().startsWith('data:') ? line.trim().slice(5).trim() : null;
        if (!data) continue;
        if (data === '[DONE]') return;
        let v: any;
        try { v = JSON.parse(data); } catch { continue; }
        if (v?.error?.message) throw new Error(`The provider said: ${v.error.message}`);
        const piece = t.wire === 'anthropic' ? v?.delta?.text : v?.choices?.[0]?.delta?.content;
        if (typeof piece === 'string' && piece) onText(piece);
      }
    }
  } catch (e) {
    if (signal?.aborted) return;
    throw e;
  }
}
