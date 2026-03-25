import { Hono } from "hono";
import db from "../db";
import { success, error } from "../middleware/error";
import {
  optionalString,
  optionalBoolean,
  optionalEnum,
  requireString,
} from "../utils/validate";

type Variables = { userId: string };
const users = new Hono<{ Variables: Variables }>();

function formatUser(row: Record<string, unknown>) {
  const joinDate = row.join_date as string;
  const now = new Date();
  const join = new Date(joinDate);
  const joinDays =
    Math.floor((now.getTime() - join.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  return {
    id: row.id,
    nickName: row.nick_name,
    avatarUrl: row.avatar_url,
    healthScore: row.health_score,
    joinDate,
    joinDays,
    settings: JSON.parse((row.settings as string) || "{}"),
    emergencyContact: JSON.parse(
      (row.emergency_contact as string) || "{}"
    ),
  };
}

users.get("/me", async (c) => {
  const userId = c.get("userId");
  const user = db
    .query("SELECT * FROM users WHERE id = ?")
    .get(userId) as Record<string, unknown> | null;

  if (!user) {
    return error(c, 40400, "用户不存在", 404);
  }

  return success(c, formatUser(user));
});

users.patch("/me", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();

  const nickName = optionalString(body.nickName, "nickName", 50);
  const avatarUrl = optionalString(body.avatarUrl, "avatarUrl", 500);

  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (nickName !== undefined) {
    updates.push("nick_name = ?");
    values.push(nickName);
  }
  if (avatarUrl !== undefined) {
    updates.push("avatar_url = ?");
    values.push(avatarUrl);
  }

  if (updates.length === 0) {
    return error(c, 40001, "参数错误：未提供要更新的字段");
  }

  updates.push("updated_at = datetime('now')");
  values.push(userId);

  db.run(
    `UPDATE users SET ${updates.join(", ")} WHERE id = ?`,
    values
  );

  const user = db
    .query("SELECT * FROM users WHERE id = ?")
    .get(userId) as Record<string, unknown>;

  return success(c, formatUser(user));
});

users.patch("/me/settings", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();

  const user = db
    .query("SELECT * FROM users WHERE id = ?")
    .get(userId) as Record<string, unknown> | null;

  if (!user) {
    return error(c, 40400, "用户不存在", 404);
  }

  const currentSettings = JSON.parse((user.settings as string) || "{}");

  const reminderEnabled = optionalBoolean(body.reminderEnabled, "reminderEnabled");
  const reminderSound = optionalString(body.reminderSound, "reminderSound", 50);
  const vibrationEnabled = optionalBoolean(body.vibrationEnabled, "vibrationEnabled");
  const snoozeMinutes = optionalEnum(
    body.snoozeMinutes !== undefined ? String(body.snoozeMinutes) : undefined,
    "snoozeMinutes",
    ["5", "10", "15", "20", "30"]
  );

  if (reminderEnabled !== undefined)
    currentSettings.reminderEnabled = reminderEnabled;
  if (reminderSound !== undefined)
    currentSettings.reminderSound = reminderSound;
  if (vibrationEnabled !== undefined)
    currentSettings.vibrationEnabled = vibrationEnabled;
  if (snoozeMinutes !== undefined)
    currentSettings.snoozeMinutes = parseInt(snoozeMinutes);

  db.run(
    "UPDATE users SET settings = ?, updated_at = datetime('now') WHERE id = ?",
    [JSON.stringify(currentSettings), userId]
  );

  return success(c, currentSettings);
});

users.patch("/me/emergency-contact", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();

  const name = optionalString(body.name, "name", 50);
  const phone = optionalString(body.phone, "phone", 20);

  const user = db
    .query("SELECT * FROM users WHERE id = ?")
    .get(userId) as Record<string, unknown> | null;

  if (!user) {
    return error(c, 40400, "用户不存在", 404);
  }

  const contact = JSON.parse((user.emergency_contact as string) || "{}");
  if (name !== undefined) contact.name = name;
  if (phone !== undefined) contact.phone = phone;

  db.run(
    "UPDATE users SET emergency_contact = ?, updated_at = datetime('now') WHERE id = ?",
    [JSON.stringify(contact), userId]
  );

  return success(c, contact);
});

users.delete("/me/data", async (c) => {
  const userId = c.get("userId");
  const confirm = c.req.header("X-Confirm");

  if (confirm !== "DELETE") {
    return error(c, 40001, "需要 X-Confirm: DELETE 确认头");
  }

  db.run("DELETE FROM users WHERE id = ?", [userId]);
  return success(c, null);
});

export default users;
