import { Hono } from "hono";
import db from "../db";
import { generateId } from "../utils/id";
import { requireString } from "../utils/validate";
import { signJwt, verifyRefreshToken } from "../middleware/auth";
import { success, error } from "../middleware/error";
import { code2Session } from "../services/wechat";

const auth = new Hono();

auth.post("/login", async (c) => {
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

  const payload = await verifyRefreshToken(refreshTokenStr);
  if (!payload) {
    return error(c, 40100, "refreshToken 无效或已过期", 401);
  }

  const user = db
    .query("SELECT * FROM users WHERE id = ?")
    .get(payload.uid) as Record<string, unknown> | null;

  if (!user) {
    return error(c, 40400, "用户不存在", 404);
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
