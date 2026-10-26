/**
 * Shared wire types of the `skillLedger` session projection and the
 * `/api/skill-ledger/*` routes.
 *
 * The projection folds the committed session log into a per-turn tool trail
 * (every `tool/call` becomes an entry; the paired `tool/result` — matched by
 * the block's `toolCallId` — settles it as ok/err via `message.content[].isError`).
 *
 * User-explicit skill invocations (`/name` gestures) reach the fold through a
 * second path: the host's dsh-tool-skill pre-step hook commits the loaded
 * skill as a synthetic `user/message` (`source.kind = 'skill-invocation'`)
 * and never emits a `tool/call` — the fold settles those directly as `ok`.
 */

/** One tool invocation within a turn, as folded by the host projection. */
export interface LedgerCall {
  /** Wire tool name (e.g. `skill`, `bash`, `read`). Slash-invocations use `skill`. */
  name: string
  /** Parsed skill name when `name === 'skill'` (arguments' `name`, falling back to `skill`; for slash-invocations, `source.name`). */
  skill: string
  /** `pending` = triggered, result not committed yet; `ok` / `err` = settled. Slash-invocations commit settled (`ok`). */
  status: 'pending' | 'ok' | 'err'
  /** Engine callId pairing the call with its result. Empty for slash-invocations (nothing to pair). */
  callId: string
}

/** Internal fold state of the projection: per-turn triggered entries. */
export interface LedgerState {
  /** Turn number (as string key) → its calls, in call order. */
  turns: Record<string, LedgerCall[]>
  /** Assistant message id → its turn key (string). Lets the client's
   * assistant-actions seat map a finalized message back to its turn without
   * a chat snapshot. Capped alongside `turns`. */
  byMessage: Record<string, string>
  /** Turn key of the last turn-tagged event seen (null until the first).
   * Slash-invocation injections carry no `turn` field but always commit after
   * the consuming turn's `step/start`, so this anchor attributes them. */
  lastTurn: string | null
  /** Slash invocations committed before any turn tag existed, flushed onto
   * the next anchor. Defensive: `step/start` commits before the message
   * batch in every log examined, so this queue stays empty in practice. */
  pendingSkills: string[]
}

/** Per-skill aggregate served by the projection view and the analyze route. */
export interface SkillStats {
  calls: number
  ok: number
  err: number
  /** Turns this skill was used in (capped at the last 30). */
  turns: number[]
  /** Last turn that settled an error for this skill; null when none. */
  lastErrTurn: number | null
}

/** Whole value of the `skillLedger` projection (the wire payload). */
export interface SkillLedgerView {
  skills: Record<string, SkillStats>
  tools: Record<string, SkillStats>
  byTurn: Record<string, { skills: string[]; tools: string[]; errors: string[] }>
  /** Assistant message id → turn key; the actions-seat badge's turn lookup. */
  byMessage: Record<string, string>
  /** Per-turn compact call trail (`n` name, `s` skill, `st` status) — the
   * badge rows' data source, replacing the pre-0.1.7 chat-snapshot path. */
  trails: Record<string, Array<{ n: string; s: string; st: 'ok' | 'err' | 'pending' }>>
  total: { skills: number; calls: number }
}

/** One catalog entry served by `GET /api/skill-ledger/catalog` — the inline
 * per-skill detail rendered on the Skills tab. */
export interface SkillCatalogEntry {
  name: string
  description: string
  provider: string
}

/** Skill definition digest served by the analyze route. */
export interface SkillDefinitionDigest {
  name: string
  provider: string
  description: string
  contentLength: number
}
