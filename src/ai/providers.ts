/**
 * The AI providers the chat can use, shared by the phone and the desktop app (whose Rust side,
 * `desktop/src-tauri/src/ai.rs`, keeps its own copy of the addresses). Most speak OpenAI's chat
 * API; Anthropic speaks its own. `prefer` picks a sensible model from the provider's list.
 */
export type Wire = 'openai' | 'anthropic';

export interface Provider {
  id: string;
  name: string;
  base: string;
  wire: Wire;
  needsKey: boolean;
  keyUrl?: string;
  prefer: RegExp[];
  /** Set for providers whose address can be changed (Ollama, a server of your own). */
  address?: string;
  /** Not offered on the phone: Ollama runs on a computer. */
  desktopOnly?: boolean;
}

export const PROVIDERS: Provider[] = [
  { id: 'openrouter', name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', wire: 'openai', needsKey: true, keyUrl: 'https://openrouter.ai/keys', prefer: [/^anthropic\/claude-sonnet/, /^openai\/gpt-5/, /^google\/gemini/] },
  { id: 'openai', name: 'OpenAI', base: 'https://api.openai.com/v1', wire: 'openai', needsKey: true, keyUrl: 'https://platform.openai.com/api-keys', prefer: [/^gpt-5(\.\d+)?$/, /^gpt-5/, /^gpt-4\.1$/, /^gpt-4o$/] },
  { id: 'anthropic', name: 'Anthropic (Claude)', base: 'https://api.anthropic.com/v1', wire: 'anthropic', needsKey: true, keyUrl: 'https://console.anthropic.com/settings/keys', prefer: [/^claude-sonnet/, /^claude-opus/, /^claude/] },
  { id: 'gemini', name: 'Google Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', wire: 'openai', needsKey: true, keyUrl: 'https://aistudio.google.com/apikey', prefer: [/^gemini-[\d.]+-flash$/, /^gemini-[\d.]+-pro$/, /^gemini/] },
  { id: 'groq', name: 'Groq', base: 'https://api.groq.com/openai/v1', wire: 'openai', needsKey: true, keyUrl: 'https://console.groq.com/keys', prefer: [/llama-3\.3-70b/, /llama/] },
  { id: 'mistral', name: 'Mistral', base: 'https://api.mistral.ai/v1', wire: 'openai', needsKey: true, keyUrl: 'https://console.mistral.ai/api-keys', prefer: [/^mistral-large-latest$/, /^mistral-medium/] },
  { id: 'deepseek', name: 'DeepSeek', base: 'https://api.deepseek.com/v1', wire: 'openai', needsKey: true, keyUrl: 'https://platform.deepseek.com/api_keys', prefer: [/^deepseek-chat$/] },
  { id: 'xai', name: 'xAI (Grok)', base: 'https://api.x.ai/v1', wire: 'openai', needsKey: true, keyUrl: 'https://console.x.ai', prefer: [/^grok-4/, /^grok/] },
  { id: 'ollama', name: 'Ollama, on this computer', base: 'http://localhost:11434/v1', wire: 'openai', needsKey: false, prefer: [], address: 'http://localhost:11434/v1', desktopOnly: true },
  { id: 'custom', name: 'Other (OpenAI-compatible)', base: '', wire: 'openai', needsKey: false, prefer: [], address: '' },
];

export const providerOf = (id: string) => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];

/** How the footer names where questions go. */
export const destinationOf = (id: string) => (id === 'custom' ? 'your server' : providerOf(id).name);

/** Models that can't chat (embeddings, speech, pictures) are left out of the list. */
const NOT_CHAT = /embed|tts|whisper|dall-e|moderation|audio|realtime|transcribe|image|search|rerank|guard/i;

export function chatModels(ids: string[]) {
  return ids.filter((id) => !NOT_CHAT.test(id));
}

export function preferredModel(provider: string, ids: string[]) {
  for (const re of providerOf(provider).prefer) {
    const hit = ids.find((id) => re.test(id));
    if (hit) return hit;
  }
  return ids[0] ?? '';
}
