# Critic report — parsing, round 1

Score: **8.2 / 10** — Pass: **no** (threshold 8.5). Console errors: 0. Contract violations: 0. Rule violations: 0.

Verdict in one line: on the target fixture this parser is flawless and fast, and the contract is
honoured to the letter; it is not yet shippable to paying users because five cheap-to-hit real-world
cases (a slur that starts and ends on the same pitch, a clef change mid-system, staff lines drawn
per measure, a small floating accidental, a legacy music font) produce wrong notes, duplicate
tracks, a wrong key, or a misleading error. Each is a small fix.

## What I ran (all with the sandbox disabled, as the brief requires)

| Command | Result |
| --- | --- |
| `OPENSSL_CONF=/dev/null npm run typecheck` | 3 errors, all in `src/audio` (engine.ts:252, showcase.ts:276, showcase.ts:312). `src/parsing`: 0 errors (verified by filtering tsc output). |
| `npm test` | 18 files, 142 tests, 142 passed (parsing: 50 tests across 10 files incl. a real-PDF Node integration test). |
| `node tools/verify/showcase.mjs parsing --out tools/verify/out/critic-parsing-r1` | SHOWCASE OK, 6/6 steps, 0 console errors, 0 warnings, 0 failed requests. |
| `git status --short`, `git diff --stat` | Changed: `src/parsing/**`, `src/audio/**` (other wave-2 module, expected), `docs/STATUS.json`, `docs/core-change-requests.md` (audio's request). Nothing else. |
| Puppeteer probe of `window.__smr.parser` in the real app (my script) | See "Contract check" below. |
| 12 synthetic analyzer probes (vitest, my script, outside the repo) | 5 pass, 7 fail — see "Robustness probes". |

## Numbers (from the reports, not from the builder)

From `tools/verify/out/critic-parsing-r1/report.json` diagnostics:

- Fonts: Emmentaler-20, Emmentaler-Brace, Emmentaler-14 · 282 glyphs, 653 paths, 17 text runs, 0 images
- 12 staves, 6 systems (2 staves each), 32 measures of 3 qn, 3/4 from m.1, 1 sharp from m.1
- Repeats: m.16 `:|`, m.17 `|:`, m.32 `:|` → timeline 64 segments, 192 qn; `unfoldRepeats:false` → 32 segments, 96 qn
- Tracks: Right hand (treble) 129 printed heads → 258 events; Left hand (bass) 75 → 150; 1 grace, 5 rests
- Title "Menuet in G", composer "Johann Sebastian Bach (1685-1750)", tempo 100 (default; no mark printed)
- Rhythm method: single ×60, two-voice ×4; **warnings: 0**
- **Comparison to `bach-minuet-g.mid` (printed-order variant): onset+pitch F1 1.0000, pitch LCS 1.0000, duration accuracy 1.0000; 129/129 and 75/75 notes, 0 missing, 0 extra.** Targets (F1 ≥ 0.95, LCS ≥ 0.97) met with margin.
- Same numbers independently reproduced by the Node integration test (`SMR_DEBUG=1`) and by `tools/verify/out/app/report.json` (full app path: F1 1.0, LCS 1.0, dur 1.0, "parse has no warnings" pass).

Performance:

- Parse 184 ms cold in the showcase, 78–83 ms in the app tab, 70–75 ms on ten consecutive warm parses; `renderPage` at scale 2 (1191×1684 bitmap): 15–36 ms.
- Heap 5.6–7.0 MB; five undisposed documents held at once → 6.8 MB, unchanged after dispose (no leak signal). Showcase rAF 32 fps (headless cap), longest frame 33 ms; each step settles in ~1.0 s.

## Contract check (`src/core/contracts.ts` → `src/parsing/index.ts`)

Verified in Chrome via `window.__smr.parser` (puppeteer, app mode):

- `parse(nonPdf)` → `"notes.txt" is not a valid PDF file.` · `parse(empty)` → same sentence · a hand-built text-only PDF → `This PDF looks scanned; only engraved (vector) PDFs are supported.` All complete sentences, as required.
- `onProgress` fractions strictly non-decreasing: 0.02 Opening PDF → 0.05 Reading page 1 of 1 → 0.55 → 0.6 → 0.7 → 0.85 → 0.95 Done → 1 Done (last two duplicate the stage text; cosmetic).
- `pages` = `[{index 0, 595.28 × 841.89}]`.
- `renderPage(0, canvas, 2)` sets bitmap 1191×1684 and leaves `canvas.style.width/height` empty (UI owns the CSS box) ✓. `renderPage(5)` → `Page 6 does not exist`; `renderPage(-1)` → `Page 0 does not exist`. Two overlapping renders on one canvas: both resolve, first cancelled quietly, final bitmap is the second call's ✓. After `dispose()` → `Document disposed`; double dispose is a no-op ✓.
- The caller's `ArrayBuffer` is not detached (copied before handing to pdf.js) ✓.
- ScoreModel: one `layout` box per staff on every measure; every note has a `layout` point; all durations > 0; ids unique; notes sorted; timeline contiguous; no note runs past `durationQn`; `defaultGain` 0.8; velocities 0.8 / 0.6 (grace); `instrument` piano; `firstStartQn` of m.17 = 99 (after the unfolded first half) ✓.
- `debug` carries staves/systems/barlines/measures/notes/rests/stems/beams/accidentals/clefs/parseMs/allFonts/extraction — a useful overlay payload.
- Imports: `../core/types`, `../core/contracts`, `pdfjs-dist`, `midi-file` only. No imports from ui/audio. `Showcase` implements `name/steps/runStep/getDiagnostics`.

No contract violations.

## Screenshots studied

Verifier run (1400×1000, DPR 1), all in `tools/verify/out/critic-parsing-r1/`:

1. `00-initial.png` — page rendered on load; panel already shows Parse facts and "Clean parse: no warnings". Identical to step 1 (fine: step 1 is "Page rendered").
2. `01-page-rendered.png` — as above.
3. `02-staves-and-systems.png` — 12 staves coloured by track, 6 purple system brackets with "System n · 2 staves" badges; legend and counts in the panel. Does what it says.
4. `03-glyphs-classified.png` — clefs (purple boxes), key-signature accidentals (white) vs. note accidentals (yellow), rests (green), stems (blue), beams (orange), heads (blue rings); count table by kind. Does what it says.
5. `04-notes-with-pitches-and-durations.png` — every head filled in its track colour with a pitch label; durations histogram (3 qn ×16, 2 ×13, 1 ×90, 0.5 ×84), key, time, tempo. Labels are small at this viewport (≈7 px) but correct; verified legible at 2× below.
6. `05-measures-repeats-and-timeline.png` — green measure-number badges 1–32, thin green barlines, red thick/repeat barlines, "16 :|", "17 |:", "32 :|" — matches the printed music; play order and rhythm-method summary in the panel.
7. `06-comparison-to-reference-midi.png` — on-page green "TARGET MET" badge with per-track lines, panel table with F1/LCS/Dur 1.000 for both tracks. Does what it says.

My own 2× zooms (puppeteer, DPR 2) in `tools/verify/out/critic-parsing-r1/zoom/`:

- `z1-step4-system1-2-notes.png` — labels D5 G4 A4 B4 C5 … correct for bar 1; LH chord D4/B3/G3 labels overlap each other (cosmetic).
- `z2-step4-system5-6-notes.png` — bars 22–32: C#5, C#4, C4 (natural), F#3, two-voice bars 25/26/30 with rests boxed; all pitches right.
- `z3-step3-glyphs-system1-2.png` — classification overlay tidy and aligned.
- `z4-step5-measures-system3-4.png` — barlines and repeat marks aligned to the engraving.
- `z5-step2-system-labels.png` — the "System 3 · 2 staves" badge sits on top of the printed measure number "11" (cosmetic).
- `z6-step6-panel.png` — side panel is well organised; current step first, warnings, then earlier sections dimmed.
- `z7-narrow-900x700-step4.png` — after a viewport/DPR change the page canvas keeps its old CSS size and the overlay is drawn at half scale in the top-left; the showcase has no resize handling (verifier never resizes; minor).

## Robustness probes (my synthetic pages through `analyze()`, realistic Emmentaler geometry)

| Probe | Result |
| --- | --- |
| A. Phrase slur over G4 A4 B4 G4 (curved fill ending 0.6 sp above the first and last head) | **FAIL** — parsed as `[G4 0 2] [A4 1 1] [B4 2 1]`: the last G4 is dropped and the first doubled. Slur endpoints on the same step are taken for a tie. |
| B. Real tie between adjacent B4 halves | pass — one 4-qn note. |
| C. `clefs.F_change` after bar 1 in a 3-bar system | **FAIL** — bar 2 reads D3 (bass) but bar 3 reverts to B4 (treble). Mid-system clef change only lives inside its own measure. |
| D. Staff lines drawn as two abutting segments (per measure) | **FAIL** — 2 staves, 2 tracks, warning "No clef found for staff 2". Collinear segments are never merged. |
| E. Accidental 1.5 sp left of its head | pass — attaches. |
| F. Single voice with stems flipping up/down by pitch | pass — stays single. |
| G. `unfoldRepeats:false` | pass — 2 segments vs 4. |
| I. Tie across a barline | pass — `[B4 0 2] [B4 2 4] [C5 6 2]`. |
| J. Whole-note chord `<c'' d''>1` (second, no stem) | **FAIL** — proportional fallback, onsets 0.875 and 1, warning. Stemless heads a head-width apart are not clustered. |
| K. One-quarter pickup bar in 3/4 | **FAIL (noise)** — timing right (measure 1 = 1 qn) but warns "durations fill 1 of 3 quarter notes; onsets were read left to right". |
| L. Vector page in the legacy font "Maestro" | **FAIL** — error is "This PDF looks scanned; only engraved (vector) PDFs are supported." The legacy-font warning is lost because the throw happens first. |
| M. Small sharp floating above a note (as over a trill) in C major | **FAIL** — becomes a key change: `keySignatures = [{measure 0, fifths 1}]`; every later F in the piece would be sharpened. |

## Ranked issues

1. **[major] Slurs whose two ends sit on the same pitch are merged as ties, dropping notes.** `detectTies` (analyze.ts 366–404) accepts any thin curved fill whose extreme points lie near two same-step heads; it never checks that the heads are adjacent. Probe A: G A B G under one slur → `[G 0 2] [A 1 1] [B 2 1]`, second G gone. Fix: only merge when no other head of that staff lies strictly between `a.cx` and `b.cx`; additionally prefer flat shapes (bbox height ≲ 1.5 sp) and cap the span (≲ 10 sp) since ties join neighbours. Add a slur-vs-tie unit test.
2. **[major] A mid-system clef change applies only inside the measure that contains it.** `clefAt` (analyze.ts 717–727) only looks at clefs with `c.x ≥ region.x1`, and `staffStates[i].clef` is set only from clefs before the first note of the system. Probe C: bass-clef change in bar 2 → bar 3 reads treble again. Fix: in the per-region loop, advance `state.clef/clefOctave` when a clef glyph (other than the system's opening one) falls inside the region, exactly as key/time changes are carried; make `clefAt` fall back to that running state. Add a test with a clef change followed by two more measures.
3. **[major] Collinear staff-line segments are not merged, so staff lines drawn per measure (or split at any point) yield one "staff" per segment.** `detectStaves` (staves.ts 93–127) requires the five lines to share x1/x2 within 2.5 pt and never joins segments. Probe D: two abutting segments → 2 staves, 2 tracks, spurious "No clef found for staff 2" warning; on a real page this would fan out into dozens of tracks. Fix: before grouping, merge `HLine`s with |Δy| < 0.5 pt whose x-ranges overlap or touch within ~2 pt (also helps ledger-line noise). Add a test.
4. **[major] Every unattached accidental is read as a key-signature change.** `keyChanges` (analyze.ts 645–648) groups all accidentals not glued to a head and pushes a new `fifths` for the rest of the piece. Probe M: a small sharp above a note (as over a trill, `tr♯`) in C major → `fifths 1` from m.1, every later F sharpened. Fix: ignore accidentals smaller than ~0.85 staff height; accept a key group only at the start of a region (≲ 4–5 sp after `region.x1` or right after a clef) with its glyphs on distinct staff steps; otherwise warn "unattached accidental ignored". Add a test.
5. **[minor] Legacy music fonts get the "looks scanned" error and their warning is lost.** Probe L: a Maestro page throws `RASTER_ERROR` (analyze.ts 477) because no glyph classifies; the legacy-font warning added at 472 never reaches the user. Fix: when `legacy-music` fonts are present and nothing classifies, throw `"<file>" uses the music font "Maestro", which is not supported yet (Emmentaler and SMuFL fonts are).`; keep "looks scanned" for pages with images and no vector music.
6. **[minor] A pickup bar produces a warning although it is handled correctly.** Probe K: measure 1 = 1 qn (right), but `assembleMeasure` sets `problem: durations fill 1 of 3…` and analyze warns. Fix: suppress the problem when the short measure is the first (or precedes a repeat/final barline) and all staves agree on the shortened total, since `build.durationQn` is already adjusted for that case (analyze.ts 826).
7. **[minor] Stemless chords with a displaced second are split into two onsets.** Probe J: `<c'' d''>1` → proportional fallback, onsets 0.875 / 1, warning. `clusterByX` tolerance is 1.0 sp and there is no stem to bind them. Fix: for heads without `stemId`, cluster within ~1.4 sp when they are on adjacent steps (a displaced second is exactly one head width apart).
8. **[minor] Voltas and tuplets are not modelled (acknowledged).** 1st/2nd endings are unfolded as plain repeats, so playback of any score with alternative endings is wrong; tuplets overrun the bar and fall to proportional spacing with a warning. Neither is in the fixture; both are common in the target repertoire. At least detect the volta bracket (thin horizontal stroke with a hook above the top staff plus a text digit) and skip the first ending on the repeat.
9. **[minor] Showcase polish.** (a) "System n · 2 staves" badge covers the printed measure numbers 11/17/22/27 (z5). (b) Chord labels overlap in dense LH chords (z1 bar 1). (c) No resize/DPR handling: after a viewport change the overlay is drawn at the wrong scale (z7) — re-run `renderPage` and redraw the current step on `resize`. (d) Progress reports "Done" twice (0.95 and 1). (e) `midi-file` is a `devDependency` imported from `src/parsing/midiReference.ts` (bundled into the showcase chunk) — move it to `dependencies` or keep the comparison strictly in tools.
10. **[minor] Bar-start grace notes are filed under the previous measure.** The grace before bar 8 is emitted with `measure: 6` (to steal time from the previous bar, matching LilyPond MIDI) while its `layout` sits in measure 7's box — 2 of 408 events have a `measure` that does not contain their `layout.x`. A UI highlighting "current measure" from the note will flash the wrong bar. Either keep `measure: 7` with the negative offset expressed on the timeline, or document the convention in the model.

## Strengths

- Perfect on the fixture and proven three independent ways (Node integration test, showcase in Chrome, full app through the controller): F1 1.0, LCS 1.0, duration 1.0, 0 warnings, 0 console errors.
- The contract is honoured in every detail I could probe: sentence-form errors for non-PDF, empty, text-only and no-staff inputs; bitmap-only `renderPage` with per-canvas cancellation and out-of-range rejection; `dispose` semantics; monotonic progress; `unfoldRepeats`; caller buffer preserved.
- Clean architecture: `extract.ts` is a pure operator-list walker over an OPS table and page-like interface (full CTM/text-matrix/gState/form-XObject tracking, TJ adjustments); `analyze/rhythm/pitch/durations/timeline/staves` are pure and unit-tested; pdf.js touches only `index.ts`/`pdfPage.ts`.
- Musically thoughtful details: two-voice split by stem direction with rest voice by height, floating rests assigned by rhythmic fit, heads sharing a stem forced into one onset, key/time carried per staff across systems, ties across barlines correct, dotted rests, whole-bar rests, octave clefs by digit, SMuFL digit centring accounted for.
- Fast and frugal: ~75 ms warm parse, ~20 ms render, ~7 MB heap, no leak after repeated parses.
- The showcase is a genuinely useful tutorial: each step's overlay matches its label, the side panel puts the current step's numbers first, and the on-page comparison badge makes the result legible at a glance.

## Why 8.2 and not 8.5

The score reflects what I saw, not effort: the fixture result could not be better, but four confirmed
generalisation bugs (1–4) each cause wrong notes, wrong key, or duplicated tracks on ordinary
engraved music that this product explicitly targets, and the builder's own tests never exercise
those paths. They are small fixes; with them, plus the misleading legacy-font error, this module is
comfortably above the bar.
