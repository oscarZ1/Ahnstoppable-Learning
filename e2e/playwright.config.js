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
      command: 'node fake-gemini.js',      // a stand-in Gemini API
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
        GEMINI_MODEL: '',               // the default, whatever is in your shell
        // There's no fallback model by default; one is set so its behaviour is tested.
        GEMINI_FALLBACK_MODEL: 'gemini-fallback-test',
        GEMINI_THINKING_LEVEL: '',
        GEMINI_OVERLOAD_SKIP_SECONDS: '',
        // Students' own Gemini keys: encrypted with a fixed test secret, and
        // pointed at the fake API.
        AI_KEY_ENCRYPTION_SECRET: Buffer.alloc(32, 7).toString('base64'),
        BYO_GEMINI_BASE_URL: `http://localhost:${FAKE_GEMINI_PORT}`,
        ASSISTANT_DAILY_SITE_LIMIT: '',
        STUDENT_SUMMARIES_PER_CLASS_HOUR: '3',
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
