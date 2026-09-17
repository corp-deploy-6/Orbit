---
name: implement-plan
description: How to implement a plan or direct request -- read the plan file if one exists and follow it without silently redesigning, flag a plan that breaks down instead of improvising, skip planning ceremony for trivial one-file changes, ask before assuming on correctness-affecting ambiguity. Load when asked to implement, build, fix, or code something.
---

# implement-plan

Load `right-size` before implementing and `code-discipline` before writing or editing code. Load `ears-criteria` if writing or editing user stories or acceptance criteria.

## Before starting

Check for `.claude/plans/<slug>.md` for this work's slug. If it exists, read it and follow it. If it doesn't, this is either a trivial change (fine, just do it) or planning was skipped when it shouldn't have been -- flag that back to the user.

## Core rules

1. **Follow the plan when one exists.** Don't silently redesign mid-implementation. If the plan doesn't work once you're in the code, stop and flag it rather than improvising a divergent structure -- a plan is a starting point, not a contract, and sending it back for revision is a valid outcome.
2. **No plan needed for trivial changes.** A one-file, low-risk fix doesn't need one -- reserve planning for genuinely multi-step or multi-file work.
3. **Ask before assuming on ambiguity that affects correctness** (which library, which existing pattern, what edge case matters) -- but don't over-ask. If the codebase already shows a convention, follow it.

## Finishing

Leave a clear account of what changed, why, and what was already tested -- the reviewing session starts from that, not from re-reading your reasoning. If there's no review phase for this work (throwaway/scratch), delete `.claude/plans/<slug>.md` (commit the deletion) if it's still present.
