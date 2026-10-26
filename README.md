# 🧩 Skill Ledger — DSH-Plugin

> **Skills you can see, explain, and analyze.** Per-reply skill badges + a session-wide Skills tab (ledger with inline per-skill detail and capability/quality analysis).

**[English](README.md) · [繁體中文](README.zh.md)**

[![npm](https://img.shields.io/npm/v/@bryan-cmf/dsh-skill-ledger)](https://www.npmjs.com/package/@bryan-cmf/dsh-skill-ledger)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-Plugin-4B32C3)](https://github.com/deepseek-ai/deepseek-harness)
![Topics](https://img.shields.io/badge/topics-dsh--plugin%20%7C%20cordis--plugin-blue)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin
that turns skills into a first-class observable surface. Two pillars:

## ✨ Features

### A — Per-reply badges, on every turn (dual-seat)

Beneath every completed reply, the skills the turn triggered (🧠) and the tools
it actually used (✓) or failed (✗), aggregated with counts:

```
🧩 Skills  [🧠 ak-hk-stock-dd ✓] [🧠 serenity-skill ✗]
🧩 Tools   [read ×3 ✓] [bash ✗]
```

The badges render through **two cooperating seats**, because the turn-tail
slot is a *chain* with single-winner semantics — the shipped deliverables
card claims every turn that produced files, and a chain elects exactly one
entry:

1. **`conversation.chat.turnTail` (chain seat)** — the full badge block,
   rendered directly on turns the chain reaches (no files produced);
2. **`conversation.chat.assistant-actions` (list seat)** — a compact
   `🧩 N skills/M tools` chip on EVERY completed turn's action row (list slots
   render all entries, so it coexists with the deliverables card). Click it
   to expand a popover with the same full badge block.

Result: badges are reachable under every reply, file-producing or not, without
ever shadowing the shipped deliverables UI.

### B — The Skills tab (`conversation.view`, id `skills`)

A session-scoped tab beside chat/trajectory: per-skill ledger stats (calls /
ok / err / turns / last-failing turn) backed by the **`skillLedger` session
projection** (whole session, including out-of-window turns and cold-start
backfill). Every skill card also **explains the skill itself** — its live
catalog description and provider, fetched once per session via
`GET /api/skill-ledger/catalog` — plus two analysis affordances:

- **⚙ capability/quality analysis** — instant structural report via
  `POST /api/skill-ledger/analyze` (folded stats + catalog definition digest);
- **🔬 deep analysis** — copies a prompt that dispatches a
  `skill-analysis` skill for a source-level capability/quality review.

(The earlier "non-blocking alternative-skill hint" row was retired by owner
request — suggesting alternates was noise; the tab now explains the skills
actually used instead.)

## Why the projection is trustworthy

The host half registers `skillLedger` with the runtime's real contract
(`stateSchema` + `wire: { viewSchema, view }` — the same shape
`@deepseek-ai/dsh-goal` uses). Earlier community plugins registered with a
`schema`/`view` top-level shape the projection registry never reads; those
units silently degrade to host-only (no client value, cache rows that force
full-log refolds on every cold read). This package is the reference
implementation of the correct wiring.

The fold also settles errors correctly: the committed `tool/result` event
carries `isError` on its `message.content[]` block — **not** on `data.error`
— and pairing happens through the block's `toolCallId`. Both facts were
verified against real session logs.

Slash (`/name`) skill invocations are folded too: the host's tool-skill hook
commits them as synthetic `user/message` events (`source.kind =
'skill-invocation'`) with **no** `tool/call`, attributed to the consuming
turn via the fold's turn anchor (stateVersion 3; verified against 11 real
injections across 4 committed session logs).

## Install

### Path A — Host composition (always-on, every session & preset)

Add to the profile's `package.json`:

```jsonc
"dsh": { "profile": { "bundles": ["@bryan-cmf/dsh-skill-ledger"] } }
```

then install (`dsh plugin --profile <name> install`) and restart DSH.

### Path B — Agent preset row

```yaml
- id: skill-ledger
  name: '@bryan-cmf/dsh-skill-ledger'
  inject: [sessionProjections, webServer, skills, sessions]
```

> ⚠️ Keep `inject` in the **row** (or bundle patch): the DSH loader reads the
> dependency list from row options, not from the module export. The
> module-export form is how `dsh-skill-gate` silently never activated; the
> missing form is how `dsh-ops-view` 0.2.0 failed the whole tree.

## Requirements

- DSH `>= 0.1.0-rc.6` — services `sessionProjections`, `webServer`, `skills`,
  `sessions` (all shipped in the `dsh-base` bundle)
- Browser UI needs the `conversation.chat.turnTail` chain,
  `conversation.chat.assistant-actions` list and the `conversation.view` ring
  (shipped chat view)

## Configuration

None in v0.1 — knobs are intentionally minimal. Caps are compile-time
constants (`MAX_TURNS = 500`, `MAX_CALLS_PER_TURN = 60`, catalog entries
`500`, per-description cap `2000` chars).

## HTTP surface

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/skill-ledger/catalog` | GET `?sessionId=` | Live catalog: name + full description + provider (Skills-tab inline detail) |
| `/api/skill-ledger/analyze` | POST `{sessionId, skill}` | Folded stats + definition digest |

Both are fail-soft: errors return `{error}` with HTTP 200, never 5xx.

## Design document

[`docs/design.md`](docs/design.md) records the full review that led here —
including the autopsy of the two predecessors this package replaces
(`dsh-skill-trail`, `dsh-skill-gate`), the hot-plugin validation round, and
the dual-seat fix for the chain/deliverables conflict.

## Development

```bash
pnpm install
pnpm build        # tsc declarations → lib/types + tsdown → lib/{index,client}.js
```

## License

MIT
