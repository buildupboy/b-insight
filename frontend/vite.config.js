import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const repoRoot = fileURLToPath(new URL('../', import.meta.url));
  const port = loadEnv(mode, repoRoot, 'PORT').PORT || '4173';
  return { server: { proxy: { '/api': `http://127.0.0.1:${port}` } } };
});
