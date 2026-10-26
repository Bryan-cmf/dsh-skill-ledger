# 🧩 Skill Ledger — DSH 插件

> **技能看得見、說得清、析得動。** 每條回覆下方的技能/工具徽章 + 會話級「技能」標籤頁（台帳、每技能內聯詳細說明與能力/質量分析）。

**[English](README.md) · [繁體中文](README.zh.md)**

[![npm](https://img.shields.io/npm/v/@bryan-cmf/dsh-skill-ledger)](https://www.npmjs.com/package/@bryan-cmf/dsh-skill-ledger)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-Plugin-4B32C3)](https://github.com/deepseek-ai/deepseek-harness)
![Topics](https://img.shields.io/badge/topics-dsh--plugin%20%7C%20cordis--plugin-blue)

一個 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件，
把技能變成第一等的可觀測面。兩大支柱：

## ✨ 功能

### A — 每輪回覆的徽章（雙席位，每一輪都在）

每條已完成的回覆下方，標出該輪觸發的技能（🧠）與實際使用的工具（✓）或失敗（✗），按次數聚合：

```
🧩 技能  [🧠 ak-hk-stock-dd ✓] [🧠 serenity-skill ✗]
🧩 工具  [read ×3 ✓] [bash ✗]
```

徽章透過**兩個協作席位**渲染——因為 turnTail 槽是*單赢家鏈*：官方產物卡
（deliverables）會認領每一個產出過檔案的輪次，而鏈只選出恰好一個條目：

1. **`conversation.chat.turnTail`（鏈席位）**——完整徽章區，
   在鏈能到達的輪次（未產檔）直接渲染；
2. **`conversation.chat.assistant-actions`（列表席位）**——每個已完成輪的
   操作列上都有一個緊湊的 `🧩 N技能/M工具` 芯片（列表槽所有條目並存，
   與產物卡天然共存）。點擊展開彈出層，內含同樣的完整徽章區。

結果：無論是否產檔，每條回覆下方都能看到徽章，且絕不遮蔽官方產物 UI。

### B — 「技能」標籤頁（`conversation.view`，id `skills`）

與 chat/trajectory 並列的會話級標籤頁：每技能台帳統計（調用/成功/失敗/
使用輪次/最後失敗輪），資料來自 **`skillLedger` 會話投影**（整個會話，
含窗口外輪次與冷啟動回填）。每張技能卡片同時**說明技能本身**——即時
目錄中的描述與來源，經 `GET /api/skill-ledger/catalog` 每會話拉取一次
——另有兩個分析入口：

- **⚙ 分析能力/質量**——經 `POST /api/skill-ledger/analyze` 即時返回
  結構化報告（摺疊統計 + 目錄定義摘要）；
- **🔬 深度分析**——把提示詞複製到剪貼簿，派發 `skill-analysis`
  技能做源碼級能力/質量評測。

（早期的「非阻斷候選技能提示」行已按擁有者要求移除——推薦替代技能是
噪音；標籤頁改為把**實際用過的技能**講清楚。）

## 為什麼投影是可信的

宿主半以運行時的真實契約（`stateSchema` + `wire: { viewSchema, view }`，
即 `@deepseek-ai/dsh-goal` 同款形狀）註冊 `skillLedger`。更早的社區插件
用註冊表從不讀取的 `schema`/`view` 頂層形狀註冊，這些單元會靜默退化為
host-only（客戶端拿不到值，緩存行還會迫使每次冷讀全量重放日誌）。本包
是正確接法的參考實現。

摺疊也正確結算錯誤：已提交的 `tool/result` 事件把 `isError` 放在
`message.content[]` 塊上——**不在 `data.error`**——配對經由塊的
`toolCallId`。兩件事都對照真實會話日誌核實過。

斜杠（`/name`）技能調用同樣會被摺疊：宿主的 tool-skill 鉤子把它們提交為
合成 `user/message`（`source.kind = 'skill-invocation'`），**沒有**
`tool/call`；摺疊經 turn 錨定歸屬到消費輪次（stateVersion 3；對照 4 份
已提交會話日誌中的 11 處真實注入核驗通過）。

## 安裝

### 路徑 A——宿主組合（常駐，覆蓋所有會話與 preset）

在 profile 的 `package.json` 加入：

```jsonc
"dsh": { "profile": { "bundles": ["@bryan-cmf/dsh-skill-ledger"] } }
```

然後安裝（`dsh plugin --profile <name> install`）並重啟 DSH。

### 路徑 B——Agent preset 行

```yaml
- id: skill-ledger
  name: '@bryan-cmf/dsh-skill-ledger'
  inject: [sessionProjections, webServer, skills, sessions]
```

> ⚠️ `inject` 必須寫在**行**（或 bundle patch）裡：DSH 加載器從行選項讀
> 依賴清單，而不是模組導出。模組導出形式是 `dsh-skill-gate` 當年靜默
> 失效的原因；缺失形式則是 `dsh-ops-view` 0.2.0 拖垮整棵插件樹的原因。

## 環境要求

- DSH `>= 0.1.0-rc.6`——服務 `sessionProjections`、`webServer`、`skills`、
  `sessions`（全部隨 `dsh-base` 出廠）
- 瀏覽器 UI 需要 `conversation.chat.turnTail` 鏈、
  `conversation.chat.assistant-actions` 列表與 `conversation.view` 環
  （出廠聊天視圖）

## 配置

v0.1 無配置——旋鈕刻意從簡。上限為編譯期常量（`MAX_TURNS = 500`、
`MAX_CALLS_PER_TURN = 60`、目錄條目上限 `500`、單描述截斷 `2000` 字）。

## HTTP 介面

| 路由 | 方法 | 用途 |
| --- | --- | --- |
| `/api/skill-ledger/catalog` | GET `?sessionId=` | 即時目錄：名稱 + 完整描述 + 來源（技能頁內聯說明） |
| `/api/skill-ledger/analyze` | POST `{sessionId, skill}` | 摺疊統計 + 定義摘要 |

兩者皆 fail-soft：錯誤以 `{error}` + HTTP 200 返回，絕不 5xx。

## 設計文檔

[`docs/design.md`](docs/design.md) 完整記錄了走到這裡的評審過程——包括
對兩個前身（`dsh-skill-trail`、`dsh-skill-gate`）的屍檢、熱插件驗證輪，
以及鏈/產物卡衝突的雙席位修復。

## 開發

```bash
pnpm install
pnpm build        # tsc 聲明 → lib/types + tsdown → lib/{index,client}.js
```

## 授權

MIT
