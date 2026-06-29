/**
 * 🎯 八字串流端點 — 整合 v3.1 (SSE Streaming)
 *
 * 路徑: POST /api/bazi/stream
 * 用途: 把 LLM 的逐 token 生成,直接用 SSE pipe 給前端,讓使用者 5 秒起就看到第一段
 *
 * 業務流程:
 *   1. 驗證帳密 (verifyNcbUser)
 *   2. 物理扣 10 點
 *   3. 解析 datetime → 計算四柱(CalendarService)
 *   4. 組 prompt 餵 LLM(stream: true)
 *   5. LLM 的 ReadableStream 直接 pipe 給前端,每 chunk 推 SSE event
 *
 * SSE event 格式:
 *   event: pillars      data: { ...四柱 }                    ← T+0ms 立即推
 *   event: raw          data: { delta: "<新增的字串片段>" }   ← 每個 LLM chunk 推
 *   event: section      data: { n: 1, text: "..." }           ← 當前端 regex 偵測到完整段(可選,前端做)
 *   event: done         data: { remainingCredits, pillars }   ← 串流結束
 *   event: error        data: { message }
 *
 * 物理隔離原則:
 *   - /api/verify: 完全不動
 *   - /api/chat   : 完全不動
 *   - /api/bazi   : 保留(已 work,可作為非 streaming 撤退點)
 *   - 本檔: SSE 串流專屬
 */

import { Env, ApiResponse, NCBUser } from './types';
import { PROMPTS } from './prompts';
import { CalendarService } from './services/CalendarService';
import { getCost, getLabel } from './pricing';

interface BaziRequest {
  username: string;
  password: string;
  datetime: string;
  birthplace: string;
  gender: string;
}

const STREAM_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
};

async function verifyNcbUser(body: { username: string; password: string }, env: Env): Promise<NCBUser | null> {
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
    console.error('NCB verify error (stream):', e);
  }
  return null;
}

function encodeSse(event: string, data: any): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function handleBaziStream(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: STREAM_HEADERS });
  }

  // Step 1: 解析 body
  let body: BaziRequest;
  try {
    body = await request.json() as BaziRequest;
  } catch {
    return new Response(JSON.stringify({ success: false, message: 'JSON 解析失敗' } as ApiResponse), {
      status: 400,
      headers: { ...STREAM_HEADERS, 'Content-Type': 'application/json' }
    });
  }

  const { username, password, datetime, birthplace, gender } = body;
  if (!username || !password || !datetime) {
    return new Response(JSON.stringify({ success: false, message: "缺少必要欄位" } as ApiResponse), {
      status: 400,
      headers: { ...STREAM_HEADERS, 'Content-Type': 'application/json' }
    });
  }

  // Step 2: 驗證帳密
  const user = await verifyNcbUser({ username, password }, env);
  if (!user) {
    return new Response(JSON.stringify({ success: false, message: "身分驗證失敗" } as ApiResponse), {
      status: 401,
      headers: { ...STREAM_HEADERS, 'Content-Type': 'application/json' }
    });
  }

  // Step 3: 扣點
  const cost = getCost('bazi');
  const currentPoints = parseInt(user.points || "0");
  if (currentPoints < cost) {
    return new Response(JSON.stringify({
      success: false,
      message: `${getLabel('bazi')}需要 ${cost} 點,目前僅 ${currentPoints} 點`
    } as ApiResponse), {
      status: 403,
      headers: { ...STREAM_HEADERS, 'Content-Type': 'application/json' }
    });
  }

  const newPoints = currentPoints - cost;

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
      question: `八字排盤(stream):${datetime} ${gender} ${birthplace}`,
      status_val: 'completed'
    })
  }).catch((e) => console.error('Record write failed (stream):', e));

  // Step 4: 排盤
  const dateInfo = CalendarService.parseDateTime(datetime);
  if (!dateInfo) {
    return new Response(JSON.stringify({
      success: false,
      message: "出生日期解析失敗,請使用 YYYY-MM-DD HH:MM 格式"
    } as ApiResponse), {
      status: 400,
      headers: { ...STREAM_HEADERS, 'Content-Type': 'application/json' }
    });
  }
  const { year, month, day, hour, minute, isTimeUnknown } = dateInfo;
  const baziData = CalendarService.calculateBazi(year, month, day, hour, minute, isTimeUnknown);
  const timeStr = isTimeUnknown ? "吉時" : `${hour}:${minute < 10 ? '0' + minute : minute}`;

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

  // Step 5: 開 LLM stream
  let llmResponse: Response;
  try {
    llmResponse = await fetch("https://api.kie.ai/gpt-5-2/v1/chat/completions", {
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
        reasoning_effort: "high",
        stream: true
      })
    });
  } catch (err: any) {
    return new Response(JSON.stringify({
      success: false,
      message: `LLM 串流啟動失敗:${err.message}`
    } as ApiResponse), {
      status: 502,
      headers: { ...STREAM_HEADERS, 'Content-Type': 'application/json' }
    });
  }

  if (!llmResponse.ok || !llmResponse.body) {
    return new Response(JSON.stringify({
      success: false,
      message: `LLM 上游回應錯誤:${llmResponse.status}`
    } as ApiResponse), {
      status: 502,
      headers: { ...STREAM_HEADERS, 'Content-Type': 'application/json' }
    });
  }

  // ★ Step 6: SSE pipe
  // 重要:逐 chunk 推 event: raw,在前端累積 raw text。
  // 不在後端解析,因為 streaming 模式下 fence 與 reasoning 模型會干擾正則。
  const reader = llmResponse.body.getReader();
  const decoder = new TextDecoder();
  // LLM 上游用的是 OpenAI-style SSE,每個 chunk 長這樣:
  //   data: {"choices":[{"delta":{"content":"..."} or {} or {"role":"..."}, ...}]}
  //   \n\n
  // 我們要把每個 chunk 解開,只把 content 字串累積,逐 token 推給前端
  let openaiBuffer = '';

  const stream = new ReadableStream({
    async start(controller) {
      // 立刻推 pillars(T+0)
      try {
        controller.enqueue(encodeSse('pillars', {
          year: baziData.yearPillar,
          month: baziData.monthPillar,
          day: baziData.dayPillar,
          hour: baziData.hourPillar,
          solarDate: baziData.solarDate,
          lunarDate: baziData.lunarDate
        }));
      } catch {}

      try {
        // 注意:reader.read() 一次可能拿到 1~N 個 SSE 事件(可能跨事件切邊界)
        // 所以我們需要在上游 buffer 內,以 \n\n 切事件,再解每個事件
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          openaiBuffer += decoder.decode(value, { stream: true });

          // 切事件:每個事件由多行(以 \n 分隔,以 \n\n 結尾)
          let sepIdx;
          while ((sepIdx = openaiBuffer.indexOf('\n\n')) !== -1) {
            const eventBlock = openaiBuffer.substring(0, sepIdx);
            openaiBuffer = openaiBuffer.substring(sepIdx + 2);

            // 取這個事件的第一行 data: 後面的 JSON
            const lines = eventBlock.split('\n');
            for (const line of lines) {
              if (!line.startsWith('data:')) continue;
              const payloadStr = line.substring(5).trim();
              if (payloadStr === '[DONE]') continue;
              try {
                const payload = JSON.parse(payloadStr);
                const choice = payload?.choices?.[0];
                const content = choice?.delta?.content;
                if (typeof content === 'string' && content.length > 0) {
                  // ★ 把上游的純文字 content 字串推給前端
                  controller.enqueue(encodeSse('raw', { delta: content }));
                }
              } catch {
                // ignore malformed line
              }
            }
          }
        }

        // 串流結束:最終告訴前端關門 + 殘餘點數
        controller.enqueue(encodeSse('done', {
          remainingCredits: newPoints,
          pillars: {
            year: baziData.yearPillar,
            month: baziData.monthPillar,
            day: baziData.dayPillar,
            hour: baziData.hourPillar
          }
        }));
        controller.close();
      } catch (err: any) {
        try {
          controller.enqueue(encodeSse('error', {
            message: err.message || '串流中斷'
          }));
          controller.close();
        } catch {}
      }
    },
    cancel() {
      try { reader.cancel(); } catch {}
    }
  });

  return new Response(stream, {
    headers: STREAM_HEADERS
  });
}
