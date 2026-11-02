import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { execSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(__dirname);

export default defineConfig({
  root,
  build: { outDir: 'build', emptyOutDir: false },
  resolve: {
    alias: [
      // tentap from its sources, sharing one TipTap with our extensions, without React (tentap.ts).
      { find: /^@10play\/tentap-editor$/, replacement: path.resolve(root, 'tentap.ts') },
      { find: /^tentap-src\/(.*)$/, replacement: path.resolve(root, '../node_modules/@10play/tentap-editor/src/$1') },
    ],
  },
  plugins: [
    viteSingleFile(),
    {
      name: 'tentap-post-build',
      closeBundle() {
        execSync('npm run editor:post-build', { stdio: 'inherit', cwd: path.resolve(root, '..') });
      },
    },
  ],
});
