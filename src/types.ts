/**
 * Shared wire types of the `skillLedger` session projection and the
 * `/api/skill-ledger/*` routes.
 *
 * The projection folds the committed session log into a per-turn tool trail
 * (every `tool/call` becomes an entry; the paired `tool/result` — matched by
 * the block's `toolCallId` — settles it as ok/err via `message.content[].isError`).
 */

/** One tool invocation within a turn, as folded by the host projection. */
export interface LedgerCall {
  /** Wire tool name (e.g. `skill`, `bash`, `read`). */
  name: string
  /** Parsed skill name when `name === 'skill'` (arguments' `name`, falling back to `skill`). */
  skill: string
  /** `pending` = triggered, result not committed yet; `ok` / `err` = settled. */
  status: 'pending' | 'ok' | 'err'
  /** Engine callId pairing the call with its result. */
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

/** One catalog skill served by `GET /api/skill-ledger/candidates`. */
export interface SkillCandidate {
  name: string
  description: string
}

/** Skill definition digest served by the analyze route. */
export interface SkillDefinitionDigest {
  name: string
  provider: string
  description: string
  contentLength: number
}
