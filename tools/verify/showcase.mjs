#!/usr/bin/env node
/**
 * Screenshots a module showcase through its tutorial steps.
 *
 *   node tools/verify/showcase.mjs <ui|parsing|audio> [--url ...] [--out tools/verify/out/showcase-<name>] [--headed]
 *
 * Writes <out>/NN-<step>.png for the initial scene and after every step plus
 * <out>/report.json with console errors, per-step timings, diagnostics and
 * perf. Exit code 1 on console errors, step failures, or missing showcase.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_URL,
  attachConsole,
  ensureDir,
  launch,
  measureFps,
  parseArgs,
  perfSnapshot,
  readAppErrors,
  shot,
  sleep,
  waitForReady,
  writeJson,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const name = args._[0];
if (!name) {
  console.error('usage: showcase.mjs <ui|parsing|audio>');
  process.exit(2);
}
// --query "pdf=/some.pdf&pages=1,2" forwards extra parameters to the showcase (e.g. an alternative PDF).
const url = `${args.url || DEFAULT_URL}/?showcase=${encodeURIComponent(name)}${args.query ? `&${args.query}` : ''}`;
const outDir = ensureDir(args.out || `tools/verify/out/showcase-${name}`);
// Step labels change between rounds; a screenshot left over from an older numbering would mislead a critic.
for (const f of fs.readdirSync(outDir)) if (/^\d{2}-.*\.png$/.test(f)) fs.unlinkSync(path.join(outDir, f));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

const report = { name, url, startedAt: new Date().toISOString(), steps: [], screenshots: [], pass: false };
const browser = await launch({ headless: !args.headed });
try {
  const page = await browser.newPage();
  const consoleLog = attachConsole(page);
  report.console = consoleLog;
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitForReady(page, 30000);
  report.readyMs = Date.now() - t0;
  const meta = await page.evaluate(() => {
    const s = window.__smr?.showcase;
    return s ? { name: s.name, steps: s.steps } : null;
  });
  report.implemented = !!meta && !(meta.steps.length === 1 && meta.steps[0] === 'stub');
  report.showcase = meta;
  await sleep(400);
  report.screenshots.push(await shot(page, outDir, '00-initial'));
  if (meta) {
    for (let i = 0; i < meta.steps.length; i++) {
      const label = meta.steps[i];
      const tStep = Date.now();
      const result = await page
        .evaluate((idx) => window.__smr.showcase.runStep(idx), i)
        .then(() => ({ ok: true }))
        .catch((err) => ({ ok: false, error: String(err) }));
      await sleep(350);
      const fps = await measureFps(page, 500);
      const file = await shot(page, outDir, `${String(i + 1).padStart(2, '0')}-${slug(label)}`);
      report.screenshots.push(file);
      report.steps.push({ index: i, label, ms: Date.now() - tStep, ...result, fps });
      console.log(`${result.ok ? 'ok  ' : 'FAIL'} step ${i + 1}/${meta.steps.length} ${label}${result.error ? ` :: ${result.error}` : ''}`);
    }
    report.diagnostics = await page.evaluate(() => {
      try {
        return window.__smr.showcase.getDiagnostics();
      } catch (e) {
        return { error: String(e) };
      }
    });
  }
  report.perf = await perfSnapshot(page);
  report.appErrors = await readAppErrors(page);
  report.errors = [...new Set([...consoleLog.errors, ...report.appErrors])];
  report.pass = report.implemented && report.steps.every((s) => s.ok) && report.errors.length === 0;
} catch (err) {
  report.fatal = err.stack || String(err);
  console.error(report.fatal);
} finally {
  await browser.close();
}
report.finishedAt = new Date().toISOString();
const file = writeJson(path.join(outDir, 'report.json'), report);
console.log(`${report.pass ? 'SHOWCASE OK' : 'SHOWCASE FAILED'} (${name}, implemented=${report.implemented}, errors=${report.errors?.length ?? '?'}) -> ${file}`);
process.exit(report.pass ? 0 : 1);
