# Critic report — parsing, round 2

Score: **8.3 / 10** — Pass: **no** (threshold 8.5). Console errors: 0. Contract violations: 0. Rule violations: 0.

Verdict in one line: every round-1 issue is genuinely fixed and regression-tested, the fixture is still
perfect, the contract holds and the showcase is polished — but the two new detectors (tuplets, voltas)
plus the key-signature reader each have a confirmed failure on ordinary engraved input that produces
wrong rhythm, a wrong key or a wrong play order, and one of them (fingering digits read as tuplets) is a
regression that silently corrupts bar 1 of any fingered piano edition. Not yet something I would put in
front of paying users.

## What I ran (sandbox disabled, as the brief requires)

| Command | Result |
| --- | --- |
| `OPENSSL_CONF=/dev/null npm run typecheck` | 0 errors (whole repo). |
| `npm test` | 23 files, **223 tests, 223 passed** (parsing: 15 probe tests + 60 others incl. the real-PDF Node integration test). |
| `node tools/verify/showcase.mjs parsing --out tools/verify/out/critic-parsing-r2` | SHOWCASE OK, **6/6 steps, 0 console errors, 0 warnings, 0 failed requests**, 32 fps (headless cap), longest frame 33.5 ms, heap 6.4 MB. |
| `npm run verify` (full app) | **28/28 checks pass**: F1 1, LCS 1, duration 1, "parse has no warnings", zero console errors. |
| `git status --short`, `git diff --stat` | Changed by this module: `src/parsing/**`, `docs/core-change-requests.md`, `docs/STATUS.json`. `src/audio/**` changed concurrently (wave-2 sibling, expected). Nothing else. |
| Puppeteer script (`scratchpad/probe-showcase.mjs`) | DPR-2 zooms, 900×700 resize, out-of-order steps, `runStep(9)`, and `window.__smr.parser` contract probes in the real app. Results in `tools/verify/out/critic-parsing-r2/zoom/probe-results.json`. |
| 16 synthetic analyzer probes (vitest, `scratchpad/probes/*.probe.test.ts`, LilyPond-like geometry, same helper conventions as the builder's `analyze.probes.test.ts`) | 11 pass, **5 fail** — see "Robustness probes". |

## Numbers (from the reports, not from the builder)

`tools/verify/out/critic-parsing-r2/report.json` diagnostics:

- Fonts Emmentaler-20/-Brace/-14 · 282 glyphs, 653 paths, 17 text runs, 0 images · 12 staves, 6 systems, 32 measures × 3 qn, 3/4 from m.1, 1 sharp from m.1
- Repeats m.16 `:|`, m.17 `|:`, m.32 `:|` → 64 segments, 192 qn; `unfoldRepeats:false` → 32 segments, 96 qn (my probe)
- 204 printed heads → 258 + 150 events, 1 grace, 5 rests, 0 voltas, 0 tuplets, 12 key accidentals, 5 note accidentals, 0 ignored
- **Comparison (printed order): onset+pitch F1 1.0000, pitch LCS 1.0000, duration accuracy 1.0000; 129/129 and 75/75 notes, 0 missing, 0 extra. Warnings: 0.** Targets (F1 ≥ 0.95, LCS ≥ 0.97) met with full margin; independently reproduced by `npm run verify` and by the Node integration test.

Performance: parse 187–190 ms cold in the showcase, 81 ms first parse in the app tab, 72–81 ms on five warm parses; `renderPage(0, canvas, 2)` 39 ms for a 1191×1684 bitmap; heap 19.5 MB after 8 parses in the app tab (6.4 MB in the showcase). Each showcase step settles in ≈1.0 s.

## Contract check (`src/core/contracts.ts` → `src/parsing/index.ts`), verified in Chrome

- `parse(nonPdf)` → `"notes.txt" is not a valid PDF file.`; `parse(empty)` → same sentence. Legacy-font page (unit test) → `"old.pdf" uses the music font "Maestro", which is not supported yet (Emmentaler and SMuFL fonts are).`; image-only page → `This PDF looks scanned; …`. All complete sentences.
- `onProgress`: 0.02 Opening PDF → 0.05 Reading page 1 of 1 → 0.55 Classifying glyphs → 0.6 Detecting staves and systems → 0.7 Reading notes → 0.85 Building timeline → 0.95 Assembling score → 1 Done. Non-decreasing; the duplicate "Done" from round 1 is gone.
- `pages` = `[{0, 595.28 × 841.89}]`; `renderPage` sets bitmap only (`canvas.style.width/height` stay empty); `renderPage(7)` → `Page 8 does not exist`; after `dispose()` → `Document disposed`; double dispose is a no-op; the caller's `ArrayBuffer` is not detached.
- ScoreModel: 408 notes, every note has a finite `layout`, all durations > 0, none runs past `durationQn`, ids unique, one layout box per staff on every measure, timeline contiguous. 2 grace events are filed under the previous bar (documented convention + open core request).
- Imports: `../core/types`, `../core/contracts`, `pdfjs-dist` only. `midi-file` is no longer imported anywhere in `src/parsing` (self-contained SMF reader in `midiReference.ts`). `Showcase` implements `name/steps/runStep/getDiagnostics`; `runStep(9)` rejects with `No step 9`.

No contract violations. No rule violations.

## Screenshots studied

Verifier run (1400×1000, DPR 1), `tools/verify/out/critic-parsing-r2/`:

1. `00-initial.png` / `01-page-rendered.png` — page rendered, Parse facts, "Clean parse: no warnings". Fine.
2. `02-staves-and-systems.png` — 12 staves coloured per track, purple system brackets, badges now right-aligned and clear of the printed bar numbers 6/11/17/22/27 (round-1 issue 9a fixed).
3. `03-glyphs-classified.png` — clefs, key accidentals (white) vs note accidentals (yellow) vs ignored (red, none), rests, stems, beams, head rings; count table. Matches the label.
4. `04-notes-with-pitches-and-durations.png` — every head labelled; durations histogram; "Tuplets: none found"; key/time/tempo. Matches the label.
5. `05-measures-repeats-and-timeline.png` — bar badges 1–32, thin green barlines, red repeat barlines at 16/17/32, "Volta brackets: none found (plain repeats)". Matches the label.
6. `06-comparison-to-reference-midi.png` — TARGET MET badge on the page and the per-track table in the panel. Matches the label.

My own (DPR 2 unless noted), `tools/verify/out/critic-parsing-r2/zoom/`:

- `z1-step4-systems-1-2-dpr2.png` — LH chord labels G3/B3/D4 now stacked and legible (round-1 9b fixed); pitch labels correct for bars 1–10. Adjacent eighth-note labels still touch/overlap horizontally in dense groups (cosmetic).
- `z2-step4-systems-5-6-dpr2.png` — bars 22–32: F#5, C#5, C#4, C4 natural, F#3, two-voice bars with rests boxed; all correct.
- `z3-step2-system-badges-dpr2.png` — badges at the right edge, bar numbers 6/11 untouched.
- `z4-step3-glyphs-systems-3-4-dpr2.png` — overlay aligned to the engraving; the two C# note accidentals boxed yellow.
- `z5-step5-measures-systems-3-4-dpr2.png` — barlines/repeats aligned; badge text legible.
- `z6-narrow-900x700-step4.png` (DPR 1) — after a viewport change, page div, canvas CSS box, canvas bitmap and overlay are all 446×631 and the overlay lines up with the page (round-1 9c fixed). Restoring 1400×1000 at DPR 2 gives 666×942 CSS with 1333×1884 / 1332×1884 bitmaps (1 px rounding difference between canvas and overlay, invisible).
- `z7-step6-panel-dpr2.png` — comparison panel crisp and well organised.
- `z8-step6-badge-dpr2.png` — on-page badge below the last system, not covering music.

## Robustness probes (my synthetic pages through `analyze()`)

| Probe | Result |
| --- | --- |
| P1. Bar 2 opens with the chord ⟨F♯4 C♯5⟩ carrying both sharps (packed, fifths order), bar 3 has a plain F4 | **FAIL** — `keySignatures = [{0,0},{1,2}]`, bar-3 F4 → F♯ (66). The two chord accidentals are read as a D-major key signature. |
| P2. Four beamed eighths + half in 4/4, small Emmentaler digit "3" (a fingering) above the 3rd note | **FAIL** — tuplet 3:2 applied to all four eighths, half note starts at 1.333, **measure 1 silently shortened to 3.333 qn, 0 warnings** (the new pickup rule accepts it). Digits 4 and 5 → 3.5 / 3.6 qn bars, also silent; digit 2 → duplet, overfilled, proportional + warning. |
| P3. Tie broken across a system break (half-arc at line end, half-arc at line start) | **FAIL (known-class)** — both notes re-attacked (`[71 8 4] [71 12 4]` instead of `[71 8 8]`). Not listed in the builder's known gaps. |
| P4. Tied two-note chord (two arcs) | pass — both voices merge. |
| P6. G major → F major after a barline (♮ on F, ♭ on B) | **FAIL** — key stays 1♯; the natural is ignored with a warning, the flat attaches to the B as a note accidental, bar-3 F5 → F♯. `readKeyGroups` validates cancellation naturals against `state.fifths` from the *start of the system*, which is 0 on the first line. |
| P7. Two-page score | pass — 2 systems, state carried, `layout.page` 0/1/1. |
| P8. Two flats, treble | pass. |
| P9. One sharp, bass clef (F line) | pass. |
| P16. Courtesy `clefs.F_change` at a line end + real F clef on the next line | pass. |
| P18. 6/8, dotted quarter + three beamed eighths | pass. |
| P22. Courtesy key signature (2♯) at a line end | pass — `[{0,0},{3,2}]`, no warning (closes the builder's "no dedicated test" gap). |
| P26. 1st ending that starts on line 1 and continues (numberless bracket, `:|`) on line 2, 2nd ending on line 2 | **FAIL** — play order `[0,1,2,0,2,2,3,4]` instead of `[0,1,2,0,3,4]`: the continuation bar has no volta, `buildTimeline` treats it as "past the last ending", resets, and replays it twice. |
| Builder's own probes (slur G-A-B-G, tie across barline, tie over a moving voice, clef change carried, split staff lines, small floating sharp, Maestro font, pickup bar, stemless second, beam triplet, bracket triplet, volta) | all pass in `npm test`; geometry matches my round-1 probes. |

## Ranked issues

1. **[major] Fingering digits over a beam are read as tuplet numbers, and the new pickup rule then hides the damage.** `detectTuplets` (tuplets.ts, beam branch) accepts any small digit within 2.5 sp of a beam's centre and 4 sp above/below it; LilyPond fingerings are small Emmentaler digits placed exactly there on the inner notes of beamed groups. Probe P2: "3" over the 3rd of four eighths → 3:2 applied to all four, half note shifted to 1.333, and because `shortAgreed && index === 0` (analyze.ts ≈1041–1050) the bar is silently shortened to 3.333 qn with **no warning**; "4"/"5" give 3.5/3.6-qn bars, also silent. Every fingered piano edition — the product's core repertoire — is exposed. Fix: (a) accept a beam-only tuplet (no bracket) only if the measure does not assemble exactly without it *and* does assemble exactly with it (try without first; keep the label only when it repairs the fit); (b) require a tuplet number to be centred on the beam within ~0.6 sp *and* not centred on a head (fingerings sit over one head); (c) in the pickup rule, require the short total to lie on the beat grid (a multiple of `4/beatType` qn, or at least of 0.125 qn) — 3.333 must warn. Add regression tests for digits 2–5 over a 4-eighth beam.
2. **[major] A chord whose accidentals happen to be in circle-of-fifths order at a bar start is read as a key change.** `readKeyGroups` (analyze.ts 353–418) only applies the "head on its step right after" test when the group has one glyph. Probe P1: ⟨F♯4 C♯5⟩ with both sharps 2–3 sp after the barline → `fifths 2` from that bar, every later F and C sharpened. Fix: for region/courtesy anchors (not clef anchors), reject the group when *every* glyph has a head on its own step within 2.2 sp to the right of the group (a chord's accidentals), or when any glyph of the group vertically overlaps a head cluster within 2.5 sp. Add a test.
3. **[major] Volta brackets that continue onto the next line break the unfolding.** LilyPond/MuseScore print the continuation of a 1st ending on a new line without the number; `detectVoltas` needs a hook + number, so the continuation bar gets no `volta`, and `buildTimeline` (timeline.ts, `pass > 1 && !m.volta && prevVolta`) treats it as "past the last ending", resets the section and replays it: probe P26 gives `[0,1,2,0,2,2,3,4]` for a 5-bar piece (should be `[0,1,2,0,3,4]`). Fix: (a) in `analyze`, when a system's first bracket-like line starts at `system.x1 ± 2 sp` and the previous system's last volta reached `system.x2 − 1 sp`, inherit its numbers (no hook/number required); (b) in `buildTimeline`, extend a volta's numbers over following unlabelled measures up to and including the next `repeatEnd`. Add a two-line volta test.
4. **[minor] Key changes with cancellation naturals in the same system as the previous key are rejected.** `readKeyGroups` receives `prevFifths = state.fifths` from before the system (0 on the first line), so a ♮ that cancels a sharp printed earlier on the same line fails `prevDegrees.has(degree)` and the whole group is dropped (probe P6: G major → F major becomes "accidental ignored" + wrong F♯ in bar 3). Fix: update `prevDegrees` from each accepted group as anchors are processed left to right (running key within the staff pass). Add a test.
5. **[minor] Ties broken across a system break are not merged.** Both half-arcs have only one end near a head, so `detectTies` drops them and the note is re-attacked (probe P3). Fix: treat a half-arc whose right end lies within 1.5 sp of `staff.x2` as an "open tie" on that head, and a half-arc whose left end lies within ~6 sp of the next system's `x1` as its continuation; merge when the first head of the next system on the same staff index has the same step. Add to the known-gaps list if deferred.
6. **[minor] Pickup-bar acceptance is too permissive on single-staff scores.** `shortAgreed` is trivially true with one staff, so *any* under-filled first bar (missed beam, misread tuplet, lost head) is silently accepted as an anacrusis and shortens the piece. See issue 1(c): require an on-grid total and, for one-staff scores, a total ≤ half the nominal bar or equal to a whole number of beats.
7. **[minor] Showcase polish.** (a) Adjacent eighth-note labels in dense groups overlap horizontally at 1400 px (z1: "G4 A4 B4 C5"); alternate label rows above/below for neighbours closer than the label width. (b) Overlay and canvas bitmaps differ by 1 px at DPR 2 (1332 vs 1333) — use the same rounding for both. (c) The volta/tuplet overlays and panel rows are never exercised by the fixture; consider a second scene (synthetic page with a volta and a triplet run through `analyze`) so the verifier screenshots those code paths too.

## Strengths

- All ten round-1 issues are closed with real code changes and regression tests that reproduce the critic's geometry; my independent re-probes of the fixed behaviours (tie/slur, clef carry, split staff lines, key vs floating accidental, Maestro error, pickup, stemless second, courtesy key, courtesy clef, multi-page) all pass.
- Fixture result is still perfect and proven three ways (showcase, full app verify, Node integration test): F1 1.0, LCS 1.0, duration 1.0, 0 warnings, 0 console errors.
- Contract honoured in every probe: sentence-form errors, monotonic progress with no duplicate stage, bitmap-only `renderPage`, cancellation, dispose semantics, `unfoldRepeats`, caller buffer intact, unique ids, contiguous timeline.
- Architecture stays clean: pure, unit-tested modules (`staves`, `rhythm`, `timeline`, `repeats`, `tuplets`, `pitch`, `durations`), pdf.js confined to `index.ts`/`pdfPage.ts`, no `midi-file` import, no cross-module imports.
- Showcase is a genuinely useful tutorial and now survives resize/DPR changes; badges, stacked chord labels and the on-page comparison badge are all legible at DPR 2.
- Honest builder report: known gaps are listed, deviations from the critic's suggestions (25 sp tie cap, grace filing) are argued rather than hidden, and the grace-note convention and `Measure.volta` are written up as core requests.

## Why 8.3 and not 8.5

Progress since round 1 is real and verified, hence the higher score. But the bar for "ship it" is that
ordinary engraved input does not come out musically wrong without a warning, and round 2 introduces one
regression that does exactly that on fingered piano scores (issue 1), while two further confirmed cases
(issues 2 and 3) transpose the rest of a piece or corrupt the play order. Each is a contained fix in the new
code; with them and the running-key fix (issue 4) this module is above the bar.
