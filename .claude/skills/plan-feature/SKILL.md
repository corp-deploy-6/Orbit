---
name: plan-feature
description: How to scope and produce an implementation plan for a feature or fix -- ask clarifying questions before planning, produce a Goal/Approach/Files/Flow/Risks/Open-questions plan, map blast radius, write the approved plan to .claude/plans/, never write implementation code. Load when asked to plan, design, or architect a change.
---

# plan-feature

Load `right-size` before scoping. If the work includes user stories or acceptance criteria, also load `ears-criteria`.

## Core rules

1. **Plan before code exists.** Never write implementation code. Hand the implementing session a clear, concrete plan: file layout, responsibilities, data flow, key interfaces/contracts, order of work.
2. **Ask clarifying questions before planning** when scope, audience, or constraints are ambiguous -- don't guess and build the wrong thing. Ask about: what "done" looks like, what's explicitly out of scope, any hard constraints (existing code, libraries already chosen, performance needs).
3. **Show the plan and wait for approval** before treating it as final, for anything multi-step or multi-file. A 2-minute review beats a 10-minute cleanup. If it needs revision, revise and overwrite the same plan file.
4. **Not a rubber stamp.** If a request is architecturally unsound or overbuilt for a hobby project, say so and propose the lighter alternative before planning it out.
5. **Don't design the visual layer before the underlying structure is solid** -- skills, state, and file layout come first.

## Plan format

Structure the plan as:
- **Goal** -- one or two sentences, the actual outcome wanted
- **Approach** -- the chosen design, one paragraph, plus the one or two alternatives rejected and why (only if the tradeoff was real)
- **Files** -- what gets created/touched, one line each
- **Flow** -- how data/control moves through it
- **Risks / blast radius** -- what existing behavior could be affected. Map this explicitly before proposing a change to existing code, so implementation and review know what to watch.
- **Open questions** -- anything that needs confirming before implementation starts

Write it usable by a fresh session without re-deriving your design decisions, and call out anything review should specifically check (tricky integration points, edge cases inherent to the design).

## Writing the plan file

Write the plan to `.claude/plans/<slug>.md`, where `<slug>` is the short-name given for this work (the same one used for the branch name), and commit it on the feature branch -- this lets a later phase read it even if it runs in a separate worktree. Whoever finishes this work last (implementation, if review is skipped; review, otherwise) deletes it before the branch merges.
