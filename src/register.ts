import { Env, ApiResponse, RegisterRequest, corsHeaders } from './types';

export async function handleRegister(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  try {
    const body: RegisterRequest = await request.json();
    const { username, password, phone, email } = body;

    if (!username || !password || !phone || !email) {
      return new Response(JSON.stringify({ success: false, message: "帳號、密碼、手機與 Email 均為必填" } as ApiResponse), { 
        status: 400, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const checkUrl = `${env.NCB_BASE_URL}/read/users?Instance=${env.NCB_INSTANCE}&user_tel=${phone}`;
    const checkRes = await fetch(checkUrl, {
      headers: { 'Authorization': `Bearer ${env.NCB_API_KEY}` }
    });
    const checkData = await checkRes.json();

    if (checkData.status === "success" && checkData.data && checkData.data.length > 0) {
      return new Response(JSON.stringify({ success: false, message: "該手機號碼已被註冊" } as ApiResponse), { 
        status: 409, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const createUrl = `${env.NCB_BASE_URL}/create/users?Instance=${env.NCB_INSTANCE}`;
    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.NCB_API_KEY}`
      },
      body: JSON.stringify({
        username,
        password,
        user_tel: phone,
        email, // 加入 email
        points: 5,
        user_role: 'user'
      })
    });

    const createData = await createRes.json();
    if (createData.status !== "success") {
      return new Response(JSON.stringify({ 
        success: false, 
        message: `NCB Error: ${createData.message || 'Unknown error'}`,
        debug: createData 
      } as ApiResponse), { 
        status: 400, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    return new Response(JSON.stringify({ success: true, message: "註冊成功，已贈送 5 點體驗金" } as ApiResponse), { 
      status: 201, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, message: error.message || "註冊過程發生異常" } as ApiResponse), { 
      status: 500, 
      headers: corsHeaders 
    });
  }
}
