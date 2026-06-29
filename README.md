# 堂筠命理系統 — 後端 API v3 整合版

Cloudflare Workers 後端,正式域名:`qimen-api.winggloryone.workers.dev`

## 🎯 整合特色

- **八字專屬獨立端點**:`POST /api/bazi`(本版新增)
- **`/api/verify` 物理隔離**:沿用既有邏輯,絕不重構
- **扣點權威**:所有點數異動以後端 NCB 為準,前端只呈現
- **LLM JSON 結構化**:八字解讀強制回 13 段(section1~13)
- **ES Modules 模組化**:`work.ts` 路由分派,bazi.ts/qimen_llm.ts/register.ts 各司其職

## 📁 結構

```
src/
├── work.ts          # 路由總管 (CORS + path 分派)
├── bazi.ts          # 🎯 八字專屬端點 (本版新增)
├── qimen_llm.ts     # 通用 LLM 解盤 + JSON 解析
├── register.ts      # 帳號註冊
├── prompts.ts       # PROMPTS 字典 (bazi 已升級 JSON)
├── types.ts         # Env / ApiResponse / ChatRequest 等型別
└── services/
    └── CalendarService.ts  # 萬年曆排盤
```

## 📡 API 端點

| 端點 | Method | 說明 | 新版狀態 |
|------|--------|------|---------|
| `/api/verify` | POST | 帳密驗證 | 不動 ✅ |
| `/api/register` | POST | 註冊開戶 | 既有 |
| `/api/chat` | POST | 通用 LLM 解盤 | 既有 + JSON 解析 |
| `/api/bazi` | POST | **八字專屬** | 🆕 本版新增 |
| `/api/debug/bazi` | POST | Calendar 診斷 | 既有 |

## 🔗 整合重點

1. **後端權威扣點**:`/api/bazi` 內物理扣 1 點並寫入 `divination_records`,回傳 `remainingCredits`
2. **物理隔離 `/api/verify`**:`work.ts` 第 61-82 行完全獨立區塊,邏輯零變更
3. **JSON 雙保險**:`extractJsonObject()` 移除 markdown fence 與前後綴文字,parse 失敗 fallback 到 `raw`
4. **編碼隔離**:`user_tel` 與 `password` 在 NCB URL 都包 `encodeURIComponent`(防特殊字元炸掉)
