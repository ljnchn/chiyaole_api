import { Hono } from "hono";
import db from "../db";
import { generateId } from "../utils/id";
import { success, error } from "../middleware/error";
import {
  requireString,
  optionalString,
  optionalEnum,
  optionalNumber,
  optionalTimeArray,
  requireNumber,
} from "../utils/validate";

type Variables = { userId: string };
const medications = new Hono<{ Variables: Variables }>();

function formatMedication(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    dosage: row.dosage,
    specification: row.specification,
    icon: row.icon,
    color: row.color,
    remark: row.remark,
    remaining: row.remaining,
    total: row.total,
    unit: row.unit,
    times: JSON.parse((row.times as string) || "[]"),
    withFood: row.with_food,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

medications.get("/", async (c) => {
  const userId = c.get("userId");
  const status = c.req.query("status");

  let rows: Record<string, unknown>[];
  if (status) {
    rows = db
      .query(
        "SELECT * FROM medications WHERE user_id = ? AND status = ? ORDER BY created_at DESC"
      )
      .all(userId, status) as Record<string, unknown>[];
  } else {
    rows = db
      .query(
        "SELECT * FROM medications WHERE user_id = ? ORDER BY created_at DESC"
      )
      .all(userId) as Record<string, unknown>[];
  }

  return success(c, {
    list: rows.map(formatMedication),
    total: rows.length,
  });
});

medications.get("/stats", async (c) => {
  const userId = c.get("userId");

  const row = db
    .query(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) AS paused,
        SUM(CASE WHEN status = 'active' AND total > 0 AND CAST(remaining AS REAL) / total < 0.2 THEN 1 ELSE 0 END) AS lowStock
      FROM medications WHERE user_id = ?`
    )
    .get(userId) as Record<string, unknown>;

  return success(c, {
    total: row.total || 0,
    active: row.active || 0,
    paused: row.paused || 0,
    lowStock: row.lowStock || 0,
  });
});

medications.get("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const med = db
    .query("SELECT * FROM medications WHERE id = ? AND user_id = ?")
    .get(id, userId) as Record<string, unknown> | null;

  if (!med) {
    return error(c, 40400, "药品不存在", 404);
  }

  const recentCheckins = db
    .query(
      "SELECT * FROM checkins WHERE medication_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 10"
    )
    .all(id, userId) as Record<string, unknown>[];

  return success(c, {
    medication: formatMedication(med),
    recentCheckins: recentCheckins.map((r) => ({
      id: r.id,
      date: r.date,
      scheduledTime: r.scheduled_time,
      actualTime: r.actual_time,
      status: r.status,
      dosage: r.dosage,
      note: r.note,
      createdAt: r.created_at,
    })),
  });
});

medications.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();

  const name = requireString(body.name, "name", 1, 50);
  const dosage = requireString(body.dosage, "dosage", 1, 20);
  const specification = optionalString(body.specification, "specification", 100) || "";
  const icon =
    optionalEnum(body.icon, "icon", [
      "pill",
      "capsule",
      "tablet",
      "spray",
    ]) || "pill";
  const color = optionalString(body.color, "color", 10) || "#0058bc";
  const remark = optionalString(body.remark, "remark", 500) || "";
  const remaining = optionalNumber(body.remaining, "remaining", 0) ?? 0;
  const total = optionalNumber(body.total, "total", 0) ?? 0;
  const unit = optionalString(body.unit, "unit", 10) || "片";
  const times = optionalTimeArray(body.times, "times") || [];
  const withFood =
    optionalEnum(body.withFood, "withFood", [
      "before",
      "after",
      "empty",
      "",
    ]) || "";

  const id = generateId("m");

  db.run(
    `INSERT INTO medications (id, user_id, name, dosage, specification, icon, color, remark, remaining, total, unit, times, with_food, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    [
      id,
      userId,
      name,
      dosage,
      specification,
      icon,
      color,
      remark,
      remaining,
      total,
      unit,
      JSON.stringify(times),
      withFood,
    ]
  );

  const med = db
    .query("SELECT * FROM medications WHERE id = ?")
    .get(id) as Record<string, unknown>;

  return success(c, formatMedication(med), 201);
});

medications.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json();

  const med = db
    .query("SELECT * FROM medications WHERE id = ? AND user_id = ?")
    .get(id, userId) as Record<string, unknown> | null;

  if (!med) {
    return error(c, 40400, "药品不存在", 404);
  }

  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  const fields: [string, string, string | number | undefined][] = [
    ["name", "name", optionalString(body.name, "name", 50)],
    ["dosage", "dosage", optionalString(body.dosage, "dosage", 20)],
    [
      "specification",
      "specification",
      optionalString(body.specification, "specification", 100),
    ],
    [
      "icon",
      "icon",
      optionalEnum(body.icon, "icon", [
        "pill",
        "capsule",
        "tablet",
        "spray",
      ]),
    ],
    ["color", "color", optionalString(body.color, "color", 10)],
    ["remark", "remark", optionalString(body.remark, "remark", 500)],
    ["remaining", "remaining", optionalNumber(body.remaining, "remaining", 0)],
    ["total", "total", optionalNumber(body.total, "total", 0)],
    ["unit", "unit", optionalString(body.unit, "unit", 10)],
    [
      "with_food",
      "withFood",
      optionalEnum(body.withFood, "withFood", [
        "before",
        "after",
        "empty",
        "",
      ]),
    ],
    [
      "status",
      "status",
      optionalEnum(body.status, "status", [
        "active",
        "paused",
        "completed",
      ]),
    ],
  ];

  for (const [col, , val] of fields) {
    if (val !== undefined) {
      updates.push(`${col} = ?`);
      values.push(val);
    }
  }

  if (body.times !== undefined) {
    const times = optionalTimeArray(body.times, "times");
    if (times !== undefined) {
      updates.push("times = ?");
      values.push(JSON.stringify(times));
    }
  }

  if (updates.length === 0) {
    return error(c, 40001, "参数错误：未提供要更新的字段");
  }

  updates.push("updated_at = datetime('now')");
  values.push(id, userId);

  db.run(
    `UPDATE medications SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`,
    values
  );

  const updated = db
    .query("SELECT * FROM medications WHERE id = ?")
    .get(id) as Record<string, unknown>;

  return success(c, formatMedication(updated));
});

medications.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const med = db
    .query("SELECT * FROM medications WHERE id = ? AND user_id = ?")
    .get(id, userId) as Record<string, unknown> | null;

  if (!med) {
    return error(c, 40400, "药品不存在", 404);
  }

  db.run("DELETE FROM medications WHERE id = ? AND user_id = ?", [id, userId]);
  return success(c, null);
});

medications.patch("/:id/stock", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json();

  const delta = requireNumber(body.delta, "delta");

  const med = db
    .query("SELECT * FROM medications WHERE id = ? AND user_id = ?")
    .get(id, userId) as Record<string, unknown> | null;

  if (!med) {
    return error(c, 40400, "药品不存在", 404);
  }

  db.run(
    "UPDATE medications SET remaining = MAX(0, remaining + ?), updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [delta, id, userId]
  );

  const updated = db
    .query("SELECT * FROM medications WHERE id = ?")
    .get(id) as Record<string, unknown>;

  const remaining = updated.remaining as number;
  const total = updated.total as number;

  return success(c, {
    id,
    remaining,
    total,
    lowStock: total > 0 && remaining / total < 0.2,
  });
});

export default medications;
