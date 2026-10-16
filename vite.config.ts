import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  plugins: [cloudflare()],
  publicDir: 'data',
  server: {
    host: '127.0.0.1',
    port: mode === 'smoke' ? 18787 : 8787,
    strictPort: true,
  },
}));
