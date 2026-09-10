# Critic report — parsing, Sonata-layout fonts, round 2

Score: **8.0 / 10** — Pass: **no** (threshold 8.5). Console errors: 0 (6 Chrome runs). Typecheck: clean. Tests: 282/282 (29 files). Verify: 28/28.

Reviewed state: commits `73537a4` and `620292c` (`git diff 214c3a3..HEAD`). `docs/STATUS.json` had an uncommitted
orchestrator edit in the working tree while this review ran; it is quoted where relevant but is not part of the commits.

Verdict in one line: every round-1 major is fixed and now pinned by a test I could run against the engraving — octave
clefs, Tc-spaced rests, the font grammar, pitch assertions — and a real 19-page Sibelius choral export (Apple Tree) now
reads 2/2, half-note = ca. 88 → 176 bpm, D major, 138 × 4-qn bars, percussion on its own tracks, with every pitch and
rhythm I checked on pages 1–2 and 5 correct; but the pitched voices still swap tracks whenever Sibelius inserts or hides a
staff (the bass is "Staff 5" on pages 3–4 and "Staff 4" from page 5 on; the soprano melody moves to "Staff 2" for bars
17–19), the CID-glyph-index guard is only half real (a default-encoding glyph name still leaks the GID through), and the
`page=` showcase parameter introduced in this change blanks the synthetic step's overlays. Good, not yet shippable for the
choral case the change set out to serve.

## What I ran (sandbox disabled)

| Command | Result |
| --- | --- |
| `OPENSSL_CONF=/dev/null npm run typecheck` | 0 errors. |
| `OPENSSL_CONF=/dev/null npm test` | **29 files, 282 tests, 282 passed** (sonata.test.ts, sonata.external.test.ts 4, appleTree.external.test.ts 2 — both PDFs present, so they ran). |
| `SMR_DEBUG=1 npx vitest run src/parsing/sonata.external.test.ts src/parsing/appleTree.external.test.ts` | 6/6. Page 365 kinds `{clef 8, notehead 97, other 17, accidental 3}`; page 324 pitches `{C2:2, C3:5, C4:12, C5:2, C6:1}`; pages 313/324/336 → 31 staves, 25 systems, 28 measures, tracks Percussion 1 (4 notes) + Staff 1–4 (84/9/9/7). Apple Tree p1: 2/2, key `[{0,0},{4,2}]`, tempo 176 (`"  = ca. 88"`), staves 4/3/3 with 5 single-line, 10 × 4 qn, tracks Percussion 1–4 (70/28/20/12) + Staff 1–2 (37/36). Whole score: 196 staves (43 single-line), 38 systems, 138 measures all 4 qn, 10 tracks, **24 warnings**, durationQn 568. |
| `node tools/verify/run.mjs --out tools/verify/out/critic2-app` | **28/28 PASS**: F1 1.000, LCS 1.000, duration 1.000 (129/129, 75/75), 0 warnings, parse 238 ms, 61.2 fps, rate check 2.00 qn/s (expected 2.00), 0 console errors, 0 failed requests. Fixture unaffected; tracks still "Right hand" / "Left hand". |
| `node tools/verify/showcase.mjs parsing --out tools/verify/out/critic2-showcase` | OK 7/7, errors 0, parse 186 ms, F1/LCS/dur 1.0, Emmentaler fonts only. |
| `… --query "pdf=/tools/verify/out/opus/sib8-reference.pdf&pages=324,336&page=0"` → `critic2-sib324` | OK 7/7, errors 0, parse 188 ms; 29 staves, 23 systems, 24 measures, 8 clefOctave marks. |
| Same with `page=1` → `critic2-sib336` | OK 7/7, errors 0, parse 168 ms. **Step 7 screenshot has no overlays** (issue 3). |
| `… --query "pdf=/fixtures/external/apple-tree.pdf&pages=1,2,3&page=0"` → `critic2-apple-p1` | OK 7/7, errors 0, parse 182 ms; 32 staves, systems 4/3/3/3/3/4/6/6, 9 tracks, 459 heads, 124 rests, tempo "176 bpm (▯ = ca. 88)". |
| Same with `page=1` → `critic2-apple-p2` | OK 7/7, errors 0, parse 179 ms. Step 7 again without overlays. |
| Throwaway vitest files in the scratchpad (not in the repo) | Per-track, per-measure note dump for Apple Tree pages 1–2 and the whole score; text runs on page 1 (tempo line); glyph code points; `sonataCode` / `sonataFamily` / `readTempo` / `metronomeBeatQn` probes. |
| Puppeteer crops of the engraving (scratchpad script, output under `tools/verify/out/critic2-pages/`) | Page 1 systems 1–3 at 2×, bar 10 at 4×, page 2 systems, pages 3, 5, 16 full, page 5 top at 2×. |

The IntelliJ LSP is not available for this project; symbol lookups were by reading the diff, not by proving anything unused.

## Round-1 issues — verified one by one

| # | Round-1 issue | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Octave clefs lose their octave | **Resolved** | Opus Special 0xDC/0xDD → `clefOctave`; `clefOctaveFromDigits` skips the size filter for them and takes the side of the middle line. Page 324 parses 22 notes, all C: `{C6:1, C5:2, C3:5, C2:2, C4:12}` — treble 15ma C6, treble/bass 8va C5, treble 8vb / optional (8) / double treble / tenor 8vb / bass 8vb C3, bass 15mb C2 (one C2 carried into the clef-less "blank clef" example, as the test comment says). Apple Tree's tenor (treble 8vb, "8" drawn separately on every system from page 3) reads B3–F#4 with the octave applied. Pinned in `sonata.external.test.ts`. |
| 2 | Tc folded into advance | **Resolved** | `advance` = glyph width only, pen still moves by `tx`; text runs keep the pen advance. Page 336 top staff = the 20-note sequence and second staff `C5/0.5 A4/0.5 D5/1.5 C5/0.5 A#4/1.5 A4/0.5 G4/1` — both pinned and both visible in `critic2-sib336/04` (the bottom-right staff now starts with the rest, then C5). |
| 3 | `SONATA_FONT` over-matching | **Resolved** | `sonataFamily()` = family prefix + closed suffix set. Probe: EngraversMT, Engravers MT, MaestroTimes, RepriseTitleStd, RepriseStampStd, RepriseRehearsalStd, JazzCord, "Jazz LET", Engraver Text T, Sonatina, Opusculum → `undefined` (→ text); OpusText/Chords/Percussion/Metronome/FiguredBass/RomanChords/FunctionSymbols/NoteNames/Ornaments/BigTime/JapaneseChords/PlainChords/ChordsSans(Condensed), NorfolkHarp/Tab/Metronome, RepriseText, Inkpen2Chords, Norfolk Special II → `ignore`; Opus/Special/SpecialExtra, Helsinki Special, Reprise Special, Lelandia, Pori, Petrucci, Sonata, Maestro Wide, Golden Age, "Opus-Std", "OpusStd,Bold" → right table. `FinaleMaestro` still SMuFL. |
| 4 | External test asserted nothing pitch-specific | **Resolved** | Page 336 sequences and page 324 octave table pinned; Apple Tree test pins 2/2, 176 bpm, 4/3/3 staves, 5 single-line staves, 10 × 4 qn, fifths 2, percussion track kind/instrument, and ≥ 95 % 4-qn bars over the whole score. It pins no Apple Tree pitch; I checked bars 5–19 by hand instead (below) and they are right — worth pinning bars 5–7 soprano/alto next round. |
| 5 | CID raw glyph index | **Partially resolved** | The final `byte` fallback is gated (`sonataCode({code: 37, fontType: 'CIDFontType0'})` → `undefined`), but pdf.js supplies a *default-encoding name* for CID glyph indices (Apple Tree's own glyphs arrive as GID 78 `name: 'N'`, GID 50 `name: 'two'`), and the `named` path runs before the CID check: `sonataCode({code: 78, name: 'N', fontType: 'CIDFontType2'})` → **78**, and `classifyGlyph` of such an Opus glyph → `{kind: 'accidental', accidental: 0}`. Apple Tree is saved only because its ToUnicode maps every glyph to `F0xx` and the PUA path wins first. A CID Opus export without ToUnicode would still get GID-numbered phantom glyphs, contrary to the claim. |
| 6 | Non-standard clef positions | **Resolved** | `resolveClef` derives an even shift ≤ 4 from the origin line; soprano, mezzo, baritone (C and F), French violin and sub-bass all read C4 on page 324 (`critic2-sib324/04`), tenor still via the step-2 rule. Emmentaler fixture unchanged (28/28), so the shift is 0 where it must be. |
| 7 | Integrator files edited directly | **Resolved** | Two entries appended to `docs/core-change-requests.md` (`ParseOptions.pages`; `--query` + rate-based playback check), both marked applied by the orchestrator. |
| 8 | `pages` all-invalid; ARCHITECTURE wording | **Resolved** | `index.ts` throws `None of the requested pages exist; "<file>" has N page(s).`; ARCHITECTURE now distinguishes "known but unsupported legacy font → error naming it" from "no recognised music glyphs → looks scanned", which matches `LEGACY_MUSIC_FONT` + the fallthrough. |
| 9 | Invisible characters in tests | **Partially resolved** | `extract.test.ts` is now pure ASCII (0 NUL bytes). `sonata.test.ts` lines 82–83 still contain literal U+F0CF and U+F0FA inside `unicode: ''` (invisible in any editor). |
| 10 | Unreachable `'ignore'` branch | Left as is | Author kept it as a defensive default; acceptable, noted. |

## Apple Tree — what a real Sibelius choral PDF now does

Verified against the engraving (crops at 2–4×), not against the author's numbers:

- **Structure**: 2/2 read from the rhythm line of system 1 (the single-line "Clap" staff is now a staff, so the 2/2 no
  longer lands on a neighbour: round 1's 22/2 is gone); key `fifths 0` for bars 1–4 (percussion only) then `2` from
  bar 5 — correct, the voices enter at bar 5 in D major; tempo `h = ca. 88` → 176 qn/min (OpusText `h` at x 97.6–102.0
  joined to the Times Bold ` = ca. 88` run at x 102.1); repeat `:||` at bar 4 → timeline 1 2 3 4 1 2 3 4 5 …; 138/138
  measures 4 qn.
- **Tracks on page 1**: Percussion 1 = Clap (and the combined Clap/Sticks line from bar 5), Percussion 2 = Sticks,
  Percussion 3 = Low Drum, Percussion 4 = Cajun (a five-line staff with a percussion clef → `drum` kind, `instrument
  'other'`), Staff 1 = Soprano, Staff 2 = Alto. Cajun bar 4: quarter rest + 6 eighths ✓ (12 timeline events = 6 × 2 passes).
- **Rhythm and pitch, bars 5–19, soprano and alto** (dump vs crops): bar 5 `F#4 F#4 F#4 F#4 A4 E4 E4` ✓, bar 6
  `E4 E4(1.5) E4 E4 E4 E4(1.5, tied into bar 7)` ✓, bar 7 `E4 E4 E4 E4(1.5)` from beat 2 ✓, bar 8 eight eighths with
  "feet__" merged ✓, bar 9 `F#4(1) F#4 F#4 F#4 F#4 F#4(1)` ✓, bar 10 `… E4 D4(1)` with the D4 tied across the page break
  into bar 11 ✓ (broken tie joined across the page), bar 11 `B3(0.5)` + rests ✓, bar 12 empty ✓, bars 13–16 match the
  crop note for note including the "moon__" and "bad,__" ties; alto is B3 throughout except the checked bar-10 last note,
  which is B3 in the 4× crop as parsed. Clap/Sticks bar 5: C5 `1.5 0.5 1.5 0.5` (x-heads, stems up) and A4 `0.5 0.5 1 …
  0.5` (stems down) ✓ matches `♩. ♪ ♩. ♪` over `♪♪ ♩ 𝄽 𝄾 ♪`.
- **Page 5, bars 41–44**: tenor `B3(1.5) B3(1.5) B3(5 = quarter tied to next bar's whole)` ✓; bass `E3(5)` ✓ (whole tied
  to a quarter); soprano divisi chords `B4+F#5`, `B4+E5` ✓; alto — see issue 2.
- **Percussion glyph decoding** on this CID export goes through the PUA path (`uni=F02F` percussion clef, `F0CF`/`F0C0`/
  `F0E2` heads, `F0B7/F0CE/F0E4/F0EE` rests); the OpusSpecial bracket ends (`F0A1`/`F0A2`) and `F09D` are `other` — no
  phantom notes at the system starts.
- **Performance**: parse 179–188 ms for 2–3 pages in Chrome; the 19-page score parses in ~250 ms under vitest.

## Ranked issues

1. **[major] Pitched voices still change tracks when the staff layout changes.** The new mapping keys only on
   rhythm / drum / pitched and then on vertical order, so any system where Sibelius adds a solo staff or hides an empty
   voice re-numbers the voices below it. Apple Tree: pages 3–4 have six pitched staves ("Two Voices or Small Group",
   S, A, T, B) and pages 5–14 four (S, A, T, B), so the **bass is "Staff 5" on pages 3–4 and "Staff 4" from page 5**;
   track "Staff 4" (`clef: treble`) holds 56 notes below C3 (B2, A2, G2, F#2 in bars 42–102) while "Staff 5 (bass)" is
   silent there; the tenor moves Staff 4 → Staff 3; on page 2 bars 17–19 the **soprano melody is on "Staff 2"** and the
   alto on "Staff 3" because the solo staff appears above them, and a real tie (F#4 "stone.__" → bar 17) is not merged
   because `joinBrokenTies` looks the staff up by position (`system.staves[a.staff.index]`). Muting or soloing a voice —
   the product's core promise — therefore does not follow a voice. ARCHITECTURE's "so choral scores whose percussion lines
   come and go keep their voices together" is true for the percussion only. The orchestrator's uncommitted STATUS.json
   discloses this; the commits do not. A cheap first step exists inside the current design: add the clef signature
   (treble / treble-8vb / bass / alto) to the kind key, which alone keeps S/A, T and B apart here; the staff-name text
   Sibelius prints at every entry ("Soprano", "Alto", "Tenor", "Bass") is the real answer.
2. **[minor] Seconds in a chord are read as two onsets.** Alto divisi `E4+F#4` (bars 41, 43, 49, 51, 93, 95, 101) and
   `E4+F#4` in Staff 3 (bars 127, 129, 135, 137): the displaced upper head is emitted at `+0.25 qn` (`E4/1@0.00
   F#4/1@0.25 E4/1@2.00`), so 11 notes sound a sixteenth late and the second chord of the bar loses its F#4. Pre-existing
   chord grouping (same-x heads), but this is what a Sibelius choral score exposes; the round-1 "note-for-note" claim does
   not extend to clusters.
3. **[minor] New showcase bug: `page=N` with N > 0 blanks the synthetic step.** `onPage()` filters every overlay by the
   URL `pageIndex`; the synthetic scene's items are on page 0, so `critic2-sib336/07` and `critic2-apple-p2/07` show the
   synthetic page with no labels, voltas, tuplet or tie overlays while the side panel claims 17 notes and 3 voltas. Only
   the fixture run (`page` unset) and `page=0` runs draw them. Introduced by making `pageIndex` configurable.
4. **[minor] The CID guard is not what the commit says.** See round-1 item 5: a default-encoding name maps a glyph index
   back onto itself (`'N'` → 0x4E → natural, `'two'` → 0x32 → Opus Special notehead). `named` should be trusted only for
   simple (non-CID) fonts, as the byte already is; a unit test with `name` set and no unicode would have caught it.
5. **[minor] Tempo text carries a PUA character.** `TempoMark.text` is `" = ca. 88"`; the showcase renders it as
   "176 bpm (▯ = ca. 88)" (`critic2-apple-p1/04`). Map the beat back to a readable token ("half = ca. 88" or ♩/𝅗𝅥) before
   storing it. Also, the line-join heuristic prepends whatever text ends within 6 em to the left ("hunt-ing  = ca. 88" in
   a probe), and a Sonata text run whose first letter is not a note letter (e.g. "mf") yields beat 1 (`h` after `mf` →
   88, not 176). SMuFL metronome glyphs (U+ECA2–ECA9, MuseScore's "Leland Text") are not in the regex, so a MuseScore
   "half = 60" still reads 60 — pre-existing, but the natural place to fix it was this function.
6. **[minor] Rhythm warnings fire on bars that were read correctly.** "Measure 41, staff 3: durations sum to 5 quarter
   notes in a 4-quarter measure" is the tenor's quarter tied to the next bar's whole; the onsets (0, 1.5, 3) are right.
   14 of Apple Tree's 24 warnings are of this tie-merge kind (sums of 5 or 8). The working-tree STATUS.json says "73
   rhythm warnings remain"; a fresh run gives 24 (1 layout + 23 rhythm). Report the number you measured.
7. **[minor] Positional staff lookups left behind.** `joinBrokenTies` (`system.staves[a.staff.index]`), `debug.rests`
   (`track: staff.index` while `debug.notes` use `slot`), `clefWarned`, and `drawStaves` colouring by `s.index` all still
   use the position within the system; with differing staff counts these disagree with the track mapping (ties, above;
   colours in `critic2-apple-p2/02–04` where "Staff 2" and "Staff 4" share a hue).
8. **[minor] Test hygiene.** `sonata.test.ts:82–83` still hold literal U+F0CF / U+F0FA. `FAMILY` silently admits
   Toccata, Fughetta, Ghent and Seville as Sonata-layout fonts with no evidence and no mention in ARCHITECTURE.
   `readTitle` picks "Words and Music by" as the composer (shown in every Apple Tree screenshot header).

## Strengths

- All four round-1 majors are fixed the right way (data tables and geometry, not special cases) and each is now pinned
  by an assertion that fails if it regresses: 20-note page-336 sequence, page-324 octave histogram, Apple Tree structure.
- The single-line staff detector is conservative: it needs a percussion clef within 8 spaces of the line's left end,
  a line ≥ half the median staff width, thickness ≤ 0.4 space, outside every 5-line band — and returns early when the
  page has no percussion clef, so LilyPond/MuseScore scores without percussion cannot be touched. On Apple Tree it finds
  exactly the 43 rhythm lines and none of the lyric extenders, slurs or the glissando line on page 16.
- Kind-based mapping does what it promises for percussion: Clap/Sticks/Low Drum/Cajun stay on Percussion 1–4 across
  systems with 1, 2 or 3 rhythm lines; `signatureStaff` reads the 2/2 from the only staff that has it.
- The metronome-mark reading is exactly what Sibelius output needs (Opus Text note letter in a separate run) and the
  Bach fixture still falls back to 100 bpm with "no tempo mark found".
- Broken ties across page and system breaks are merged when the layout is unchanged (D4 bar 10 → 11 across the page
  break); the duration histogram (1.5 qn × 55, 0.5 qn × 252 on three pages) is consistent with the engraving.
- Zero regression evidence: Emmentaler fixture F1/LCS/duration 1.0 in both `run.mjs` and the showcase, 0 console errors
  in six Chrome runs, parse under 240 ms everywhere, 61 fps while playing.
- Process items were honoured: core requests filed, `--query` and `pages` documented, external PDFs gitignored, tests
  skip cleanly when the copyrighted files are absent, comments carry only the "why".

## Screenshots studied

`tools/verify/out/critic2-app/`: `01-loaded.png`, `02-parsed.png`, `03-playing.png`, `04-seeked.png`,
`05-slow-tempo.png`, `06-paused.png`.
`tools/verify/out/critic2-showcase/`: `00`–`07` (fixture; identical to the pre-change showcase, TARGET MET, F1 1).
`tools/verify/out/critic2-sib324/`: `00`–`07` (page 324: every clef example labelled C at the octave the caption
demands; systems 1 staff each plus one 4-staff row; step 7 overlays present with `page=0`).
`tools/verify/out/critic2-sib336/`: `00`–`07` (page 336: bottom-right staff now `rest C5 A4 D5 C5 Bb4 A4 G4`; step 7
without overlays — issue 3).
`tools/verify/out/critic2-apple-p1/`: `00`–`07` (systems 4/3/3, single lines drawn as single lines, Cajun as a red
5-line drum staff, B4 labels on the rhythm lines, F#4/E4/B3 labels on S/A, "176 bpm (▯ = ca. 88)", repeat at bar 4).
`tools/verify/out/critic2-apple-p2/`: `00`–`07` (system 6 with the "Two Voices" staff on top coloured as a different
track from systems 4–5; step 7 without overlays).
Engraving: `tools/verify/out/opus/apple-p1.png`; `tools/verify/out/critic2-pages/apple-p2-s1.6.png`, `apple-p1-sys1.png`,
`apple-p1-sys2-3.png`, `apple-p1-bar10.png`, `apple-p2-sys1-2.png`, `apple-p2-sys3.png`, `apple-p3.png`, `apple-p5.png`,
`apple-p5-top.png`, `apple-p16.png`.

## What remains unproven

- Any Sibelius or Finale score with a reference MIDI; Apple Tree has none, so pitch accuracy rests on my bar-by-bar
  reading of pages 1–2 and 5 (about 250 notes) and the structural assertions.
- Finale families (Maestro, Petrucci, Engraver, Jazz), Norfolk/Pori/Lelandia, TrueType Sibelius exports, and CID exports
  without ToUnicode — still unit tests only; the CID name-path leak (issue 4) means the last of these is known to be wrong.
- Page 16 bars 121–122 (aleatoric bar with glissando, quarter-note triplets in tenor and bass, cluster chords) produce
  onsets such as 0.38 and 1.63 qn in the bass; tuplets are recognised in the tenor (0.6667 qn) but the bass chords are not.
- Slash noteheads and stick notation are still ignored by design; hollow Special noteheads are still always half notes.
