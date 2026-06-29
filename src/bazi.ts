/**
 * 🎯 八字專屬端點 — 整合 v3
 *
 * 路徑: POST /api/bazi
 * 用途: 處理 Bazi 子房間的獨立業務邏輯(物理隔離自 /api/chat)
 *
 * 請求體: { username: string, password: string, datetime: string, birthplace: string, gender: string }
 *
 * 業務流程(驗證 → 扣點 → 排盤 → LLM → 回前端):
 *   1. 驗證帳密 → 拿 NCB user 物件
 *   2. 檢查點數 ≥ 1
 *   3. 物理扣除 1 點 + 寫入 divination_records
 *   4. 解析 datetime → 計算四柱(內部 API: CalendarService)
 *   5. 組 prompt 餵給 LLM,使用 PROMPTS['bazi'] (強制 JSON 13 段)
 *   6. 抽取 LLM 回傳 JSON → 回前端 { sections, remainingCredits }
 *
 * 物理隔離原則:
 *   - /api/verify: 完全不動
 *   - /api/chat (通用 LLM): 完全不動
 *   - 本檔為 /api/bazi 專屬,獨立路由
 */

import { Env, ApiResponse, NCBUser, corsHeaders } from './types';
import { PROMPTS } from './prompts';
import { CalendarService } from './services/CalendarService';

const BAZI_CREDIT_COST = 1; // 與 chat 一致;若需 10 點改這裡即可

interface BaziRequest {
  username: string;
  password: string;
  datetime: string;     // e.g. "1981-08-13T10:30"
  birthplace: string;
  gender: string;       // "乾造 (男)" | "坤造 (女)"
}

// 抽出 NCB user(沿用 /api/verify 既有的 URL/Header 形式)
async function verifyNcbUser(body: { username: string; password: string }, env: Env, corsHeaders: Record<string, string>): Promise<NCBUser | null> {
  const { username, password } = body;
  if (!username || !password) return null;

  const verifyUrl = `${env.NCB_BASE_URL}/read/users?Instance=${env.NCB_INSTANCE}&user_tel=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  try {
    const ncbResponse = await fetch(verifyUrl, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${env.NCB_API_KEY}`, 'accept': 'application/json' }
    });
    const data: any = await ncbResponse.json();
    if (data.status === "success" && data.data && Array.isArray(data.data) && data.data.length > 0) {
      return data.data[0];
    }
  } catch (e) {
    console.error('NCB verify error:', e);
  }
  return null;
}

function extractJsonObject(raw: string): any | null {
  if (!raw) return null;
  let cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

export async function handleBazi(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  try {
    const body = await request.json() as BaziRequest;
    const { username, password, datetime, gender, birthplace } = body;

    if (!username || !password || !datetime) {
      return new Response(JSON.stringify({
        success: false,
        message: "缺少必要欄位:username / password / datetime"
      } as ApiResponse), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 1. 驗證帳密
    const user = await verifyNcbUser({ username, password }, env, corsHeaders);
    if (!user) {
      return new Response(JSON.stringify({
        success: false,
        message: "身分驗證失敗,請確認手機號碼與密碼"
      } as ApiResponse), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 2. 檢查點數
    const currentPoints = parseInt(user.points || "0");
    if (currentPoints < BAZI_CREDIT_COST) {
      return new Response(JSON.stringify({
        success: false,
        message: "體驗點數不足,請先儲值"
      } as ApiResponse), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 3. 物理扣點 + 寫紀錄(後端權威,扣點前端不可信)
    const newPoints = currentPoints - BAZI_CREDIT_COST;
    const updateUrl = `${env.NCB_BASE_URL}/update/users/${user.id}?Instance=${env.NCB_INSTANCE}`;
    await fetch(updateUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.NCB_API_KEY}`
      },
      body: JSON.stringify({ points: newPoints })
    });

    const recordUrl = `${env.NCB_BASE_URL}/create/divination_records?Instance=${env.NCB_INSTANCE}`;
    fetch(recordUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.NCB_API_KEY}`
      },
      body: JSON.stringify({
        user_id: user.id,
        question: `八字排盤:${datetime} ${gender} ${birthplace}`,
        status_val: 'completed'
      })
    }).catch((e) => console.error('Record write failed:', e));

    // 4. 解析 + 計算四柱
    const dateInfo = CalendarService.parseDateTime(datetime);
    if (!dateInfo) {
      return new Response(JSON.stringify({
        success: false,
        message: "出生日期解析失敗,請使用 YYYY-MM-DD HH:MM 格式"
      } as ApiResponse), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { year, month, day, hour, minute, isTimeUnknown } = dateInfo;
    const baziData = CalendarService.calculateBazi(year, month, day, hour, minute, isTimeUnknown);
    const timeStr = isTimeUnknown ? "吉時" : `${hour}:${minute < 10 ? '0' + minute : minute}`;

    // 5. 組 prompt 餵 LLM
    const systemPrompt = PROMPTS['bazi'];

    const finalUserContent =
      `\n生辰資訊:${datetime}` +
      `\n出生地:${birthplace || "未提供"}` +
      `\n性別:${gender || "未提供"}` +
      `\n\n【精準八字命盤數據】(由後端萬年曆精算,絕對事實):\n` +
      `- 年柱:${baziData.yearPillar}\n` +
      `- 月柱:${baziData.monthPillar}\n` +
      `- 日柱:${baziData.dayPillar}\n` +
      `- 時柱:${baziData.hourPillar}\n` +
      `---\n` +
      `【詳細資訊】:陽曆 ${baziData.solarDate},陰曆 ${baziData.lunarDate}\n` +
      `【分析參數】:性別:${gender},出生時間:${timeStr}\n` +
      `請直接根據上述數據進行深度分析,並嚴格遵守 JSON 輸出格式。`;

    const llmResponse = await fetch("https://api.kie.ai/gpt-5-2/v1/chat/completions", {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.LLM_API_KEY}`
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: finalUserContent }
        ],
        reasoning_effort: "high"
      })
    });

    const llmData: any = await llmResponse.json();
    const result: string = llmData.choices?.[0]?.message?.content ?? "";

    // 6. 解析 LLM JSON 回前端
    const parsed = extractJsonObject(result);
    if (parsed && typeof parsed === 'object') {
      return new Response(JSON.stringify({
        success: true,
        tool: 'bazi',
        sections: parsed,
        pillars: {
          year: baziData.yearPillar,
          month: baziData.monthPillar,
          day: baziData.dayPillar,
          hour: baziData.hourPillar,
          solarDate: baziData.solarDate,
          lunarDate: baziData.lunarDate
        },
        raw: result,
        remainingCredits: newPoints
      } as ApiResponse), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // JSON 解析失敗:仍回 success + raw
    return new Response(JSON.stringify({
      success: true,
      tool: 'bazi',
      sections: null,
      pillars: {
        year: baziData.yearPillar,
        month: baziData.monthPillar,
        day: baziData.dayPillar,
        hour: baziData.hourPillar
      },
      raw: result,
      warning: 'LLM 未回傳合法 JSON,前端請用 raw 顯示',
      remainingCredits: newPoints
    } as ApiResponse), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error: any) {
    return new Response(JSON.stringify({
      success: false,
      message: error.message || "八字解盤過程中發生異常"
    } as ApiResponse), {
      status: 500,
      headers: corsHeaders
    });
  }
}
