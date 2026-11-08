import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', timeout: 60000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:5173', headless: true, launchOptions: { args: ['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--enable-unsafe-swiftshader'] } },
  webServer: { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1', url: 'http://127.0.0.1:5173', reuseExistingServer: false }
});
