import { Hono } from "hono";
import db from "../db";
import { generateId } from "../utils/id";
import { success } from "../middleware/error";
import { requireString, requireEnum } from "../utils/validate";

type Variables = { userId: string };
const subscriptions = new Hono<{ Variables: Variables }>();

subscriptions.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();

  const templateId = requireString(body.templateId, "templateId", 1, 100);
  const status = requireEnum(body.status, "status", [
    "accept",
    "reject",
    "ban",
  ]);

  const id = generateId("s");
  db.run(
    `INSERT INTO subscriptions (id, user_id, template_id, status)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, template_id) DO UPDATE SET status = excluded.status`,
    [id, userId, templateId, status]
  );

  return success(c, { templateId, status }, 201);
});

subscriptions.get("/", async (c) => {
  const userId = c.get("userId");

  const rows = db
    .query("SELECT template_id, status FROM subscriptions WHERE user_id = ?")
    .all(userId) as { template_id: string; status: string }[];

  return success(c, rows.map((r) => ({
    templateId: r.template_id,
    status: r.status,
  })));
});

export default subscriptions;
