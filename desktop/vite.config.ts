import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const here = import.meta.dirname;
const repo = path.resolve(here, '..');

// The desktop page: the app's own screens plus the phone's editor extensions (`editor-web/`) and
// shared code (`src/utils`, `src/theme`, `src/store/noteModel.ts`), from the repo's node_modules.
export default defineConfig({
  root: here,
  clearScreen: false,
  server: { port: 1420, strictPort: true, fs: { allow: [repo] } },
  build: { outDir: 'dist', emptyOutDir: true, target: 'safari15', chunkSizeWarningLimit: 4000 },
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${repo}/src/` },
      // One TipTap and ProseMirror copy for the editor and every extension (see editor-web/vite.config.ts).
      { find: /^@10play\/tentap-editor$/, replacement: '@10play/tentap-editor/web' },
      { find: /^@tiptap\/pm\/(view|state)$/, replacement: '@10play/tentap-editor/web' },
    ],
    dedupe: ['react', 'react-dom'],
  },
  plugins: [react()],
});
