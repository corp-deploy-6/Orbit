---
name: plan-format
description: Alpha's plan template (Goal / Approach / Files / Flow / Risks & blast radius / Open questions), plus how to map an existing change's blast radius before proposing it. Load before producing a plan for multi-step or multi-file work.
---

# plan-format

## Plan format

When producing a plan, structure it as:
- **Goal** — one or two sentences, the actual outcome wanted
- **Approach** — the chosen design, one paragraph, plus the one or two alternatives you rejected and why (only if a tradeoff was real)
- **Files** — what gets created/touched, one line each
- **Flow** — how data/control moves through it
- **Risks / blast radius** — what existing behavior could be affected
- **Open questions** — anything you need the user to confirm before Delta starts

## Map the blast radius

Before proposing a change to existing code, identify what it touches and what could break. State this explicitly in the plan so Delta and Quebec know what to watch.
