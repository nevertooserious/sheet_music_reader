#!/usr/bin/env node
/**
 * End-to-end verification of the app against the bundled public-domain fixture.
 *
 *   node tools/verify/run.mjs [--url http://127.0.0.1:5173] [--fixture fixtures/bach-minuet-g]
 *                             [--out tools/verify/out/app] [--headed]
 *
 * Loads the app, waits until ready, imports the demo song, compares the parsed
 * score with the reference MIDI, exercises playback / seek / tempo / per-track
 * volume, renders audio offline, takes screenshots along the way and writes
 * <out>/report.json. Exit code 1 if any check fails or a console error occurs.
 */
import path from 'node:path';
import fs from 'node:fs';
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
  waitForStatus,
  writeJson,
} from './lib.mjs';
import { loadReferenceMidi } from './midi.mjs';
import { compareScoreToReference } from './compare.mjs';

const args = parseArgs(process.argv.slice(2));
const url = args.url || DEFAULT_URL;
const fixtureDir = args.fixture || 'fixtures/bach-minuet-g';
const outDir = ensureDir(args.out || 'tools/verify/out/app');
const headless = !args.headed;

const checks = [];
const check = (name, ok, details = {}) => {
  checks.push({ name, ok: !!ok, ...details });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${details.note ? `  (${details.note})` : ''}`);
  return !!ok;
};
const screenshots = [];
const snap = async (page, name) => screenshots.push(await shot(page, outDir, name));

const report = {
  startedAt: new Date().toISOString(),
  url,
  fixture: fixtureDir,
  checks,
  screenshots,
  console: null,
  appErrors: [],
  perf: {},
  comparison: null,
  scoreSummary: null,
  playback: {},
  pass: false,
};

const browser = await launch({ headless });
try {
  const page = await browser.newPage();
  const consoleLog = attachConsole(page);
  report.console = consoleLog;

  const tNav = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const readyMs = await waitForReady(page, 30000);
  report.perf.readyMs = Date.now() - tNav;
  check('app becomes ready', true, { note: `${readyMs} ms` });
  await snap(page, '01-loaded');

  // Import the demo song through the public controller API.
  const tParse = Date.now();
  await page.evaluate(() => window.__smr.controller.loadDemo().catch(() => undefined));
  await waitForStatus(page, ['ready', 'error'], 90000);
  report.perf.parseMs = Date.now() - tParse;
  const state = await page.evaluate(() => {
    const s = window.__smr.store.getState();
    return { status: s.status, error: s.error, fileName: s.fileName, pages: s.pages };
  });
  check('demo song parses to ready', state.status === 'ready', { note: state.error || `${report.perf.parseMs} ms` });
  await sleep(600);
  await snap(page, '02-parsed');

  if (state.status === 'ready') {
    const score = await page.evaluate(() => JSON.parse(JSON.stringify(window.__smr.store.getState().score)));
    report.scoreSummary = {
      title: score.title,
      composer: score.composer,
      engine: score.source.engine,
      fonts: score.source.fonts,
      tempoBpm: score.tempoBpm,
      measures: score.measures.length,
      timelineSegments: score.timeline.length,
      durationQn: score.durationQn,
      timeSignatures: score.timeSignatures,
      keySignatures: score.keySignatures,
      tracks: score.tracks.map((t) => ({ id: t.id, name: t.name, clef: t.clef, notes: t.notes.length })),
      warnings: score.warnings,
    };
    fs.writeFileSync(path.join(outDir, 'score.json'), JSON.stringify(score, null, 1));

    const reference = loadReferenceMidi(path.join(fixtureDir, 'reference.mid'));
    report.reference = {
      tempoBpm: reference.tempoBpm,
      timeSignature: reference.timeSignature,
      tracks: reference.tracks.map((t) => ({ name: t.name, notes: t.notes.length })),
    };
    const comparison = compareScoreToReference(score, reference);
    report.comparison = comparison;
    check('track count matches reference', score.tracks.length === reference.tracks.length, {
      note: `${score.tracks.length} vs ${reference.tracks.length}`,
    });
    check('time signature matches reference', !!reference.timeSignature && score.timeSignatures.some((ts) => ts.beats === reference.timeSignature.beats && ts.beatType === reference.timeSignature.beatType), {
      note: JSON.stringify(score.timeSignatures[0]),
    });
    check('key signature matches reference', reference.keyFifths == null || score.keySignatures.some((k) => k.fifths === reference.keyFifths), {
      note: `${score.keySignatures[0]?.fifths} vs ${reference.keyFifths}`,
    });
    check('notes match reference (onset+pitch F1)', comparison.overall.onsetPitchF1 >= comparison.thresholds.minF1, {
      note: `F1 ${comparison.overall.onsetPitchF1} via ${comparison.variant} order, threshold ${comparison.thresholds.minF1}`,
    });
    check('pitch sequence matches reference (LCS)', comparison.overall.pitchLcsRatio >= comparison.thresholds.minLcs, {
      note: `LCS ${comparison.overall.pitchLcsRatio}`,
    });
    check('durations mostly match reference', comparison.overall.durationAccuracy >= 0.8, {
      note: `${comparison.overall.durationAccuracy}`,
    });
    check('every note has a page layout point', score.tracks.every((t) => t.notes.every((n) => n.layout && Number.isFinite(n.layout.x))), {});
    check('parse has no warnings', score.warnings.length === 0, { note: score.warnings.slice(0, 3).join(' | ') });

    // ---- Playback ----
    const tempo = 120;
    await page.evaluate((bpm) => {
      const c = window.__smr.controller;
      c.setTempo(bpm);
      c.seek(0);
      window.__smr.engine.clearScheduledLog();
    }, tempo);
    await page.evaluate(() => window.__smr.controller.play());
    const playT0 = Date.now();
    await sleep(2000);
    const fps = await measureFps(page, 800);
    report.perf.playingFps = fps;
    await snap(page, '03-playing');
    const t1 = await page.evaluate(() => window.__smr.engine.getState());
    const elapsedQn = ((Date.now() - playT0) / 1000) * (tempo / 60);
    check('transport is playing and advancing', t1.playing && t1.positionQn > 1 && Math.abs(t1.positionQn - elapsedQn) < 1.5, {
      note: `position ${t1.positionQn.toFixed(2)} qn after ${(elapsedQn).toFixed(2)} qn wall time, ctx ${t1.contextState}`,
    });
    check('audio context running', t1.contextState === 'running', { note: t1.contextState });
    check('playback fps >= 30', fps.fps >= 30, { note: `${fps.fps} fps, longest frame ${fps.longestFrameMs} ms` });

    const log1 = await page.evaluate(() => window.__smr.engine.getScheduledLog());
    const expectedEarly = score.tracks.flatMap((t) => t.notes.filter((n) => n.startQn < Math.max(0, t1.positionQn - 0.5)));
    const scheduledKeys = new Set(log1.map((n) => `${n.trackId}:${n.midi}:${n.qn.toFixed(2)}`));
    const covered = expectedEarly.filter((n) => scheduledKeys.has(`${n.trackId}:${n.midi}:${n.startQn.toFixed(2)}`)).length;
    report.playback.early = { expected: expectedEarly.length, scheduled: log1.length, covered };
    check('scheduled notes match score at playhead', expectedEarly.length > 0 && covered / expectedEarly.length >= 0.95, {
      note: `${covered}/${expectedEarly.length} expected notes scheduled, ${log1.length} total`,
    });
    check('scheduled notes cover every track', score.tracks.every((t) => log1.some((n) => n.trackId === t.id)), {
      note: [...new Set(log1.map((n) => n.trackId))].join(','),
    });

    // Seek while playing.
    const mid = Math.floor(score.durationQn / 2);
    await page.evaluate((qn) => {
      window.__smr.engine.clearScheduledLog();
      window.__smr.controller.seek(qn);
    }, mid);
    const seekT0 = Date.now();
    await sleep(1500);
    await snap(page, '04-seeked');
    const t2 = await page.evaluate(() => window.__smr.engine.getState());
    const expectedPos = mid + ((Date.now() - seekT0) / 1000) * (tempo / 60);
    check('seek while playing moves playhead', Math.abs(t2.positionQn - expectedPos) < 1.5, {
      note: `position ${t2.positionQn.toFixed(2)} qn, expected ~${expectedPos.toFixed(2)}`,
    });
    const log2 = await page.evaluate(() => window.__smr.engine.getScheduledLog());
    check('notes scheduled after seek come from seek region', log2.length > 0 && log2.every((n) => n.qn >= mid - 0.01), {
      note: `${log2.length} notes, min qn ${log2.length ? Math.min(...log2.map((n) => n.qn)).toFixed(2) : 'n/a'}`,
    });

    // Tempo change while playing.
    await page.evaluate(() => window.__smr.controller.setTempo(60));
    const p3a = await page.evaluate(() => window.__smr.engine.getState().positionQn);
    const tempoT0 = Date.now();
    await sleep(1500);
    const p3b = await page.evaluate(() => window.__smr.engine.getState().positionQn);
    const advanced = p3b - p3a;
    const expectedAdvance = ((Date.now() - tempoT0) / 1000) * 1;
    check('tempo change slows playhead', Math.abs(advanced - expectedAdvance) < 0.6, {
      note: `advanced ${advanced.toFixed(2)} qn at 60 bpm, expected ~${expectedAdvance.toFixed(2)}`,
    });
    await snap(page, '05-slow-tempo');

    // Per-track volume and mute.
    const firstTrack = score.tracks[0].id;
    const mix = await page.evaluate((id) => {
      const c = window.__smr.controller;
      c.setTrackGain(id, 0.25);
      const a = window.__smr.engine.getState().tracks.find((t) => t.trackId === id);
      c.setTrackMuted(id, true);
      const b = window.__smr.engine.getState().tracks.find((t) => t.trackId === id);
      c.setTrackMuted(id, false);
      c.setTrackGain(id, 0.8);
      return { a, b };
    }, firstTrack);
    check('track gain is independently adjustable', mix.a && Math.abs(mix.a.gain - 0.25) < 1e-6 && mix.b && mix.b.muted === true, {
      note: JSON.stringify(mix),
    });
    check('transport state lists every track', t2.tracks.length === score.tracks.length, {});

    // Pause.
    await page.evaluate(() => window.__smr.controller.pause());
    const pA = await page.evaluate(() => window.__smr.engine.getState());
    await sleep(700);
    const pB = await page.evaluate(() => window.__smr.engine.getState());
    check('pause stops the playhead', !pA.playing && Math.abs(pA.positionQn - pB.positionQn) < 0.01, {
      note: `${pA.positionQn.toFixed(3)} -> ${pB.positionQn.toFixed(3)}`,
    });
    await snap(page, '06-paused');

    // Offline render: sound exists and per-track volume has an audible effect.
    const offline = await page.evaluate(async (trackId) => {
      const e = window.__smr.engine;
      const rms = (buf) => {
        let sum = 0;
        let n = 0;
        for (let c = 0; c < buf.numberOfChannels; c++) {
          const d = buf.getChannelData(c);
          for (let i = 0; i < d.length; i += 4) {
            sum += d[i] * d[i];
            n++;
          }
        }
        return Math.sqrt(sum / Math.max(n, 1));
      };
      const onsetCount = (buf) => {
        const d = buf.getChannelData(0);
        const win = Math.floor(buf.sampleRate * 0.02);
        let prev = 0;
        let onsets = 0;
        for (let i = 0; i + win < d.length; i += win) {
          let e2 = 0;
          for (let j = i; j < i + win; j++) e2 += d[j] * d[j];
          e2 = Math.sqrt(e2 / win);
          if (e2 > prev * 1.8 && e2 > 0.01) onsets++;
          prev = e2;
        }
        return onsets;
      };
      const all = await e.renderOffline({ fromQn: 0, toQn: 6, tempoBpm: 120, sampleRate: 22050 });
      const solo = await e.renderOffline({ fromQn: 0, toQn: 6, tempoBpm: 120, sampleRate: 22050, trackIds: [trackId] });
      return {
        durationSec: all.duration,
        rmsAll: rms(all),
        rmsSolo: rms(solo),
        onsetsAll: onsetCount(all),
      };
    }, firstTrack).catch((err) => ({ error: String(err) }));
    report.playback.offline = offline;
    check('offline render produces sound', !offline.error && offline.rmsAll > 0.005, { note: JSON.stringify(offline) });
    check('offline render length matches tempo', !offline.error && Math.abs(offline.durationSec - 3) < 0.6, {
      note: `${offline.durationSec?.toFixed?.(2)} s for 6 qn at 120 bpm`,
    });
    check('single-track render differs from full mix', !offline.error && offline.rmsSolo > 0.002 && offline.rmsSolo < offline.rmsAll * 0.98, {
      note: `solo ${offline.rmsSolo?.toFixed?.(4)} vs all ${offline.rmsAll?.toFixed?.(4)}`,
    });
  }

  // ---- UI presence (contract-level, not aesthetic) ----
  const ui = await page.evaluate(() => {
    const q = (sel) => document.querySelector(sel);
    return {
      play: !!q('[data-action="play"], [data-action="toggle-play"]'),
      tempo: !!q('[data-control="tempo"]'),
      seek: !!q('[data-control="seek"]'),
      trackVolumes: document.querySelectorAll('[data-control="track-gain"]').length,
      scoreView: !!q('[data-role="score-view"]'),
      fileInput: !!q('input[type="file"]'),
    };
  });
  report.ui = ui;
  check('ui exposes play, tempo, seek, file input and score view', ui.play && ui.tempo && ui.seek && ui.fileInput && ui.scoreView, {
    note: JSON.stringify(ui),
  });
  check('ui exposes one volume control per track', report.scoreSummary ? ui.trackVolumes === report.scoreSummary.tracks.length : ui.trackVolumes >= 0, {
    note: `${ui.trackVolumes}`,
  });

  report.perf.final = await perfSnapshot(page);
  report.appErrors = await readAppErrors(page);
  const allErrors = [...new Set([...consoleLog.errors, ...report.appErrors])];
  check('zero console errors', allErrors.length === 0, { note: allErrors.slice(0, 3).join(' | ') });
  check('zero failed requests', consoleLog.requestFailures.length === 0, { note: consoleLog.requestFailures.slice(0, 3).join(' | ') });
} catch (err) {
  check('verification script completed', false, { note: err.stack || String(err) });
} finally {
  await browser.close();
}

report.finishedAt = new Date().toISOString();
report.pass = checks.every((c) => c.ok);
report.summary = { passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length };
const file = writeJson(path.join(outDir, 'report.json'), report);
console.log(`\n${report.pass ? 'ALL CHECKS PASSED' : 'FAILURES: ' + report.summary.failed}  -> ${file}`);
process.exit(report.pass ? 0 : 1);
