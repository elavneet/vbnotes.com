// The desktop app downloads its models through https://api.vbnotes.com/models/<folder>/<file>.
// This sends it on to our copy in R2 (models.vbnotes.com), or, if that file is missing, to where
// the model is published, so the app's links never have to change.

const COPIES = 'https://models.vbnotes.com/';

/** Each folder's published source, at the same revision as our copy. */
const PUBLISHED = {
  'parakeet-tdt-0.6b-v3-8f23f0c0/':
    'https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce/',
  's1-mini-34add00a/': 'https://huggingface.co/superwhisper/s1-mini-GGUF/resolve/34add00a48a2e5d24e5a4ee5405a99620a3a240c/',
  'lfm2.5-embedding-350m-a80de9c5/':
    'https://huggingface.co/LiquidAI/LFM2.5-Embedding-350M-GGUF/resolve/a80de9c5b941d429104f0038292a0ef5a860e486/',
};

const sendTo = (location) =>
  new Response(null, { status: 302, headers: { location, 'cache-control': 'public, max-age=300' } });

export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
    const { pathname } = new URL(request.url);
    const path = pathname.startsWith('/models/') ? pathname.slice('/models/'.length) : '';
    const folder = Object.keys(PUBLISHED).find((f) => path.startsWith(f) && path.length > f.length);
    if (!folder) return new Response('Not found\n', { status: 404 });
    if (await env.MODELS.head(path)) return sendTo(COPIES + path);
    return sendTo(PUBLISHED[folder] + path.slice(folder.length));
  },
};
