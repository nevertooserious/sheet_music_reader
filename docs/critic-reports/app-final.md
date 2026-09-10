# App final gate — round 1

**Module:** app (whole product) · **Score: 8.8 / 10 · PASS** · console errors: 0 · verify: 28/28 · comparison F1 1.0 / LCS 1.0 / duration 1.0

Verdict in one line: the app does what the brief asks and I could prove every claim myself — the fixture PDF is read note-for-note (129 + 75 notes, no misses, no extras, no warnings), what the engine schedules is exactly what was parsed, repeats unfold and the playhead loops back to bar 1 on the second pass, each staff is an independently mixable track, playback starts from any bar I click, and tempo changes take effect live. Zero console errors anywhere. What keeps it off 9+ is generalisation risk (one real-world PDF proves the parser) and a handful of polish items, none of which a user would call broken. **Weakest module: parsing** — lowest module score (8.7), the longest issue tail, and the only place where the product's core promise ("actually reads the music") is proven on a single engraving.

## What I ran (verifier and tests unsandboxed; the sandbox kills tsc/vitest silently)

- `node tools/verify/run.mjs --out tools/verify/out/final-gate` — **28/28 PASS**. ready 31 ms (94 ms incl. navigation), parse 234 ms, F1 1.0 via printed order (reference MIDI is not unfolded), LCS 1.0, duration 1.0, 0 parse warnings, playing 61.1 fps (longest frame 16.8 ms), 13/13 expected notes scheduled at the playhead, seek to 96 qn → min scheduled qn 96.00 with 0 held-across entries, tempo 60 → 1.50 qn advanced in 1.5 s, gain 0.25 / mute true read back synchronously, pause froze at 100.685, offline render 3.35 s for 6 qn at 120 bpm with RMS 0.080 (mix) vs 0.058 (track 1 solo), UI attributes present, 0 console errors, 0 failed requests. JS heap 7.6 MB used / 13.2 MB total, 531 DOM nodes.
- `node tools/verify/showcase.mjs ui|parsing|audio --out tools/verify/out/final-gate-<module>` — ui 11/11, parsing 7/7, audio 11/11; every report has `errors: []`, `warnings: []`, `requestFailures: []`.
- `npm run typecheck` — no diagnostics. `npx vitest run` — 26 files / 264 tests passed (970 ms).
- Live session in Chrome (claude-in-chrome extension) at `http://localhost:5173/?autoload=demo` — the extension is blocked on `127.0.0.1` by an ExtensionsSettings policy; `localhost` works. Details below.

## Comparison to the reference MIDI (the number that matters most)

| Ref track | Parsed as | Ref notes | Got notes | F1 | LCS | Duration acc. |
|---|---|---|---|---|---|---|
| one: | Right hand (treble) | 129 | 129 | 1.000 | 1.000 | 1.000 |
| two: | Left hand (bass) | 75 | 75 | 1.000 | 1.000 | 1.000 |

Missing sample: none. Extra sample: none. Time signature 3/4 and key (1 sharp) match. 32 printed measures → 64 timeline segments / 192 qn (both `:|` repeats unfolded). Note: the reference MIDI's 140 bpm lives only in the LilyPond `\midi` block — the PDF prints no tempo — so the parser's 100 bpm is a default, not a misread (see issue 1 for the consequence).

## Live walkthrough (my own hands, real Chrome, real AudioContext)

1. **Load** `/?autoload=demo`: ready, "Menuet in G", chips PAGES 1 · TRACKS 2 · BARS 32 · TIME 3/4 · KEY G major · TEMPO 100 bpm, bar 1 highlighted, mixer shows Right hand (G clef) and Left hand (F clef) at −1.9 dB, transport "bar 1 · beat 1 · 0:00 / 1:55" (192 qn at 100 bpm = 115.2 s — correct).
2. **Play** and watch ≥10 s: after 4 s "bar 3 · beat 1 · 0:04" with the playhead on the E5 and the LH dotted half; after 10 s "bar 6 · beat 2 · 0:10", follow-scroll had moved to system 2, the highlight sat on the second RH note of bar 6 and the LH half. Engine: `playing true, ctx running, positionQn 6.82 → 17.02`, meters 0.075 / 0.085. Scheduled log vs score at 17 qn: **33/33 expected notes scheduled, 34 logged, 0 not in the score**, first entries D5@0 (0.6 s), G4@1, A4@1.5, B4@2, LH G3+B3@0 (1.2 s) — exact for 100 bpm.
3. **Click bar 9** while playing → `positionQn 25.85` one second later (bar 9 starts at 24 qn), highlight and playhead on bar 9.
4. **Tempo drag** on the transport slider: 100 → 193 bpm, UI value 193, playhead rate followed (a 26-px drag is a lot of bpm — issue 5). Also 60 and 120 bpm via the verifier: total time re-computed to 3:12 and 1:36.
5. **Mute Left hand** (M button): `track-2 muted true, level 0`, strip dimmed; **drag Right hand fader**: gain 0.8 → 0.48 (−6.4 dB) read back synchronously; Right hand still metering.
6. **Repeat pass**: at 0:29 the readout was "bar 1 · beat 2" with the playhead back in bar 1 — the first `:|` at bar 16 was honoured (49.34 qn). Later the session reached bar 19 at 104.24 qn on the second half — the correct order.
7. **Pause / resume**: pause froze at 49.438 for 700 ms with meters at 0; resume continued (52.74 two seconds later), `ctx running`.
8. **End of score**: seek to 189 qn and play → `playing false, positionQn 192`, readout "bar 32 · beat 3 · 1:55 / 1:55", seek slider at max, bar 32 highlighted. No error.
9. **File picker**: uploaded `fixtures/bach-minuet-g/score.pdf` through the hidden `input[type=file]` → status ready, fileName "score.pdf", 258 + 150 timeline notes, 192 qn, mix reset to 0.8/0.8 — identical to the demo. Uploaded `source.ly` (not a PDF) → red banner "source.ly" is not a PDF. Only PDF sheet music is supported.", previous score kept, transport still enabled, no error state, no console error.
10. **Console**: `read_console_messages(onlyErrors)` empty on four reads; `window.__smr.errors` `[]` throughout.
11. **Audio quality by numbers** (offline render 0–48 qn at 100 bpm, 44.1 kHz, explicit trackIds = unity fader gain): mix peak −6.6 dBFS, RMS −22.1 dBFS, crest 15.5 dB, 0 clipped samples, max sample-to-sample step 0.064 (no clicks), DC 0, no silent 10 ms windows; Right hand alone −9.3 / −24.4, Left hand alone −9.8 / −26.3; 70 of 72 score onsets visible as ≥15 % envelope rises.
12. **Robustness I did not plan**: while the extension ran JS the tab was `visibilityState: hidden` and rAF stopped for 19.6 s — the audio clock advanced exactly 34 qn at 100 bpm and the UI caught up on the next frame. The Worker-clock fix from audio round 1 works in the real thing.

Live-session caveats: the extension renders an emulated 3127×1172 viewport into a smaller window so several coordinate-based drags missed and had to be repeated by ref; an rAF-based fps probe hung because the tab was hidden — the fps figures above are puppeteer's (61 fps app, 60–63 showcases).

## Screenshots studied

`tools/verify/out/final-gate/`: 01-loaded, 02-parsed, 03-playing, 04-seeked, 05-slow-tempo, 06-paused — empty state with drop zone and disabled transport; parsed score with chips, bar-1 highlight and note rings on D5 and the LH chord; playing "bar 2 · beat 3 · 0:02 / 1:36" at 120 bpm with live meters and peak-hold; seeked to bar 18 (second half, 0:49) with the highlight on the correct system; tempo 60 → "1:40 / 3:12"; paused with meters dropped and play icon restored.

`tools/verify/out/final-gate-ui/` 01–11: drop overlay; demo excerpt with 3-warning chip; playhead at bar 3 beat 2; track 2 muted amber and track 1 at −8.0 dB; tempo 140 → 0:20 total; seek to bar 6 by click with follow-scroll; warnings popover with three readable sentences; error banner "Could not read corrupt-download.pdf: the download is empty (0 bytes)" with Retry while the old score stays; 24-page / 6-track orchestral mock at bar 97 with six strips (names "Clarinet …" and "Double …" truncated); scanned PDF rejected with a clear card and "Try again / Open another PDF".

`tools/verify/out/final-gate-parsing/` 01–07: page rendered with fonts (Emmentaler-20/-Brace/-14; TeXGyreSchola/DejaVu as text); 12 staves in 6 systems, 39 barlines; glyph counts (204 heads, 28 dots, 17 accidentals, 12 clefs, 5 rests, 4 digits, 1 flag); every bar labelled with pitches; measure numbers 1–32 with `16 :|`, `17 |:`, `32 :|` and play order; comparison card "TARGET MET"; synthetic volta/tie/triplet page with play order 1 2 3 4 1 2 5 6.

`tools/verify/out/final-gate-audio/` 01–11: idle (context none, hollow piano-roll); playing with worker clock, 9 logged notes, spectrum alive; seek to bar 5 with log at 12.00; tempo 160 with 188/375/750 ms durations; track 2 muted → −inf; track 1 solo; paused with flat scope; resumed inside the opening chord (four qn-0 entries, 833/278 ms remaining); offline waveform (−21.8 dBFS RMS, peak −8.4, 6 of 8 onsets by the heuristic); piano vs strings centroids 1060 vs 1714 Hz; stopped at 0.

## Contract check

No violations found. `play()` resolves and starts the context (`ctx running`); `getState()` reflected gain/mute/tempo/seek synchronously in every probe; `getScheduledLog().qn` equals the notes' `startQn` (34/34 entries matched score notes); `renderOffline` length = range + tail (29.15 s for 28.8 s of music; 3.35 s for 3.0 s); explicit `trackIds` render at fader gain ignoring mute; parse rejects non-vector input with a sentence (raster card in the ui showcase); the UI touches only `AppStore`/`AppController`; `#app[data-status="ready"]` and `window.__smr` present in every mode. `Measure.volta` is populated by the parser (integration glue) but unread by the UI — not a violation, an unused field.

## Ranked issues (none blocking; all minor)

1. **parsing — A missing tempo mark is filled in silently.** The fixture prints no tempo; the parser defaults to 100 bpm and emits **zero** warnings, so the header chip "TEMPO 100 bpm" presents a guess as a fact (the reference MIDI is 140). The parsing showcase itself says "100 bpm (default, no tempo mark found)" — the app never does. Fix: emit a warning ("no tempo mark found; defaulting to 100 bpm") or add a `tempoSource: 'score' | 'default'` flag so the UI can label the chip. Evidence: `final-gate/report.json` `scoreSummary.tempoBpm 100`, `warnings []`; `reference.tempoBpm 140`; `fixtures/bach-minuet-g/source.ly` line 143 (`\midi { \tempo 4 = 140 }`).
2. **parsing — The product's core promise is proven on one engraving.** Everything the verifier measures comes from a single one-page LilyPond/Emmentaler score with durations of 3/2/1/0.5 qn only, no tuplets, no voltas, one grace note. SMuFL fonts (MuseScore/Finale/Sibelius) and voltas/tuplets/ties across breaks are exercised only on synthetic pages, and the builder's disclosed limits stand (ottava lines ignored without warning; a "3" over three beamed notes with no time signature is a triplet; mid-piece single-staff short bars truncated). Fix: add a second public-domain fixture engraved with MuseScore (SMuFL) plus reference MIDI to `fixtures/` and `run.mjs`, and a multi-page one.
3. **audio — The mix leaves 12 dB on the table.** Unity mix renders at −22.1 dBFS RMS (peak −6.6); the master "limiter" is tuned as a wide-knee compressor (audio-round2 issue 1). Users will reach for the system volume. Fix: raise the make-up gain / re-tune the compressor as a true peak limiter and target about −16 dBFS RMS at unity. Evidence: my offline render 0–48 qn, 44.1 kHz; the round-2 audio report.
4. **ui — No repeat-pass indicator, and `Measure.volta` unused.** On the second pass the readout says "bar 1 · beat 2 · 0:29"; only the playhead jumping back tells the user why. The audio showcase already prints "2nd time"; the app should too, and alternative endings (`Measure.volta`, populated by the parser since integrate 2) should be labelled/dimmed by pass. Evidence: live session at 49.34 qn; `docs/integration-notes.md`.
5. **ui — Tempo slider is short and coarse; mixer strip names truncate.** A 26-px drag moved 100 → 193 bpm (the number box is the only precise path); in the six-track orchestral scene the strips read "Clarinet …" and "Double …" with no tooltip. Fix: widen the tempo slider or give it a log scale with 1-bpm steps; show full names on hover/title. Evidence: live session; `final-gate-ui/10-orchestral-score-…png`.
6. **core/audio — Silence has no explanation.** `play()` resolves (documented) when the AudioContext cannot reach `running`, so a user on a browser that blocks audio sees the transport "playing" nothing; and after a failed parse the engine keeps the previous score (no `unload()`). Fix: surface `contextState` in the transport ("audio blocked — click to enable") and add `unload()`. Evidence: `src/core/contracts.ts` play() doc; integrator's remaining issues.
7. **ui — Carried-over minors not re-verified here:** follow mode overrides manual scrolling during playback; sub-900 px layout squeezes the score view; render-failure pages are never retried (ui-round2). Recorded in `docs/STATUS.json`.

## Strengths

- Note-for-note correctness on the fixture, proven three ways (verifier, parsing showcase, my live log check): F1 1.0 / LCS 1.0 / duration 1.0, 0 missing, 0 extra, 0 warnings, 234 ms parse.
- Every feature in the brief works by hand: independent per-track gain/mute/solo with honest meters; play from any bar by clicking it, the seek slider, or while playing; live tempo change with the total time re-computed and the playhead rate following.
- Repeats unfold correctly (64 segments / 192 qn) and the UI follows the pass; end of score stops cleanly at 192 qn.
- Import paths are all real: drag overlay, picker upload (parsed identically), non-PDF banner that keeps the current score, raster PDF card with a clear sentence, corrupt download banner with Retry.
- Zero console errors, warnings or failed requests across the verifier, three showcases and a long interactive session; 61 fps while playing, 7.6 MB heap, 531 DOM nodes.
- Clean audio: no clipping, no clicks (max sample step 0.064), no DC, tails released, 70/72 onsets articulate; the Worker scheduler kept exact time through a 19.6 s rAF suspension.
- Honest engineering culture: every module's critic report cites its own measurements, change requests went through the integrator, and the integration changed three lines of module code and documented them.

## Where the next iteration should start

**parsing.** It has the lowest module score (8.7), the two top-ranked issues here (silent tempo default; single-fixture proof), and the most disclosed heuristic limits. Concretely: (1) warn on a defaulted tempo, (2) add a SMuFL (MuseScore) public-domain fixture with reference MIDI to the verifier, (3) warn on ottava lines. Then ui for the pass indicator and `Measure.volta`, then audio for the mix level.
