import { Env, ApiResponse, corsHeaders } from './types';
import { handleRegister } from './register';
import { handleChat } from './qimen_llm';
import { handleBazi } from './bazi';
import { CalendarService } from './services/CalendarService';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const verifyUser = async (body: any) => {
      const { username, password } = body;
      if (!username || !password) return null;
      
      const verifyUrl = `${env.NCB_BASE_URL}/read/users?Instance=${env.NCB_INSTANCE}&user_tel=${username}&password=${password}`;
      const ncbResponse = await fetch(verifyUrl, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${env.NCB_API_KEY}`, 'accept': 'application/json' }
      });
      const data = await ncbResponse.json();
      if (data.status === "success" && data.data && data.data.length > 0) {
        return data.data[0];
      }
      return null;
    };

    // --- DIAGNOSTIC ENDPOINT: Directly test CalendarService ---
    if (url.pathname === "/api/debug/bazi" && request.method === "POST") {
      try {
        const body = await request.json();
        const prompt = body.prompt || "";
        const dateInfo = CalendarService.parseDateTime(prompt);
        
        if (!dateInfo) {
          return new Response(JSON.stringify({ 
            success: false, 
            message: "Date parsing failed", 
            input: prompt 
          }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const baziResult = CalendarService.calculateBazi(
          dateInfo.year, dateInfo.month, dateInfo.day, 
          dateInfo.hour, dateInfo.minute, dateInfo.isTimeUnknown
        );

        return new Response(JSON.stringify({ 
          success: true, 
          parsed: dateInfo, 
          result: baziResult 
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (e: any) {
        return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers: corsHeaders });
      }
    }
    // ---------------------------------------------------------

    if (url.pathname === "/api/verify" && request.method === "POST") {
      try {
        const body = await request.json();
        const user = await verifyUser(body);
        if (user) {
          return new Response(JSON.stringify({ success: true, user }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        } else {
          return new Response(JSON.stringify({ success: false, message: "帳號或密碼錯誤" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      } catch (error: any) {
        return new Response(JSON.stringify({ success: false, message: error.message || "伺服器內部異常" }), {
          status: 500,
          headers: corsHeaders
        });
      }
    }

    // === 整合 v3:八字專屬獨立端點 ===
    if (url.pathname === "/api/bazi" && request.method === "POST") {
      return await handleBazi(request, env, corsHeaders);
    }

    try {
      if (url.pathname === "/api/register" && request.method === "POST") {
        return await handleRegister(request, env, corsHeaders);
      }

      if (url.pathname === "/api/chat" && request.method === "POST") {
        const body = await request.json();
        const user = await verifyUser(body);
        
        if (!user) {
          return new Response(JSON.stringify({ success: false, message: "身分驗證失敗" } as ApiResponse), { 
            status: 401, 
            headers: { ...corsHeaders, "Content-Type": "application/json" } 
          });
        }
        
        return await handleChat(body, user, env, corsHeaders);
      }
    } catch (modError: any) {
      return new Response(JSON.stringify({ success: false, message: "模組執行失敗" } as ApiResponse), { 
        status: 500, 
        headers: corsHeaders 
      });
    }

    return new Response(JSON.stringify({ message: "Not Found" } as ApiResponse), { 
      status: 404, 
      headers: corsHeaders 
    });
  }
};
