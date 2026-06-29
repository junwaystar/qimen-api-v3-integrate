# 堂筠命理系統 API 規格說明書 (API Specification)

## 1. 概觀
本 API 為「堂筠命理系統」之後端核心，負責處理使用者認證、生辰日期解析、八字排盤計算及 LLM 深度命理分析。

- **Base URL**: `https://qimen-api.winggloryone.workers.dev/`
- **認證方式**: 請求 Body 攜帶 `username` (手機號碼) 與 `password`。
- **數據格式**: `application/json`

---

## 2. 端點定義 (Endpoints)

### 2.1 使用者驗證 `/api/verify`
驗證帳號密碼是否正確，並返回使用者基本資訊。

- **Method**: `POST`
- **Request Body**:
  ```json
  {
    "username": "09xxxxxxxx",
    "password": "your_password"
  }
  ```
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "user": {
      "id": 1,
      "username": "用戶名",
      "user_tel": "09xxxxxxxx",
      "points": 100,
      "user_role": "user"
    }
  }
  ```
- **Error Response (401 Unauthorized)**: 帳號或密碼錯誤。

---

### 2.2 命理分析對話 `/api/chat`
核心分析端點，支持多種命理工具（如：八字、奇門、紫微）。

- **Method**: `POST`
- **Request Body**:
  ```json
  {
    "username": "09xxxxxxxx",
    "password": "your_password",
    "prompt": "八字分析: 1981-08-13 10:30",
    "tool_id": "bazi",
    "gender": "Male" // Male / Female
  }
  ```
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "answer": "LLM 生成的深度分析內容...",
    "remainingCredits": 99
  }
  ```
- **Error Response**:
    - `401`: 身分驗證失敗。
    - `403`: 體驗點數不足。
    - `500`: 模組執行失敗或伺服器異常。

---

### 2.3 使用者註冊 `/api/register`
建立新使用者帳號。

- **Method**: `POST`
- **Request Body**: 參照 `handleRegister` 具體實現。

---

## 3. 八字專屬邏輯 (Bazi Logic)

當 `tool_id` 設為 `"bazi"` 時，系統將執行以下流程：

### 3.1 日期解析寬容度
系統支持多種日期輸入格式，無需強制要求 `YYYY-MM-DD HH:mm`：
- **分隔符支持**：`-`, `/`, `.`, 或空格 (例如：`1981-08-13`, `1981/8/13`, `1981.8.13`)。
- **月份/日期省略 0**：支持 `8月` 而非僅限 `08月`。
- **時間格式**：支持 `10:30` 或 `10時30分`。

### 3.2 「吉時」處理機制
若用戶不知道精確出生時間，可輸入 **「吉時」** 或 **不提供時間**：
- **判定**：若 `prompt` 中包含「吉時」或缺乏時間格式，系統將 `isTimeUnknown` 標記為 `true`。
- **換算結果**：時柱將被設定為 **`吉時`**。
- **LLM 行為**：系統會明確告知 LLM 當時辰為「吉時」時，**僅針對年、月、日三柱進行分析**，且 LLM **嚴禁拒絕解盤**。

### 3.3 數據注入流程 (Data Pipeline)
` la-brain` 遵循 **「絕對事實注入」** 原則：
`用戶輸入` $\rightarrow$ `CalendarService` (萬年曆精算) $\rightarrow$ `結構化四柱數據` $\rightarrow$ `LLM 接收`

**注入格式示例：**
- 年柱：辛酉
- 月柱：丙申
- 日柱：癸亥
- 時柱：丁巳 (或 吉時)

---

## 4. 狀態碼對照表

| 狀態碼 | 意義 | 原因 |
| :--- | :--- | :--- |
| `200` | OK | 請求成功 |
| `400` | Bad Request | 缺少必要參數 (如 prompt) |
| `401` | Unauthorized | 帳號密碼錯誤或驗證失敗 |
| `403` | Forbidden | 點數不足 |
| `404` | Not Found | 路徑錯誤 |
| `500` | Internal Server Error | 換算崩潰或 LLM API 異常 |
