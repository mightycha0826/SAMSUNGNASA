import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { resolve } from 'node:path';

// WebXR은 HTTPS나 localhost에서만 켜진다. 같은 네트워크의 헤드셋이 접속할 수 있게
// 자체 서명 인증서로 서빙하고(host: true), 모든 네트워크 인터페이스에서 받는다.
export default defineConfig({
  base: './',
  plugins: [basicSsl()],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        check: resolve(import.meta.dirname, 'check.html'),
      },
    },
  },
});
