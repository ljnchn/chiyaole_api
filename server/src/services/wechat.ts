const WX_APPID = process.env.WX_APPID || "wx_test_appid";
const WX_SECRET = process.env.WX_SECRET || "wx_test_secret";

interface Code2SessionResult {
  openid: string;
  session_key: string;
  errcode?: number;
  errmsg?: string;
}

export async function code2Session(
  code: string
): Promise<Code2SessionResult> {
  if (process.env.NODE_ENV !== "production" && code.startsWith("test_")) {
    return {
      openid: `openid_${code}`,
      session_key: `sk_${code}`,
    };
  }

  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${WX_APPID}&secret=${WX_SECRET}&js_code=${code}&grant_type=authorization_code`;

  const res = await fetch(url);
  const data = (await res.json()) as Code2SessionResult;

  if (data.errcode) {
    throw new Error(`WeChat API error: ${data.errcode} ${data.errmsg}`);
  }

  return data;
}

export async function sendSubscribeMessage(
  accessToken: string,
  touser: string,
  templateId: string,
  data: Record<string, { value: string }>
): Promise<void> {
  const url = `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${accessToken}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ touser, template_id: templateId, data }),
  });

  const result = (await res.json()) as { errcode?: number; errmsg?: string };
  if (result.errcode) {
    console.error("Failed to send subscribe message:", result);
  }
}
