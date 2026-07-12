import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { randomBytes } from 'crypto';
import { writeFileSync } from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

function versionPlugin() {
  return {
    name: 'generate-version',
    closeBundle() {
      const meta = {
        buildId: randomBytes(8).toString('hex'),
        builtAt: new Date().toISOString(),
      };
      writeFileSync('dist/version.json', JSON.stringify(meta));
      // Also write public/ so Vite mid-dev can serve /version.json for force-reload checks.
      try {
        writeFileSync('public/version.json', JSON.stringify(meta));
      } catch {
        // public/ may be absent in some deploy contexts
      }
    },
  };
}

export default defineConfig(() => {
  return {
    base: '/',
    plugins: [react(), tailwindcss(), versionPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
