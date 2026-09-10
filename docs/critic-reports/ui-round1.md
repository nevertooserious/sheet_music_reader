# Critic report — ui, round 1

Score: **8.1 / 10** — Pass: **no** (threshold 8.5; console errors 0; contract violations 0; rule violations 0)

Verdict in one line: a genuinely well-crafted DAW-style shell that meets every listed UI requirement with zero errors at 60 fps, held back from shipping by a lying peak meter, a mixer that hides tracks beyond two, and a score view that eagerly renders every page at full DPR.

## What I ran

- `npm run typecheck` — clean.
- `npm test` — 25/25 pass (2 files). Note: vitest only runs with the sandbox disabled; inside the sandbox it exits 255 with no output (worker spawn blocked). Not a module defect.
- `node tools/verify/showcase.mjs ui --out tools/verify/out/critic-ui-r1` — 9/9 steps ok, `errors: []`, `appErrors: []`, warnings 0, readyMs 79, fps 60.4–63.7, longest frame 16.7–16.8 ms, JS heap 2.4 MB, 514 nodes.
- Three puppeteer probe scripts of my own against `/?showcase=ui` and `/` (app mode with stub parser/engine). Findings JSON: `tools/verify/out/critic-ui-r1/extra/findings*.json`. Zero console errors or warnings across all probes.
- `git status --short` / `git diff --stat`: only `src/ui/**` and `docs/core-change-requests.md` changed. `tools/verify/out/` is gitignored, so the deleted stale screenshot is not a rule violation.

## Contract check

- `mountApp(root, { store, controller })` present; returns `{ root, dispose }` (superset, harmless; `main.ts` ignores it).
- UI imports only `../core/contracts`, `../core/types`, `../core/store`, `../core/demoScore`. No import from `parsing/` or `audio/`. Never touches engine or parser directly.
- Uses only `AppStore.getState/subscribe` and the `AppController` surface (loadFile, loadDemo, togglePlay, seek, seekToMeasure, setTempo, setMasterGain, setTrackGain/Muted/Solo, renderPage, stop, pause, play).
- `createShowcase(root)` exports `{ name, steps[9], runStep, getDiagnostics }`; diagnostics report required-attribute presence.
- Required verifier attributes all present: `[data-action="toggle-play"]`, `[data-control="tempo"]`, `[data-control="seek"]`, `[data-control="track-gain"]` (one per track), `[data-role="score-view"]`, `input[type="file"]`.
- Contract violations: none.

## Screenshots studied

Showcase run (`tools/verify/out/critic-ui-r1/`):
00-initial, 01-empty-state, 02-dragging-a-pdf-over-the-app, 03-demo-score-loaded, 04-playing-playhead-at-bar-3, 05-track-2-muted-track-1-gain-40, 06-tempo-140, 07-seeked-to-bar-6-by-clicking-measure, 08-parse-warnings-expanded, 09-error-banner.

My own (`tools/verify/out/critic-ui-r1/extra/`):
zoom-header, zoom-transport, zoom-mixer-strips, zoom-bar1-clef-collision, zoom-playing-meters, zoom-playing-playhead, end-of-score, solo-track1, after-real-measure-click, measure-hover, non-pdf-drop-banner, compact-1000x700-playing, laptop-1280x720, narrow-820x600, progress-mid-parse, app-mode-stub-error, multipage-loaded, multipage-seek-page3, multipage-playing-page1, six-tracks-mixer, six-tracks-mixer-bottom-zoom, loading-while-score-shown.

Every tutorial step visibly did what its label says: overlay on drag, page + chips + strips on load, orange playhead and note rings at bar 3 while playing, M lit and fader at -8.0 dB (0.4 → -7.96 dB, correct), tempo 140 with total time 0:26 → 0:20 (48 qn @140 = 20.6 s, correct), scroll to system 2 with bar 6 highlighted, warnings popover with three items, error banner plus error card.

## What is good

- Visual system is coherent and professional: dark panels, one accent (cyan) for controls and one (amber) for time, tabular numerals, sensible hierarchy. Legible at 1400×1000, 1280×720 and 1000×700.
- Transport semantics are right: bar·beat + m:ss, total time recomputed at the current tempo, seek fill, tempo reset disabled at score tempo, playing state flips icon/colour, end-of-score stops at bar 8 beat 3 with the seek at max and Play restarts from 0.
- Repeat pass maps back to printed bars (unit-tested) and the highlight/playhead follow correctly.
- Auto-follow works across systems and, verified with an injected 24-page state, across pages (seek to bar 7 scrolled to page 4; playing from page 1 into page 2 auto-scrolled).
- Keyboard: Space toggles (verified), ignored on focused buttons (verified: Space on M muted the track, did not play), Home/End/Arrows nudge by measure (verified 0 → 6 after two ArrowRight). Real mouse click on a measure leaves no focus ring (`:focus-visible` false).
- Import is robust: drag depth counting, overlay hidden on drop, non-PDF drop shows a local banner without a Retry button and without disturbing the loaded score, retry/dismiss semantics, progress card with stage and percent and disabled Open/Load buttons while busy.
- Solo/mute states reflect `TrackMixState` including the "silenced by another solo" dimming; double-click fader resets to `defaultGain`; dB readout.
- Store → DOM coalesced per animation frame; 60 fps with 16.8 ms longest frame; DOM node count identical (260) after six repeated loads, so no leak in the rebuild paths.
- App mode with stub parser: Load demo shows both the banner and the error card with "parsing module not implemented", zero console errors, zero unhandled rejections.
- Canvas/overlay alignment is correct at dpr 1 (page 1044 px, canvas CSS 1044, bitmap 1044) and after a live resize while playing (692/692/692).

## What is wrong (ranked)

1. **Major — every page is rendered eagerly at full DPR, no virtualisation.** Injecting 24 pages produced 24 render calls and 24 live canvases totalling 141 MB of bitmap at dpr 1 (`renderCalls: 24, canvasBitmapMB: 141.2`) while roughly one page was visible (`visiblePagesApprox: 1`); at dpr 2 that is ~565 MB, and every width change re-renders all pages. With real pdf.js at 100–300 ms per page a 20-page score means seconds of rendering and a very real chance of GPU memory pressure on Retina laptops. Fix: render only pages intersecting the scroll viewport ±1 page (IntersectionObserver or scroll math), release far pages (`canvas.width = 0`), cap effective render scale, and re-render lazily on resize.
2. **Major — mixer hides tracks beyond two.** A 6-track score put 4 of 6 strips outside the fixed 300 px panel (`hostClientW 299, hostScrollW 772, hiddenStrips 4`) behind a horizontal scroll with no visible scrollbar (macOS overlay scrollbars; zoomed shot shows none). For anything but a piano score the user cannot see there are more tracks. Fix: let `--mixer-width` grow with track count (e.g. `min(40vw, n × strip)`), or use narrower strips / a compact list mode, and always show a scroll affordance when it overflows.
3. **Major — peak-hold marker is stuck at the top of every meter.** `.meter-peak` is a 2 px element and the JS sets `translateY((1 - peak) * 100%)`, which is a percentage of its own height, so it never moves more than 2 px. Measured while playing: `level 0.46, transform translateY(50.52%), actual offset 1 px, expected 349 px` on a 646 px meter. Both meters read like they are pinned at 0 dBFS in every playing screenshot. Fix: set `top` as a percentage of the meter, or translate in px using the meter's height, or make the marker element full-height and translate it.
4. **Minor — loading a new file while a score is shown splits the column.** With `status: 'loading'` and a previous score still in state (which is exactly what `controller.loadFile/loadDemo` do before `parsing`), the progress card (454 px) and the old score view (390 px) are both visible, stacked. Fix: hide `.score-panel` whenever busy, or overlay the progress card on the score.
5. **Minor — tempo number field keeps an out-of-range typed value.** Typing 500 + Enter sets tempo to 240 (clamped) but the field keeps showing "500", still after blur (`tempoAfterBlur: field "500", tempo 240`). Fix: write the clamped value back in `applyTempo` and on `blur`.
6. **Minor — showcase mock page draws bar-1 noteheads over the clef/key/time glyphs.** In `03-demo-score-loaded` and `zoom-bar1-clef-collision` the RH D5 ring sits on the treble clef and the LH chord rings sit on the bass clef; the first bar is unreadable. Cosmetic and showcase-only, but it is the first frame anyone sees. Fix: extend the staff left of the first measure box and draw clef/key/time in that margin (or offset first-measure heads).
7. **Minor — below ~900 px the header, mixer and master volume are clipped with no way to reach them.** At 820×600 the Load demo button, strip 2 and the master slider are cut off (`transportScrollW 924 > innerW 820`) because `.smr-app` is `overflow: hidden`. Fix: a breakpoint that stacks/collapses the mixer and wraps the transport, or a `min-width` with horizontal scroll.
8. **Minor — follow does not re-centre on a seek that stays in the current measure.** Scroll away manually, press Rewind while already in bar 1: nothing scrolls (`followScrollBack: 724`), so Play starts with the playhead offscreen until bar 2. Fix: call `scrollToCurrent` on every explicit seek and on play start, not only on measure change.
9. **Minor — devicePixelRatio changes are not observed.** After switching to dpr 2 the bitmap stayed at 1044 px (`alignDpr2.bitmapW 1044`), so moving the window to a Retina display leaves a blurry page. Fix: compare `devicePixelRatio` in the update loop or listen to a `matchMedia('(resolution)')` change and re-render.
10. **Minor — playhead x is linear in measure fraction.** Real engraving is not proportionally spaced, so the line will lead/lag noteheads by a beat in bars mixing long and short values. The note rings compensate, but a piecewise-linear interpolation between consecutive `NoteEvent.layout.x` onsets inside the measure would keep the line on the notes.
11. **Minor — accessibility / hygiene.** `aria-valuenow` is set on the progress card instead of the `role="progressbar"` element; the same error is announced twice (banner `role=alert` plus the stage card, each with its own retry); `dispose()` does not remove the header's `document` listeners, the importZone `window.dragend` listener, or disconnect the `ResizeObserver`.

## Numbers

| Metric | Value |
| --- | --- |
| Console errors (showcase run + 3 probes + app mode) | 0 |
| Showcase steps | 9/9 ok |
| fps during steps | 60.4–63.7 |
| Longest frame | 16.8 ms |
| readyMs | 79 |
| JS heap | 2.4 MB used / 3.9 MB total |
| DOM nodes after 6 reloads | 260 → 260 |
| 24-page injection | 24 canvases, 141.2 MB bitmap @dpr1, 397 ms with a trivial renderer |
| 6-track injection | 4 of 6 strips hidden |
| Unit tests | 25/25 |

## Score rationale

Requirements coverage is complete, craft is high, and the runtime is clean and fast; that is worth well above 7. It is not 8.5 because a shipping mixer cannot show a peak indicator that is always at 0 dBFS, cannot hide two thirds of an ensemble's tracks without a visible affordance, and the score view's render strategy will not survive a normal 10–30 page PDF on a Retina display. Fix items 1–3 (and ideally 4–5) and this passes.
