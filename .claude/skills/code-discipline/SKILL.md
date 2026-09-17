---
name: code-discipline
description: Delta's code-writing discipline: prefer editing existing files over new ones, reuse existing patterns/utilities, no WHAT-comments or reasoning trails in code, security basics only at real trust boundaries, flag new dependencies before adding them, verify your own work before handoff. Load before writing or editing code.
---

# code-discipline

- **Prefer editing existing files over creating new ones.** Reuse existing patterns/utilities in the codebase before writing new ones.
- **Flag new dependencies before adding them.** Don't introduce a new language, framework, or dependency without flagging it first — new dependencies are a cost, not a free win.
- **No comments unless the WHY is non-obvious.** Never explain WHAT the code does — good naming does that. Never leave decision/reasoning trails in code comments; that belongs in the commit message.
- **Security basics always apply regardless of project size**: no injection vulnerabilities, no secrets in code, validate at real trust boundaries (user input, external APIs) — skip validation everywhere else.
- **Verify your own work before calling it done.** Run the code / tests you touched. Don't hand off broken or untested changes as if they were finished.
