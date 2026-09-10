# Core change requests

Builders append requests here; the integrator applies or rejects them between
waves and records the outcome. Format:

```
## <module> — <short title>            (status: open | applied | rejected)
Why: ...
Change: (exact diff or precise description of the change to src/core or tools/verify)
Workaround used meanwhile: ...
```

---

## ui — Clarify who owns the canvas CSS size in `ScoreDocument.renderPage`   (status: applied)
Why: `contracts.ts` says "The implementation sizes the canvas itself". If the parser sets
`canvas.style.width/height` as well as the bitmap size, the page div (which the UI sizes
from `PageInfo × scale` so overlays stay in % coordinates) and the canvas can disagree
after a resize while a render is in flight. The UI renders at `scale × devicePixelRatio`
and must own the CSS box.
Change: in `src/core/contracts.ts`, `ScoreDocument.renderPage` doc comment →
"Draw one page onto a canvas at the given scale (1 = PDF points → device px; the UI
passes CSS scale × devicePixelRatio). The implementation sets `canvas.width`/`canvas.height`
(bitmap size) only and must not set inline CSS size; the UI owns the CSS box."
Workaround used meanwhile: `src/ui/scoreView.ts` forces `canvas.style.width/height = '100%'`
after every render resolves.
Outcome (integrator, Integrate 1): applied verbatim to `src/core/contracts.ts` (`ScoreDocument.renderPage`
doc comment: scale = PDF points → device px, implementation sets bitmap size only, UI owns the CSS box)
and mirrored in ARCHITECTURE.md "Contracts". The UI's `canvas.style.width/height = '100%'` after render
is now redundant but harmless and was left in place.

## audio — Pin down `ScheduledNote.gain` and the `renderOffline` `trackIds` semantics   (status: applied)
Why: `ScheduledNote.gain` has no unit in `contracts.ts`, and `OfflineRenderOptions.trackIds`
says only "Track ids to include; default all unmuted". The engine had to pick a meaning for
both; writing it into the contract stops the verifier, UI and a future engine from guessing.
Change: in `src/core/contracts.ts`
- `ScheduledNote.gain` doc comment → "Velocity-mapped peak amplitude of the voice envelope
  (0..1) before track and master gain; a muted track still schedules its notes so unmuting
  mid-note is audible."
- `OfflineRenderOptions.trackIds` doc comment → "Track ids to include. When given, exactly
  these tracks are rendered at their fader gain regardless of mute/solo (the caller is choosing
  what to hear); when omitted, every track is rendered at its live effective gain, i.e. mute and
  solo apply."
Workaround used meanwhile: `src/audio/engine.ts` implements exactly these semantics and
documents them in its `renderOffline` comment; the verifier's checks pass either way.
Outcome (integrator, Integrate 2): both doc comments applied verbatim in `src/core/contracts.ts`
(`ScheduledNote.gain`, `OfflineRenderOptions.trackIds`) and mirrored in ARCHITECTURE.md "Contracts".
No module change needed; `tools/verify/run.mjs` already passes `trackIds: [firstTrack]` and expects the
fader-gain reading (solo RMS below the full mix).

## audio — Scheduled-log entries for notes joined mid-way (seek/resume inside a held note)   (status: applied)
Why: The engine now starts notes that are already sounding at the position a seek, resume or
offline render begins from (e.g. a 2-qn bass chord when playback resumes at 0.5 qn), joining the
envelope part-way instead of dropping the note. Such a voice is really scheduled, so it is logged
with `qn = startQn` (unchanged, per the contract) and `time` = the actual start; its `durationSeconds`
is the remaining part. `tools/verify/run.mjs` ("notes scheduled after seek come from seek region")
asserts `every(n => n.qn >= mid - 0.01)`, which a held note crossing the seek point would fail even
though the behaviour is correct. The bundled fixture has no note crossing a barline (verified against
`fixtures/bach-minuet-g/reference.mid`), and the verifier seeks to a barline, so the check passes today.
Change: in `tools/verify/run.mjs`, accept log entries whose note spans the seek point:
  `log2.every((n) => n.qn >= mid - 0.01 || spansSeek(n))` where `spansSeek` looks the note up in
  `score.tracks` by `trackId`/`midi`/`startQn` and tests `startQn < mid && startQn + durationQn > mid`.
  Optionally document in `contracts.ts` (`ScheduledNote`): "A note joined mid-way after a seek keeps
  `qn = startQn`; `durationSeconds` is the remaining sounding time."
Workaround used meanwhile: none needed for the fixture; documented here so the semantics are explicit.
Outcome (integrator, Integrate 2): `tools/verify/run.mjs` "notes scheduled after seek come from seek region"
now accepts a log entry with `qn < mid` only when the score has a note with that trackId + midi + startQn
whose span strictly contains the seek point (`startQn < mid && startQn + durationQn > mid + 0.01`); the note
text reports how many such held notes were seen (0 on the fixture). `ScheduledNote.qn` in `contracts.ts`
documents the joined-mid-way semantics (`qn = startQn`, `durationSeconds` = remaining time). Not a threshold
change: an entry that neither starts at/after the seek point nor spans it still fails the check.

## parsing — Document where a bar-start grace note is filed (`NoteEvent.measure`)   (status: applied)
Why: `NoteEvent.measure` is documented as "the printed measure this note came from". A grace note printed
at the very start of a bar sounds in the last eighth of the *previous* bar (LilyPond's MIDI does the same,
and the reference MIDI expects it there). The parser files it under the bar whose time it occupies, so
`startQn` always lies inside the first timeline segment of `measure` (which `tools/verify/compare.mjs`
`printedOrderNotes` and `src/ui/format.ts` anchor computation both rely on) while `layout` shows the head
in the following bar. In the fixture this affects 2 of 408 events. The critic asked for the convention to
be written down.
Change: in `src/core/types.ts`, `NoteEvent.measure` doc comment →
"Index into ScoreModel.measures: the measure whose time span contains `startQn` (normally the printed
measure of the head). A grace note printed at the start of a bar borrows the end of the previous bar and
is filed under that previous bar; its `layout` then lies in the next measure's box."
Workaround used meanwhile: the convention is implemented and commented in `src/parsing/analyze.ts`
(grace emission) and covered by `analyze.test.ts` ("treats a small head as a grace note").
Outcome (integrator, Integrate 2): doc comment applied verbatim to `NoteEvent.measure` in `src/core/types.ts`
and summarised in ARCHITECTURE.md "Core model". `tools/verify/compare.mjs` `printedOrderNotes` and the UI's
anchor computation already rely on exactly this invariant (startQn inside the first segment of `measure`).

## parsing — Optional `Measure.volta` for alternative endings   (status: applied)
Why: the parser now detects volta brackets (1st/2nd endings) and unfolds them correctly into
`ScoreModel.timeline` (the 1st ending is skipped on the repeat pass), but the model has no place to say
which measures are endings, so the UI cannot label or dim them and a consumer cannot re-derive the
timeline. Repeat barlines already have `repeatStart`/`repeatEnd`.
Change: in `src/core/types.ts`, `Measure` gains
`/** Passes on which this measure is played when it sits under a volta bracket (e.g. [1] or [2]); absent = every pass. */ volta?: number[];`
Workaround used meanwhile: voltas live only in the timeline and in `ScoreDocument.debug.measures[].volta`
(shown by the parsing showcase); `Measure` objects carry no volta field.
Outcome (integrator, Integrate 2): `volta?: number[]` added to `Measure` in `src/core/types.ts` with the requested
doc comment and listed in ARCHITECTURE.md "Core model". So the field is not a dead declaration, the integrator
made a three-line glue change in `src/parsing/analyze.ts` (recorded in docs/integration-notes.md): the repeat
measures are passed through `extendEndings` once, the timeline is built from that list, and each `Measure` gets
`volta` from it, so a continuation bar after a line-broken bracket carries the same passes as the bar that
opened the ending. The fixture has no alternative endings (plain repeat barlines at measures 15/16/31), so on
the demo every `volta` is undefined and the timeline is unchanged; the field is exercised by the synthetic
two-line volta page (`src/parsing/syntheticScene.ts`, parsing showcase step 7). The UI does not yet read the field.

## parsing — `ParseOptions.pages` (1-based page selection)            (status: applied by the orchestrator, 2026-09-10)
Why: staging the parsing showcase on a page range of a large external PDF (the Sibelius reference guide) without parsing all 807 pages.
Change: `pages?: number[]` on ParseOptions in src/core/contracts.ts; `ScoreDocument.pages` indexed in the selected order; all-invalid input rejects with a message.
Workaround used meanwhile: none.

## parsing — showcase `--query` and rate-based playback check in tools/verify    (status: applied by the orchestrator, 2026-09-10)
Why: `showcase.mjs --query "pdf=...&pages=..."` forwards parameters so critics can screenshot any engraved PDF; the run.mjs "transport is playing and advancing" check compared position with wall time across a screenshot and failed under machine load (4.25 vs 5.79 qn); it now measures the advance rate over a one-second window (±15 %).
Workaround used meanwhile: none.

## core — `DEMO_URL` built from `import.meta.env.BASE_URL`            (status: applied directly at the user's request, 2026-09-11)
Why: GitHub Pages serves the app under `/sheet_music_reader/`; a root-relative `/fixtures/...` URL 404s there. Same change made in `src/parsing/showcase.ts` for its fixture paths.
Change: `export const DEMO_URL = \`${import.meta.env.BASE_URL}fixtures/bach-minuet-g.pdf\`;` in src/core/controller.ts.
Workaround used meanwhile: none.
