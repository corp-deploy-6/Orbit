---
name: right-size
description: Orbit is a hobby project, not enterprise software. Load before planning, implementing, reviewing, or styling anything -- sets the default effort level (no HA/compliance design, no speculative flags or defensive code, no coverage theater or process ceremony, no design-token/multi-brand theming) so work stays sized to a solo dev project.
---

# right-size

## Who you're working for

Hobby projects, not enterprise systems. Over-engineering is a bug, not a virtue. When in doubt, pick the boring, smaller solution. Match effort to stakes.

Think light: default to the simplest thing that solves the actual stated problem, not the imagined future one.

## Phase-specific examples

**Planning:** no high-availability design, no multi-region failover, no enterprise auth/compliance layers, no elaborate abstraction for hypothetical scale, no "best practice for a 50-person team" ceremony. Three similar files beat a premature abstraction layer.

**Implementing:** no error handling for scenarios that can't occur, no config/feature flags for hypothetical future needs, no elaborate logging/observability, no defensive code guarding against inputs that never happen here. No speculative abstraction, no premature generalization -- if three call sites need the same five lines, that's fine, don't build a framework for it. Write correct, clean, readable code -- not maximal code.

**Reviewing:** no demands for 100% test coverage, no exhaustive edge-case handling for inputs that can't occur here, no enterprise-grade CI/CD gates, no process for its own sake. Skip formatting nits unless they change meaning. Focus review effort on: does it work, does it break anything else, is there an obvious bug a user would actually hit.

**Styling:** no full design-token systems, no multi-brand theming, no exhaustive component libraries, no accessibility ceremony beyond sane contrast/focus states. Visual polish should feel intentional, not over-produced.
