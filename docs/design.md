# dsh-skill-ledger — DSH 技能帳本設計文檔 v2(依據用戶完整意圖重構)

> 狀態:待評審 · 2026-08-22 · 替代 `@bryan-cmf/dsh-skill-trail` + `@bryan-cmf/dsh-skill-gate`
> v1 結論(純徽章、無宿主、無標籤頁)已被用戶澄清後的意圖取代:用戶要的是一個**技能觀測+控制台**,不是裝飾性徽章。

---

## 1. 用戶意圖(原文分解 → 三個支柱)

> 「我需要看得見每個對話回覆都附帶使用了哪些技能的徽章」

**支柱 A — 每輪徽章**:每條回覆下方如實標出該輪用了哪些技能(以及工具成敗)。→ 保留並作為觀測面的底座。

> 「可能是在對話回覆後的下方附帶還有哪些技能可選……我還有個提示去使用其他可選的技能,一個或多個都行」

**支柱 B — 非阻斷候選提示**:回覆下方出現「其他可用技能」提示;對結果不滿意時,點選一個或多個候補技能 → 發起「用這些技能重跑/補充」動作。**絕不彈窗、絕不攔截**(與 ask→never 決策一致)。

> 「在上方的標籤頁右邊新增一個技能頁面,用於顯示調用過的技能,並提供用於分析技能能力和質量的按鈕」

**支柱 C — 技能標籤頁**:頂部標籤列右側新增「技能」頁:本會話調用過的技能總覽 + 每個技能的「分析能力/質量」按鈕。

---

## 2. 技術基座(全部已在你的運行環境驗證)

| 機制 | 已有先例(同一部署內) | 結論 |
|---|---|---|
| 每輪徽章 + turnTail slot | trail 0.1.4 已正常渲染(你確認) | 原樣保留 |
| 標籤頁 = `conversation.view` list 註冊 | **dsh-insights 已加 4 個標籤**(observability/memory/insights/notes,order 20-50) | 「技能」= id `skills`, order 60 |
| 靜態包 client↔host 通信 | insights 用 **webServer route**(`/api/observation`、`/api/insight/chat`…)+ client `fetch` | 照搬:`/api/skill-ledger/*` |
| 視圖/徽章讀宿主數據 | `useProjection`(標準 props,insights 視圖在用) | 技能頁數據走宿主投影 |
| 按鈕→寫入輸入框(非發送) | insights「⤴ 傳送到主對話框」= `inputActions.setDraft(text)` | 「重跑」與「深度分析」都走 setDraft,用戶按 Enter 才執行 |
| **投影註冊的正確契約** | `dsh-goal`(官方,運行中):`{key, stateSchema, init, apply, wire:{viewSchema, view}, stateVersion}` | 見 §3 重大發現 |

### ⚠️ §3 重大發現:第三方程投影的「舊形狀」全家都壞

`dsh-insights` 的 5 個投影(`infraView`/`insightsScan`/`fileActivity`/`mechEvents`/`goalTrace`)與 skill-trail 一樣用舊形狀 `{key, schema, …, view}` 註冊。運行時的 `sessionProjections.register`(`dsh-session-projection@0.1.1-rc.2`)只讀 `stateSchema` + `wire`:

- 舊形狀 → `wire=undefined` → 被當 **host-only 單元**:`useProjection('insightsScan')` 等**永遠 undefined**(客戶端靜默降級,難發現);
- `stateSchema=undefined` → 投影緩存裡已有這些 key 的行(44/47 會話有 infraView 行、19 個 insightsScan 行…),冷讀 restore 在 try/catch 內拋 TypeError → **每次冷讀整份日誌全量重放**被當兜底吞掉;
- 官方投影(dsh-goal 的 `goal`、dsh-base 的 `todos` 等)用新形狀,所以你的洞察頁**目標錨點顯示正常**,但 insightsScan 的「掃描洞察」從來是空的——這解釋了為什麼你後來覺得掃描數據「沒意義」(它根本沒顯示過)。

**→ skill-ledger 的投影必須以 `dsh-goal` 的註冊代碼為範本**,並在完成後為 insights 提供修復樣板(可後續做)。

---

## 4. 功能設計

### 4.1 支柱 A:每輪徽章(turnTail,現有邏輯微調)

```
🧩 技能   [🧠 ak-hk-stock-dd ✓] [🧠 serenity-skill ✗]
🧩 工具   [read ×3 ✓] [bash ✗]
```

改動:刪 diag 行(0.1.4 診斷版,已收口)、刪 projection 回退分支(見 4.3 的數據源決策)、刪 pending 分支(窗口內快照只有已結算結果)、技能行無技能 → 整行不渲染。數據源:窗口內 snapshot 派生(現有、正常)。

### 4.2 支柱 B:候選提示行(同 slot,徽章下方)

僅在該輪**用過技能**時出現:

```
🧩 不滿意?可試  [serenity-skill]  [dcf-valuation]  [ak-financial-analyst]   (多選) [用選定技能重跑]
```

- 候選來源:`GET /api/skill-ledger/candidates` → 宿主 `skills.list()` 全目錄(名稱+描述,截斷 120 字);客戶端過濾掉本輪已用的技能,取前 N(`maxCandidates` 預設 6);
- 交互:點擊 chip 多選(高亮) → 「👣 用選定技能重跑」 → `inputActions.setDraft(模板)` 並聚焦輸入框;模板:
  `請使用技能 X、Y 重新處理上一輪任務(該輪使用了 Z)。重點改善:…(可選補充)`
  用戶確認後按 Enter → 新一輪,agent 載入所選技能。**用戶完全掌舵,零阻塞**;
- 首次載入慣性:候選列表緩存到 sessionStorage(30 分鐘),避免每輪 fetch。

### 4.3 支柱 C:「技能」標籤頁(`conversation.view` id=`skills` order=60,label=「技能」)

```
┌─ 技能台帳 ────────────────────────────────┐
│ 本會話:9 個技能 · 27 次調用 · 成功率 85%    │
│ ┌─ ak-hk-stock-dd ──────────────────────┐ │
│ │ 🧠 24 次(✓23 ✗1)· 用於 turn 3,5,8,12… │ │
│ │ [⚙ 分析能力/質量] [🔬 深度分析]         │ │
│ └────────────────────────────────────────┘ │
└────────────────────────────────────────────┘
```

- **帳本數據**:宿主投影 `skillLedger`(**正確契約**),整會話(含窗口外、冷啟動回填現在真正生效);
- 每技能卡片:調用次數 / 成功 / 失敗 / 使用輪次 / 最後使用 turn;
- **「⚙ 分析能力/質量」按鈕** → `POST /api/skill-ledger/analyze {sessionId, skill}`:
  宿主返回結構化報告:統計(次數/失敗率/平均輪次)+ 技能定義摘要(name/description/provider/內容長度/是否模型可調用)+ 最近一次失敗的錯誤訊息(從投影 callId 對應的 tool/result 事件取);
  客戶端在卡片下方展開渲染報告(可摺疊);
- **「🔬 深度分析」按鈕** → `setDraft` 模板:
  `請使用 skill-analysis 技能,對技能「X」做源碼級能力與質量分析(觸發面/風險點/適用性),輸出「借什麼、不借什麼、怎麼借」。`
  —— 直接用你目錄裡已有的 skill-analysis 技能完成深度評測,agent 執行,結果寫入對話(可追蹤);
- 視圖 props:`useProjection('skillLedger')` + `sessionId` + `inputActions.setDraft`(insights 同款)。

### 4.4 數據源決策(單一職責,不再雙軌)

| 表面 | 數據源 | 理由 |
|---|---|---|
| 每輪徽章(turnTail) | 客戶端 snapshot 派生 | 已證實正常、窗口內實時、零 RPC |
| 技能標籤頁 | 宿主投影 `skillLedger`(正確契約) | 要整會話史,窗口外+冷啟動回填靠投影 |
| 候選技能 | webServer route(宿主目錄) | 目錄只在宿主,非日誌事件,投影不適合 |
| 分析報告 | webServer route | 需統計+定義+錯誤詳情,即時計算 |

---

## 5. 宿主半(`src/index.ts`)

```
services: skills, sessionProjections, webServer(全部 select/inject 聲明)
config:  enabled=true · maxCandidates=6 · tabEnabled=true · analyzeEnabled=true
```

1. **投影 `skillLedger`**(範本:dsh-goal):
   ```ts
   sessionProjections.register({
     key: 'skillLedger',
     stateSchema: zod.record(zod.string(), zod.object({ held: z.array(zod.object({name, skill, status, callId, turn})) })),  // 平鋪 per-turn 條目
     init: () => ({}),                              // turn -> held[]
     apply: fold,                                    // tool/call→pending 條目;tool/result→ok/err(同 trail fold,去掉 wire 缺損版)
     wire: { viewSchema, view },                     // view: 折成 技能數/調用數/失敗率/每技能明細 + 每輪 badges(供標籤頁)
     stateVersion: 1,
   })
   ```
2. **路由**:
   - `GET /api/skill-ledger/candidates` → `{ skills: [{name, description}] }`(catalog,截斷 120 字)
   - `POST /api/skill-ledger/analyze {sessionId, skill}` → `{ stats, definition, lastError? }`(投影 `stateOf` 讀統計;`skills.get` 讀定義;從 session log 查最近失敗事件——用 `sessionProjections` 的 stateOf 已含 callId → 錯誤訊息需要事件原文,簡化:錯誤訊息取「最近失敗次數+最後失敗 turn」,詳情留給深度分析)
   - 兩路由都 fail-soft:任何異常 → `{error}` + 200(insights 風格),絕不 5xx 打斷 UI
3. **不做**:不攔截 `tools/execute`(gate 全部刪除)、不碰 userQuestions/timer、不注資 agent 循環。

## 6. 客戶端半(`src/client/index.ts`)

```
apply:
  ctx.slots.inject('conversation.chat.turnTail', …)   # 徽章 + 候選提示行(支柱 A/B)
  ctx.slots.inject('conversation.view', …)            # skills 標籤頁(支柱 C)
```

組件:**`index.tsx` 風格純 `createElement`**(insights 同款),`React` hooks 僅 `useState/useEffect`;所有 fetch 帶取消標誌;所有渲染失敗 `catch → null`(絕不讓徽章/標籤頁崩壞對話)。

### 視覺
沿用 insights 視圖 token 語言:`var(--dsw-alias-*)`、卡片式、11-13px、badge 圓角。標籤頁圖標:`🧩/⚙` 文字即可(insights 標籤也是文字)。

---

## 7. 配置(schemastery)

| key | 預設 | 語義 |
|---|---|---|
| `enabled` | `true` | 總開關 |
| `maxCandidates` | `6` | 每輪候選上限 |
| `hintEnabled` | `true` | 支柱 B 候選提示行(徽章左邊保留) |
| `tabEnabled` | `true` | 支柱 C 標籤頁 |

---

## 8. 倉庫與發布

- 新倉庫 `dsh-skill-ledger`,包 `@bryan-cmf/dsh-skill-ledger` v0.1.0-alpha.0;沿用 tsdown+tsc;
- `cordis.patch.yml` 一行 `skill-ledger`;**host+client 同 row**,無 isolate(不發布服務;投影與路由是職責,不是發布服務——按 consumer-only 慣例行);
  ⚠️ 但宿主要用 `skillTrail→skillLedger` 投影與 webServer,行仍是 consumer-only(誰 publish 服務才需要 isolate);
- profile:`bundles` 中 `dsh-skill-trail`、`dsh-skill-gate` 兩行 → `dsh-skill-ledger` 一行;`dependencies` 對應替換;
- 舊兩倉庫:git archive(read-only,README 指向新包);
- **清理**:`session_projcache.json` 中 45 個 skillTrail 行 → 刪除(投影 key 消失後 rows 自動無效,手動刪以免冷讀重放稅;insights 的 5 個舊形狀投影的同類清理列為跟進項)。

### 發布步驟
1. 新建倉庫 → `pnpm install && pnpm build`
2. profile 依賴/bundles 替換 → `pnpm install`(web profile)
3. 重啟 DSH(launchctl kickstart)+ 瀏覽器硬刷新
4. 按 §9 驗證清單收口
5. `git push`;`npm publish --tag alpha`(先 `npm view` 確認無衝突)

---

## 9. 驗證清單

- [ ] Slots inspect: `conversation.view` 出現 occupant `{id:'skills', order:60}`;turnTail occupant = `skill-ledger-client`
- [ ] 一輪含多技能 → 兩行徽章正確;純文字輪 → 無徽章殘影
- [ ] 技能輪下方出現候選行;點兩個候選 → setDraft 出現模板;發送 → agent 載入所選技能調用(工具卡可見)
- [ ] 「技能」標籤頁:帳本數字與當輪徽章一致;點「分析」→ 報告卡展開(統計+定義摘要)
- [ ] 點「深度分析」→ 草稿含 skill-analysis 模板
- [ ] 冷啟動(重啟後打開舊會話)→ 技能頁仍顯示完整帳本(投影 wire 生效;對比:舊 skillTrail 做不到)
- [ ] `session_projcache` 新行 key = `skillLedger`(且舊 skillTrail 行已清)
- [ ] 無 console 報錯;insights/其他標籤不受影響

---

## 10. 明確不做的(防膨脹)

- ❌ 任何 form 的 skill 觸發攔截/彈窗/倒計時(gate 哲學,與 never 政策衝突)
- ❌ 不復刻 trajectory 時間線(官方已有)
- ❌ 不做會話間全局統計(先做 per-session;跨會話排名是 v2)
- ❌ 不提前修 insights 的投影(樣板交付後作為獨立跟進項)
- ❌ 不接 `userQuestions`/`approval`/`agent.inject`(無宿主副作用)

---

## 11. 熱插件實現注記(2026-08-22,與 §5/§6 的偏離與修正)

按用戶決策「先安全落地為熱插件」,以動態 Cordis 包 `sklg-3`(pkg-3 → pkg-4)實現。與本文件 §4-§7 的定案相比:

1. **通信機制改為 Package 私有 RPC**:`harness.handle('skill-ledger.candidates'|'skill-ledger.analyze')` + 客戶端 `host.call(...)`。原因:動態包客戶端**沒有 fetch 內建**(已從 Client Builtins 核實),webServer route 方案留給靜態包化階段;`host.call` 同樣只能傳 lossless JSON,且天然綁定本包,暴露面更小。
2. **無 sessionStorage 快取**:`window.sessionStorage` 不在客戶端內建符號表,熱插件階段不引入;每輪切換時 RPC 一次(候選僅 12 條,成本可忽略)。
3. **配置項延後**:熱插件無 cordis.yml 行配置;`maxCandidates` 硬編碼為宿主 12 / 客戶端 6;`enabled/hintEnabled/tabEnabled` 等於靜態包化時以 schemastery 補齊。
4. **修正 trail 舊 bug(實證)**:真實 `tool/result` 事件的 `isError` 在 `message.content[].isError`(**不在 `data.error`**);舊 trail fold 讀 `data.error` 永遠為 undefined,失敗全部被摺成 ok。`skillLedger` fold 已修正,並以實際會話緩存行核對(`session-006a0a5f`:4 turns / 124 calls / 0 pending / 1 err)。
5. **投影現已真正生效**:正確契約(`stateSchema`+`wire`)下,`session_projcache.json` 已出現 `skillLedger` 行,客戶端 `useProjection('skillLedger')` 可讀(對照:dsh-goal 同款寫法)。
6. **熱插件階段與舊 trail 並存**:`conversation.chat.turnTail` 鏈條同時有 `skill-trail-client`(靜態)與 `dyn/sklg-3`(動態),產生兩套徽章——屬預期,靜態包化時移除舊行即收斂。
7. **審查修復(獨立子代理評審 1 Blocker + 3 Major + 若干 Minor,已全部處理)**:React hooks 順序違規(useEffect 移早於早退)、客戶端/宿主 skill 名解析雙鍵統一(name/skill)、原型污染防護(桶用 Object.create(null)+hasOwnProperty)、SkillsView 缺省守衛、RPC error 展示、分析折疊不重複調用、服務引用移入 handler、配對回退僅限唯一 pending、`lastErrTurn` 上報、stateSchema 數組守衛。餘下 Minor/Nit(配置項、快取、truncated 標記)記錄為靜態包化階段收斂項。
