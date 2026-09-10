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

## audio — Pin down `ScheduledNote.gain` and the `renderOffline` `trackIds` semantics   (status: open)
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

## audio — Scheduled-log entries for notes joined mid-way (seek/resume inside a held note)   (status: open)
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

## parsing — Document where a bar-start grace note is filed (`NoteEvent.measure`)   (status: open)
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

## parsing — Optional `Measure.volta` for alternative endings   (status: open)
Why: the parser now detects volta brackets (1st/2nd endings) and unfolds them correctly into
`ScoreModel.timeline` (the 1st ending is skipped on the repeat pass), but the model has no place to say
which measures are endings, so the UI cannot label or dim them and a consumer cannot re-derive the
timeline. Repeat barlines already have `repeatStart`/`repeatEnd`.
Change: in `src/core/types.ts`, `Measure` gains
`/** Passes on which this measure is played when it sits under a volta bracket (e.g. [1] or [2]); absent = every pass. */ volta?: number[];`
Workaround used meanwhile: voltas live only in the timeline and in `ScoreDocument.debug.measures[].volta`
(shown by the parsing showcase); `Measure` objects carry no volta field.
