// 統一環境變數定義
export interface Env {
  NCB_API_KEY: string;
  NCB_BASE_URL: string; 
  NCB_INSTANCE: string; 
  LLM_API_KEY: string; // 現在對應 kie.ai 的 token
}

// 標準 API 回應格式
export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  answer?: string;
  remainingCredits?: number;
}

// 聊天請求格式 (增加 tool_id)
export interface ChatRequest {
  username: string;
  password: string;
  prompt: string;
  tool_id: string; // 例如 'bazi', 'qimen', 'ziwei', 'liu_nian'
  gender?: string; // 增加性別變數
}

// NCB 使用者模型
export interface NCBUser {
  id: number;
  username: string;
  password: string;
  user_tel: string;
  points: number;
  email?: string;
  user_role?: string;
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
