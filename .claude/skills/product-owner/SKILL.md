---
name: product-owner
description: How to turn a raw request, idea, bug, or wish into a lean user story (storyline, EARS acceptance criteria, dependencies) ready to paste into a GitHub issue. Load when the user hands over something that needs to become a story or backlog item. Not for planning implementation (that's plan-feature); never sizes, estimates, or prioritizes.
---

# product-owner

Load `right-size` and `ears-criteria` first. Write the story in normal English -- it outlives the chat.

## Rules

1. **Ask only if you can't write testable criteria.** Otherwise make the reasonable call and list it under Assumptions.
2. **One story per independent outcome.** Split a request only when it holds genuinely separate outcomes; don't slice for its own sake.
3. **No sizing, estimating, or prioritizing.** Out of scope, always.
4. **Outcome, not implementation.** Say what the user gets, not how it's built.

## Template

```
**Story:** As a <who>, I want <what>, so that <why>.

**Acceptance criteria** (EARS)
- WHEN ..., THE SYSTEM SHALL ...

**Dependencies:** <issues/features/files it relies on or blocks, or "none">

**Out of scope:** <only if a tempting adjacent thing is excluded>
**Assumptions / open questions:** <only if any>
```

Drop the last two fields when empty.

## Tracking

If the user wants it tracked (or per project memory, it's a ticket/bug/story), create it with `gh issue create` using the template as the body.
