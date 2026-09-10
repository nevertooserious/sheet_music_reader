# Sheet Music Reader — Architecture

Reads PDF sheet music and turns it into layered, playable music in the browser.
Each staff becomes an independently mixable track; playback can start from any
point; tempo is adjustable live.

## Approach

Most sheet-music PDFs that people download today are engraved by notation
software (LilyPond, MuseScore, Finale, Sibelius) and contain the music as
**vector glyphs from a music font** plus **vector paths** (staff lines, stems,
beams, barlines). We recover the music from that structure directly with
pdf.js instead of doing pixel-level optical music recognition:

1. Walk the page operator list, tracking the graphics + text state, to collect
   every glyph placement (font, glyph name, size, x, y) and every path
   segment (lines, rectangles, filled polygons) in page coordinates.
2. Identify glyphs through the embedded font's encoding (`differences` /
   `defaultEncoding` from pdf.js with `fontExtraProperties: true`).
   Emmentaler (LilyPond) uses names such as `noteheads.s2`, `clefs.G`,
   `accidentals.sharp`, `rests.2`, `flags.u3`; SMuFL fonts (Bravura, Leland,
   MScore) use Private-Use-Area code points. A font adapter maps either to a
   common glyph vocabulary.
3. Detect staves (five equally spaced horizontal lines), group them into
   systems, assign glyphs to staves, read clefs / key / time signatures,
   split by barlines into measures, and derive pitch (vertical position +
   clef + key + accidentals) and duration (notehead type + stem + flags /
   beams + dots) for every notehead and rest.
4. Assemble a `ScoreModel`: tracks (one per staff), measures with page layout
   boxes, a repeat-unfolded playback timeline, tempo, and warnings.

Scanned (raster) PDFs are out of scope for the first release. The parser must
detect the case (no music-font glyphs) and fail with a clear message rather
than guessing. The `ScoreParser` contract is engine-agnostic so a raster
engine can be added behind it later.

## Folders — one per subsystem

```
src/core/      shared model + contracts + store + controller + bootstrap   (integrator only)
src/ui/        application UI: import, score view, transport, mixer         (ui builder)
src/parsing/   PDF → ScoreModel (pdf.js, glyph/path extraction, OMR logic)  (parsing builder)
src/audio/     Web Audio engine: scheduler, synth, per-track gains, offline (audio builder)
tools/verify/  Chrome-driven verification loop (puppeteer-core + system Chrome)
fixtures/      public-domain test material (PDF + reference MIDI + source)
public/        static assets served by Vite (demo PDF)
docs/          STATUS.json, critic reports, core change requests
```

Dependency direction: `ui`, `parsing`, `audio` → `core` only. Subsystems never
import each other. `core/main.ts` is the only place the three meet.

## Core model (src/core/types.ts)

- **Time**: quarter notes (`qn`) on a repeat-unfolded timeline; tempo is qn/min.
- **Layout**: PDF points, top-left origin, scale 1 (pdf.js viewport at scale 1).
- `ScoreModel { tracks[], measures[], timeline[], timeSignatures[], keySignatures[], tempoBpm, durationQn, warnings[] }`
- `Track { id, name, instrument, clef, staffIndex, notes: NoteEvent[], defaultGain }`
- `NoteEvent { midi, startQn, durationQn, velocity, measure, layout? }` —
  `measure` is the measure whose time span contains `startQn`; a grace note
  printed at the start of a bar is filed under the previous bar (its `layout`
  sits in the next bar's box).
- `Measure { index, durationQn, layout: LayoutBox[] (one per staff), firstStartQn, repeatStart?, repeatEnd?, volta? }`
  — `volta` lists the passes on which the measure plays under an alternative-ending bracket.
- `TimelineSegment { measure, startQn, durationQn }` — playback order (repeats expanded).
- `TransportState { playing, positionQn, tempoBpm, masterGain, tracks: TrackMixState[], contextState }`

## Contracts (src/core/contracts.ts)

- `ScoreParser.parse(ArrayBuffer, { fileName, onProgress, unfoldRepeats }) → ScoreDocument`
  where `ScoreDocument { score, pages, renderPage(pageIndex, canvas, scale), dispose }`.
  `renderPage` draws at `scale` = PDF points → device pixels (the UI passes CSS
  scale × devicePixelRatio) and sets only the canvas bitmap size; the UI owns the
  canvas CSS box. `parse` rejects with a user-readable sentence (shown verbatim in
  the error card) for raster PDFs, non-PDF data, or scores with no notes.
- `AudioEngine`: `load, play, pause, stop, seek, setTempo, setMasterGain,
  setTrackGain, setTrackMuted, setTrackSolo, getState, subscribe,
  getScheduledLog, clearScheduledLog, renderOffline, dispose`.
  `load()` stops, rewinds to 0, adopts `score.tempoBpm` and builds one
  `TrackMixState` per track at `defaultGain`. `play()` resumes the AudioContext.
  Tempo changes apply immediately while playing. `getState()` reflects every
  setter synchronously. `play()` resolves even when the context cannot start
  (`playing` stays false; a later `play()` retries). `getScheduledLog()` records
  every note actually scheduled (`qn` = the note's `startQn`, also for a note
  joined mid-way after a seek, whose `durationSeconds` is then the remaining
  part; `gain` = velocity-mapped peak before track/master gain) so the verifier
  can prove that what plays is what was parsed. `renderOffline` renders a range
  to an `AudioBuffer` for sound-level checks; its length is the range at the
  given tempo plus a short release tail; an explicit `trackIds` list renders
  exactly those tracks at fader gain (mute/solo ignored), no list = the live
  mix.
- `AppStore` (read) + `AppController` (write) are the **only** things the UI
  touches. The controller wraps the parser and engine. Loads go
  `loading` (previous score kept, playback paused) → `parsing` (previous score,
  pages and document cleared, playback stopped) → `ready` | `error`; a failure at
  any stage ends in `status: 'error'` with the message the UI displays, and the
  load promise rejects with that same error. Overlapping loads: the newest wins,
  superseded results are disposed without touching the store.
- `Showcase { name, steps[], runStep(i), getDiagnostics() }`: every module
  ships `src/<module>/showcase.ts` exporting `createShowcase(root)`; it is
  reachable at `/?showcase=<module>` and stages a representative scene of just
  that module, using `core/demoScore.ts` (a synthetic two-track score) or the
  fixture PDF. The steps are a tutorial the verifier screenshots one by one.

## Runtime wiring (src/core/main.ts)

`/` boots the app: store → parser → engine → controller → `mountApp(root, { store, controller })`.
`/?autoload=demo` also imports the bundled demo (a failure is surfaced only via
`AppState.error`, never as a console error). `/?showcase=<module>` boots only
that module's showcase. In every mode `window.__smr` (`TestHooks`) exposes
`ready`, `store`, `controller`, `engine`, `parser`, `showcase`, and `errors`
(console errors captured in-page). `#app[data-status="ready"]` mirrors `ready`.

## Verification loop (tools/verify)

Built before the app; every claim about the app must come from it or from a
screenshot taken by the agent.

- `npm run verify` → `tools/verify/run.mjs`: launches the installed Chrome
  headless, opens the app, waits for ready, imports the demo song via the
  controller, compares the parsed `ScoreModel` to `fixtures/bach-minuet-g/reference.mid`
  (per-track onset+pitch F1, pitch-sequence LCS, duration accuracy; both
  unfolded and printed-order variants), then plays, seeks, changes tempo,
  adjusts per-track gain/mute, pauses, renders audio offline, screenshots each
  stage, and writes `tools/verify/out/app/report.json` with console errors,
  perf, and per-check pass/fail. Non-zero exit on any failure.
- `npm run verify:showcase -- <module>` → `tools/verify/showcase.mjs`: opens
  the module showcase, screenshots the initial scene and every tutorial step,
  records fps, perf, console errors and diagnostics to
  `tools/verify/out/showcase-<module>/report.json`.
- Unit tests: `npm test` (vitest) for pure logic (glyph classification, pitch
  math, scheduler math, comparison utilities).

Fixture: Bach (attr. Petzold), *Menuet in G*, BWV Anh. 114, from the Mutopia
Project (public domain), engraved with LilyPond 2.19 (Emmentaler fonts). Two
staves, 3/4, G major, 32 printed measures with two volta repeats. The reference
MIDI is not unfolded (129 + 75 notes).

## UI requirements (src/ui)

- Import: drag-and-drop, file picker, and "Load demo" button.
- Score view: rendered pages (via `controller.renderPage`) with a moving
  playhead / current-measure highlight driven by `transport.positionQn` and
  `score.timeline`; clicking a measure seeks there (`seekToMeasure`).
- Transport: play/pause/stop, position (measure + mm:ss), seek slider over
  `durationQn`, tempo control (30–240 bpm with reset to the score's tempo).
- Mixer: one strip per track with name, gain slider, mute, solo, level meter.
- Status: loading/parsing progress, error banner, parse warnings list.
- Test attributes the verifier looks for: `[data-action="toggle-play"]`,
  `[data-control="tempo"]`, `[data-control="seek"]`,
  `[data-control="track-gain"]` (one per track), `[data-role="score-view"]`,
  `input[type="file"]`.

## Audio requirements (src/audio)

- Web Audio; per-track `GainNode` → master `GainNode` → destination; solo/mute
  logic in the engine; lookahead scheduler (≈25 ms tick, ≈120 ms horizon)
  that maps qn → context time and survives tempo changes and seeks without
  hanging notes; polyphonic synth with a pleasant piano-like timbre and
  velocity; no clicks (envelopes on every note); playhead reported at
  animation-frame rate; `renderOffline` uses `OfflineAudioContext` with the
  same synth code path.

## Parsing requirements (src/parsing)

- pdf.js in the browser (worker via Vite `?url` import), `fontExtraProperties: true`.
- Vector extraction with full graphics-state tracking (CTM, text matrix,
  save/restore, font size).
- Emmentaler and SMuFL glyph adapters; unknown fonts → warning.
- Staves, systems, clefs (G/F/C incl. octave variants), key signatures,
  accidentals with measure-scoped memory, time signatures, noteheads (whole /
  half / black), stems, flags, beams, dots, rests, ties (merge durations),
  chords (same-x heads), grace notes (small fonts), barlines and repeats,
  basic multi-voice fallback (stem direction).
- Emits `layout` for every note and measure so the UI can highlight.
- Clear error for raster PDFs; warnings for anything skipped.

## Process rules (from the brief)

- Builders own only their folder. Core changes are requested in
  `docs/core-change-requests.md` and applied by the integrator.
- Every module ships a showcase; nobody claims anything they have not run and
  looked at through `tools/verify`.
- A critic (no code) scores each module 0–10 from its own screenshots,
  contract checks, console errors and perf. Pass = ≥ 8.5 with zero errors.
  Up to 4 builder rounds per module. Scores and open issues persist in
  `docs/STATUS.json`; iteration resumes from the weakest module.
- Waves: (1) ui; (2) parsing, audio; integrator between waves; final gate.
