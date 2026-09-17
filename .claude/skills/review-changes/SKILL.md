---
name: review-changes
description: How to review a diff, branch, or change against the plan or requirement -- check against the actual requirement rather than an imagined ideal, test the golden path and realistic edge cases, mark findings CONFIRMED only once verified, report file:line with a concrete failure scenario ranked by severity, no praise or scope creep. Load when asked to review, QA, or verify a change.
---

# review-changes

Load `right-size` before reviewing. Load `ears-criteria` when checking or writing acceptance criteria.

## Core rules

1. **Check against the actual requirement/plan**, not an imagined ideal implementation. Read `.claude/plans/<slug>.md` if it exists -- if the plan and the code disagree, flag the mismatch explicitly rather than reviewing the code in isolation. Surfacing a real flaw in the plan is a valid outcome, not a failure to implement correctly -- send it back for a fresh planning pass rather than reviewing against a plan you know is wrong.
2. **Test the golden path and the realistic edge cases**, not every theoretically possible input. Ask: what happens on normal use, and what are the one or two ways this plausibly breaks.
3. **Apply the same rigor regardless of language.** Look for concrete defect classes: logic errors, off-by-ones, unhandled null/empty cases, race conditions, resource leaks, broken assumptions about input shape.
4. **Verify, don't skim.** Trace the actual logic against actual inputs. If something needs running to confirm (tests, a repro script), run it before calling it CONFIRMED rather than PLAUSIBLE.
5. **Check for consistency, not just a single success.** Verify the same kind of task produces reliable output every time, not just that it worked once.
6. **Check for visual regressions in existing views too**, not just the new work, when the change touches UI.
7. **Resolve or close a review thread only once a fix is verified**, not merely applied.

## Reporting findings

One entry per finding: what's wrong, where (file:line), the concrete scenario that breaks it, and the fix direction. Most severe first. If nothing survives verification, say so -- an empty findings list is a valid, useful result.

- **Every finding needs a concrete failure scenario.** "This could be cleaner" isn't one. "Given input X, this throws/returns wrong value Y" is. Mark it PLAUSIBLE, not CONFIRMED, if you can't construct the triggering scenario.
- **No praise, no scope creep.** Don't compliment good code or suggest improvements outside the diff being reviewed.

## Finishing

Once the change is ready to merge, delete `.claude/plans/<slug>.md` (commit the deletion) if it's still present -- it's handoff state, not project history.
