/**
 * @bryan-cmf/dsh-skill-ledger — Client half.
 *
 * A) `conversation.chat.turnTail` chain entry: beneath every completed reply,
 *    skill/tool badge rows derived from the local conversation snapshot, plus
 *    a non-blocking alternative-skill hint row (multi-select chips + a
 *    "re-run with selected skills" button that writes a prompt draft — the
 *    user stays in full control, nothing is ever intercepted).
 *
 * B) `conversation.view` list entry (id 'skills', order 60, label 技能): a
 *    Skills tab over the whole session — per-skill ledger stats from the
 *    host projection (`useProjection('skillLedger')`) plus capability/quality
 *    analysis buttons:
 *      ⚙ 分析能力/質量  → POST /api/skill-ledger/analyze, inline report
 *      🔬 深度分析       → writes a skill-analysis prompt draft
 *
 * React hooks are called unconditionally at the component top (the effect
 * runs before any early return) — a hard rule this component family enforces
 * after a past hooks-order regression.
 */
import { createElement, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type { SkillCandidate, SkillLedgerView, SkillStats } from '../types.ts'

const name = 'skill-ledger-client'
const inject = ['slots']

// ── minimal structural shapes of the conversation snapshot ──────────────────

interface TurnLocationLike {
  turn?: number
  start?: { seq?: number } | null
  end?: { seq?: number } | null
}
interface ToolResultNodeLike {
  kind: 'tool-result'
  seq: number
  callId: string
  call?: { name: string; argsRaw: string } | null
  isError: boolean
}
interface SnapshotLike {
  nodes?: ToolResultNodeLike[]
}
interface InputActionsLike {
  setDraft?: (text: string) => void
}
interface TurnTailProps {
  matched?: TurnLocationLike | null
  useSession?: <S>(selector: (snapshot: SnapshotLike) => S) => S
  inputActions?: InputActionsLike
}
interface ViewProps {
  sessionId?: string
  useProjection?: <K extends string>(key: K) => unknown
  inputActions?: InputActionsLike
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

// ── snapshot trail derivation (pillar A) ────────────────────────────────────

interface TrailCall {
  name: string
  skill: string
  status: 'ok' | 'err'
}

/** Unified argument parsing: `name` first, `skill` fallback (host does the same). */
function skillNameOf(argsRaw: string | undefined): string {
  if (typeof argsRaw !== 'string') return ''
  try {
    const j = JSON.parse(argsRaw) as unknown
    if (j && typeof j === 'object') {
      const record = j as Record<string, unknown>
      if (typeof record.name === 'string') return record.name
      if (typeof record.skill === 'string') return record.skill
    }
  } catch {
    // unparseable
  }
  return ''
}

/** One turn's trail from the local conversation snapshot (in-window only). */
function deriveTrail(snapshot: SnapshotLike | undefined, turn: TurnLocationLike): { triggered: TrailCall[] } | undefined {
  if (!snapshot || !turn) return undefined
  const startSeq = turn.start && typeof turn.start.seq === 'number' ? turn.start.seq : -1
  const endSeq = turn.end && typeof turn.end.seq === 'number' ? turn.end.seq : Number.MAX_SAFE_INTEGER
  const triggered: TrailCall[] = []
  const nodes = Array.isArray(snapshot.nodes) ? snapshot.nodes : []
  for (const node of nodes) {
    if (!node || node.kind !== 'tool-result') continue
    const seq = typeof node.seq === 'number' ? node.seq : -1
    if (seq <= startSeq || seq > endSeq) continue
    const name = node.call && typeof node.call.name === 'string' ? node.call.name : ''
    if (name === '') continue
    triggered.push({
      name,
      skill: name === 'skill' ? skillNameOf(node.call ? node.call.argsRaw : undefined) : '',
      status: node.isError === true ? 'err' : 'ok',
    })
  }
  if (triggered.length === 0) return undefined
  return { triggered }
}

interface Chip {
  key: string
  label: string
  kind: 'plain' | 'skill' | 'ok' | 'err'
}

function chipsOf(trail: { triggered: TrailCall[] }, isSkill: boolean): Chip[] {
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

// ── pillar A + B: badges + alternative-skill hint row ──────────────────────

function TurnTail(props: TurnTailProps): ReactNode {
  const [cand, setCand] = useState<SkillCandidate[] | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const turn = props.matched
  const snapshot = props.useSession ? props.useSession((s) => s) : undefined
  const entry = turn ? deriveTrail(snapshot, turn) : undefined
  const skillNames: string[] = []
  if (entry) {
    for (const c of entry.triggered) {
      if (c.skill !== '' && !skillNames.includes(c.skill)) skillNames.push(c.skill)
    }
  }
  const showHint = entry !== undefined && skillNames.length > 0
  const skillKey = skillNames.join(',')
  // Hooks run unconditionally BEFORE the early return below — never conditional.
  useEffect(() => {
    if (!showHint) {
      setCand(null)
      setSelected({})
      return
    }
    let cancelled = false
    fetch('/api/skill-ledger/candidates')
      .then((r) => r.json())
      .then((res: { skills?: SkillCandidate[] }) => {
        if (cancelled) return
        const arr = Array.isArray(res?.skills) ? res.skills : []
        setCand(arr.filter((s) => s && typeof s.name === 'string' && !skillNames.includes(s.name)).slice(0, 6))
      })
      .catch(() => { if (!cancelled) setCand([]) })
    return () => { cancelled = true }
  }, [showHint, skillKey])

  if (!entry) return null
  const chosen = Object.keys(selected).filter((k) => selected[k])
  function rerun(): void {
    if (chosen.length === 0) return
    if (!props.inputActions || typeof props.inputActions.setDraft !== 'function') return
    props.inputActions.setDraft(
      `請使用技能 ${chosen.join('、')} 重新處理上一輪任務(該輪使用了 ${skillNames.join('、')})。若你對前輪結果有不滿意的具體點,可在此補充說明。`,
    )
  }

  const rows: ReactNode[] = []
  const skillChips = chipsOf(entry, true)
  const toolChips = chipsOf(entry, false)
  if (skillChips.length > 0) rows.push(renderRow('技能', skillChips))
  if (toolChips.length > 0) rows.push(renderRow('工具', toolChips))
  let hintRow: ReactNode = null
  if (showHint) {
    const list = cand === null ? [] : cand
    const hintChips = list.map((s) => createElement('span', {
      key: s.name,
      style: {
        ...chipBase,
        cursor: 'pointer',
        borderColor: selected[s.name] ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)',
        color: selected[s.name] ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
      },
      title: s.description || '',
      onClick: () => { setSelected({ ...selected, [s.name]: !selected[s.name] }) },
    }, (selected[s.name] ? '✓ ' : '') + s.name))
    hintRow = createElement('div', { style: rowStyle },
      createElement('span', { style: capStyle }, '不滿意?可試'),
      hintChips,
      cand === null ? createElement('span', { style: { ...chipBase, opacity: 0.6 } }, '…') : null,
      chosen.length > 0 ? createElement('button', { style: rerunBtn, onClick: rerun }, '用選定技能重跑') : null,
    )
  }
  return createElement('div', { style: containerStyle }, rows, hintRow)
}

// ── pillar C: the Skills tab ────────────────────────────────────────────────

interface AnalyzeReport {
  busy?: boolean
  error?: string
  data?: { error?: string; stats?: SkillStats | null; definition?: { name: string; provider: string; description: string; contentLength: number } | null }
}

function SkillsView(props: ViewProps): ReactNode {
  const ledgerRaw = props.useProjection ? props.useProjection('skillLedger') : undefined
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
    setReports({ ...reports, [skill]: { busy: true } })
    fetch('/api/skill-ledger/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sid, skill }),
    })
      .then((r) => r.json())
      .then((res: AnalyzeReport['data']) => { setReports({ ...reports, [skill]: { busy: false, data: res } }) })
      .catch((err: unknown) => { setReports({ ...reports, [skill]: { busy: false, error: String(err) } }) })
  }
  function deepAnalyze(skill: string): void {
    if (!props.inputActions || typeof props.inputActions.setDraft !== 'function') return
    props.inputActions.setDraft(
      `請使用 skill-analysis 技能,對技能「${skill}」做源碼級能力與質量分析(觸發面/架構模式/風險點/適用性),輸出「借什麼、不借什麼、怎麼借」的結構化報告。`,
    )
  }

  const header = createElement('div', { style: cardStyle },
    createElement('div', { style: cardTitle }, '技能台帳'),
    reg === null
      ? createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)' } }, '等待宿主投影數據…')
      : createElement('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap' } },
          createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
            createElement('span', { style: statValue }, String(total.skills)), createElement('span', { style: statLabel }, '技能數')),
          createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
            createElement('span', { style: statValue }, String(total.calls)), createElement('span', { style: statLabel }, '技能調用')),
          createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
            createElement('span', { style: statValue }, String(Object.keys(toolsMap).length)), createElement('span', { style: statLabel }, '工具種類')),
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
        createElement('button', { style: smallBtn, onClick: () => deepAnalyze(skill) }, '🔬 深度分析'),
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
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register(
    { name: 'conversation.chat.turnTail', select: (owner: { turn?: unknown }) => (owner && owner.turn ? owner.turn : null) },
    TurnTail,
  ))
  ctx.slots.inject('conversation.view', () => ctx.slots.register(
    { name: 'conversation.view', id: 'skills', order: 60, label: '技能' },
    SkillsView,
  ))
}

export { apply, inject, name }
