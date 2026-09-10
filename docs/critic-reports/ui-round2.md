# Critic report — ui, round 2

Score: **8.8 / 10** — Pass: **yes** (threshold 8.5; console errors 0; contract violations 0; rule violations 0)

Verdict in one line: every round-1 blocker is gone and verifiably so — the score view now virtualises and re-renders on DPR change, the mixer grows and signals overflow, the peak marker tracks and decays — and the playhead now sits exactly on the noteheads; what remains is polish (busy-state consistency, follow vs manual scroll, a cramped sub-900 px layout).

## What I ran

- `OPENSSL_CONF=/dev/null npm run typecheck` — clean.
- `npm test` (vitest, sandbox disabled) — 42/42 pass in 4 files (pageMath 7, format 26, mockPage 3, showcaseScores 6).
- `node tools/verify/showcase.mjs ui --out tools/verify/out/critic-ui-r2` — 11/11 steps ok, `errors: []`, `warnings: []`, `appErrors: []`, `requestFailures: []`, readyMs 53, fps 60.4–62.6, longest frame 16.7–16.8 ms, JS heap 3.8 MB used / 8.2 MB total, 1317 DOM nodes after the 24-page scene, layoutCount 285.
- My own puppeteer probe (`scratchpad/probe-r2/probe.mjs`, findings in `scratchpad/probe-r2/findings.json`) against `/?showcase=ui` at 1400×1000, 1000×700, 820×600, 1280×720 and 700×520, and against `/` (app mode with stub parser and engine). Zero console errors, warnings or failed requests on all six pages.
- `git status --short` / `git diff --stat`: changes are confined to `src/ui/**` and `docs/**` (`docs/STATUS.json` is written by the orchestrator; the `docs/core-change-requests.md` ui entry dates from round 1 and is the sanctioned channel). No rule violation.

## Contract check

- `mountApp(root, { store, controller })` present, returns `{ root, scoreView, mixer, dispose }` (superset; `main.ts` ignores the return).
- Imports from outside `src/ui` are only `../core/contracts`, `../core/types`, `../core/store`, `../core/demoScore`. Nothing from `parsing/` or `audio/`; engine and parser are never touched.
- Controller surface used: `loadFile, loadDemo, loadArrayBuffer (showcase), play, pause, stop, togglePlay, seek, seekToMeasure, setTempo, setMasterGain, setTrackGain, setTrackMuted, setTrackSolo, renderPage` — all within `AppController`.
- `createShowcase(root)` returns `{ name: 'ui', steps[11], runStep, getDiagnostics }`; diagnostics report required attributes, render stats, mixer overflow and per-step snapshots.
- Required verifier attributes present: `[data-action="toggle-play"]`, `[data-control="tempo"]`, `[data-control="seek"]`, `[data-control="track-gain"]` (one per track), `[data-role="score-view"]`, `input[type="file"]`.
- `dispose()` removes the window keydown listener, header document listeners, importZone window dragend listener, both observers, DPR timer/media query and pending frames.
- Contract violations: none.

## Screenshots studied

Showcase run (`tools/verify/out/critic-ui-r2/`): 00-initial, 01-empty-state, 02-dragging-a-pdf-over-the-app, 03-demo-score-loaded, 04-playing-playhead-at-bar-3, 05-track-2-muted-track-1-gain-40, 06-tempo-140, 07-seeked-to-bar-6-by-clicking-measure, 08-parse-warnings-expanded, 09-error-banner, 10-orchestral-score-24-pages-6-tracks-seeke, 11-scanned-pdf-rejected.

My own (`scratchpad/probe-r2/`): a1-ensemble-end-after-sweep, a2-ensemble-last-bar, a3-playing-crossed-to-page2, a4-playing-meters-6tracks, a5-solo-track1, a6-render-failure-page6, a7-loading-over-score, b1-1000x700-six-tracks, b2-1000x700-mixer-scrolled, b3-1000x700-playing, c1-820x600-demo, c2-820x600-playing, c3-820x600-ensemble, d1-1280x720-demo-bar5, e1-700x520-demo, f1-app-mode-stub-error.

Every tutorial step visibly did what its label says: drag overlay; page, chips and two strips on load with clef/key/time now in an indent left of bar 1 (the round-1 collision is gone); orange playhead and note rings at bar 3 with live meters and peak lines; M lit and fader at −8.0 dB; tempo 140 with total 0:26 → 0:20; scroll to system 2 with bar 6 highlighted; three-item warnings popover; error banner with Retry over the still-displayed score; 24-page/6-track scene on page 13 (bar 97) with six compact strips; raster rejection as a single error card.

## Round-1 issues — verification

| # | Round-1 issue | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Eager full-DPR render of every page | Fixed | 24-page sweep: rendered 2–5 pages, ≤14.7 MB, 21 releases; far seek top→bar 192: 2 rendered, 5.9 MB; DPR 2 → bitmap 1476 px for 738 px CSS within 1.6 s, back to 738 at DPR 1 |
| 2 | Mixer hides tracks beyond two | Fixed | 1400 px: 6 strips in a 605 px panel, no overflow; 1000×700: `overflow true, hiddenStrips 1`, “+1 more” pill, chevrons shown, edge fade; chevron click → scrollLeft 104 |
| 3 | Peak marker stuck at 0 dBFS | Fixed | marker offset 331 px on a 662 px meter (peak 0.5) while level 0.13–0.48; moved to 323 px on a new peak; after 1.5 s paused: offset 662, opacity 0 |
| 4 | Loading splits the score column | Fixed | `scorePanelHidden true, progressVisible true` with a score in state (see issue 1 below for what still leaks) |
| 5 | Tempo field keeps out-of-range text | Fixed | type 500 + Enter → field “240”, slider 240, tempo 240; type 7 + blur → “30”/30; empty + blur → “30” |
| 6 | Bar-1 heads over clef/key/time | Fixed | 03-demo-score-loaded: clefs, key and 3/4 sit in the indent; first noteheads clear |
| 7 | <900 px clipped | Fixed (cramped) | 820×600: every scrollWidth 820, master slider at x 690, Load demo at x 771, strip 2 at x 124; score view 184 px tall |
| 8 | No follow-back on same-measure seek | Fixed | scrollTop 6000 → 0 after Rewind at bar 1; Play start also reveals |
| 9 | DPR changes unobserved | Fixed | see 1 |
| 10 | Playhead linear in measure fraction | Fixed | 8 onsets in bars 6–7: error 0.0 pt each; midpoint between two onsets: 217.2 vs 217.2 expected |
| 11 | A11y / disposal hygiene | Fixed | `aria-valuenow/valuetext` on `role=progressbar`; one `role=alert` visible in both error paths; `dispose()` covers listeners, observers, timer |

## What is good

- The render pipeline is now a proper virtualiser: IntersectionObserver with 25 % margin, sequential priority queue (visible → below → above), release beyond ±2 pages, DPR cap 2 plus a 16 Mpx budget, lazy re-render after resize, far seeks scroll instantly. On a 24-page ensemble the bitmap never exceeded 14.7 MB during a full sweep.
- Playhead motion is musically right: piecewise-linear through the onsets of the current bar, gliding to the barline after the last onset, exact to the tenth of a point at every onset tested. Note rings and bar highlight agree with it on every staff of a six-staff system.
- Transport semantics remain correct: bar·beat plus m:ss recomputed at the live tempo (576 qn at 30 bpm → 19:12), seek fill, reset-tempo enable state, End → last segment start (573), Arrows nudge by measure, Space toggles and is ignored on buttons and text fields.
- Mixer: solo dims every non-soloed strip (`is-silenced`), mute lights amber, dB readouts correct (0.8 → −1.9, 0.7 → −3.1, 0.4 → −8.0), peak hold 900 ms with time-based decay in its own rAF loop that stops when idle.
- Error handling is disciplined: banner only when a score is still on screen or for local errors, stage card otherwise, never both (1 alert in both probes); render failure shows an explanatory placeholder and does not retry-storm (renderCalls stable at 50); app mode with the stub parser yields a clean error card and zero uncaught rejections.
- Runtime hygiene: 60 fps, 16.8 ms longest frame, 3.8 MB heap, DOM node count 714 → 696 after seven alternating demo/ensemble loads (note pool reused, strips rebuilt cleanly).
- Craft: coherent dark DAW aesthetic, one accent for controls and one for time, tabular numerals, icon-only header buttons with aria-labels below 900 px, page placeholders labelled “Page N”, failed pages visually distinct.

## What is wrong (ranked)

1. **Minor — busy state is inconsistent while a new file loads over a displayed score.** With `status: 'loading'` and the old score still in state (exactly what `controller.loadFile/loadDemo` produce before parsing), the header title already reads “Next piece.pdf / Loading file…” while the meta chips (PAGES 24, TRACKS 6, …) and the warnings chip still describe the old score, the mixer keeps all six old strips with their S/M states, and the transport stays fully enabled showing “bar 43 · beat 1  4:12 / 19:12” (`playDisabled: false`). A user can press Play on the outgoing score during the load. Fix: when `busy`, hide `.header-meta` and the warnings chip, hide or dim the mixer strips (or show “Loading…” in the mixer), and disable transport controls (`hasScore && !busy`). Evidence: a7-loading-over-score, `findings.loadingOverScore`.
2. **Minor — follow mode fights manual scrolling during playback.** With follow on, scrolling away by hand is yanked back at the next bar change (scrollTop 9000 → 995 within 1.2 s at 240 bpm), so a player cannot look ahead while it plays without first toggling follow off. Fix: detect user-initiated scroll (wheel/touch/pointer, distinguished from programmatic `scrollTo` by a flag set around it) and suspend following until the next explicit seek/play or a “Back to playhead” click; keep the toolbar toggle as the hard switch. Evidence: `findings.manualScrollDuringPlay`.
3. **Minor — sub-900 px layout leaves almost no room for the score.** At 820×600 the score view is 184 px tall (shows the title and the top of one staff; while playing, the bass staff is cut off) because the mixer bottom row is a fixed ~194 px even with two strips and the transport takes 108 px; at 700×520 the score view is 129 px. Fix: a collapsible mixer drawer (toolbar button, remembered), or auto-collapse the mixer to its 30 px toolbar when viewport height < 700, and drop `.strip-body` to 56 px below 900 px width regardless of height. Evidence: c1, c2, e1; `narrow820.scoreView.h 184`, `tiny700.scoreH 129`.
4. **Minor — render-failure text is drawn under the overlay and a failed page is never retried.** On a page whose `renderPage` rejected, “Page 6 could not be rendered (…)” is crossed by the measure highlights and playhead line; and because `failedKey` matches until scale/DPR changes, scrolling away and back never retries. Fix: for `.page.is-failed` raise the placeholder above `.page-overlay` (or hide highlights there) and add a retry on click / clear `failedKey` when the page re-enters the render range after being released. Evidence: a6-render-failure-page6; `scoreView.ts` lines 303 and 345.
5. **Minor — error card prose is set in monospace pink.** `.error-state .stage-text` renders user-facing sentences (“This looks like a scanned (raster) PDF; only vector-engraved scores are supported…”, “parsing module not implemented”) like a stack trace. Fix: keep the UI font and colour for the message; reserve monospace for an optional technical “details” line. Evidence: 11-scanned-pdf-rejected, f1-app-mode-stub-error.
6. **Minor — compact strips truncate names with only a hover title.** Above four tracks the 90 px strips show “Clarinet …” and “Double …” (`truncated: true`), and the instrument label is dropped. Fix: allow two-line names (`-webkit-line-clamp: 2`) or abbreviate known instrument names, and put the full name in the strip header’s tooltip (it is already on the name span). Evidence: 10-orchestral, b1, `compact1000.names`.
7. **Minor — meter fill is linear in level.** A level of 0.1 (−20 dB) is a 10 % sliver; most musical dynamics live in the bottom third of the meter. Fix: map level to a dB law (e.g. −60…0 dB → 0…1) for both fill and peak marker, with the gradient thresholds at −18 dB / −6 dB. Evidence: `mixer.ts` `applyMix` `scaleY(1 - shown)`; a4.
8. **Minor — no current-page indicator on long scores.** The toolbar shows “24 pages” and “bar 97” but not which page is on screen. Fix: derive from `visiblePages` (already tracked in render stats) and show “Page 13 of 24” in `pageLabel`.
9. **Minor — warnings popover has no focus management.** `role="dialog"` opens without moving focus and Escape closes without returning it. Fix: focus the popover title on open, return focus to the chip on close.
10. **Minor (showcase-only) — focus ring around the score view in steps 7–9.** The synthetic `.click()` on the measure button followed by `scroll.focus()` leaves a `:focus-visible` outline; a real pointer click does not (verified in round 1). Fix: skip `scroll.focus()` when `event.detail === 0`, or drive the click through a pointer event sequence in the showcase.

## Numbers

| Metric | Value |
| --- | --- |
| Console errors / warnings (showcase + 6 probe pages) | 0 / 0 |
| Showcase steps | 11/11 ok |
| fps during steps | 60.4–62.6 |
| Longest frame | 16.8 ms |
| readyMs | 53 |
| JS heap | 3.8 MB used / 8.2 MB total |
| DOM nodes after 7 alternating loads | 714 → 696 |
| 24-page sweep (13 positions) | rendered 2–5, bitmap ≤14.7 MB, 24 render calls, 21 releases |
| Far seek top → bar 192 | 2 rendered, 5.9 MB, +2 render calls |
| DPR 2 emulation | bitmap 1476 px for 738 px CSS after ≤1.6 s; 23.5 MB for 2 pages |
| Playhead error at 8 onsets | 0.0 pt each; midpoint 217.2 vs 217.2 |
| Peak marker | 331 px offset at peak 0.5 on 662 px meter; 662 px + opacity 0 after 1.5 s paused |
| Tempo clamp | 500 → 240 (field/slider/state); 7 → 30; '' → last |
| 1000×700 six tracks | mixer 450 px, overflow true, +1 more, chevrons, page 494 px |
| 820×600 | all scrollWidths 820; score view 184 px; mixer row 194 px; transport 108 px |
| Unit tests | 42/42 |

## Score rationale

Requirements coverage is complete, the three shipping blockers from round 1 are demonstrably fixed with numbers rather than claims, the playhead is now exact on real onset positions, and the runtime is clean, fast and leak-free. That is a shippable desktop UI shell. It is not higher than 8.8 because the busy state still leaks the outgoing score into the header chips, mixer and an enabled transport, follow mode cannot be looked past without toggling it off, and under 900 px the score is squeezed to a strip. None of these would stop me putting it in front of users at laptop sizes and up; all ten items are polish for the next round or for the integrator to schedule.
