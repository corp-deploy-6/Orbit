# Orbit

Personal Agentic OS. Hobby-scale, not enterprise. Optimize for speed + working code over ceremony.

## Agent

Orbit runs on one generalist agent, `Orbit` (`.claude/agents/orbit.md`). It has no built-in specialty -- each phase's judgment comes from the skill it loads (`plan-feature`, `implement-plan`, `review-changes`, `style-ui`). Invoke it with the Agent tool once per phase, in a fresh session each time, so a planning session's context/bias never leaks into implementation or review. Never ask it to do two phases in one session.

Default flow: spawn Orbit to plan -> user approves -> spawn Orbit fresh to implement -> spawn Orbit fresh to review -> spawn Orbit fresh to style if there's a visual component. Skip planning for one-file/low-risk changes, skip review for throwaway/experimental scratch work.

Pick a short-name slug up front (the one that becomes the branch name) and pass it to every spawn. The planning session writes the plan to `.claude/plans/<slug>.md` and commits it on the feature branch, so it survives even if a later phase runs in a separate worktree; implementing and reviewing read it from there. Whichever of implementing or reviewing finishes the work last deletes that file (commit the deletion) before the branch merges -- it's handoff state, not project history.

Match whatever stack the project already uses; an underspecified ask is a signal to ask, not to guess. Finish and verify one thing before starting the next.

### GitHub issue hygiene

When Orbit works against a GitHub issue, it must keep that issue updated as it goes — not just report back to the user in chat:

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
