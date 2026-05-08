# AGENTS.md — Project Constitution

## Project Identity

**Project:** Agent-Feedback-API
**Purpose:** Thin operator-hosted proxy service that forwards feedback submissions from `ux-designer` (and future Markdown-Agents) to Featurebase, holding the Featurebase API key server-side so it never ships in agent bundles.

**Why this exists.** Agents are distributed as bundles to recipient developers. If the agent called Featurebase directly, every recipient bundle would carry the Featurebase API key — exposing the operator's full account (including read access to other recipients' submissions). The proxy isolates the secret server-side; the agent only carries a low-stakes bundle token.

**Upstream contract owner.** The proxy's request/response shape and behavioral contract are owned by the upstream agent project at `d:\Dev\Markdown-Agents\agents\ux-designer\projects\2026-05-07-feedback-intake-workflow\`. Do not change the contract here — change it there first, then mirror.

## Agent Rules

Rules are scoped by activity in `~/.claude/rules/`:
- `discovery-rules.md` — decision-making, evaluating options
- `execution-rules.md` — delegation, context management, structural navigation
- `editing-rules.md` — change discipline, verification, simplicity
- `review-rules.md` — critical evaluation, self-challenge
- `communication-rules.md` — global communication rules (authoritative)

---

## Project Structure

```
Agent-Feedback-API/
├── AGENTS.md                       # This file
├── .gitignore
├── package.json                    # npm metadata + scripts (dev, typecheck, test)
├── tsconfig.json                   # TypeScript config (strict, NodeNext, no-emit)
├── vercel.json                     # Vercel function config (maxDuration, memory)
├── .env.example                    # Documented env-var keys (no values)
├── api/
│   └── feedback.ts                 # Single Vercel Node Serverless handler
├── lib/
│   ├── validate.ts                 # Pure request validator
│   └── map-outbound.ts             # Pure agent-payload → Featurebase-payload mapper
├── tests/
│   └── transformation/
│       ├── validate.test.ts        # Unit tests for validator
│       └── map-outbound.test.ts    # Unit tests for outbound mapper
├── docs/
│   ├── prd-agent-feedback-api.md   # Product requirements
│   ├── proxy-contract.md           # Mirror of upstream §10 contract
│   └── operations.md               # Deploy + smoke-test + rotation runbook
├── scratch/                        # Throwaway exploration (gitignored)
└── projects/                       # Workflow state (gitignored except ACTIVE.md if desired)
```

Layout follows Vercel's Node.js Serverless Function convention: handler at `api/feedback.ts`, pure helpers under `lib/`, tests under `tests/`. Source code uses TypeScript exclusively. No web framework — handler talks directly to `@vercel/node` types and built-in `fetch`.

---

## Contract files

The following files outrank generated options when discovery reaches alternatives (per `~/.claude/rules/discovery-rules.md` rule 9):

- `docs/proxy-contract.md` (TBD — to be authored from upstream design doc §10 verbatim) — the externally-facing API contract; do not change here without changing upstream first.
- `d:\Dev\Markdown-Agents\agents\ux-designer\projects\2026-05-07-feedback-intake-workflow\plans\2026-05-07-feedback-intake-design.md` (read-only reference) — upstream design doc, source of truth for the proxy contract.

## Scope Boundary

This repo holds proxy code, deploy config, tests, and docs. It does NOT hold:
- Featurebase API keys or any other secret values (those live in the deploy platform's secret store)
- Agent code (lives in `Markdown-Agents/agents/ux-designer/`)
- Bundle tokens beyond placeholder examples in docs

## Git

Local repo. Initialized 2026-05-07.
- Commit only files inside this directory
- Never commit `.env*` files containing real values
- `projects/` and `scratch/` are gitignored (workflow state stays local)
