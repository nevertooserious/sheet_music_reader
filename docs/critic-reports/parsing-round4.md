# Critic report — parsing, round 4

Score: **8.7 / 10** — Pass: **yes** (threshold 8.5). Console errors: 0. Contract violations: 0. Rule violations: 0.

Verdict in one line: every round-3 issue is fixed for real and survives independent probing (my 28 round-3 probes and 14
new round-4 probes, the fixture still perfect three ways, the contract clean in every check, the step-4 overlay now
honest and legible, the DPR-only re-render confirmed); what remains is a handful of minor edge cases, one of them a
narrow regression introduced by the widened volta-continuation window. This is shippable for its stated scope
(engraved LilyPond/SMuFL PDFs) with the disclosed heuristic limits.

## What I ran (sandbox disabled, as the brief requires)

| Command | Result |
| --- | --- |
| `OPENSSL_CONF=/dev/null npm run typecheck` | 0 errors. |
| `npm test` | 26 files, **264 tests, 264 passed** (parsing: 16 new round-4 tests, 3 synthetic-scene tests, 15 round-3, 15 probe, fixture through pdf.js in Node). |
| `node tools/verify/showcase.mjs parsing --out tools/verify/out/critic-parsing-r4` | SHOWCASE OK, **7/7 steps, 0 console errors, 0 warnings, 0 failed requests**, 62.0–63.7 fps, longest frame 16.8 ms, heap 8.6 MB, parse 191 ms. |
| `npm run verify` (full app) | **28/28 checks pass**: F1 1, LCS 1, duration 1, no warnings, 60.9 fps playback, zero console errors. |
| `git status --short`, `git diff --stat` | Parsing changed `src/parsing/**` only; `docs/STATUS.json`, `docs/core-change-requests.md` (parsing entries unchanged from earlier rounds, no new requests) and `src/audio/**` changed concurrently (wave-2 sibling). Nothing else. |
| Round-3 critic probes (`scratchpad/probes/r3.probe.test.ts`, `critic.probe.test.ts`, `extra.probe.test.ts`, 28 tests) | **28/28 pass** against the current `src/parsing`; the six that failed in round 3 (R3-A, B, E, G, H, I) now give exactly the requested outputs. |
| Round-4 critic probes (`scratchpad/probes/r4.probe.test.ts`, 14 synthetic pages) | Results in "Robustness probes". |
| Puppeteer driver (`scratchpad/r4-critic.mjs`) | DPR 1→2→1 at a fixed 1400×1000 viewport, DPR-2 zoom crops of every overlay step, a deliberate scene-switch race, 900×700 and 1200×560 viewports, out-of-order/invalid steps, contract probes via `window.__smr.parser`. Results in `tools/verify/out/critic-parsing-r4/zoom/critic-results.json`. |

The Chrome extension could not script `127.0.0.1` (ExtensionsSettings policy), so all live driving went through
puppeteer against the same dev server.

## Numbers (from the reports, not from the builder)

`tools/verify/out/critic-parsing-r4/report.json` diagnostics:

- Fonts Emmentaler-20/-Brace/-14 · 12 staves, 6 systems, 32 measures × 3 qn, 3/4 and 1 sharp from m.1
- Repeats m.16 `:|`, m.17 `|:`, m.32 `:|` → 64 segments, 192 qn; `unfoldRepeats:false` → 32 segments, 96 qn (my probe)
- 204 printed heads → 258 + 150 events, 1 grace, 5 rests, 0 voltas, 0 tuplets, 12 key accidentals, 5 note accidentals, 0 ignored
- **Comparison (printed order): onset+pitch F1 1.0000, pitch LCS 1.0000, duration accuracy 1.0000; 129/129 and 75/75, 0 missing, 0 extra, 0 warnings.** Targets (F1 ≥ 0.95, LCS ≥ 0.97) met with full margin; reproduced by `npm run verify` and by the Node fixture test.
- Synthetic step: 6 measures on 2 systems, voltas [1] (line 1), [1] inherited (line 2), [2]; measure voltas `[–,–,1,1,2,–]`; one tie broken across the line break; tuplet 3:2; play order 1 2 3 4 1 2 5 6 (8 plays, 24 qn); 17 notes; 0 warnings; analyze 1 ms.

Performance: parse 191 ms cold in the showcase (229 ms in my second run), 93 ms first parse in the app tab, 76–78 ms on
five warm parses; `renderPage(0, canvas, 2)` 13 ms for a 1191×1684 bitmap; heap 8.6 MB in the showcase report, 7.4 MB
after my step storm, 18.4 MB after 8 parses in the app tab (identical to round 3: no growth); every step settles in
≈0.96 s; 62–64 fps. The showcase now runs a permanent 250 ms `setInterval` that reads `stage.clientWidth/Height`
(the DPR poll); cost is negligible (layoutCount 20 over the run) and the Showcase contract has no dispose to hang it on.

## Contract check (`src/core/contracts.ts` → `src/parsing/index.ts`), verified in Chrome

- `parse(nonPdf)` → `"notes.txt" is not a valid PDF file.`; `parse(empty)` → same sentence. Legacy-font and raster errors covered by unit tests.
- `onProgress`: Opening PDF → Reading page 1 of 1 → Classifying glyphs → Detecting staves and systems → Reading notes → Building timeline → Assembling score → Done; fractions monotonic.
- `pages` = `[{0, 595.28 × 841.89}]`; `renderPage` sets bitmap only (`style.width/height` empty); `renderPage(7)` → `Page 8 does not exist`; after `dispose()` → `Document disposed`.
- ScoreModel: 408 notes, every note has finite `layout`, all durations > 0, none past `durationQn`, ids unique, one layout box per staff on every measure, timeline contiguous, `firstStartQn` equals the first timeline occurrence, no warnings.
- Imports: `../core/types`, `../core/contracts`, `pdfjs-dist` only; no `src/ui` or `src/audio` import anywhere in `src/parsing`. `Showcase` implements `name/steps/runStep/getDiagnostics`; `runStep(9)` → `No step 9`, `runStep(-1)` → `No step -1`; `runStep` resolves after a settled frame.

No contract violations. No rule violations.

## Screenshots studied

Verifier run (1400×1000, DPR 1), `tools/verify/out/critic-parsing-r4/`:

1. `00-initial.png` / `01-page-rendered.png` — page rendered, Parse facts, "Clean parse: no warnings". Fine.
2. `02-staves-and-systems.png` — 12 staves coloured per track, purple system brackets, right-aligned system badges. Fine.
3. `03-glyphs-classified.png` — clefs, key vs note accidentals, rests, stems, beams, head rings; counts table. Matches the label.
4. `04-notes-with-pitches-and-durations.png` — labels per staff, no stacks on lone notes, bars 17–21 labelled, header clear of the attribution. Fixed.
5. `05-measures-repeats-and-timeline.png` — bar badges 1–32 with `:|`/`|:` marks, green barlines, red thick barlines. Fine.
6. `06-comparison-to-reference-midi.png` — TARGET MET badge under the last system and per-track table. Fine.
7. `07-voltas-and-tuplets-on-a-synthetic-page.png` — new two-line synthetic page filling ~70 % of the stage: volta 1 open at the line end, continued on line 2, volta 2, a tie broken at the break drawn as dashed arcs, beamed triplet with 3:2 box, badges below the staff, per-bar table. Does what it says.

My own (puppeteer, DPR 2 unless stated), `tools/verify/out/critic-parsing-r4/zoom/`:

- `k1-step4-header-system1-dpr2.png` — labels stop below the composer line; bar 1 chord G3/B3/D4 stacked downward; no cross-system stacks. Bitmap 1333×1884 for the 666-px CSS box after a DPR-only change (fixed).
- `k2-step4-systems-2-3-dpr2.png` — bars 6–16 all labelled; the grace A4 in bar 8 labelled; labels that had to flip below their head (bar 7 F#4, bar 11 E5, bar 12 LH run) sit inside the staff over lines and stems — legible, not tidy.
- `k3-step4-systems-4-5-dpr2.png` — bars 17–26 all labelled (were largely blank in round 3); C#5/F#4 accidental notes correct; rests highlighted.
- `k4-step4-system-6-dpr2.png` — bars 27–32; the final RH chord B3/D4/G4 flipped below spills into the bass staff's top space, touching the LH G3 label region.
- `k5-step5-systems-3-4-dpr2.png` — badges `16 :|`, `17 |:`, red repeat barlines. Fine.
- `k6-step6-footer-dpr2.png` — comparison badge crisp. Fine.
- `k7-step7-synthetic-dpr2.png` — 1892×1399 bitmap = overlay; brackets, dashed ties, 3:2 box legible. The volta-2 line runs through the top edge of the dashed tuplet box; the tied-continuation head on line 2 is plain black with no overlay marker.
- `k8-step7-panel-dpr2.png` — panel table clean.
- `k9-narrow-synthetic.png` / `k10-narrow-step4.png` (900×700, DPR 1) — page, canvas and overlay all 446×330 / 446×631 CSS; bitmaps 446×330 / 447×631. Alignment holds.
- `k11-short-560.png` (1200×560) — page 355×502 fits the 528-px stage; panel scrolls.

## Robustness probes (my synthetic pages through `analyze()`, LilyPond-like geometry, sp = 6)

| Probe | Result |
| --- | --- |
| R3-A/B (single staff eighth pickups, 4/4 and 3/4) | **pass** — `[0.5,4,3.5]` and `[0.5,3]`, no warnings (were `[4,4,4]`/`[3,3]` with holes). |
| R3-E (triplet + fingering "2" in one bar) | **pass** — triplet only, method single, no warning. |
| R3-G (broken tie behind clef + key at 5.7/6.7/8.3 sp) | **pass** — merged at all three distances. |
| R3-H (triplet in a short closing bar) | **pass** — `[1,4,3]` with the triplet applied. |
| R3-I (volta continuation from 8 sp) | **pass** — `inherited` bracket, x1 pulled back to the staff edge. |
| R3-F (no time signature, "3" over three beamed eighths) | unchanged — triplet (disclosed; defensible). |
| R4-A/B/C single staff, mid-piece bar of 3 quarters in 4/4 / a half in 4/4 / two quarters in 3/4 | bar **shortened** to 3 / 2 / 2 qn *and* warned "durations fill 3 of 4 … onsets were read left to right" — the warning does not say the bar was shortened. Whole-beat acceptance applies mid-piece, where a missed rest glyph is the likelier cause. |
| R4-D single staff, 2.5-qn pickup (quarter quarter eighth) | `[4,4]` + warning: the pickup keeps the nominal length (not whole beats, more than half a bar). Acceptable, uncommon. |
| R4-E slur broken at a line break between different pitches | not merged (step mismatch). Correct. |
| R4-F LilyPond-style open last ending `2.` at a line end; next line begins with a **bracketed** quarter-note triplet | **FAIL** — the tuplet bracket is taken as the volta continuation (`[[2], inherited, 30–90]`), `tuplets: []`, bar 5 sums to 5 qn, proportional onsets, warning. Timeline order itself is right (0 1 2 1 3 4 5). |
| R4-F2 same tuplet without the open volta | pass — 3:2 detected, bar exact. |
| R4-F3 same as R4-F but the tuplet bracket starts after the first head | pass — 3:2 detected, no inherited volta. |
| R4-G open last ending at a line end; next line begins with an 8va line | 8va line taken as the continuation and bars 5–7 marked volta 2; order still correct; ottava neither applied nor warned. |
| R4-H single staff, 3.5-qn *first* bar (misread, no complement) | `[4,4]` + warning. Correct. |
| R4-I two staves both losing a beat mid-piece | `[4,3,4]` + two warnings (agreement rule; consistent with R4-A). |
| R4-J 6/8 eighth and sixteenth pickups | `[0.5,3]`, `[0.25,3]`, no warnings. Correct. |
| R4-K 6/8, fingering "3" over three beamed eighths in a bar that already adds up | ignored, bar 3 qn, no warning. Correct. |
| R4-L broken tie arriving at the lower head of an opening chord after two sharps | merged (`[71,4,8]`). Correct. |

## Ranked issues

1. **[minor] The widened volta-continuation window swallows a bracketed tuplet (or any thin line) that starts the next line after an open last ending.** `analyze.ts` passes `firstHeadX` to `detectVoltas`, and `repeats.ts` (`cont = candidates.filter(h => h.x1 <= startLimit)…sort by x2`) accepts any thin horizontal stroke above the top staff whose start lies before the first head, hook or not. LilyPond leaves the last alternative's bracket open on the right, so when that alternative ends a line `openVoltaAtLineEnd` arms `inherited`, and a quarter-note-triplet bracket over the first beat of the next line (probe R4-F) becomes "volta 2 (continued)"; `tupletBrackets` then excludes it, the triplet is lost, the bar sums to 5 qn and is spaced proportionally with a warning. R4-F3 (bracket after the first head) and R4-F2 (no open volta) are fine, so the regression is confined to this coincidence. Fix: constrain the continuation candidate — same height above the staff as the previous line's bracket (|Δ(y − staff.top)| ≤ 1.5 sp), or reaching at least to the first barline of the line (an ending is at least a bar long), and never a line broken around a small digit/tuplet label; add R4-F as a regression test and keep R4-F3 passing.
2. **[minor] Single-staff mid-piece short bars that are a whole number of beats are truncated, and the warning does not say so.** `sensibleShort` (analyze.ts ≈1035) accepts `multipleOf(qn, beatQn)` anywhere, so a 4/4 bar holding three quarters (a missed rest glyph is the likely cause) becomes a 3-qn measure (probes R4-A/B/C: `[4,3,4]`, `[4,2,4]`, `[3,2,3]`); the warning reads "durations fill 3 of 4 quarter notes; onsets were read left to right", which describes a padded bar, not a shortened one. Fix: restrict the whole-beats clause to `opensSection || closesSection || lastOfPiece` (pad mid-piece bars to nominal, which keeps downstream timing when a glyph was missed), or, if the truncation is intended, say "measure shortened to 3 quarter notes" in the warning. Regression-test both the 2-beat anacrusis (R3-C) and R4-A.
3. **[minor] Step-4 labels that flip below their head land inside the staff.** `drawNotes` places a flipped label at `head.y + 2.3 sp`, so for heads on or above the middle line it sits over staff lines and stems (k2 bar 7 F#4, bar 11 E5, bar 12 LH run; k4 the final RH chord B3/D4/G4 spills into the bass staff's top space next to the LH G3 label). Fix: when flipping, start the row at `staff.bottom + 1.5 sp` (below the staff) and stack chord labels downward from there; alternate rows below as you do above.
4. **[minor] Synthetic-page polish.** The volta-2 bracket line runs through the top edge of the dashed 3:2 tuplet box (k7): move the synthetic voltas ~2 sp higher or the tuplet number 1 sp lower. The tied-continuation head at the start of line 2 is plain black with no overlay ring or tag, so a viewer cannot tell it was merged rather than missed: draw it hollow in the track colour with a small "tied" tag. Minor: the red thick-barline colour is used for both repeat barlines and the final barline; a legend line ("red = thick/repeat barline") in the panel would remove the ambiguity.
5. **[minor] Ottava lines are neither applied nor warned about.** An "8va" text run with its line (probe R4-G) is ignored silently, so the affected notes play an octave low without a warning; with an open volta on the previous line the same line is also absorbed as a volta continuation (bars 5–7 marked volta 2 in R4-G — harmless to the timeline here, but a `|:` inside that span would be repeated from the wrong bar). Not in the requirements list, but "warnings for anything skipped" is: add a warning when an `8va/8vb/15ma/15mb` text run is found within 10 sp of a staff, or implement the shift.
6. **[minor] Disclosed limits to keep on the record.** No time signature: a "3" over three beamed eighths is a triplet (R3-F) — reasonable default, but emit a warning when a beam-number is applied without a time signature so the user can check; a two-staff short closing bar whose only consistent reading is a beamed tuplet still falls back to plain; the complementary short-bar rule pairs only with the current section's opener; `subsetsBySize` tries subsets only up to 5 candidates. None affects the fixture or my probes.

## Strengths

- All seven round-3 issues have real code changes with regression tests reproducing the critic's geometry; my 28 round-3 probes (6 failing before) and 14 new round-4 probes confirm the fixes hold in neighbouring geometries (6/8 pickups, chord tie continuations, slurs across breaks, fingerings that already add up, repeat pickups).
- Fixture result perfect and proven three ways (showcase, full app verify, Node fixture test): F1 1.0, LCS 1.0, duration 1.0, 0 warnings, 0 console errors, 28/28 app checks.
- Contract honoured in every probe: sentence-form errors, monotonic progress, bitmap-only `renderPage`, dispose semantics, `unfoldRepeats`, unique ids, contiguous timeline, `firstStartQn` consistent, bad step indices rejected, `runStep` resolves after a settled frame.
- The step-4 overlay is now truthful: labels are grouped per staff with a per-label ceiling, so no stacks appear on lone notes, the composer line stays clear, and every bar on the page is labelled.
- DPR-only re-render works (667→1333→667 px at a fixed 666-px CSS box, synthetic 946→1892→946), with the honest disclosure that a 250 ms poll backs up the media query because emulated DPR changes fire no events.
- The synthetic step now exercises a two-line ending continuation, a tie broken at a line break, and a beam tuplet in one page; its diagnostics are machine-checkable and the panel table reads well.
- Architecture stays clean (pure, unit-tested modules; pdf.js confined to `index.ts`/`pdfPage.ts`; no cross-module imports), parse stays fast (76–78 ms warm, ≈190 ms cold), heap flat across repeated parses, and the builder's report is honest about the gaps it left.

## Why 8.7

Round 3's two majors — the single-staff pickup hole and the mislabelled tutorial overlay — are gone and independently
verified, and the minors went with them. What I found this round is all edge-case: one narrow regression from the
widened continuation window that needs two coincidences and is warned when it strikes, a truncation-vs-padding choice
for mid-piece short bars on a single staff that is at least warned, and overlay polish. The parser does its job on the
target material with a perfect fixture, clean warnings, a fast parse and a tutorial that shows what it actually did.
That is a ship-it module with a short polish list, not a perfect one.
