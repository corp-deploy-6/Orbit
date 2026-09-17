# Agentic OS feature ideas

Source: 4 YouTube transcripts mined 2026-09-14 (`yt video transcripts/`):
- Jack Roberts — Claude Code + Graphify
- Nate Herk — Build & Sell Claude Code Operating Systems (2+ Hour Course)
- Chase AI — The Agentic OS Setup That Will 10x Claude Code
- AI Master — How to Build an AI Agent with Claude Code

Alpha reviewed this list against Orbit's actual state on 2026-09-14 and filed GitHub issues for the two that fit. Everything else was rejected as premature, duplicate of what Claude Code already ships, or out of scope for a solo hobby project — kept here so the ideas aren't lost if Orbit's scale/needs change later.

## Accepted → GitHub issues

- **#36** — Add a project skill for adding a new theme (4 themes already repeat the same shape: token file → index.js registration → Settings panel entry)
- **#37** — Show per-session token/cost usage in the terminal panel

## Rejected (with reason)

- Knowledge graph / vault wiki (raw → wiki → outputs) / index.md per folder / hot-cache / lint pass — Orbit is ~10 source files, no grep-cost problem yet. Revisit if the codebase or a connected knowledge base grows large.
- Skill-builder meta-skill, progressive context loading, marketplace/community skill sharing — Claude Code already provides skill mechanics natively.
- Session-history mining to seed a skill list — unnecessary process; inspect repeat patterns directly instead.
- Cloud routines / cron create-list-delete / `/loop` reimplementation, reminders & scheduling — Claude Code already ships `/schedule` and `/loop`.
- Google Workspace CLI, Playwright browser-automation fallback, per-tool API keys/.env separation — no external connections exist in Orbit yet; revisit when a real integration is added.
- Dashboard/live metrics web UI, voice I/O, cross-project chat panel, Obsidian graph view — Orbit's UI *is* the terminal panel; speculative surface area with no current need.
- Distribution packaging for non-technical teammates, monetization, per-operator company rollout — team/monetization-shaped, irrelevant to a solo hobby project.
- 4 C's (context/connections/capabilities/cadence) and 3 M's (mindset/method/machine) framing, `/audit` skill, `/level-up` skill — process ceremony with no concrete payoff at this scale.

## Full raw list (for reference)

### Knowledge & Memory
- Knowledge graph of codebase/vault (Graphify): clusters modules, ranks "god node" load-bearing files, tags fact vs inferred guess
- Query via graph not grep — cheap, fresh, no full-repo reread per session
- Karpathy LLM-wiki pattern: raw (unstructured) → wiki (structured, markdown, linked) → outputs folder
- index.md per folder level — cheap table-of-contents, fast agent orientation
- "Hot cache" file — last ~500 words of context, avoid full wiki crawl for recent info
- Lint pass on wiki — find inconsistent/missing data, propose new sources
- Second brain scales cheap (just markdown) up to hundreds of docs; beyond millions, need real vector RAG
- One shared knowledge graph/registry across tools (desktop, mobile, multiple agents)
- CLAUDE.md as master prompt: who user is, rules, folder map, skill list, connection list
- Session-history mining — extract repeat tasks from past N sessions to seed skill list

### Skills (SOPs as files)
- Skill = markdown file: name, description (YAML frontmatter), trigger, step-by-step, rules, output format
- Progressive context loading: level1 name+desc only (~100 tok) → level2 full skill.md (~1-2k tok) → level3 load reference/script files only if needed
- Reference files / scripts kept alongside or pointed-to from skill.md (avoid re-searching same API docs every run)
- Skill-builder meta-skill: interviews user, generates new skill (6-step framework: name/trigger, goal, process, references, rules, self-improve loop)
- Global skills (~/.claude) vs project-local skills
- Feedback cycle: run → watch → correct → re-run until skill reliable
- disable_model_invocation flag, allowed_tools, argument_hint, specific model per skill (frontmatter options)
- Marketplace / community / official skill libraries — download, remix, sell
- Sub-agent delegation inside a skill to protect main context window (e.g. "ClickUp searcher" sub-agent)
- Hardcode stable IDs/config directly in skill to skip repeated lookup calls (token+time save)

### Connections
- Prefer direct API integration over heavy MCP servers (token efficiency) — write endpoint reference doc once, reuse
- Separate API keys/accounts per tool per agent — restrict permissions, track spend per automation
- .env for secrets, gitignored
- Google Workspace CLI: one tool → Drive/Gmail/Calendar/Docs/Sheets/Slides, 100+ prebuilt "recipes"
- Browser automation fallback (Playwright) when no public API
- Visual validation loop: agent screenshots its own output (e.g. Slides), critiques, fixes

### Automation / Cadence
- Skill → scheduled automation → self-improving loop (progression)
- Cloud routines (Anthropic-hosted): run without laptop open, GitHub-repo based, cron/API/webhook triggered, stateless (clone→run→destroy)
- Local scheduled tasks: require app open, have local file access, catch-up on missed runs
- /loop command: session-scoped cron, max 3-day expiry, good for "help me today" not long-term
- cron create/list/delete tools, natural language scheduling, no cron syntax needed
- Reminders (one-shot) vs intervals (recurring) vs scheduled tasks (persistent)
- Routine env vars + network access levels (trusted/full/custom) — security tradeoff
- "Boring is beautiful": deterministic workflow > full agent for most business processes — push to Trigger.dev/Modal when appropriate
- Multi-agent parallel dispatch (4 agents running different tasks simultaneously)

### Dashboard / UI
- Claude Artifacts as fast dashboard prototype (proof-of-concept before custom build)
- Custom web app or Obsidian plugin wrapper — buttons = headless `claude -p` calls to skills
- Live metrics tiles: spend, session window, subscriber counts, token burn
- Voice in/out (local STT/TTS, zero cloud cost)
- Cross-project chat panel — talk to any ingested repo/vault from one place
- Obsidian graph view for visualizing wiki relationships

### Distribution / Team
- Package skill+automation+UI bundle for non-technical teammates/clients — one-click, no terminal exposure
- Web app easier to distribute (GitHub/zip) than Obsidian setup
- Per-operator AIOS → company-wide AI-readiness (bottom-up rollout)
- Monetization: sell skills/templates (caveat: not durable long-term)

### Mindset/Process framing (non-technical but structural)
- 4 C's: Context → Connections → Capabilities → Cadence (strict dependency order)
- 3 M's: Mindset, Method, Machine
- 3 levels of AI use: chat → builder → agentic (goal-in, autonomous multi-phase, self-review)
- Mandatory clarifying questions before execution; plan-mode approval before multi-step run
- Workflow audit (manual / session-mining / interview) → skill list
- /audit skill: scores AIOS against 4 C's, finds gaps
- /level-up skill: 5-question prompt (drudgery, smart-intern test, constraint, growth lever) → surfaces next builds to spec
- Tool-agnostic core (skills are just markdown — portable across Claude Code, Codex, Cursor, antigravity)
- Success signals: team messages the AIOS not you; fewer open tabs; less stuff held in your own head
