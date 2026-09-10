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
