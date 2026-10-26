/**
 * @bryan-cmf/dsh-skill-ledger — Host half.
 *
 * 1. Registers one `skillLedger` session-projection unit using the runtime's
 *    real contract (`stateSchema` + `wire: { viewSchema, view }` — the shape
 *    `@deepseek-ai/dsh-goal` uses). The unit folds each session's committed
 *    log into a per-turn tool trail; the client Skills tab reads the whole
 *    session ledger through `useProjection('skillLedger')`.
 *
 * 2. Serves two webServer routes for the client half (static packages have no
 *    package-private RPC channel; this mirrors how dsh-insights does it):
 *      GET  /api/skill-ledger/catalog?sessionId=       → live catalog w/ full descriptions (Skills-tab inline detail)
 *      POST /api/skill-ledger/analyze {sessionId, skill} → stats + definition digest
 *
 * Fold notes (verified against real committed events):
 *   tool/call   data = { turn, step, callId, name, arguments: string }
 *   tool/result data = { turn, step, message: { content: [{ type: 'tool-result',
 *                            toolCallId, content, isError }] } }
 *   `isError` lives on the message content block — NOT on `data.error` (a
 *   field earlier trail implementations read and therefore never saw errors).
 *   user/message data = { source: { kind: 'skill-invocation', name, form }, … }
 *   — a user-explicit `/name` gesture is loaded host-side by the dsh-tool-skill
 *   pre-step hook and committed as this synthetic message; NO tool/call is
 *   emitted on that path (the model is instructed not to call the `skill` tool
 *   for it), so without this branch slash invocations never reach the ledger.
 *   These events carry NO `turn` but always commit AFTER the consuming turn's
 *   `step/start` (verified in committed logs), so the fold attributes them to
 *   the last turn-tagged event.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { LedgerCall, LedgerState, SkillCatalogEntry, SkillDefinitionDigest, SkillStats } from './types.ts'

const name = 'skill-ledger'

const MAX_TURNS = 500
const MAX_CALLS_PER_TURN = 60
/** Assistant-message → turn map cap (a turn can emit several assistant
 * messages, so this is deliberately looser than MAX_TURNS). */
const MAX_MESSAGES = 2000
/** Inline-detail catalog served by the catalog route: entry cap and
 * per-description cap (generous — the Skills tab renders real descriptions). */
const MAX_CATALOG_ENTRIES = 500
const MAX_DESCRIPTION_CHARS = 2000
/** Slash-invocation deferred-queue cap (used only when a skill-invocation
 * commits before any turn-tagged event — defensive, empty in practice). */
const MAX_PENDING_INVOCATIONS = 32

/** Hard dependencies — all shipped in the dsh-base bundle. */
const inject = ['sessionProjections', 'webServer', 'skills', 'sessions', 'agents']

// ── minimal structural shapes (no runtime imports from @deepseek-ai/*) ──────

interface SessionEventShape {
  type: string
  data?: unknown
}
interface ToolCallData {
  turn?: unknown
  callId?: unknown
  name?: unknown
  arguments?: unknown
}
interface ToolResultData {
  turn?: unknown
  message?: unknown
  error?: unknown
}
interface AssistantMessageData {
  turn?: unknown
  message?: { id?: unknown }
}
interface MessageShape {
  isError?: unknown
  toolCallId?: unknown
  content?: unknown
}

interface ProjectionRegistry {
  register(definition: {
    key: string
    stateSchema: { parse(v: unknown): unknown }
    init(): LedgerState
    apply(state: LedgerState, event: SessionEventShape): LedgerState
    wire: {
      viewSchema: { parse(v: unknown): unknown }
      view(state: LedgerState): unknown
    }
    stateVersion: number
  }): () => void
  stateOf(session: unknown, key: string): LedgerState | undefined
}

interface SkillSummaryLike {
  name?: unknown
  description?: unknown
  provider?: unknown
}
interface SkillsService {
  list(options?: Record<string, unknown>): Promise<SkillSummaryLike[]>
  get(name: string, options?: Record<string, unknown>): Promise<{
    name?: unknown
    provider?: unknown
    description?: unknown
    content?: unknown
  } | undefined>
}
interface SessionsService {
  get(id: string): unknown
}

interface AgentsService {
  /** Agent and Session share the same id axis. */
  get(id: string): { session: { header: { cwd?: unknown } } } | undefined
}
interface WebServerLike {
  register(route: {
    kind: string
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}
interface HostCtx extends Record<string, unknown> {
  sessionProjections: ProjectionRegistry
  webServer: WebServerLike
  skills: SkillsService
  sessions: SessionsService
  agents: AgentsService
}

// ── schema shims: the runtime only ever calls .parse on these ───────────────

function mkParse(label: string, check: (v: unknown) => boolean): { parse(v: unknown): unknown } {
  return {
    parse(v: unknown): unknown {
      if (!check(v)) throw new Error(`${label} schema validation failed`)
      return v
    },
  }
}
const stateSchema = mkParse('skillLedger state', (s) =>
  !!s && typeof s === 'object' && typeof (s as LedgerState).turns === 'object' && !Array.isArray((s as LedgerState).turns))
const viewSchema = mkParse('skillLedger view', (v) => !!v && typeof v === 'object')

// ── fold helpers ────────────────────────────────────────────────────────────

function skillNameOf(args: unknown): string {
  if (typeof args !== 'string') return ''
  try {
    const j = JSON.parse(args) as unknown
    if (j && typeof j === 'object') {
      const record = j as Record<string, unknown>
      if (typeof record.name === 'string') return record.name
      if (typeof record.skill === 'string') return record.skill
    }
  } catch {
    // unparseable arguments — no skill name
  }
  return ''
}

/** `isError` sits on the message content block; `data.error` is a fallback. */
function errorOf(data: ToolResultData): boolean {
  if (data.error) return true
  const m = data.message as MessageShape | undefined
  if (m && typeof m === 'object') {
    if (m.isError === true) return true
    const arr = m.content
    if (Array.isArray(arr)) {
      for (const c of arr) {
        if (c && typeof c === 'object' && (c as MessageShape).isError === true) return true
      }
    }
  }
  return false
}

function pairingOf(data: ToolResultData): string {
  const m = data.message as MessageShape | undefined
  if (m && typeof m === 'object') {
    const arr = m.content
    if (Array.isArray(arr)) {
      for (const c of arr) {
        if (c && typeof c === 'object' && typeof (c as MessageShape).toolCallId === 'string') {
          return (c as MessageShape).toolCallId as string
        }
      }
    }
    if (typeof m.toolCallId === 'string') return m.toolCallId
  }
  return ''
}

/** Record one settled slash-invocation. The injection only commits for an
 * existing, user-invocable skill, so it settles directly as `ok`; the empty
 * callId keeps it out of every tool/result pairing path. */
function attachSkillInvocation(state: LedgerState, turnKey: string, skill: string): LedgerState {
  const prev = state.turns[turnKey]
  if (prev && prev.length >= MAX_CALLS_PER_TURN) return state
  const call: LedgerCall = { name: 'skill', skill, status: 'ok', callId: '' }
  const turns = { ...state.turns }
  turns[turnKey] = prev ? [...prev, call] : [call]
  return { ...state, turns }
}

/** Pure fold: previous state + one committed event → next state. */
function fold(state: LedgerState, event: SessionEventShape): LedgerState {
  // ── turn anchor + deferred slash-invocation flush ──────────────────────
  // Skill-invocation injections carry no `turn`; every other engine event
  // does. The last turn-tagged event is the injection's turn (verified order:
  // step/start commits before the injected message batch).
  const evData = event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : undefined
  const tagged = evData && typeof evData.turn === 'number' && Number.isFinite(evData.turn) ? String(evData.turn) : null
  if (tagged !== null && tagged !== state.lastTurn) state = { ...state, lastTurn: tagged }
  const deferred = Array.isArray(state.pendingSkills) ? state.pendingSkills : null
  if (typeof state.lastTurn === 'string' && deferred !== null && deferred.length > 0) {
    let settled: LedgerState = { ...state, pendingSkills: [] }
    for (const skill of deferred) settled = attachSkillInvocation(settled, state.lastTurn, skill)
    state = settled
  }
  // ── user-explicit skill invocation (`/name` gesture) ───────────────────
  if (event.type === 'user/message') {
    const src = evData && evData.source && typeof evData.source === 'object'
      ? (evData.source as Record<string, unknown>)
      : undefined
    if (src === undefined || src.kind !== 'skill-invocation' || typeof src.name !== 'string' || src.name === '') return state
    if (typeof state.lastTurn === 'string') return attachSkillInvocation(state, state.lastTurn, src.name)
    // No anchor committed yet: defer to the next turn tag (flush block above).
    const queue = Array.isArray(state.pendingSkills) ? state.pendingSkills : []
    if (queue.length >= MAX_PENDING_INVOCATIONS) return state
    return { ...state, pendingSkills: [...queue, src.name] }
  }
  // assistant/message — record the closing message id → turn mapping the
  // client's assistant-actions seat needs (0.1.7 dispatches only `messageId`
  // there; the chat snapshot is no longer reachable from slot props).
  if (event.type === 'assistant/message') {
    const data = (event.data && typeof event.data === 'object' ? event.data : {}) as AssistantMessageData
    const mid = data.message && typeof data.message === 'object' && typeof data.message.id === 'string' ? data.message.id : ''
    if (mid === '' || data.turn === undefined) return state
    const turnKey = String(data.turn)
    if (state.byMessage[mid] === turnKey) return state
    const byMessage = { ...state.byMessage, [mid]: turnKey }
    const mids = Object.keys(byMessage)
    if (mids.length > MAX_MESSAGES) delete byMessage[mids[0]!]
    return { ...state, byMessage }
  }
  if (event.type !== 'tool/call' && event.type !== 'tool/result') return state
  const data = (event.data && typeof event.data === 'object' ? event.data : {}) as ToolCallData & ToolResultData
  const turnKey = String(data.turn)
  const turns = state.turns
  const prev = turns[turnKey]

  if (event.type === 'tool/call') {
    if (prev && prev.length >= MAX_CALLS_PER_TURN) return state
    const call: LedgerCall = {
      name: typeof data.name === 'string' ? data.name : '',
      skill: data.name === 'skill' ? skillNameOf(data.arguments) : '',
      status: 'pending',
      callId: typeof data.callId === 'string' ? data.callId : '',
    }
    if (call.name === '' && call.callId === '') return state
    const nextTurns = { ...turns }
    nextTurns[turnKey] = prev ? [...prev, call] : [call]
    const keys = Object.keys(nextTurns).map(Number).filter(Number.isFinite)
    if (keys.length > MAX_TURNS) {
      const oldest = String(Math.min(...keys))
      const trimmed = { ...nextTurns }
      delete trimmed[oldest]
      return { ...state, turns: trimmed }
    }
    return { ...state, turns: nextTurns }
  }

  // tool/result — settle the paired pending call.
  if (!prev) return state
  const callId = pairingOf(data)
  let index = -1
  if (callId !== '') index = prev.findIndex((c) => c.callId === callId)
  if (index === -1) {
    // Fallback pairing only when exactly one pending call remains: guessing
    // among several concurrent pendings would mis-attribute the result.
    const pendings = prev.filter((c) => c.status === 'pending')
    if (pendings.length === 1) index = prev.indexOf(pendings[0]!)
  }
  if (index === -1) return state
  const call = prev[index]!
  if (call.status !== 'pending') return state
  const nextCalls = [...prev]
  nextCalls[index] = { ...call, status: errorOf(data) ? 'err' : 'ok' }
  return { ...state, turns: { ...turns, [turnKey]: nextCalls } }
}

/** State → wire payload (the read-side projection). Null-prototype buckets
 * keep arbitrary skill/tool names out of `Object.prototype` keys. */
function view(state: LedgerState): unknown {
  const skills: Record<string, SkillStats> = Object.create(null)
  const tools: Record<string, SkillStats> = Object.create(null)
  const byTurn: Record<string, { skills: string[]; tools: string[]; errors: string[] }> = Object.create(null)
  const trails: Record<string, Array<{ n: string; s: string; st: 'ok' | 'err' | 'pending' }>> = Object.create(null)
  let skillCallCount = 0
  const turns = state.turns ?? {}
  for (const turnKey of Object.keys(turns)) {
    const calls = turns[turnKey]
    if (!Array.isArray(calls)) continue
    trails[turnKey] = calls.map((c) => ({
      n: c && typeof c.name === 'string' ? c.name : '',
      s: c && typeof c.skill === 'string' ? c.skill : '',
      st: c && (c.status === 'err' || c.status === 'ok' || c.status === 'pending') ? c.status : 'pending',
    }))
    for (const c of calls) {
      if (!c || typeof c !== 'object') continue
      const isSkill = c.skill !== ''
      const key = isSkill ? c.skill : c.name
      if (key === '') continue
      const bucket = isSkill ? skills : tools
      const rec = bucket[key] ?? (bucket[key] = { calls: 0, ok: 0, err: 0, turns: [], lastErrTurn: null })
      rec.calls += 1
      if (c.status === 'ok') rec.ok += 1
      else if (c.status === 'err') rec.err += 1
      if (isSkill) skillCallCount += 1
      const t = Number(turnKey)
      if (Number.isFinite(t)) {
        if (!rec.turns.includes(t)) {
          rec.turns.push(t)
          if (rec.turns.length > 30) rec.turns = rec.turns.slice(-30)
        }
        if (c.status === 'err') rec.lastErrTurn = t
      }
      const bt = byTurn[turnKey] ?? (byTurn[turnKey] = { skills: [], tools: [], errors: [] })
      const arr = isSkill ? bt.skills : bt.tools
      if (!arr.includes(key)) arr.push(key)
      if (c.status === 'err' && !bt.errors.includes(key)) bt.errors.push(key)
    }
  }
  return {
    skills,
    tools,
    byTurn,
    byMessage: state.byMessage ?? {},
    trails,
    total: { skills: Object.keys(skills).length, calls: skillCallCount },
  }
}

// ── tiny HTTP helpers (fail-soft: errors return {error} with 200) ──────────

function sendJson(res: ServerResponse, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

/**
 * Resolve the skills-view lookup for a session id. Skill catalogs are layered
 * by scope and cwd (user-agents root, project roots, preset layers); calling
 * list/get WITHOUT them sees only the global layer — empty on this deployment
 * (verified live: the catalog listing returned [] and get() returned undefined).
 * The
 * shipped skill tool passes { cwd, scope: agent }; we mirror that via the
 * agents registry (Agent and Session share the id axis).
 */
function lookupOf(ctx: HostCtx, sessionId: string): Record<string, unknown> {
  try {
    const agent = ctx.agents.get(sessionId)
    if (agent !== undefined) {
      const cwd = agent.session.header.cwd
      return { cwd: typeof cwd === 'string' ? cwd : undefined, scope: agent }
    }
  } catch {
    // fall through to the cwd-less lookup
  }
  return {}
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = []
    req.on('data', (c: Buffer) => parts.push(c))
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')))
    req.on('error', reject)
  })
}

function apply(ctx: HostCtx): void {
  // 1. The session projection (correct contract: stateSchema + wire).
  //    stateVersion 2: adds byMessage (assistant-message → turn) + trails.
  //    stateVersion 3: ingests slash-invocation user/messages (turn anchor +
  //    deferred queue) — old cached rows lack the new fields, so replay.
  ctx.sessionProjections.register({
    key: 'skillLedger',
    stateSchema,
    init: () => ({ turns: {}, byMessage: {}, lastTurn: null, pendingSkills: [] }),
    apply: fold,
    wire: { viewSchema, view },
    stateVersion: 3,
  })

  // 2. Client-facing routes.
  ctx.webServer.register({
    kind: 'exact',
    path: '/api/skill-ledger/catalog',
    handler: async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', 'http://x')
        const sid = url.searchParams.get('sessionId') ?? ''
        const lookup = sid !== '' ? lookupOf(ctx, sid) : {}
        // Scope-aware listing (cwd + agent layer): the global layer alone is
        // empty on layered deployments (verified live — see lookupOf).
        const list = await ctx.skills.list(lookup)
        const seen = new Set<string>()
        const skills: SkillCatalogEntry[] = []
        for (const s of Array.isArray(list) ? list : []) {
          if (!s || typeof s.name !== 'string' || s.name === '' || seen.has(s.name)) continue
          seen.add(s.name)
          skills.push({
            name: s.name,
            description: typeof s.description === 'string' ? s.description.slice(0, MAX_DESCRIPTION_CHARS) : '',
            provider: typeof s.provider === 'string' ? s.provider : '',
          })
        }
        skills.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        sendJson(res, { skills: skills.slice(0, MAX_CATALOG_ENTRIES) })
      } catch (error) {
        sendJson(res, { skills: [], error: String((error as Error)?.message ?? error) })
      }
    },
  })

  ctx.webServer.register({
    kind: 'exact',
    path: '/api/skill-ledger/analyze',
    handler: async (req, res) => {
      try {
        const raw = await readBody(req)
        let args: { sessionId?: unknown; skill?: unknown } = {}
        try {
          args = JSON.parse(raw || '{}') as typeof args
        } catch {
          sendJson(res, { error: 'invalid JSON' })
          return
        }
        const sessionId = typeof args.sessionId === 'string' ? args.sessionId : ''
        const skill = typeof args.skill === 'string' ? args.skill : ''
        if (sessionId === '' || skill === '') {
          sendJson(res, { error: 'missing sessionId/skill' })
          return
        }
        let stats: SkillStats | null = null
        const session = ctx.sessions.get(sessionId)
        if (session !== undefined) {
          const st = ctx.sessionProjections.stateOf(session, 'skillLedger')
          if (st !== undefined) {
            const v = view(st) as { skills: Record<string, SkillStats> }
            if (Object.prototype.hasOwnProperty.call(v.skills, skill)) stats = v.skills[skill]!
          }
        }
        let definition: SkillDefinitionDigest | null = null
        const d = await ctx.skills.get(skill, lookupOf(ctx, sessionId))
        if (d !== undefined) {
          definition = {
            name: typeof d.name === 'string' ? d.name : skill,
            provider: typeof d.provider === 'string' ? d.provider : '',
            description: typeof d.description === 'string' ? d.description.slice(0, 400) : '',
            contentLength: typeof d.content === 'string' ? d.content.length : -1,
          }
        }
        sendJson(res, { stats, definition, skill, sessionId })
      } catch (error) {
        sendJson(res, { error: String((error as Error)?.message ?? error) })
      }
    },
  })
}

export { apply, inject, name }
