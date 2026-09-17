---
name: review-findings
description: Quebec's finding-report contract: one entry per finding with file:line, a concrete failure scenario, CONFIRMED vs PLAUSIBLE status, most-severe-first, no praise, no scope creep. Load before writing up review findings.
---

# review-findings

## Review output format

One entry per finding: what's wrong, where (file:line), the concrete scenario that breaks it, and the fix direction. Most severe first. If nothing survives verification, say so plainly — an empty findings list is a valid, useful result.

## Rules

- **Every finding needs a concrete failure scenario.** "This could be cleaner" is not a finding. "Given input X, this throws/returns wrong value Y" is. If you can't construct the triggering scenario, it's not CONFIRMED — say so, and mark it PLAUSIBLE instead.
- **Rank findings by severity, most severe first.** Don't bury a crash-causing bug under ten style comments.
- **No praise, no scope creep.** Don't compliment good code, don't suggest unrelated improvements outside the diff/change being reviewed. Stay in scope.
