# 🧩 Skill Ledger — DSH-Plugin

> **技能看得見、選得出、析得動。** 每條回覆下方的技能/工具徽章 + 非阻斷候選技能提示 + 會話級「技能」標籤頁(台帳與能力/質量分析)。

[![npm](https://img.shields.io/npm/v/@bryan-cmf/dsh-skill-ledger)](https://www.npmjs.com/package/@bryan-cmf/dsh-skill-ledger)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-Plugin-4B32C3)](https://github.com/deepseek-ai/deepseek-harness)
![Topics](https://img.shields.io/badge/topics-dsh--plugin%20%7C%20cordis--plugin-blue)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin
that turns skills into a first-class observable surface. Three pillars:

## ✨ Features

### A — Per-reply badges (`conversation.chat.turnTail`)

Beneath every completed reply, the skills the turn triggered (🧠) and the tools
it actually used (✓) or failed (✗), aggregated with counts:

```
🧩 技能   [🧠 ak-hk-stock-dd ✓] [🧠 serenity-skill ✗]
🧩 工具   [read ×3 ✓] [bash ✗]
```

Derived from the conversation snapshot's `tool-result` nodes — deterministic
for live turns and replayed history, zero model self-reporting. Tool-less
turns render nothing.

### B — Non-blocking alternative-skill hint (same slot)

When a turn used at least one skill, a third row appears:

```
🧩 不滿意?可試  [serenity-skill] [dcf-valuation] [ak-financial-analyst]  [用選定技能重跑]
```

Multi-select candidate chips → the button writes a re-run prompt **draft** into
the composer. Nothing is ever intercepted, popped, or timed out — you press
Enter, or you don't. (This is the philosophical opposite of a blocking
"skill gate".)

### C — The Skills tab (`conversation.view`, id `skills`)

A session-scoped tab beside chat/trajectory: per-skill ledger stats (calls /
ok / err / turns / last-failing turn) backed by the **`skillLedger` session
projection** (whole session, including out-of-window turns and cold-start
backfill), plus two analysis affordances per skill:

- **⚙ 分析能力/質量** — instant structural report via
  `POST /api/skill-ledger/analyze` (folded stats + catalog definition digest);
- **🔬 深度分析** — writes a prompt draft that dispatches the
  [`skill-analysis`](https://github.com/Bryan-cmf) skill for a source-level
  capability/quality review.

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
```

## Requirements

- DSH `>= 0.1.0-rc.6` — services `sessionProjections`, `webServer`, `skills`,
  `sessions` (all shipped in the `dsh-base` bundle; the plugin declares them
  as hard `inject` dependencies and waits for them)
- Browser UI needs the `conversation.chat.turnTail` chain and the
  `conversation.view` ring (shipped chat view)

## Configuration

None in v0.1 — knobs are intentionally minimal. Caps are compile-time
constants (`MAX_TURNS = 500`, `MAX_CALLS_PER_TURN = 60`, candidates served
`12` → client narrows to `6`).

## HTTP surface

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/skill-ledger/candidates` | GET | Catalog skills (name + 120-char description) |
| `/api/skill-ledger/analyze` | POST `{sessionId, skill}` | Folded stats + definition digest |

Both are fail-soft: errors return `{error}` with HTTP 200, never 5xx.

## Design document

[`docs/design.md`](docs/design.md) records the full review that led here —
including the autopsy of the two predecessors this package replaces
(`dsh-skill-trail`, `dsh-skill-gate`) and the hot-plugin validation round.

## Development

```bash
pnpm install
pnpm build        # tsc declarations → lib/types + tsdown → lib/{index,client}.js
```

## License

MIT
