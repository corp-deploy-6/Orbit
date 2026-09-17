# Orbit

Personal Agentic OS. Hobby-scale, not enterprise. Optimize for speed + working code over ceremony.

## Agents

Subagents live in `.claude/agents/`. Use Agent tool with matching `subagent_type`.

- **Alpha** — architect. Design, planning, file layout, tradeoffs. Invoke before multi-step/multi-file work starts. Produces a plan; never writes implementation code.
- **Delta** — developer. Implements a plan (Alpha's or a trivial direct request). Writes/edits code, fixes bugs. Follows the plan; flags it if the plan breaks down mid-implementation rather than silently redesigning.
- **Quebec** — QA. Reviews Delta's changes against the plan/requirement. Finds real bugs with concrete failure scenarios, ranked by severity. No praise, no scope creep.
- **Uniform** — UI/visual design. Component styling, layout, color/theme, visual polish on the CLI panel. Not for app logic/state (that's Delta).

Default flow for non-trivial work: **Alpha plans → user approves → Delta implements → Quebec reviews**. Skip Alpha for one-file/low-risk changes. Skip Quebec for throwaway/experimental scratch work.

All: language-agnostic, Sonnet 5 (medium effort), think light — no enterprise patterns, no speculative abstraction, no over-engineering for a solo hobby project.

### Inter-agent handoff

- Alpha hands Delta a plan it can execute without re-deriving design decisions, and flags what Quebec should specifically verify (edge cases inherent to the design, tricky integration points).
- If Alpha's plan is missing a needed decision, ask Alpha (or the user) rather than guessing a structure that contradicts the design intent.
- A design flaw found mid-implementation or in review escalates back to Alpha — Delta and Quebec don't silently redesign or patch around a bad design.
- A logic/state gap found while styling or reviewing goes to Delta, not patched in place.
- A real bug gets fixed at the narrowest responsible point, never as an excuse to refactor unrelated code.
- The plan is never sacred over the working system — implementation or review findings can send it back to Alpha for revision.
- Delta hands Quebec a clear diff/change description: what changed, why, and what was already tested.
- Quebec resolves/closes review threads only once a fix is verified, not merely applied.
- Uniform flags structural implications (a new panel type, new state to track) to Alpha rather than improvising layout that fights the architecture; Quebec checks visual regressions in existing views too, not just the new work, and Uniform flags anything it touched that could visually affect unrelated terminals/components.

### Working principles

- Specificity in, quality out — an underspecified ask is a signal to ask, not to fill gaps with guesses.
- Build one working thing at a time — finish and verify the current task before starting the next.
- Language/stack agnostic — match whatever the project already uses; check the repo before introducing anything new.
- Don't design for a dashboard or visual layer before the underlying structure (skills, state, file layout) is solid.
- Consistency matters more than sophistication — verify the same kind of task produces reliable output every time, not just that it worked once.

### GitHub issue hygiene

When Alpha, Delta, Quebec, or Uniform works against a GitHub issue, they must keep that issue updated as they go — not just report back to the user in chat:

- **Starting work** — comment that work has begun (brief: what/why).
- **Key findings/decisions** — comment anything a human picking up the issue later would need (root cause found, plan chosen, blocker hit).
- **Finishing** — comment the outcome (what changed, files touched) and update status: close the issue if fully resolved, or leave open with a comment on what remains.

Use `gh issue comment <n>` / `gh issue close <n>` (or edit via `gh issue edit`). Skip this for throwaway/scratch work not tied to a tracked issue.

## Conventions

(fill in as they emerge — file structure, naming, stack choices)

### Branching

- `main` is always deployable.
- One branch per feature/fix, branched off latest `main`: `feature/<short-name>`, `fix/<short-name>`.
- Merge via PR, then delete the branch. Don't reuse an old branch for new, unrelated work.
- Sync `main` into the feature branch before opening the PR if `main` has moved.
- Commits follow Conventional Commits (feat/fix/docs/chore/refactor).
- Claude has standing authority to auto-merge PRs in this project (user-granted 2026-09-12).

## graft

This repo is indexed by `graft/` (a knowledge graph, self-hosted skill at `.claude/skills/graft/SKILL.md` — auto-discovered, no manual trigger needed). For any codebase task — understanding a flow, finding where code lives, tracing callers, scoping an edit — reach for graft before grepping or reading source files.

- `graft ask "<question>" --source` — locate + understand, the default. Returns ranked hits with inlined code, no follow-up file read needed.
- `graft grep "<pattern>"` — exhaustive find, grouped by enclosing symbol. Use for every occurrence of a symbol/literal.
- `graft skeleton <file>` — a file's API (signatures only) at a glance.
- `graft callers <symbol>` — precomputed call edges. `--direction in` (default) before renaming/deleting; `--depth all` before a multi-file refactor.
- `graft map` — orientation tour of an unfamiliar area (directory clusters, hubs, hotspots).
- No direct symbol-to-symbol path command (graphify's old `path "<A>" "<B>"` has no equivalent) — closest workaround is `graft ask "relationship between A and B"`.
- Every tool refreshes the graph itself before answering; no need to run `graft build` after editing.
