# Critic report — parsing, round 3

Score: **8.4 / 10** — Pass: **no** (threshold 8.5). Console errors: 0. Contract violations: 0. Rule violations: 0.

Verdict in one line: all seven round-2 issues are genuinely fixed and independently re-verified (my 16 round-2
probes now pass, the fixture is still perfect three ways, the contract holds in every probe, the new synthetic
step and the render-race fix both work), but the pickup rule was tightened past the point of correctness for
single-staff scores — an ordinary eighth-note anacrusis now plays with a 2.5–3.5 beat hole after it — and the
step-4 tutorial overlay stacks a quarter of its pitch labels onto the wrong system's notes. Very close, not yet
something I would put in front of paying users.

## What I ran (sandbox disabled, as the brief requires)

| Command | Result |
| --- | --- |
| `OPENSSL_CONF=/dev/null npm run typecheck` | 0 errors. |
| `npm test` | 25 files, **246 tests, 246 passed** (parsing: 15 round-3 tests, 15 probe tests, fixture test through pdf.js in Node). |
| `node tools/verify/showcase.mjs parsing --out tools/verify/out/critic-parsing-r3` | SHOWCASE OK, **7/7 steps, 0 console errors, 0 warnings, 0 failed requests**, 62–64 fps, longest frame 16.8 ms, heap 7.6 MB, parse 190 ms. |
| `npm run verify` (full app) | **28/28 checks pass**: F1 1, LCS 1, duration 1, no warnings, 60.3 fps playback, zero console errors. |
| `git status --short`, `git diff --stat` | Parsing changed `src/parsing/**` only; `docs/STATUS.json`, `docs/core-change-requests.md` (audio entries added; parsing entries unchanged from round 2) and `src/audio/**` changed concurrently (wave-2 sibling). Nothing else. |
| Round-2 critic probes (`scratchpad/probes/critic.probe.test.ts` + `extra.probe.test.ts`, 16 tests) | **16/16 pass** against the current `src/parsing` (5 failed in round 2). |
| Round-3 critic probes (`scratchpad/probes/r3.probe.test.ts`, 12 synthetic pages) | Results in "Robustness probes". |
| Real-geometry dump (`scratchpad/probes/geometry.probe.test.ts`, the fixture PDF through pdf.js) | Clef right edge 3.3 sp, key-signature right edge 5.35 sp, first head 8.5 sp (min) from `staff.x1` on systems 2–6; key-right → first-head 3.15 sp (min). |
| Label-grouping replay (`scratchpad/probes/labels.probe.test.ts`) | Replays `showcase.ts drawNotes` chord grouping on the fixture: **39 of 149 groups contain notes from 2–4 different systems**. |
| Puppeteer driver (`scratchpad/r3-critic.mjs`, `r3-critic2.mjs`) | DPR-2 zooms, deliberate scene-switch race, 900×700 resize, out-of-order/invalid steps, contract probes via `window.__smr.parser`. Results in `tools/verify/out/critic-parsing-r3/zoom/critic-results.json`. |

## Numbers (from the reports, not from the builder)

`tools/verify/out/critic-parsing-r3/report.json` diagnostics:

- Fonts Emmentaler-20/-Brace/-14 · 12 staves, 6 systems, 32 measures × 3 qn, 3/4 and 1 sharp from m.1
- Repeats m.16 `:|`, m.17 `|:`, m.32 `:|` → 64 segments, 192 qn; `unfoldRepeats:false` → 32 segments, 96 qn (my probe)
- 204 printed heads → 258 + 150 events, 1 grace, 5 rests, 0 voltas, 0 tuplets, 12 key accidentals, 5 note accidentals, 0 ignored
- **Comparison (printed order): onset+pitch F1 1.0000, pitch LCS 1.0000, duration accuracy 1.0000; 129/129 and 75/75, 0 missing, 0 extra, 0 warnings.** Targets (F1 ≥ 0.95, LCS ≥ 0.97) met with full margin; reproduced by `npm run verify` and by the Node fixture test.
- Synthetic step: 4 measures, voltas [1],[2] on m.2/m.3, tuplet 3:2, play order 0 1 0 2 3, 15 qn, 12 notes, 0 warnings, analyze 1 ms.

Performance: parse 190–201 ms cold in the showcase, 84 ms first parse in the app tab, 71–75 ms on five warm parses; `renderPage(0, canvas, 2)` 20 ms for a 1191×1684 bitmap; heap 7.6 MB in the showcase, 18.4 MB after 8 parses in the app tab; every step settles in ≈0.95 s; 62–64 fps.

## Contract check (`src/core/contracts.ts` → `src/parsing/index.ts`), verified in Chrome

- `parse(nonPdf)` → `"notes.txt" is not a valid PDF file.`; `parse(empty)` → same sentence. Legacy-font and raster errors covered by unit tests.
- `onProgress`: 0.02 Opening PDF → 0.05 Reading page 1 of 1 → 0.55 → 0.6 → 0.7 → 0.85 → 0.95 → 1 Done; monotonic, no duplicate stage.
- `pages` = `[{0, 595.28 × 841.89}]`; `renderPage` sets bitmap only (`style.width/height` empty); `renderPage(7)` → `Page 8 does not exist`; after `dispose()` → `Document disposed`; double dispose no-op; caller's buffer intact.
- ScoreModel: 408 notes, every note has finite `layout`, all durations > 0, none past `durationQn`, ids unique, one layout box per staff on every measure, timeline contiguous, `firstStartQn` equals the first timeline occurrence, `defaultGain` 0.8, tempo 100 (no mark).
- Imports: `../core/types`, `../core/contracts`, `pdfjs-dist` only; no `src/ui` or `src/audio` import. `Showcase` implements `name/steps/runStep/getDiagnostics`; `runStep(9)` → `No step 9`, `runStep(-1)` → `No step -1`.

No contract violations. No rule violations.

## Screenshots studied

Verifier run (1400×1000, DPR 1), `tools/verify/out/critic-parsing-r3/`:

1. `00-initial.png` / `01-page-rendered.png` — page rendered, Parse facts, "Clean parse: no warnings". Fine.
2. `02-staves-and-systems.png` — 12 staves coloured per track, purple system brackets, right-aligned badges. Fine.
3. `03-glyphs-classified.png` — clefs, key vs note accidentals, rests, stems, beams, head rings; counts table. Matches the label.
4. `04-notes-with-pitches-and-durations.png` — labels now alternate rows; but stacks of 2–4 labels sit on lone notes at the start of systems 2 and 6 and above bar 1, and the top row collides with the composer attribution (see issue 2).
5. `05-measures-repeats-and-timeline.png` — bar badges 1–32, thin green barlines, red repeat barlines at 16/17/32. Fine.
6. `06-comparison-to-reference-midi.png` — TARGET MET badge and per-track table. Fine.
7. `07-voltas-and-tuplets-on-a-synthetic-page.png` — synthetic 3/4 line with volta 1/volta 2 brackets drawn over the printed ones, dashed 3:2 box over the beamed triplet, bar badges under the voltas moved below the staff, panel table per bar. Does what it says; the "4" badge touches the "E5" label and the stage is ~80 % empty at the 2.2× cap.

My own, `tools/verify/out/critic-parsing-r3/zoom/`:

- `c1-step4-systems-1-2-dpr2.png` — "G5 E5 B4" stacked over the lone B4 quarter that opens bar 6; "G5 G4 G4" over bar 1's G4; bar 6's LH dotted half has no label. Also softer than c5: bitmap was still 667×942 for a 666-px CSS box at DPR 2 (issue 6).
- `c2-step4-systems-5-6-dpr2.png` — "B3 C4 G3" stacked under bar 27's first LH note; several bars 22–26 RH eighths without labels.
- `c3-step7-synthetic-dpr2.png` — synthetic page crisp at DPR 2 (1892×757 bitmap = overlay); brackets, triplet box, badges legible.
- `c4-step7-panel-dpr2.png` — panel table clean.
- `c5-step5-after-race-dpr2.png` — after firing runStep(0/6/3/6/4) without awaiting, the fixture canvas is intact (1333×1884, dark fraction 7.3 %, no garbage). Race fix confirmed.
- `c6-narrow-synthetic.png` / `c7-narrow-step4.png` (900×700, DPR 1) — page, canvas, overlay all 446×178 / 446×631 CSS; bitmaps 446×179 / 447×631 (canvas = overlay). Alignment holds.
- `c8-step4-systems-3-4-dpr2.png` — bars 18–21 mostly unlabelled (their labels were stacked onto earlier systems); bar 12 LH labels jumbled.
- `c9-step4-system-1-header-dpr2.png` — "A4 G4 G5" and "C#5 F#4" stacks printed over "attributed to Christian Petzold (1677-1733)".

## Robustness probes (my synthetic pages through `analyze()`, LilyPond-like geometry, sp = 6)

| Probe | Result |
| --- | --- |
| R3-A. Single staff, 4/4, eighth-note anacrusis, full bar, complementary 3.5-qn last bar | **FAIL** — measures `[4,4,4]`; pickup at 0 then silence to 4.0; last bar padded to 4; two warnings. Should be `[0.5,4,3.5]`. |
| R3-B. Single staff, 3/4, eighth-note anacrusis | **FAIL** — `[3,3]`, 2.5-qn hole after the pickup, warning. |
| R3-C. Single staff, dotted-quarter + eighth (2 beats) anacrusis | pass — `[2,4]`, no warning. |
| R3-D. Piano (2 staves), eighth-note anacrusis on both | pass — `[0.5,4]`. |
| R3-L. Piano, RH eighth pickup, LH eighth rest | pass — `[0.5,4]`. |
| R3-E. 4/4 bar: real beamed triplet ("3") + fingering "2" centred over another beamed 3-group + eighth + quarter | **FAIL (disclosed)** — both candidates rejected together, bar sums to 4.5, proportional onsets, warning. |
| R3-F. No time signature, fingering "3" centred over three beamed eighths | **FAIL (disclosed)** — read as a triplet. |
| R3-H. Quarter pickup, full bar, short last bar (3 qn) holding a beamed triplet + half | **FAIL** — triplet not applied (`plain` 3.5 does not fit, `scaled` 3 is short so not "exact"), last bar padded to 4, eighths at 5/5.5/6, warning. Should be triplet + 3-qn bar. |
| R3-G. Broken tie, line 2 = clef + 1 sharp, continuation arc starting 5.7 / 6.7 / 8.3 sp from `staff.x1` | merges at 5.7 sp, **not at 6.7 or 8.3 sp**. Real fixture geometry: key signature ends at 5.35 sp, first head at 8.5 sp, so a stub drawn after the prefatory matter sits at the 6 sp edge for one accidental and beyond it for two or more. |
| R3-I. Volta continuation line starting 8 sp from the staff edge (after clef + key) | pass — not detected as `inherited` (2 sp rule) but `extendEndings` gives `[0,1,2,0,3,4]`. |
| R3-J. Line 2 = clef + 1 sharp, first note F5 at 2.0 / 2.6 sp after the sharp | pass — F♯ both ways (key carried from line 1). |
| R3-K. Mid-line key change to 1 sharp, note on F at 2.0 sp | key rejected, sharp attached to the F (F♯ once, later F natural). Ambiguous geometry; real LilyPond key→note spacing is 3.15 sp, so acceptable. |
| Round-2 probes P1, P2 (digits 2–5), P3, P4, P6, P7, P8, P9, P16, P18, P22, P26 | **all pass** (P1, P2, P3, P6, P26 failed in round 2). |

## Ranked issues

1. **[major] Single-staff anacrusis: the tightened pickup rule turns an ordinary eighth-note (or 1.5-beat) pickup into a full bar with a 2.5–3.5 beat hole, at both ends of the piece.** `analyze.ts` ≈1125–1130: `shortLegal` requires `multipleOf(maxTotal, beatQn)` whenever `system.staves.length === 1`, so a 0.5-qn first bar in 3/4 or 4/4 keeps the nominal length; the pickup sounds at 0, silence follows until the next bar, the complementary short last bar is padded too, and the playhead highlights bar 1 for a full bar (probes R3-A, R3-B; warned, not silent). Single-line scores (flute, violin, voice, lead sheets) are a core use case and eighth-note pickups are common there; round 2 played these correctly. Fix: accept an on-32nd-grid short first bar on one staff when it is *either* a whole number of beats *or* ≤ half the nominal bar; additionally accept it when the last bar of the piece is short by the complementary amount (first + last = nominal) — that pairing is strong evidence of a real anacrusis. Regression-test: single staff, eighth pickup in 3/4 and 4/4, with and without the complementary last bar.
2. **[major] Showcase step 4 stacks pitch labels from different systems onto one note.** `showcase.ts drawNotes` (≈379–396) sorts every note on the page by x and groups a "chord" by `track` and `|Δx| ≤ 1 sp` with no y test, and `lastLabel` is never reset per staff. Systems 2–6 all place their first head at 8.5 sp from the same `x1`, and many bar positions coincide, so on the fixture **39 of 149 groups contain notes from 2–4 systems** (my replay of the grouping): "G5 E5 B4" is stacked over the lone B4 of bar 6, "B3 C4 G3" under bar 27's first LH note, four labels (D5/G4/B4/G5 from bars 24/2/7/19) at x≈271, and bars 18–21 are left largely unlabelled (c1, c2, c8). A viewer of the tutorial would conclude the parser read chords where there are none. Fix: group within one staff only (require `|Δy| ≤ ~6 sp` or key the grouping by the staff the note belongs to) and reset the row-alternation state per staff; while there, cap the label rows so they do not run into the title/composer text above system 1 (c9).
3. **[minor] A tuplet inside a legitimately short bar (anacrusis or final bar) is dropped.** `assembleStaff` (analyze.ts ≈1064–1069) only keeps a beam-tuplet candidate when the scaled attempt is an exact fit; in a short bar neither attempt is exact, so `plain` wins and the bar is then padded to nominal with a warning (probe R3-H: eighths at 5/5.5/6 instead of a triplet at 5/5.33/5.67). Fix: when neither attempt fits exactly, prefer the attempt whose total is a legal short length (on-grid, whole beats/half bar, or complementary to the first bar) over one that is not.
4. **[minor] Broken-tie continuation window is measured from the staff edge and does not clear the prefatory matter.** `detectTies` (analyze.ts 537) accepts the arriving half-arc only if `left.x ≤ system.x1 + 6 sp`. On the fixture the key signature ends at 5.35 sp and the first head sits at 8.5 sp, so a stub drawn after clef + key starts at the edge of the window for one accidental and beyond it for two or more (probe R3-G: merges at 5.7 sp, re-attacks at 6.7 sp). Fix: measure the window from the right edge of the last clef/key/time glyph before the first head of that staff (or accept any half-arc whose right end is the first head of the line with no head between), and add a test with a 2–4 accidental key signature on the continuation line.
5. **[minor] Beam-tuplet candidates in one measure are applied all-or-nothing.** Probe R3-E (real triplet + a fingering "2" centred over another beamed 3-group) rejects both, leaving a 4.5-qn bar spaced proportionally with a warning. Disclosed by the builder; fix by trying subsets (there are rarely more than 2–3 candidates per bar) and keeping the smallest set that makes the bar fit. Probe R3-F (no time signature → beam-only number applied unchecked) is the same family; consider requiring the number to be centred within 0.6 sp *and* the group to be an odd count ≥ 3 when there is nothing to fit against.
6. **[minor] Showcase re-render misses a devicePixelRatio change without a viewport change.** In my run, switching the emulated DPR from 1 to 2 at the same 1400×1000 left the page bitmap at 667×942 under a 666-px CSS box (`step4Dpr2` in `critic-results.json`; c1 visibly softer than c5). Dragging a window between a Retina and a non-Retina display does exactly this. Fix: listen to `matchMedia('(resolution: ' + dpr + 'dppx)')` change events (re-arm after each change) in addition to resize/ResizeObserver. Small polish on the same step: the "4" bar badge touches the "E5" label on the synthetic page, and the synthetic stage is ~80 % empty — raise the 2.2× cap or crop the 500×200 page tighter.
7. **[minor] Volta continuation detection relies on the line starting within 2 sp of `system.x1`.** If an engraver starts the continuation bracket after the clef/key (probe R3-I, 8 sp), it is not marked `inherited`; the outcome is still right because `extendEndings` covers the "ending → unlabelled run → `:|` → next ending" pattern, but a continuation that does not end in `:|` (e.g. a last ending broken across a line followed by a `|:`) would fall back to the old reset behaviour. Widen the start window to "before the first head of the line" and add a real two-line volta fixture when one is available.

## Strengths

- All seven round-2 issues have real code changes with regression tests reproducing the critic's geometry; my 16 round-2 probes (5 failing before) all pass against the current code, and my new probes confirm the fixes hold in nearby geometries (chord accidentals, running key, broken tie at realistic short distance, volta continuation via `extendEndings`, digits 2–5 over 4-eighth beams, piano pickups).
- Fixture result perfect and proven three ways (showcase, full app verify, Node fixture test): F1 1.0, LCS 1.0, duration 1.0, 0 warnings, 0 console errors, 28/28 app checks.
- Contract honoured in every probe: sentence-form errors, monotonic progress, bitmap-only `renderPage`, dispose semantics, `unfoldRepeats`, caller buffer intact, unique ids, contiguous timeline, `firstStartQn` consistent, bad step indices rejected.
- The synthetic showcase step is a genuinely useful addition: it exercises voltas, alternative-ending unfolding and beam tuplets that the fixture cannot, renders crisply at DPR 2, and its diagnostics are machine-checkable.
- The pdf.js chunked-render race is fixed for real: a deliberate storm of un-awaited scene switches leaves a clean 1333×1884 canvas.
- Architecture stays clean (pure, unit-tested modules; pdf.js confined to `index.ts`/`pdfPage.ts`; no cross-module imports), parse stays fast (≈75 ms warm, ≈190 ms cold), and the builder's report is honest about the gaps it left.

## Why 8.4 and not 8.5

The analyzer is materially better than round 2: the three silent musical corruptions are gone and the fixes survive
independent probing. What keeps it below the bar is one confirmed regression on ordinary single-staff input (a
common pickup now produces a multi-beat hole, at both ends of the piece) and a step-4 overlay that mislabels about a
quarter of the notes on the demo page — the tutorial visibly claims something the parser did not do. Both are
contained fixes (a two-branch condition and a per-staff grouping); with them, and the short-bar tuplet and tie-window
tweaks, this module is above the bar.
