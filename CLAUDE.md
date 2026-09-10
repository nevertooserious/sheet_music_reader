# Sheet Music Reader — working notes for agents

Read ARCHITECTURE.md first. It defines folders, contracts, the model, and the
process. This file is the operational cheat sheet.

## Commands

```
npm run dev                          # Vite on http://127.0.0.1:5173 (keep it running; others screenshot it)
npm run typecheck                    # tsc --noEmit (must be clean before you report)
npm test                             # vitest unit tests (src/**/*.test.ts)
npm run verify                       # full app verification -> tools/verify/out/app/report.json + screenshots
npm run verify:showcase -- <module>  # showcase tutorial screenshots -> tools/verify/out/showcase-<module>/
```

## Sandbox quirks on this machine

- Node needs `OPENSSL_CONF=/dev/null` inside the sandbox (set in .claude/settings.json;
  if a node/npm command dies with "OpenSSL configuration error", prefix it with
  `OPENSSL_CONF=/dev/null`).
- The sandbox blocks listening on ports and launching Chrome. Run `npm run dev`,
  `npm run verify`, and `npm run verify:showcase` with the sandbox disabled.
- vitest exits 255 with no output inside the sandbox (even `vitest --version`);
  run `npm test` with the sandbox disabled too. `tsc` is fine sandboxed.
- Network is blocked in the sandbox; installs must run with the sandbox disabled.
  Do not add dependencies unless you truly need them; say so in your report.
- The dev server is already running on 5173. Do not start a second one and never kill it.
  If it is down, restart it with `npm run dev` in the background (sandbox disabled).

## Ownership

| Folder          | Owner            |
| --------------- | ---------------- |
| src/core        | integrator only  |
| src/ui          | ui builder       |
| src/parsing     | parsing builder  |
| src/audio       | audio builder    |
| tools/verify    | integrator only  |
| docs/           | anyone appends   |

Never edit another module's folder. If you need a change in core (types,
contracts, controller, main, css variables), append a request to
`docs/core-change-requests.md` with the exact diff you want and why, then work
around it locally until the integrator applies it.

## Evidence rules

- Nothing is "done" until `npm run typecheck` is clean and you have run
  `npm run verify:showcase -- <your module>` (and `npm run verify` when the
  full path exists) and looked at the screenshots with the Read tool.
- Report real numbers from the JSON reports. Never round a failing check up.
- Console errors are failures. Warnings must be explained.

## Conventions

- TypeScript strict, ES2022, no framework: build DOM with small functions.
- Time in quarter notes (`qn`); tempo in qn per minute; layout in PDF points,
  top-left origin, scale 1.
- Test hooks live on `window.__smr` (see `TestHooks` in core/contracts.ts).
  Showcases set `window.__smr.showcase`.
- Verifier looks for `[data-action="toggle-play"]`, `[data-control="tempo"]`,
  `[data-control="seek"]`, `[data-control="track-gain"]`, `[data-role="score-view"]`,
  `input[type="file"]` in the app UI.
- Comments only for non-obvious "why". No narration comments.
