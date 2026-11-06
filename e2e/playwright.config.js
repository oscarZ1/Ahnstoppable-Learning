// Browser tests: a professor and students using the real site in Chrome,
// against a throwaway local database (see test-db.js and global-setup.js).
import { defineConfig } from '@playwright/test';
import { API_PORT, WEB_PORT, FAKE_GEMINI_PORT, E2E_DIR, BACKEND_DIR, CLIENT_DIR, APP_TIMEZONE, testDatabaseUrl } from './test-db.js';

const API = `http://localhost:${API_PORT}`;
const WEB = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.js',
  // One class with live connections and "one open poll/check at a time" rules,
  // so tests run one after another.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: WEB,
    channel: 'chrome',            // the installed Google Chrome; no browser download needed
    timezoneId: APP_TIMEZONE,     // the browser's "today" matches the class's
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node fake-gemini.js',      // stand-in Gemini API for the AI summary
      cwd: E2E_DIR,
      port: FAKE_GEMINI_PORT,
      reuseExistingServer: false,
    },
    {
      command: 'node src/index.js',
      cwd: BACKEND_DIR,
      port: API_PORT,               // a port check, not /health: the database is rebuilt after servers start
      reuseExistingServer: false,
      env: {
        ...process.env,
        PORT: String(API_PORT),
        DATABASE_URL: testDatabaseUrl(),
        DATABASE_SSL: '',
        APP_TIMEZONE,
        JWT_SECRET: 'e2e-test-secret',
        GEMINI_API_KEY: 'test-key',
        GEMINI_BASE_URL: `http://localhost:${FAKE_GEMINI_PORT}`,
        GEMINI_MODEL: '',               // the defaults, whatever is in your shell
        GEMINI_FALLBACK_MODEL: '',
        GEMINI_THINKING_LEVEL: '',
        GEMINI_OVERLOAD_SKIP_SECONDS: '',
        CORS_ORIGIN: WEB,
      },
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      cwd: CLIENT_DIR,
      url: WEB,
      reuseExistingServer: false,
      env: { ...process.env, VITE_API_URL: API },
    },
  ],
});
