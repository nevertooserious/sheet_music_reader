import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

export const DEFAULT_URL = process.env.SMR_URL || 'http://127.0.0.1:5173';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

export function findChrome() {
  for (const c of CHROME_CANDIDATES) if (c && fs.existsSync(c)) return c;
  throw new Error('No Chrome binary found; set CHROME_PATH');
}

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) out[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

export async function launch({ headless = true, width = 1400, height = 1000 } = {}) {
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: headless ? true : false,
    defaultViewport: { width, height, deviceScaleFactor: 1 },
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      `--window-size=${width},${height}`,
    ],
  });
  return browser;
}

/**
 * Attaches console/error listeners and returns a collector with
 * errors, warnings, and a full log.
 */
export function attachConsole(page) {
  const log = { errors: [], warnings: [], messages: [], requestFailures: [] };
  page.on('console', (msg) => {
    const entry = { type: msg.type(), text: msg.text(), location: msg.location()?.url };
    log.messages.push(entry);
    if (msg.type() === 'error') log.errors.push(entry.text);
    if (msg.type() === 'warning') log.warnings.push(entry.text);
  });
  page.on('pageerror', (err) => log.errors.push(`pageerror: ${err.message}`));
  page.on('requestfailed', (req) => {
    const text = `${req.method()} ${req.url()} ${req.failure()?.errorText ?? ''}`;
    log.requestFailures.push(text);
  });
  page.on('response', (res) => {
    if (res.status() >= 400) log.errors.push(`http ${res.status()} ${res.url()}`);
  });
  return log;
}

export async function waitForReady(page, timeoutMs = 30000) {
  const t0 = Date.now();
  await page.waitForFunction(() => window.__smr && window.__smr.ready === true, {
    timeout: timeoutMs,
    polling: 50,
  });
  return Date.now() - t0;
}

export async function waitForStatus(page, statuses, timeoutMs = 60000) {
  const t0 = Date.now();
  await page.waitForFunction(
    (wanted) => {
      const s = window.__smr?.store?.getState().status;
      return wanted.includes(s);
    },
    { timeout: timeoutMs, polling: 50 },
    statuses,
  );
  return Date.now() - t0;
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function shot(page, dir, name) {
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

/** Reads the in-page error list the app itself captured. */
export async function readAppErrors(page) {
  return page.evaluate(() => (window.__smr ? [...window.__smr.errors] : []));
}

export async function perfSnapshot(page) {
  const metrics = await page.metrics();
  return {
    jsHeapUsedMB: +(metrics.JSHeapUsedSize / 1048576).toFixed(1),
    jsHeapTotalMB: +(metrics.JSHeapTotalSize / 1048576).toFixed(1),
    documents: metrics.Documents,
    nodes: metrics.Nodes,
    layoutCount: metrics.LayoutCount,
    scriptDurationMs: +(metrics.ScriptDuration * 1000).toFixed(0),
    taskDurationMs: +(metrics.TaskDuration * 1000).toFixed(0),
  };
}

/** Samples requestAnimationFrame for `ms` and returns fps + longest gap. */
export async function measureFps(page, ms = 1000) {
  return page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        const start = performance.now();
        let frames = 0;
        let last = start;
        let longest = 0;
        const tick = (now) => {
          frames++;
          longest = Math.max(longest, now - last);
          last = now;
          if (now - start < duration) requestAnimationFrame(tick);
          else resolve({ fps: +(frames / ((now - start) / 1000)).toFixed(1), longestFrameMs: +longest.toFixed(1) });
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
}
