import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Страница для локальной проверки — в папке dev.
// Запросы /api уходят на заглушку бэкенда, как в настоящем приложении — через nginx.
export default defineConfig({
  root: 'dev',
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      // changeOrigin: false — сервер видит адрес страницы и возвращает Location на него, а не на свой порт.
      '/api': { target: 'http://localhost:3101', changeOrigin: false },
    },
  },
});
