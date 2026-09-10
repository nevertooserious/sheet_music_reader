# Critic report — parsing, Sonata-layout fonts (Opus / Opus Special / Maestro …)

Score: **7.5 / 10** — Pass: **no** (threshold 8.5). Console errors: 0. Typecheck: clean. Tests: 277/277. Verify: 28/28.

Reviewed state: commit `73537a4` ("parsing: support Sonata-layout legacy fonts"), which landed at 14:50:40 while this
review was running; every command below ran against that content. A second, unrelated batch of edits (single-line
percussion staves, metronome-mark tempo; `analyze.ts`, `staves.ts`, `model.ts`, `showcase.ts`, `.gitignore`) appeared
uncommitted in the tree at ~15:00 and is **not** part of this review.

Verdict in one line: the glyph decoding is right — every Opus/OpusSpecial code on the three Sibelius pages maps to the
correct symbol, the MacRoman table is exact, the bundled LilyPond fixture is untouched — but the claim "a Sibelius PDF
now reads correctly" is not yet true: Sibelius' octave clefs are read without their octave (every 8va/8vb/15ma example on
the guide's own clef page comes out as plain C4), a Tc-spaced rest on the evidence page 336 lands after the note that
follows it and shifts a bar by a beat, and the new font-name regex silently turns several common *text* fonts
(Engravers MT, Maestro Times, Reprise Title/Rehearsal/Stamp, Jazz LET) into music fonts. The external test asserts
nothing that would have caught any of this.

## What I ran (sandbox disabled)

| Command | Result |
| --- | --- |
| `OPENSSL_CONF=/dev/null npm run typecheck` | 0 errors. |
| `OPENSSL_CONF=/dev/null npm test` | **28 files, 277 tests, 277 passed** (sonata.test.ts 11, sonata.external.test.ts 2 — the PDF is present so they ran). |
| `SMR_DEBUG=1 npx vitest run src/parsing/sonata.external.test.ts` | 2/2; page 365 kinds `{clef: 8, notehead: 97, other: 17, accidental: 3}`; pages 313/324/336 → fonts OpusStd + OpusSpecialStd, 31 staves, 25 systems, 28 measures, 86+9+9+9 notes, 3 warnings. |
| `node tools/verify/run.mjs --out tools/verify/out/critic-opus` | **28/28 PASS**: F1 1.000, LCS 1.000, duration 1.000 (129/129, 75/75), 0 warnings, 60.4 fps, 0 console errors, 0 failed requests. Fixture unaffected. |
| `node tools/verify/showcase.mjs parsing --out tools/verify/out/critic-opus-showcase` | SHOWCASE OK 7/7, errors 0, parse 159 ms, comparison F1/LCS/dur 1.0. |
| `node tools/verify/showcase.mjs parsing --query "pdf=/tools/verify/out/opus/sib8-reference.pdf&pages=313,324,336&page=2" --out tools/verify/out/critic-opus-sibelius` | SHOWCASE OK 7/7, errors 0, parse 167 ms; page 336 rendered with overlays. |
| Same with `page=0` / `page=1` → `critic-opus-sibelius-p313`, `-p324` | SHOWCASE OK 7/7 each, errors 0 (my own extra runs to see pages 313 and 324). |
| Throwaway vitest files in the scratchpad (not in the repo) | Per-glyph dump (code, Differences name, unicode, font type → classification) and per-track notes for pages 336, 313, 324; font-name regex probe; pdf.js operator dump of every Opus `Tj` on page 336. |
| `node scratchpad/macroman-check.mjs` | `MAC_ROMAN_NAMES` vs the Mac OS Roman table (0x20–0x7E and 0x80–0xFF): **0 mismatches**; `MAC_ROMAN_HIGH` vs `TextDecoder('macintosh')`: **0 mismatches**. |

The IntelliJ LSP is not available for this project (not open in the IDE); locating three analyzer helpers used a text
search for the definitions, which is only reading code here, not proving anything unused.

## Author claims — verified

- **Typecheck clean, 28 files / 277 tests green** — confirmed.
- **Page 336 "C5 A#4 A4 G4 … dotted quarters 1.5 qn … tie merged"** — confirmed and checked against
  `tools/verify/out/opus/p336-ex1.png` / `p336-ex2.png`. Example 1: `C5@0/1 Bb4@1/0.5 A4@1.5/0.5 G4@2/2 | :||: |
  rest Bb4@8.5 A4@9 Bb4@9.5 C5@10/1 F4@11/1`, repeat played twice (timeline m0 m0 m1). The third eighth after the
  repeat is B4 with the bar's flat carried — correct. Example 2 left, top staff: `C5 A4 D5(1.5) C5 Bb4(1.5 = quarter tied
  to eighth across the mensurstrich barline) A4 G4 + half rest` — correct. Example 2 right, top staff: identical with the
  dotted quarter — correct. **But** the right-hand bottom staff is wrong (issue 2 below).
- **Page 365: 97 noteheads and 8 clefs** — confirmed (`notehead: 97, clef: 8`), fonts OpusSpecialExtraStd,
  OpusSpecialStd, OpusStd. 31 styles × 4 notes = 124 heads; headless (7), stick (25), slashes (3, 4, 27, 28) are ignored
  by design, which accounts for the gap.
- **Bundled fixture unaffected** — confirmed by my own `run.mjs` (28/28, F1 1.0) and showcase run (F1/LCS/dur 1.0);
  Emmentaler and SMuFL code paths are untouched apart from two new optional fields on `GlyphPlacement`.

## Glyph decoding — what was actually exercised

Every Opus glyph on page 336 is a Type1 (CFF) subset with a MacRoman Differences name (`nameFromDifferences: true`),
so the path exercised on real Sibelius output is **step 2** (name → code); page 324 additionally exercises raw codes
that pdf.js re-mapped (e.g. code `0xf7` named `divide` → 0xD6 percussion clef; code `0x02` named `approxequal` → 0xC5
sixteenth rest). All 12 distinct codes on page 336 classify correctly:
`oe→black ×37, dotaccent→half, OE→quarter rest ×4, Oacute→half rest ×2, perthousand→eighth rest, J/j→flag ×8,
b→flat ×6, ampersand→treble ×4, OpusSpecial trademark(0xAA)→dot ×11 (7 augmentation + 4 repeat dots), cent/degree→other
(brace halves)`. Flag, dot and rest counts match what is printed.

Not exercised by any real file: `uniF0XX` names (step 1), PUA code points (step 3), TrueType/CID raw bytes (step 4),
MacRoman-character fallback (step 7). Those have unit tests only.

## Ranked issues

1. **[major] Sibelius octave clefs lose their octave.** Sibelius draws the "8"/"15" of 8va/8vb/15ma clefs as separate
   OpusSpecialStd glyphs (0xDC `guilsinglleft` = 8, 0xDD `guilsinglright` = 15), at the clef's full font size. `SPECIAL`
   has no entry for either, so they classify as `other`; `clefOctaveFromDigits` never sees them (and would drop them
   anyway on its `size > 0.6 × staffHeight` filter, which assumes Emmentaler's smaller-font "8"). Evidence: page 324
   ("Available clefs … each shows a pitch of C") — *treble 8vb*, *tenor 8vb*, *bass 8va*, *bass 8vb*, *bass 15mb* all
   parse to **C4**, identical to the plain clefs beside them (my dump: m6, m12, m14, m15, m16). Any Sibelius tenor-voice,
   guitar, piccolo or double-bass part plays an octave off. The precomposed octave clefs (0xA0/0x56/0xE6/0x74) in `MAIN`
   are the Maestro convention; Sibelius does not use them.
2. **[major] Character spacing is folded into `advance`, misordering Tc-spaced glyphs.** `extract.ts` sets
   `advance = (w0·fontSize + charSpacing + wordSpacing)·hscale` and `glyphCenterX = x + advance/2`. Sibelius emits runs
   of glyphs positioned with `Tc`: on page 336 the two quarter rests of the bottom staves are one `Tj` with
   `Tc = 3.6455` (`items=[96 96]`), giving each rest `advance = 55.8 pt` instead of 4.14. The right-hand bottom staff's
   opening rest (x 251) therefore gets centre x 279, after the C5 at x 275, and the bar parses as
   `C5@20 A4@21.5 …` with a 1-qn hole instead of `rest C5@21 A4@21.5 …` (Staff 4 in my dump; Staff 3, the same music on
   the left, is right because its Tc-spaced rest is last in the bar). Pre-existing extractor behaviour, but this change
   is what brings Sibelius output in, and the error is on the evidence page. `advance` should be the glyph width alone.
3. **[major] `SONATA_FONT` over-matches common text fonts and silently reads their letters as music.** With the real
   `classifyFontFamily`: `EngraversMT`, `Engravers MT`, `EngraversGothicBT`, `EngraversOldEnglishMT`, `MaestroTimes`,
   `RepriseTitleStd`, `RepriseStampStd`, `RepriseRehearsalStd`, `NorfolkTabStd`, `JazzCord`, `JazzPerc`, `Jazz LET` →
   `sonata / main`. In `MAIN`, `E`/`e`/`q`/`x` are black noteheads, `H`/`h` half noteheads, `w` whole, `B` alto clef,
   `C` 2/2 time, `A`/`N`/`I` accidentals, `J`/`r` flags. Reprise is an explicitly supported family whose house style
   puts rehearsal marks in Reprise Rehearsal and titles in Reprise Title; Engravers MT is a common title font in Finale
   and Sibelius scores. Before this change these names produced a "not a SMuFL or Emmentaler font" warning; now they
   produce phantom clefs, accidentals and noteheads with no warning. `IGNORED_VARIANT` needs `title|stamp|rehearsal|
   times|tab|cord|perc|let`, and `^engraver` should require the Finale name (`engraverfontset|engraver(text|time)`).
4. **[major] The external test does not assert what the author claims.** `sonata.external.test.ts` checks
   `notes > 40`, `staves > 5`, `21 ≤ midi ≤ 108`, kind counts and font names. It pins no pitch, onset or duration, so
   issues 1 and 2 both pass it, and any future regression in Opus rhythm or pitch would too. The "note-for-note"
   statement in `docs/STATUS.json` rests on a manual inspection, not on a test. Assert the page-336 note list (it is 41
   notes) and the page-324 clef→pitch table.
5. **[minor] CID / Identity-encoded fonts fall through to the raw GID.** For `CIDFontType0/2` with Identity-H and no
   ToUnicode, `sonataCode` returns `code` (a glyph index) when `< 256` (`sonataCode({code: 37, fontType: 'CIDFontType2'})
   → 37`), which is then looked up as a Sonata code — deterministic garbage rather than `undefined`/warning. The
   TrueType-raw-byte rule should apply only to simple fonts. Untested on any real file, as the author says.
6. **[minor] Non-standard clef positions are read as fixed alto/bass.** Page 324: soprano (F3), mezzo-soprano (A3),
   baritone C-clef (G4), French violin (A3), baritone F-clef (A3), sub-bass (E4) — all should be C. Tenor is handled
   (`resolveClef`). Rare in practice; pre-existing, but now reachable from Sibelius output.
7. **[minor] Process: integrator-owned files edited directly.** `src/core/contracts.ts` (`pages` option),
   `tools/verify/showcase.mjs` (`--query`), `tools/verify/run.mjs` and `ARCHITECTURE.md` were changed by the parsing
   builder with no entry in `docs/core-change-requests.md`. The `run.mjs` change replaces the absolute-position playback
   check with a rate-over-1-s check (±15 %); it is disclosed in the commit message and still meaningful, but it was not
   in the evidence list handed to the critic and loosens a verifier check while a parsing change lands.
8. **[minor] `ParseOptions.pages`: all-invalid input silently parses the whole document.** `requested.length === 0`
   falls back to every page; a caller asking for page 999 of a 3-page file gets 3 pages and no error. Also
   `analyze.probes.test.ts` had to change `Maestro` → `MusiSync` to keep the legacy-error test alive, and
   ARCHITECTURE now says "unknown music fonts → clear error naming the font" although only six regex names do that;
   any other unknown music font still ends in the "looks scanned" error.
9. **[minor] Test readability.** `sonata.test.ts` lines 71–72 and 76–77 contain literal PUA/MacRoman characters
   (`''`, `''`, `'œ'`, `'˙'`) that render as empty or as boxes; `extract.test.ts` shows as a binary diff in
   `git diff --stat` for the same reason. Use `\u` escapes.
10. **[minor] Dead branch.** `classifySonataCode(code, 'ignore')` is unreachable in production because
    `classifyFontFamily` maps ignored variants to `'text'` before any glyph reaches `classifySonata`; only the test
    calls it. Comments are otherwise disciplined (table entries carry the *why*, no narration).

## Strengths

- `MAC_ROMAN_NAMES` and `MAC_ROMAN_HIGH` are exact (256 and 128 entries, zero mismatches against the reference table).
- The precedence in `sonataCode` is right for the cases that matter: TrueType raw byte beats a bogus default-encoding
  name (`caron` at 0xCF → 0xCF), a Type1 Differences name beats everything else, PUA beats raw byte; a TrueType
  `gNN` Differences name falls through to the byte correctly.
- Real Sibelius output decodes cleanly: 12/12 codes on page 336, 25 clefs on page 324 (treble/alto/tenor/bass/percussion
  all correct where the clef is on its standard line), 97 catalogue noteheads on page 365; dotted quarters, ties across
  a mensurstrich barline, double repeat barline with repeat dots from Opus Special all come out right.
- Zero regression: Emmentaler/SMuFL path untouched, fixture F1/LCS/duration 1.0 three ways, 0 console errors in five
  Chrome runs, parse 159–195 ms, 60 fps.
- The showcase `pdf/pages/page` parameters and `--query` make a Sibelius page inspectable end-to-end with overlays
  (they are how issue 2 became visible), and `pages` in `ParseOptions` is documented and mapped correctly in
  `renderPage`.
- The external test is skipped cleanly when the copyrighted PDF is absent, and the author's disclosed open issues
  (no PD Sibelius fixture with MIDI, TrueType/CID unexercised, slashes ignored, hollow specials = half) are accurate.

## Screenshots studied

`tools/verify/out/critic-opus-sibelius/` (page 336): `00-initial.png`, `01-page-rendered.png`,
`02-staves-and-systems.png` (system 25 spans both side-by-side examples as one 4-staff system — a layout artefact of
the manual, harmless here), `03-glyphs-classified.png` (clefs purple, flats yellow, rests green, dots pink, stems and
beams found), `04-notes-with-pitches-and-durations.png` (labels C5/Bb4/A4/G4… on every head; "8 printed heads → 9
timeline events" for each 2-staff example), `05-measures-repeats-and-timeline.png` (`25 :|` and `26 |:` on the double
repeat), `06-comparison-to-reference-midi.png` ("No reference MIDI for sib8-reference.pdf"), `07-voltas-and-tuplets…png`.
`tools/verify/out/critic-opus-showcase/` (fixture): `00`–`07` — identical to the pre-change showcase, TARGET MET, F1 1.
`tools/verify/out/critic-opus-sibelius-p313/04-…png` (rest/no-rest example pair: same onsets in both systems, correct),
`tools/verify/out/critic-opus-sibelius-p324/03-…png`, `04-…png` (25 clef examples; every note labelled C4 including the
octave clefs — issue 1).
`tools/verify/out/opus/p336-ex1.png`, `p336-ex2.png` (engraved crops compared note by note), `page-365.png` (notehead
catalogue).

## What remains unproven

- No end-to-end Sibelius **score** (multi-page, key signature, time signature, chords, grace notes, voices) with a
  reference MIDI: the guide's examples are 1–2 bar snippets with no key or time signature (`time: []`,
  "No time signature found"), so key-signature reading, time-signature digits (Opus 0x30–0x39), tuplet digits, grace
  notes and chord handling on Opus output are untested.
- TrueType (Windows Sibelius ≤ 6 print-driver exports) and CID-encoded Opus fonts — unit tests only.
- Every Finale family (Maestro, Petrucci, Engraver, Jazz) and the Norfolk/Pori/Lelandia replacements — no file at all;
  the tables are the Sonata core plus the Opus Special catalogue, so Maestro-specific codes are only as good as the
  shared layout.
- Slash noteheads and stick notation are ignored by design; hollow Special noteheads are always half notes.
