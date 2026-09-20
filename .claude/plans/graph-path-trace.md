# graph-path-trace (issue #100)

## Goal
Make real agent activity visible in the graph: (1) fix pulses that never fire, (2) light the real file->file edges between consecutively touched files in the order the agent went, including files surfaced by graft queries. Everything lit must exist in `graft/.graph/wiring.json`; unmatched paths are ignored.

## Part 1: root cause of "pulses never fire" (evidence)

Verified OK (offline replay of the real pipeline over every Orbit transcript in `~/.claude/projects/d--AI-Projects-Claude-Code-Orbit/`; scratch script, not committed):
- Transcript path derivation matches (dir exists, `<id>.jsonl` layout, encoding `[^a-zA-Z0-9]` -> `-`).
- `touchedPathsIn` logic on real lines: 250 `file_path` tool_use blocks found, 61 resolve via `toRepoRelative` to a `kind:'file'` node `path` in wiring.json (e.g. `src/main/main.js`). Windows `d:` vs `D:` drive case is handled by `path.relative`. The rest are outside the graph (docs, .claude/, etc.), which is expected.
- IPC wiring is complete: pty-manager.js:114 `startToolWatch` with `plan.claudeSessionId` (always defined, generated or resumed) -> `sender.send('toolActivity:file')` -> preload.js:43 -> renderer.js:58 `backdrop.pulse`. session-panel passes and records claudeSessionId correctly.
- `graphRepoRoot()` = `app.getAppPath()`; forge start uses appPath '.' with cwd = repo, so it is the repo root in dev.
- kapsule re-digests on every setter call even with the same fn reference, so re-applying `nodeColor(nodeColorFor)` does repaint.

So the static chain is correct; nothing here explains "never". Candidates static reading cannot exclude, ranked:
1. `pulse()` early-returns when `paused`. `syncPlayback` pauses the backdrop on window blur/hidden and `pause()` also clears pulses. If the user watches another window while the agent works, every pulse is dropped. `pulse` also returns silently if `graphInstance` is null (graph not built / message shown).
2. Visibility, not delivery: a 700ms colour-only fade on small spheres in a translucent full-window backdrop (`--accent-strong` #f0b95c vs `--accent`) is probably imperceptible; #54 turned the graph into a backdrop after #53 shipped the pulse.
3. Sessions whose cwd is not this repo: `toRepoRelative` drops everything (by design, the graph is Orbit-only), so testing from another project shows nothing.
4. Silent failure: `safely()` in pty-manager and the try/catch in the poll timer swallow any exception, so a failure looks like "no pulses" with no trace.

I could not run the GUI in the planning session, so the exact culprit is not proven. Implementation step 1 is therefore a short, decisive live diagnosis, not a blind rewrite. (#90's commit message also says "no app verification, static analysis only".)

## Part 2: what the graph and transcript actually contain (constrains the design)
- wiring.json: 152 nodes, 25 file nodes, 336 edges: 127 `contains` (file->symbol), 153 `calls` (symbol->symbol), 56 `imports`. Only **20 file->file edges** exist (all `imports`; collapsing call edges to file pairs adds no new pairs). Many consecutive touches (e.g. a renderer file then a main file) have NO direct edge. Per the hard constraint those get a node pulse and no edge. No bridging or invented paths.
- Direct tools: assistant `tool_use` blocks carry `input.file_path` (Read/Edit/Write) or `notebook_path`. Grep/Glob carry `path` (a dir/glob), not files; their file lists live in the `tool_result` (currently ignored).
- graft: calls appear as (a) MCP `tool_use` names `mcp__graft__graft_find_code|find_all|file_api|repo_map|trace_calls` (input `file` for file_api only) and (b) Bash/PowerShell `tool_use` with `command` containing `graft ask|grep|callers|skeleton`. Results ARE in the transcript as `user` entries with a `tool_result` block (`tool_use_id`, `content` = array of `{type:'text', text}` or a string). MCP result text contains `path:Lstart-Lend` hits (seen: `src/renderer/dos-chrome.js:L24-L36`), so file paths are regex-parseable. Bash graft output is plain text with paths (in the sessions I inspected `graft` was not on PATH, so I saw only failure text; the parser must tolerate that). Result order is relevance rank, not an agent walk.

## Approach
Keep the existing architecture (main tails transcript, renderer lights graph). Extend, do not rewrite.

Main (`tool-activity-manager.js`):
- Emit an **ordered list of steps** instead of a deduped Set. Step = `{ files: string[], kind: 'touch' | 'query' }`. Direct tool file_path -> `{files:[rel], kind:'touch'}`, one step per tool_use in transcript order (drop only consecutive duplicates).
- Track `tool_use` id -> kind in watch state (from assistant lines: `mcp__graft__*` names, or Bash/PowerShell whose command matches `/\bgraft\s+(ask|grep|callers|skeleton)\b/`). When the matching `tool_result` arrives (a `user` line), extract repo-relative candidate paths by regex (`[\w./-]+\.(js|mjs|cjs|css|html|json|md)`, optional `:L..` suffix), run through `toRepoRelative`, dedupe, emit `{files, kind:'query'}`. Optionally the same for Grep/Glob results.
- Payload becomes `{ sessionId, steps }`. Main does not know graph nodes; the renderer filters.
- Write the parsing as pure functions so they can be replayed against real transcripts from a node one-liner.

Preload: `onToolActivity` passes the whole payload to the callback (currently unwraps `.paths`). renderer.js:58 updated accordingly.

Renderer (`graph-view.js`):
- In `load()`, build `linksByPair`: key `"a|b"` for every link whose source and target are both `kind:'file'` nodes (the 20 imports), under both orderings, holding the link object.
- New `trace(sessionId, steps)` (replaces `pulse` as the entry point; reuse its internals): per-session `lastNode`. Steps play on a small timer, ~250ms apart, so the path visibly travels. `touch` step: resolve node (existing case-insensitive lookup); if unmatched, ignore it and leave `lastNode` unchanged; pulse the node; if `lastNode` exists and `linksByPair` has the pair, pulse that link; set `lastNode`. `query` step: pulse every matched node and light only real links among members of that set; do NOT set `lastNode` and do NOT chain by rank order (rank is not a traversal; lighting it as a path would be fabricated).
- Link lighting: `linkColor`/`linkWidth` accessors reading a `linkPulses` map (link -> deadline), same fade and shared tick as nodes (`pulseTick` re-applies link accessors and prunes both maps). Reuse `--accent-strong`. Lit links get width ~1.5-2. Node PULSE_MS may be raised (e.g. 1200ms) if diagnosis says visibility was the problem.
- Cap the queued steps (e.g. 40, drop oldest) so a burst does not play for minutes.
- `paused`/`graphInstance` guards stay; `pause()` clears the queue and both pulse maps.

## Files
- `src/main/tool-activity-manager.js`: ordered steps, tool_use id tracking, tool_result path extraction, new payload.
- `src/main/preload.js`: pass payload through.
- `src/renderer/renderer.js`: call `backdrop.trace(payload.sessionId, payload.steps)`.
- `src/renderer/graph-view.js`: linksByPair, trace(), link pulses, step queue.
- No new dependencies, no wiring.json changes, CSS untouched (token `--accent-strong` reused).

## Flow
transcript line appended -> poll (750ms) -> parse assistant tool_use (touch step / remember graft id) and user tool_result (query step) -> `toRepoRelative` -> `toolActivity:file {sessionId, steps}` -> preload -> renderer `trace` -> per step: node lookup in `nodesByPath` -> pulse node, pulse the real link to the previous node if `linksByPair` has it -> shared fade tick.

## Order of work
1. Diagnose Part 1 before any feature code: temporary `console.log` in `poll()` (lines read, paths found) and in `graph-view.pulse()` (paused? graphInstance? matched?); run `npm start`, focus the window, have a session in this repo Read `src/main/main.js`. Decision tree: no main log -> watch not started / wrong transcript (check `transcriptPath` existence); main logs but renderer does not -> IPC/preload; renderer logs `paused` -> blur/hidden logic; matched but not visible -> raise duration/width/brightness. Fix at the narrowest point, remove the logs, comment the root cause on #100.
2. Ordered steps + payload change (main, preload, renderer.js), `trace` doing node pulses only; confirm it still lights.
3. Link map + link pulses + step queue.
4. graft result parsing (tool_result): MCP first, then Bash graft; verify by replaying real transcripts through the pure parse functions.

## Risks / blast radius
- Payload shape change touches preload + renderer.js + graph-view.js together; land in one commit or the listener breaks (`payload.paths` becomes undefined).
- `nodeColor`/`linkColor` re-application rebuilds materials each tick; adding 336 links to the 66ms tick raises cost. Tick only while pulses live; re-apply link accessors only when `linkPulses` is non-empty.
- graft result regex can match paths in prose; safe because the renderer discards anything not a file node. False positives are limited to real graph files that were mentioned but not returned.
- Only 20 real file edges: most consecutive touches show only node pulses. That is correct, not a bug; review must not "fix" it by inventing edges.
- Resumed sessions: offset seeding at EOF stays, no history replay. tool_use ids from before the seed have no remembered kind, so their results are skipped.
- Multiple sessions interleave: `lastNode` is per sessionId.
- Review should check: nothing lights that is not in wiring.json; step order within one poll batch preserved; no strobe on resume; pause/resume clears the queue; no throw when the graph is not built.

## Open questions
1. Is a live-app diagnosis run acceptable as step 1, given static analysis could not prove the cause? The implementing session needs a GUI run.
2. graft query results: node pulses plus real links among the surfaced set only, no ordered chaining (result order is rank). OK, or chain in listed order anyway?
3. Consecutive touched files with no direct edge (most cases): ignore the edge (plan), versus lighting a real multi-hop shortest path through existing edges. Plan picks the former as simpler and strictly real.
4. Include Grep/Glob result files as `query` steps too? Plan leans yes (small extra).
5. Keep pulses running while the window is unfocused (drop the blur pause for pulses)? Depends on diagnosis; the pause exists for CPU saving.
