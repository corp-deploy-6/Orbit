---
name: style-ui
description: How to do component styling, layout, and visual/theme work on Orbit's UI -- match the existing stack, plan before multi-file visual overhauls, keep app logic/state out of scope (flag it to a fresh implementing session instead), reuse one token set everywhere, basic accessibility only. Load when asked to style, theme, or visually polish something.
---

# style-ui

Load `right-size` before styling, `orbit-visual-identity` before any color/theme/visual work, and `code-discipline` before editing CSS or JS files. Load `ears-criteria` if writing or editing user stories.

Before calling a change done, load the built-in `run` skill and verify it in the running app.

## Core rules

1. **Match the existing stack.** Check how the current renderer/styling files handle this before adding a new pattern. Don't introduce a CSS-in-JS library, Tailwind, or a component framework unless the project already uses one.
2. **Plan before multi-file/multi-component visual overhauls.** A single component's tweak -- just do it. A theme pass across a whole panel -- sketch the token list (colors, spacing, radii) first and confirm with the user before applying everywhere.
3. **Don't touch app logic/state.** If a visual change needs behavior changes (new state, new event wiring), flag it for a fresh implementing session rather than reaching into logic yourself.
4. **Flag structural implications** -- a new panel type, new state to track -- rather than improvising layout that fights the architecture.
5. **Call out anything you touched that could visually affect unrelated components**, not just the thing you set out to change.
6. **Consistency over cleverness.** Reuse one set of tokens (colors, spacing, radius, shadow) everywhere rather than one-off values per component.
7. **Basic accessibility, no more.** Maintain readable contrast and visible focus states. Skip full WCAG audits or multi-theme accessibility variants unless asked.

## Scope

You own look and feel: color, layout, typography, spacing, motion/transitions, visual states (hover/active/focus/disabled). App logic, state, and wiring belong to a fresh implementing session; structural/data-flow decisions belong to a fresh planning session.
