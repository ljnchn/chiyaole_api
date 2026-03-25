import { Hono } from "hono";
import db from "../db";
import { generateId } from "../utils/id";
import { requireString } from "../utils/validate";
import { signJwt, verifyRefreshToken } from "../middleware/auth";
import { success, error } from "../middleware/error";
import { code2Session } from "../services/wechat";

const auth = new Hono();

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_RATE_LIMIT = 10;
const LOGIN_RATE_WINDOW_MS = 60_000;

function checkLoginRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (!record || now > record.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_RATE_WINDOW_MS });
    return true;
  }

  record.count++;
  return record.count <= LOGIN_RATE_LIMIT;
}

auth.post("/login", async (c) => {
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown";

  if (!checkLoginRateLimit(ip)) {
    return error(c, 40106, "登录请求过于频繁，请稍后重试", 429);
  }

  const body = await c.req.json();
  const code = requireString(body.code, "code", 1, 100);

  const wxResult = await code2Session(code);
  const { openid, session_key } = wxResult;

  let user = db
    .query("SELECT * FROM users WHERE openid = ?")
    .get(openid) as Record<string, string | number> | null;

  let isNewUser = false;
  if (!user) {
    const id = generateId("u");
    const today = new Date().toISOString().split("T")[0];
    db.run(
      `INSERT INTO users (id, openid, session_key, join_date) VALUES (?, ?, ?, ?)`,
      [id, openid, session_key, today]
    );
    user = db.query("SELECT * FROM users WHERE id = ?").get(id) as Record<string, string | number>;
    isNewUser = true;
  } else {
    db.run("UPDATE users SET session_key = ?, updated_at = datetime('now') WHERE id = ?", [
      session_key,
      user.id as string,
    ]);
  }

  const token = await signJwt(
    { uid: user!.id, openid },
    7 * 24 * 60 * 60
  );
  const refreshToken = await signJwt(
    { uid: user!.id, type: "refresh" },
    30 * 24 * 60 * 60
  );

  return success(c, {
    token,
    refreshToken,
    expiresIn: 604800,
    isNewUser,
  });
});

auth.post("/refresh", async (c) => {
  const body = await c.req.json();
  const refreshTokenStr = requireString(body.refreshToken, "refreshToken", 1, 2000);

  const result = await verifyRefreshToken(refreshTokenStr);
  if (!result.ok) {
    if (result.reason === "expired") {
      return error(c, 40101, "refreshToken 已过期，请重新登录", 401);
    }
    return error(c, 40100, "refreshToken 无效", 401);
  }

  const user = db
    .query("SELECT * FROM users WHERE id = ?")
    .get(result.payload.uid) as Record<string, unknown> | null;

  if (!user) {
    return error(c, 40100, "用户不存在或已注销，请重新登录", 401);
  }

  const token = await signJwt(
    { uid: user.id, openid: user.openid },
    7 * 24 * 60 * 60
  );
  const newRefreshToken = await signJwt(
    { uid: user.id, type: "refresh" },
    30 * 24 * 60 * 60
  );

  return success(c, {
    token,
    refreshToken: newRefreshToken,
    expiresIn: 604800,
    isNewUser: false,
  });
});

export default auth;
