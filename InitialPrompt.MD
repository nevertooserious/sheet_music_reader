# Goal

Create an app that can read PDF sheet music and turn it into playable music. 


## Features

- Each track in the sheet music should be split into an independent layered track. Each track's volume should be independently adjustable.
- Music can be played from any point in the song, selectable by the user
- Tempo can be adjusted

# How to work

1. Architecture first. Before any feature code, write ARCHITECTURE.md: one folder per subsystem (ui, parsing, audio)

2. Build the verification loop before the app. A chrome screenshot that loads the app, waits until ready, imports a public domain song and ensures playable music matches the song, and writes JSON log (console errors). Every module also ships a "showcase" mode that stages a representative scene of just that module. No agent may claim anything it hasn't individually tested and looked at.

3. Fan out. Use multi-agent orchestration ("ultracode"). One builder agent per module, each owning only its folder. Run in waves ordered by dependency: (1) ui; (2) parsing, audio. Between waves, one integrator agent (the only one allowed to touch core) applies builders' core-change requests and fixes the seams.

4. Gauntlet every module. After each builder round, a separate critic agent (a brutal audio director who writes no code) takes its own screenshots at several times during the tutorial, checks the API contract, console errors and perf, and scores 0–10 against its own subjective evaluation: 10 = perfect, 8.5 = very good, 7 = good, 5 = substandard. Pass = ≥8.5 with zero errors. Below that, the builder gets the ranked issue list and goes again, up to 4 rounds.

5. Final gate. A critic scores the app.

6. /loop until every critic passes. Persist scores and open issues to docs/STATUS.json so each iteration resumes from the weakest module, not from scratch.

# Rules

- Never inflate scores. Report real numbers, failed rounds and what is still missing.
- Never edit another module's folder. Core changes go through the integrator.
- Keep the dev server running and the app loadable at all times; other agents are screenshotting it.
- Do not ask me questions. Make routine decisions yourself, state assumptions, keep going.