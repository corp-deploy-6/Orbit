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
