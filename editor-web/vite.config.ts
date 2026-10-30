import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { execSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(__dirname);

export default defineConfig({
  root,
  build: { outDir: 'build', emptyOutDir: false },
  resolve: {
    alias: [
      { find: '@10play/tentap-editor', replacement: '@10play/tentap-editor/web' },
      { find: '@tiptap/pm/view', replacement: '@10play/tentap-editor/web' },
      { find: '@tiptap/pm/state', replacement: '@10play/tentap-editor/web' },
    ],
  },
  plugins: [
    react(),
    viteSingleFile(),
    {
      name: 'tentap-post-build',
      closeBundle() {
        execSync('npm run editor:post-build', { stdio: 'inherit', cwd: path.resolve(root, '..') });
      },
    },
  ],
});
