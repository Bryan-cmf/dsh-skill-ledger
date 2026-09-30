/**
 * @bryan-cmf/dsh-skill-ledger — Client half (0.1.7+ slot contract).
 *
 * A) `conversation.chat.turnTail` list entry: beneath every completed reply,
 *    skill/tool badge rows derived from the `skillLedger` host projection,
 *    plus a non-blocking alternative-skill hint row. 0.1.7 dispatches owner
 *    props `{ turn, seq, openFile }`; session-scope standard props supply
 *    `useProjection`/`sessionId` (dsh-client-ui-session SessionStandardProps
 *    merges into every session-scoped slot entry). The pre-0.1.7
 *    `matched`/`useSession`(chat-snapshot) path no longer exists.
 *
 * A2) `conversation.chat.assistant-actions` list entry: a compact per-turn
 *    chip (🧩 技能×N·工具×M) on every finalized assistant message. 0.1.7
 *    dispatches only `{ messageId }`; the host projection's new `byMessage`
 *    map (assistant/message fold) resolves messageId → turn, and `trails`
 *    carries the per-turn call list.
 *
 * B) `conversation.view` list entry (id 'skills', order 60, label 技能): a
 *    Skills tab over the whole session — per-skill ledger stats from
 *    `useProjection('skillLedger')` plus capability/quality analysis buttons.
 *    `inputActions` is no longer dispatched to view entries: the two
 *    prompt-writing affordances (re-run hint, deep analysis) copy their
 *    prompt to the clipboard instead.
 *
 * React hooks are called unconditionally at each component's top (effects run
 * before any early return) — a hard rule this component family enforces
 * after a past hooks-order regression.
 */
import { createElement, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { SkillCandidate, SkillLedgerView, SkillStats } from '../types.ts'

const name = 'skill-ledger-client'
const inject = ['slots']

// ── slot props (0.1.7 dispatch + session standard props) ────────────────────

/** Loose shape of the framework's session-scoped `useProjection` hook. */
interface UseProjectionLike {
  (key: string): unknown
  (key: string, selector: (value: unknown) => unknown): unknown
}
interface TurnTailProps {
  /** Owner prop from the turnTail dispatcher (the closing turn number). */
  turn?: number
  /** Session standard props (auto-injected for session-scoped entries). */
  sessionId?: string
  useProjection?: UseProjectionLike
}
interface AssistantActionsProps {
  /** Owner prop from the assistant-actions dispatcher (the only one it sends). */
  messageId?: string
  sessionId?: string
  useProjection?: UseProjectionLike
}
interface ViewProps {
  sessionId?: string
  useProjection?: UseProjectionLike
}
interface SlotsService {
  inject(key: string, fn: () => unknown): unknown
  register(registration: unknown, component: unknown): unknown
}
interface ClientCtx {
  slots: SlotsService
}

// ── styles ──────────────────────────────────────────────────────────────────

const containerStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 10px', margin: '2px 0 6px', fontSize: 11, lineHeight: 1, opacity: 0.92 }
const rowStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }
const capStyle: CSSProperties = { color: 'var(--dsw-alias-label-secondary)', minWidth: 32, whiteSpace: 'nowrap' }
const chipBase: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 8px', borderRadius: 999, background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-secondary)', border: '1px solid var(--dsw-alias-border-l1)', whiteSpace: 'nowrap', fontSize: 11, lineHeight: 1, cursor: 'default' }
const chipSkill: CSSProperties = { background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-brand-primary)', borderColor: 'var(--dsw-alias-brand-primary)' }
const chipOk: CSSProperties = { color: 'var(--dsw-alias-state-success-primary)' }
const chipErr: CSSProperties = { color: 'var(--dsw-alias-state-error-primary)', borderColor: 'var(--dsw-alias-state-error-primary)' }

const pageStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 20px', fontSize: 13, color: 'var(--dsw-alias-label-primary)' }
const cardStyle: CSSProperties = { background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 10, padding: '12px 14px' }
const cardTitle: CSSProperties = { fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--dsw-alias-label-secondary)' }
const smallBtn: CSSProperties = { fontSize: 11, border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, background: 'transparent', color: 'var(--dsw-alias-label-secondary)', padding: '2px 8px', cursor: 'pointer', marginTop: 6 }
const brandBtn: CSSProperties = { fontSize: 11, border: '1px solid var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-brand-primary)', background: 'transparent', padding: '2px 8px', cursor: 'pointer', marginTop: 6, borderRadius: 6 }
const statValue: CSSProperties = { fontSize: 20, fontWeight: 700 }
const statLabel: CSSProperties = { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' }
const reportBodyStyle: CSSProperties = { marginTop: 6, fontSize: 11, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6, background: 'var(--dsw-alias-bg-layer-2)', borderRadius: 6, padding: '6px 9px' }
const rerunBtn: CSSProperties = { borderRadius: 8, border: '1px solid var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-brand-primary)', background: 'transparent', padding: '3px 10px', fontSize: 11, cursor: 'pointer' }
const summaryChipBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 7px', borderRadius: 999, background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', border: '1px solid var(--dsw-alias-border-l1)', whiteSpace: 'nowrap', fontSize: 11, lineHeight: 1.4, cursor: 'pointer', fontFamily: 'inherit' }
const popoverAnchor: CSSProperties = { position: 'relative', display: 'inline-flex', flex: 'none' }
const popoverStyle: CSSProperties = { position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 30, minWidth: 280, maxWidth: 'min(480px, calc(100vw - 16px))', background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 10, boxShadow: 'var(--dsw-shadow-lv3)', padding: '4px 6px' }

// ── trail derivation (from the skillLedger projection) ──────────────────────

interface TrailCall {
  name: string
  skill: string
  status: 'ok' | 'err'
}
interface Trail {
  triggered: TrailCall[]
}

/** Loose structural view of the projection's wire payload (see types.ts). */
interface LedgerWire {
  trails?: Record<string, Array<{ n?: unknown; s?: unknown; st?: unknown }> | undefined>
  byMessage?: Record<string, unknown>
}

/** Per-turn call trail from the projection's `trails` table. */
function trailOfLedger(raw: unknown, turnKey: string | undefined): Trail | undefined {
  if (turnKey === undefined) return undefined
  const ledger = raw && typeof raw === 'object' ? (raw as LedgerWire) : null
  const arr = ledger && ledger.trails ? ledger.trails[turnKey] : undefined
  if (!Array.isArray(arr) || arr.length === 0) return undefined
  const triggered: TrailCall[] = []
  for (const c of arr) {
    if (!c || typeof c !== 'object') continue
    const call = c as { n?: unknown; s?: unknown; st?: unknown }
    const name = typeof call.n === 'string' ? call.n : ''
    if (name === '') continue
    triggered.push({
      name,
      skill: typeof call.s === 'string' ? call.s : '',
      status: call.st === 'err' ? 'err' : 'ok',
    })
  }
  if (triggered.length === 0) return undefined
  return { triggered }
}

/** Assistant message id → turn key, from the projection's `byMessage` map
 * (folded host-side from `assistant/message` events). */
function turnOfMessageInLedger(raw: unknown, messageId: string | undefined): string | undefined {
  if (messageId === undefined) return undefined
  const ledger = raw && typeof raw === 'object' ? (raw as LedgerWire) : null
  const turn = ledger && ledger.byMessage ? ledger.byMessage[messageId] : undefined
  return typeof turn === 'string' ? turn : undefined
}

function skillNamesOf(trail: Trail): string[] {
  const names: string[] = []
  for (const c of trail.triggered) {
    if (c.skill !== '' && !names.includes(c.skill)) names.push(c.skill)
  }
  return names
}

/** Hooks-order safety: call useProjection unconditionally with a noop
 * fallback instead of conditionally invoking the prop. */
const noopProjection = (): undefined => undefined

// ── badge rows + hint row (shared by both seats) ────────────────────────────

interface Chip {
  key: string
  label: string
  kind: 'plain' | 'skill' | 'ok' | 'err'
}

function chipsOf(trail: Trail, isSkill: boolean): Chip[] {
  const byKey: Record<string, { count: number; ok: number; err: number }> = Object.create(null)
  for (const c of trail.triggered) {
    const is = c.skill !== ''
    if (is !== isSkill) continue
    const key = is ? `🧠 ${c.skill}` : c.name
    const cur = byKey[key] ?? (byKey[key] = { count: 0, ok: 0, err: 0 })
    cur.count += 1
    if (c.status === 'err') cur.err += 1
    else cur.ok += 1
  }
  const out: Chip[] = []
  for (const key of Object.keys(byKey)) {
    const cur = byKey[key]!
    let kind: Chip['kind'] = isSkill ? 'skill' : 'plain'
    let suffix = ''
    if (cur.err > 0) { kind = 'err'; suffix = ' ✗' }
    else if (cur.ok > 0) { kind = 'ok'; suffix = ' ✓' }
    out.push({ key, label: key + (cur.count > 1 ? ` ×${cur.count}` : '') + suffix, kind })
  }
  return out
}

function chipStyle(kind: Chip['kind']): CSSProperties {
  if (kind === 'skill') return { ...chipBase, ...chipSkill }
  if (kind === 'ok') return { ...chipBase, ...chipOk }
  if (kind === 'err') return { ...chipBase, ...chipErr }
  return chipBase
}

function renderRow(label: string, chips: Chip[]): ReactNode {
  return createElement('div', { style: rowStyle },
    createElement('span', { style: capStyle }, label),
    chips.map((chip) => createElement('span', { key: chip.key, style: chipStyle(chip.kind) }, chip.label)),
  )
}

function BadgeRows({ entry }: { entry: Trail }): ReactNode {
  const rows: ReactNode[] = []
  const skillChips = chipsOf(entry, true)
  const toolChips = chipsOf(entry, false)
  if (skillChips.length > 0) rows.push(renderRow('技能 Skills', skillChips))
  if (toolChips.length > 0) rows.push(renderRow('工具 Tools', toolChips))
  return createElement('div', { style: containerStyle }, rows)
}

/** 0.1.7 no longer dispatches `inputActions` to view/action entries, so
 * prompt-writing affordances copy their prompt to the clipboard instead
 * (plain prompt() fallback where the Clipboard API is unavailable). */
function copyPrompt(text: string): void {
  try {
    if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      void navigator.clipboard.writeText(text).catch(() => { window.prompt('請複製以下提示詞：', text) })
      return
    }
  } catch {
    // fall through to prompt()
  }
  window.prompt('請複製以下提示詞：', text)
}

/** Pillar B: the non-blocking alternative-skill hint row (own state/effect). */
function HintRow({ skillNames, sessionId }: { skillNames: string[]; sessionId?: string }): ReactNode {
  const [cand, setCand] = useState<SkillCandidate[] | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState(false)
  const skillKey = skillNames.join(',')
  const prevSkillKey = useRef<string | null>(null)
  useEffect(() => {
    if (skillNames.length === 0) {
      setCand(null)
      setSelected({})
      prevSkillKey.current = null
      return
    }
    // Any change of the skill SET (not just to-empty) invalidates stale
    // selections from a previous turn sharing this component instance.
    if (prevSkillKey.current !== null && prevSkillKey.current !== skillKey) setSelected({})
    prevSkillKey.current = skillKey
    let cancelled = false
    fetch(`/api/skill-ledger/candidates${typeof sessionId === 'string' && sessionId !== '' ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`)
      .then((r) => r.json())
      .then((res: { skills?: SkillCandidate[]; error?: string }) => {
        if (cancelled) return
        if (typeof res?.error === 'string' && res.error !== '') {
          setCand([{ name: `(${res.error})`, description: '' }])
          return
        }
        const arr = Array.isArray(res?.skills) ? res.skills : []
        setCand(arr.filter((s) => s && typeof s.name === 'string' && !skillNames.includes(s.name)).slice(0, 6))
      })
      .catch(() => { if (!cancelled) setCand([]) })
    return () => { cancelled = true }
  }, [skillKey, skillNames.length, sessionId])

  // Empty result (fetch settled, nothing applicable): hide the whole row
  // instead of leaving an orphaned hint label with no chips.
  if (skillNames.length === 0 || (cand !== null && cand.length === 0)) return null
  const chosen = Object.keys(selected).filter((k) => selected[k])
  function rerun(): void {
    if (chosen.length === 0) return
    copyPrompt(
      `請使用技能 ${chosen.join('、')} 重新處理上一輪任務(該輪使用了 ${skillNames.join('、')})。若你對前輪結果有不滿意的具體點,可在此補充說明。`,
    )
    setCopied(true)
    window.setTimeout(() => { setCopied(false) }, 2500)
  }
  const list = cand === null ? [] : cand
  return createElement('div', { style: rowStyle },
    createElement('span', { style: capStyle }, '不滿意?可試 Alt'),
    // Candidate chips are real toggle buttons: keyboard focusable, Enter/Space
    // activatable, and aria-pressed carries the selection state to assistive
    // tech (a span+onClick would be invisible to both).
    list.map((s) => createElement('button', {
      key: s.name,
      type: 'button',
      'aria-pressed': selected[s.name] === true,
      style: {
        ...chipBase,
        cursor: 'pointer',
        fontFamily: 'inherit',
        borderColor: selected[s.name] ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)',
        color: selected[s.name] ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
      },
      title: s.description || '',
      onClick: () => { setSelected({ ...selected, [s.name]: !selected[s.name] }) },
    }, (selected[s.name] ? '✓ ' : '') + s.name)),
    cand === null ? createElement('span', { style: { ...chipBase, opacity: 0.6 } }, '…') : null,
    chosen.length > 0 ? createElement('button', { style: rerunBtn, onClick: rerun }, copied ? '✓ 已複製提示' : '複製重跑提示') : null,
  )
}

// ── seat 1: the turnTail list entry ─────────────────────────────────────────

function TurnTail(props: TurnTailProps): ReactNode {
  const turnKey = typeof props.turn === 'number' ? String(props.turn) : undefined
  const ledger = (props.useProjection ?? noopProjection)('skillLedger')
  const entry = trailOfLedger(ledger, turnKey)
  if (!entry) return null
  const skillNames = skillNamesOf(entry)
  return createElement('div', { style: containerStyle },
    createElement(BadgeRows, { entry }),
    createElement(HintRow, { skillNames, sessionId: props.sessionId }),
  )
}

// ── seat 2: the assistant-actions list entry (coexists with deliverables) ───

function AssistantActionsBadge(props: AssistantActionsProps): ReactNode {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!open) return
    // Outside-click and Escape dismissal for the popover: without this the
    // popover hangs over sibling action-row entries until the chip itself is
    // clicked again.
    const onDown = (ev: MouseEvent): void => {
      const anchor = anchorRef.current
      if (anchor !== null && ev.target instanceof Node && !anchor.contains(ev.target)) setOpen(false)
    }
    const onKey = (ev: KeyboardEvent): void => { if (ev.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const ledger = (props.useProjection ?? noopProjection)('skillLedger')
  const turnKey = turnOfMessageInLedger(ledger, props.messageId)
  const entry = trailOfLedger(ledger, turnKey)
  if (!entry) return null
  const skillChips = chipsOf(entry, true)
  const toolChips = chipsOf(entry, false)
  const label = `🧩 ${skillChips.length}技能/${toolChips.length}工具`
  const chip = createElement('button', {
    type: 'button',
    'aria-expanded': open,
    style: { ...summaryChipBtn, ...(open ? { color: 'var(--dsw-alias-brand-primary)', borderColor: 'var(--dsw-alias-brand-primary)' } : {}) },
    title: '本輪技能/工具徽章',
    onClick: () => { setOpen(!open) },
  }, label + (open ? ' ▾' : ' ▸'))
  if (!open) return createElement('span', { ref: anchorRef, style: popoverAnchor }, chip)
  return createElement('span', { ref: anchorRef, style: popoverAnchor },
    chip,
    // Flip the popover upward when the anchor sits in the lower half of the
    // viewport (action rows usually do) so it never falls off-screen.
    createElement('div', { style: { ...popoverStyle, ...(anchorRef.current && typeof anchorRef.current.getBoundingClientRect === 'function' && anchorRef.current.getBoundingClientRect().top > (typeof window !== 'undefined' && window.innerHeight ? window.innerHeight / 2 : 1e9) ? { top: 'auto', bottom: '100%', marginTop: 0, marginBottom: 4 } : {}) } },
      createElement(BadgeRows, { entry }),
      createElement(HintRow, { skillNames: skillNamesOf(entry), sessionId: props.sessionId }),
    ),
  )
}

// ── pillar C: the Skills tab ────────────────────────────────────────────────

interface AnalyzeReport {
  busy?: boolean
  error?: string
  data?: { error?: string; stats?: SkillStats | null; definition?: { name: string; provider: string; description: string; contentLength: number } | null }
}

function SkillsView(props: ViewProps): ReactNode {
  const ledgerRaw = (props.useProjection ?? noopProjection)('skillLedger')
  const [reports, setReports] = useState<Record<string, AnalyzeReport>>({})
  const [openSkill, setOpenSkill] = useState('')
  const sid = typeof props.sessionId === 'string' ? props.sessionId : ''
  const reg = ledgerRaw && typeof ledgerRaw === 'object' ? ledgerRaw as SkillLedgerView : null
  const total = reg && reg.total && typeof reg.total === 'object' ? reg.total : { skills: 0, calls: 0 }
  const skillsMap = reg && reg.skills && typeof reg.skills === 'object' ? reg.skills : {}
  const toolsMap = reg && reg.tools && typeof reg.tools === 'object' ? reg.tools : {}
  const skillNames = Object.keys(skillsMap).sort((a, b) => skillsMap[b]!.calls - skillsMap[a]!.calls)

  function analyze(skill: string): void {
    if (sid === '') return
    setReports((prev) => ({ ...prev, [skill]: { busy: true } }))
    fetch('/api/skill-ledger/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sid, skill }),
    })
      .then((r) => r.json())
      .then((res: AnalyzeReport['data']) => { setReports((prev) => ({ ...prev, [skill]: { busy: false, data: res } })) })
      .catch((err: unknown) => { setReports((prev) => ({ ...prev, [skill]: { busy: false, error: String(err) } })) })
  }
  function deepAnalyze(skill: string): void {
    copyPrompt(
      `請使用 skill-analysis 技能,對技能「${skill}」做源碼級能力與質量分析(觸發面/架構模式/風險點/適用性),輸出「借什麼、不借什麼、怎麼借」的結構化報告。`,
    )
  }

  const header = createElement('div', { style: cardStyle },
    createElement('div', { style: cardTitle }, '技能台帳 Skill Ledger'),
    reg === null
      ? createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)' } }, '等待宿主投影數據…')
      : createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' } },
          createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
            createElement('span', { style: statValue }, String(total.skills)), createElement('span', { style: statLabel }, '技能數 Skills')),
          createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
            createElement('span', { style: statValue }, String(total.calls)), createElement('span', { style: statLabel }, '技能調用 Calls')),
          createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
            createElement('span', { style: statValue }, String(Object.keys(toolsMap).length)), createElement('span', { style: statLabel }, '工具種類 Tools')),
        ))

  const cards = skillNames.map((skill) => {
    const rec = skillsMap[skill]!
    const rate = rec.calls > 0 ? Math.round((rec.ok * 100) / rec.calls) : 0
    const report = reports[skill]
    let reportBody: ReactNode = null
    if (report) {
      if (report.busy) {
        reportBody = createElement('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 6 } }, '分析中…')
      } else if (report.error) {
        reportBody = createElement('div', { style: { fontSize: 11, color: 'var(--dsw-alias-state-error-primary)', marginTop: 6 } }, `分析失敗: ${report.error}`)
      } else if (report.data && typeof report.data === 'object') {
        const d = report.data
        if (typeof d.error === 'string' && d.error !== '') {
          reportBody = createElement('div', { style: { fontSize: 11, color: 'var(--dsw-alias-state-error-primary)', marginTop: 6 } }, `分析失敗: ${d.error}`)
        } else {
          const def = d.definition ?? null
          const stats = d.stats ?? null
          const lastErrTurn = stats && typeof stats.lastErrTurn === 'number' ? ` · 最後失敗 turn ${String(stats.lastErrTurn)}` : ''
          reportBody = createElement('div', { style: reportBodyStyle },
            createElement('div', null,
              `調用 ${String(stats ? stats.calls : 0)} 次 · 成功 ${String(stats ? stats.ok : 0)} · 失敗 ${String(stats ? stats.err : 0)}${lastErrTurn} · 用於 turn ${stats && stats.turns ? stats.turns.join(', ') : '—'}`),
            def ? createElement('div', null, `來源: ${def.provider || '—'} · 內容長度: ${String(def.contentLength)}`) : null,
            def && def.description !== '' ? createElement('div', null, `描述: ${def.description}`) : null,
          )
        }
      }
    }
    return createElement('div', { key: skill, style: cardStyle },
      createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        createElement('span', { style: { flex: 1, fontWeight: 700, minWidth: 0 } }, skill),
        createElement('span', { style: chipOk }, `✓ ${String(rec.ok)}`),
        createElement('span', { style: chipErr }, `✗ ${String(rec.err)}`),
        createElement('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, `${rate}%`),
      ),
      createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
        // Expand runs the analysis; collapse does not re-run it.
        createElement('button', {
          style: brandBtn,
          onClick: () => { if (openSkill === skill) { setOpenSkill('') } else { setOpenSkill(skill); analyze(skill) } },
        }, openSkill === skill ? '收起' : '⚙ 分析能力/質量'),
        createElement('button', { style: smallBtn, onClick: () => deepAnalyze(skill) }, '🔬 深度分析(複製提示)'),
      ),
      openSkill === skill && reportBody ? reportBody : null,
    )
  })

  return createElement('div', { style: pageStyle },
    header,
    cards.length === 0
      ? createElement('div', { style: cardStyle }, createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)' } }, '本會話尚未調用技能。'))
      : cards)
}

function apply(ctx: ClientCtx): void {
  // Seat 1 — turnTail LIST entry (0.1.7 contract: kind 'list', options.id
  // required; owner props {turn, seq, openFile}; session standard props
  // supply useProjection/sessionId). The pre-0.1.7 chain-style `select`
  // registration is gone: list entries all render, ordered by `order`.
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register(
    { name: 'conversation.chat.turnTail', id: 'skill-ledger', order: 50 },
    TurnTail,
  ))
  // Seat 2 — the actions list: a compact summary chip on EVERY completed
  // turn's action row (owner prop {messageId}; the projection's byMessage
  // map resolves it to the turn).
  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register(
    { name: 'conversation.chat.assistant-actions', id: 'skill-ledger', order: 100, label: '技能徽章' },
    AssistantActionsBadge,
  ))
  // Pillar C — the Skills tab.
  ctx.slots.inject('conversation.view', () => ctx.slots.register(
    { name: 'conversation.view', id: 'skills', order: 60, label: '技能' },
    SkillsView,
  ))
}

export { apply, inject, name }
