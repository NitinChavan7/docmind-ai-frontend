import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true, headers: { 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' } },
  preview: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' } },
  build: { rollupOptions: { output: { manualChunks(id) {
    if (id.includes('/node_modules/pdfjs-dist/')) return 'pdf-engine';
  } } } },
});
