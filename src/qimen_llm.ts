import { Env, ApiResponse, ChatRequest, NCBUser, corsHeaders } from './types';
import { PROMPTS } from './prompts';
import { CalendarService } from './services/CalendarService';

/**
 * 從 LLM 回傳中抽出純 JSON 物件
 * - 移除 markdown code fence (```json ... ```)
 * - 取第一個 { ... } 區塊
 * - 防呆:解析失敗回 null,讓 caller fallback 用原文
 */
function extractJsonObject(raw: string): any | null {
  if (!raw) return null;

  // 1. 移除常見 markdown code fence
  let cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');

  // 2. 移除前後非 JSON 文字
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }
  cleaned = cleaned.substring(firstBrace, lastBrace + 1);

  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

export async function handleChat(body: ChatRequest, user: NCBUser, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  try {
    const { prompt, tool_id } = body;

    if (!prompt) {
      return new Response(JSON.stringify({ success: false, message: "請提供對話內容" } as ApiResponse), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const currentPoints = parseInt(user.points || "0");

    if (currentPoints < 1) {
      return new Response(JSON.stringify({ success: false, message: "體驗點數不足,請先儲值" } as ApiResponse), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const newPoints = currentPoints - 1;
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
    await fetch(recordUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.NCB_API_KEY}`
      },
      body: JSON.stringify({
        user_id: user.id,
        question: prompt,
        status_val: 'completed'
      })
    });

    const systemPrompt = PROMPTS[tool_id] || PROMPTS['default'];

    // 1. Initialize base content (KEEP ORIGINAL INFO)
    let finalUserContent = `\n生辰資訊:${prompt}\n性別:${body.gender || "未提供"}`;

    if (tool_id === 'bazi') {
      try {
        const dateInfo = CalendarService.parseDateTime(prompt);
        if (dateInfo) {
          const { year, month, day, hour, minute, isTimeUnknown } = dateInfo;
          const baziData = CalendarService.calculateBazi(year, month, day, hour, minute, isTimeUnknown);
          const timeStr = isTimeUnknown ? "吉時" : `${hour}:${minute < 10 ? '0' + minute : minute}`;

          // 2. APPEND structured data instead of overwriting
          finalUserContent += `\n\n【精準八字命盤數據】(由後端萬年曆精算,絕對事實):\n` +
                             `- 年柱:${baziData.yearPillar}\n` +
                             `- 月柱:${baziData.monthPillar}\n` +
                             `- 日柱:${baziData.dayPillar}\n` +
                             `- 時柱:${baziData.hourPillar}\n` +
                             `---\n` +
                             `【詳細資訊】:陽曆 ${baziData.solarDate},陰曆 ${baziData.lunarDate}\n` +
                             `【分析參數】:性別:${body.gender},出生時間:${timeStr}\n` +
                             `請直接根據上述數據進行深度分析,並嚴格遵守 JSON 輸出格式。`;
        }
      } catch (e) {
        console.error('Bazi conversion error:', e);
      }
    }

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

    const llmData = await llmResponse.json();
    const result: string = llmData.choices?.[0]?.message?.content ?? "";

    // ★ 整合關鍵:tool_id === 'bazi' 時,parse LLM JSON 為 sections
    if (tool_id === 'bazi') {
      const parsed = extractJsonObject(result);
      if (parsed && typeof parsed === 'object') {
        return new Response(JSON.stringify({
          success: true,
          tool: 'bazi',
          sections: parsed,
          raw: result,        // 留 raw 供前端 fallback / debug
          remainingCredits: newPoints
        } as ApiResponse), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // JSON 解析失敗:仍回 success + raw,讓前端 alert 提示
      return new Response(JSON.stringify({
        success: true,
        tool: 'bazi',
        sections: null,
        raw: result,
        warning: 'LLM 未回傳合法 JSON,前端請用 raw 顯示',
        remainingCredits: newPoints
      } as ApiResponse), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 其他 tool:沿用舊的純文字回傳
    return new Response(JSON.stringify({
      success: true,
      answer: result,
      remainingCredits: newPoints
    } as ApiResponse), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, message: error.message || "解盤過程中發生異常" } as ApiResponse), {
      status: 500,
      headers: corsHeaders
    });
  }
}
