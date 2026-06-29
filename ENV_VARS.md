# 🌐 堂筠命理系統 - 後端 API 環境變數表 (Env Vars)

本文件定義了 Cloudflare Workers 後端所需的所有環境變數。前端開發 Agent 在對接 API 或調整請求邏輯時，請參考此表。

## 🛠 1. 核心環境變數 (Cloudflare Worker Variables)
這些變數直接配置在 Cloudflare Worker 的 `Settings` $\rightarrow$ `Variables` 中。

| 變數名稱 | 用途 | 說明 | 預期值範例 |
| :--- | :--- | :--- | :--- |
| `NCB_API_KEY` | NoCodeBackend 認證金鑰 | 用於所有資料庫讀寫請求的身份驗證 | `ghp_...` 或 NCB 提供之 Key |
| `NCB_BASE_URL` | NCB 資料庫 API 入口 | 所有讀寫請求的基礎路徑 | `https://api.nocodebackend.com/read/users` |
| `NCB_INSTANCE` | NCB 實例 ID | 指定對接的特定資料庫實例 | `41667_qimenbazi` |
| `LLM_API_KEY` | LLM 大腦認證金鑰 | 用於呼叫 OpenAI/Claude 等解盤模型 | `sk-....` |

---

## 📡 2. API 端點與請求規格 (Endpoints)

### A. 登入驗證 (`/api/verify`)
- **方法**: `POST`
- **請求體**: `{ "username": "string", "password": "string" }`
- **成功回傳**: `{ "success": true, "user": { ...userData } }`
- **用途**: 驗證身分，獲取使用者基礎資料。

### B. 帳戶註冊 (`/api/register`)
- **方法**: `POST`
- **請求體**: `{ "username": "string", "password": "string", "phone": "string" }`
- **成功回傳**: `{ "success": true, "message": "註冊成功，已贈送 5 點體驗金" }`
- **特殊邏輯**: 系統會自動檢查手機號碼重複，並初始化贈送 **5 點** 體驗金。

### C. 實時解盤 (`/api/chat`)
- **方法**: `POST`
- **請求體**: `{ "username": "string", "password": "string", "prompt": "string" }`
- **成功回傳**: `{ "success": true, "answer": "string", "remainingCredits": number }`
- **核心邏輯**: 
  1. 驗證帳密 $\rightarrow$ 2. 檢查點數 $\ge 1$ $\rightarrow$ 3. **物理扣除 1 點** $\rightarrow$ 4. 請求 LLM 解盤 $\rightarrow$ 5. 回傳答案與剩餘點數。

---

## ⚠️ 3. 前端開發注意事項 (Dev Notes)
- **CORS 處理**: 後端已開啟 `Access-Control-Allow-Origin: *`，前端無需額外處理跨域，但請確保請求 Header 包含 `Content-Type: application/json`。
- **錯誤處理**: 所有 API 均回傳標準的 `ApiResponse` 格式 `{ success: boolean, message?: string }`。
- **體驗金機制**: 新用戶註冊後預設 5 點，每對話一次扣除 1 點，點數為 0 時將回傳 `403 Forbidden`。
