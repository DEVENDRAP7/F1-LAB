import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Base must match the GitHub repo name — this is a Pages project site,
// served from https://<owner>.github.io/F1-LAB/, not the domain root.
export default defineConfig({
  base: '/F1-LAB/',
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
});
