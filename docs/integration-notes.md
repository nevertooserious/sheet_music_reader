# Integration notes

The integrator records here what changed in `src/core` / `tools/verify` between
waves and any glue that had to touch a module folder.

## Integrate 1 (after the ui wave; parsing and audio still stubs)

Core changes (no module folder was edited):

- `contracts.ts`: applied the ui request on `ScoreDocument.renderPage` (scale =
  PDF points → device px, implementation sets only the bitmap size, UI owns the
  CSS box). Pinned the seams wave 2 must honour: `ScoreParser.parse` rejects with
  a user-readable sentence; `AudioEngine.load()` stops, rewinds, adopts the score
  tempo and builds one `TrackMixState` per track at `defaultGain`; `getState()`
  reflects setters synchronously; `ScheduledNote.qn` is the note's `startQn`;
  `renderOffline` length is the range at tempo plus a short tail; `play()` is a
  no-op without a score and restarts from 0 at the end. `AppController` documents
  the load state machine.
- `controller.ts`: every load path (`loadFile`, `loadArrayBuffer`, `loadDemo`)
  now ends in `status: 'error'` when anything fails — including
  `file.arrayBuffer()` and `fetch` failures that previously left the store stuck
  in `loading`. Overlapping loads are sequenced: a superseded load's document is
  disposed and it never writes to the store. Playback pauses as soon as a load
  starts and stops when parsing starts. `engine.load()` throwing disposes the
  fresh document and surfaces as an error.
- `main.ts`: `/?autoload=demo` no longer `console.error`s a failed load; the
  failure is already `AppState.error` and rendered by the UI, and the duplicate
  log made the zero-console-error check fail while parsing is a stub.
- `ARCHITECTURE.md` "Contracts" and "Runtime wiring" updated to match.
- New unit test `src/core/controller.test.ts` for the load state machine.

Verifier: no bug found; `tools/verify` unchanged. The full `npm run verify`
fails only on "demo song parses to ready" (stub parser), as expected at this stage.
