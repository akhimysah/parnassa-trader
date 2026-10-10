import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Le mode « pages » sert le site sous https://akhimysah.github.io/parnassa-trader/.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'pages' ? '/parnassa-trader/' : '/',
  server: { port: 5210 },
  build: {
    rollupOptions: {
      output: {
        // Bibliothèques à part : elles changent rarement et restent en cache d'une version à l'autre.
        manualChunks: { react: ['react', 'react-dom'], graphiques: ['lightweight-charts'] },
      },
    },
  },
}));
