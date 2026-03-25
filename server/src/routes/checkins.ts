import { Hono } from "hono";
import db from "../db";
import { generateId } from "../utils/id";
import { success, error } from "../middleware/error";
import {
  requireString,
  optionalString,
  optionalEnum,
  validateDate,
  optionalDate,
  parsePagination,
} from "../utils/validate";

type Variables = { userId: string };
const checkins = new Hono<{ Variables: Variables }>();

function formatCheckin(row: Record<string, unknown>) {
  return {
    id: row.id,
    medicationId: row.medication_id,
    date: row.date,
    scheduledTime: row.scheduled_time,
    actualTime: row.actual_time,
    status: row.status,
    dosage: row.dosage,
    note: row.note,
    createdAt: row.created_at,
  };
}

checkins.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();

  const medicationId = requireString(body.medicationId, "medicationId", 1, 50);
  const date = validateDate(body.date, "date");
  const scheduledTime = optionalString(body.scheduledTime, "scheduledTime", 5) || "";
  const actualTime = optionalString(body.actualTime, "actualTime", 5) || "";
  const status = optionalEnum(body.status, "status", ["taken", "missed"]) || "taken";
  const dosage = optionalString(body.dosage, "dosage", 20) || "";
  const note = optionalString(body.note, "note", 500) || "";

  const med = db
    .query("SELECT * FROM medications WHERE id = ? AND user_id = ?")
    .get(medicationId, userId);

  if (!med) {
    return error(c, 40400, "药品不存在", 404);
  }

  const existing = db
    .query(
      "SELECT id FROM checkins WHERE user_id = ? AND medication_id = ? AND date = ? AND scheduled_time = ?"
    )
    .get(userId, medicationId, date, scheduledTime);

  if (existing) {
    return error(c, 40900, "该时段已打卡，不可重复提交", 409);
  }

  const id = generateId("c");
  db.run(
    `INSERT INTO checkins (id, user_id, medication_id, date, scheduled_time, actual_time, status, dosage, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, medicationId, date, scheduledTime, actualTime, status, dosage, note]
  );

  if (status === "taken") {
    db.run(
      "UPDATE medications SET remaining = MAX(0, remaining - 1), updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      [medicationId, userId]
    );
  }

  const checkin = db.query("SELECT * FROM checkins WHERE id = ?").get(id) as Record<
    string,
    unknown
  >;

  return success(c, formatCheckin(checkin), 201);
});

checkins.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json();

  const existing = db
    .query("SELECT * FROM checkins WHERE id = ? AND user_id = ?")
    .get(id, userId) as Record<string, unknown> | null;

  if (!existing) {
    return error(c, 40400, "打卡记录不存在", 404);
  }

  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  const statusVal = optionalEnum(body.status, "status", ["taken", "missed"]);
  const actualTime = optionalString(body.actualTime, "actualTime", 5);
  const note = optionalString(body.note, "note", 500);
  const dosage = optionalString(body.dosage, "dosage", 20);

  if (statusVal !== undefined) {
    updates.push("status = ?");
    values.push(statusVal);
  }
  if (actualTime !== undefined) {
    updates.push("actual_time = ?");
    values.push(actualTime);
  }
  if (note !== undefined) {
    updates.push("note = ?");
    values.push(note);
  }
  if (dosage !== undefined) {
    updates.push("dosage = ?");
    values.push(dosage);
  }

  if (updates.length === 0) {
    return error(c, 40001, "参数错误：未提供要更新的字段");
  }

  values.push(id, userId);
  db.run(
    `UPDATE checkins SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`,
    values
  );

  const updated = db
    .query("SELECT * FROM checkins WHERE id = ?")
    .get(id) as Record<string, unknown>;

  return success(c, formatCheckin(updated));
});

checkins.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const existing = db
    .query("SELECT * FROM checkins WHERE id = ? AND user_id = ?")
    .get(id, userId);

  if (!existing) {
    return error(c, 40400, "打卡记录不存在", 404);
  }

  db.run("DELETE FROM checkins WHERE id = ? AND user_id = ?", [id, userId]);
  return success(c, null);
});

checkins.get("/", async (c) => {
  const userId = c.get("userId");
  const query = c.req.query();

  const date = optionalDate(query.date, "date");
  const startDate = optionalDate(query.startDate, "startDate");
  const endDate = optionalDate(query.endDate, "endDate");
  const medicationId = query.medicationId;
  const status = query.status;
  const { page, pageSize, offset } = parsePagination(query);

  const conditions: string[] = ["c.user_id = ?"];
  const params: (string | number)[] = [userId];

  if (date) {
    conditions.push("c.date = ?");
    params.push(date);
  }
  if (startDate) {
    conditions.push("c.date >= ?");
    params.push(startDate);
  }
  if (endDate) {
    conditions.push("c.date <= ?");
    params.push(endDate);
  }
  if (medicationId) {
    conditions.push("c.medication_id = ?");
    params.push(medicationId);
  }
  if (status) {
    conditions.push("c.status = ?");
    params.push(status);
  }

  const where = conditions.join(" AND ");

  const countRow = db
    .query(`SELECT COUNT(*) as cnt FROM checkins c WHERE ${where}`)
    .get(...params) as { cnt: number };

  const rows = db
    .query(
      `SELECT c.*, m.name AS medication_name, m.icon, m.color
       FROM checkins c
       JOIN medications m ON c.medication_id = m.id
       WHERE ${where}
       ORDER BY c.date DESC, c.scheduled_time ASC
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset) as Record<string, unknown>[];

  return success(c, {
    list: rows.map((r) => ({
      ...formatCheckin(r),
      medicationName: r.medication_name,
      icon: r.icon,
      color: r.color,
    })),
    total: countRow.cnt,
    page,
    pageSize,
  });
});

checkins.get("/today", async (c) => {
  const userId = c.get("userId");
  const today = new Date().toISOString().split("T")[0];

  const meds = db
    .query(
      "SELECT id, name, dosage, icon, color, times FROM medications WHERE user_id = ? AND status = 'active'"
    )
    .all(userId) as Record<string, unknown>[];

  const todayCheckins = db
    .query(
      "SELECT * FROM checkins WHERE user_id = ? AND date = ?"
    )
    .all(userId, today) as Record<string, unknown>[];

  const checkinMap = new Map<string, Record<string, unknown>>();
  for (const ci of todayCheckins) {
    const key = `${ci.medication_id}_${ci.scheduled_time}`;
    checkinMap.set(key, ci);
  }

  const items: unknown[] = [];
  let totalSlots = 0;
  let completed = 0;

  for (const med of meds) {
    const times: string[] = JSON.parse((med.times as string) || "[]");
    for (const time of times) {
      totalSlots++;
      const key = `${med.id}_${time}`;
      const ci = checkinMap.get(key);

      items.push({
        medicationId: med.id,
        medicationName: med.name,
        dosage: med.dosage,
        icon: med.icon,
        color: med.color,
        scheduledTime: time,
        checkin: ci
          ? {
              id: ci.id,
              status: ci.status,
              actualTime: ci.actual_time,
            }
          : null,
      });

      if (ci && ci.status === "taken") completed++;
    }
  }

  return success(c, {
    date: today,
    items,
    progress: {
      total: totalSlots,
      completed,
      percentage: totalSlots > 0 ? Math.round((completed / totalSlots) * 100) : 0,
    },
  });
});

checkins.get("/calendar", async (c) => {
  const userId = c.get("userId");
  const year = parseInt(c.req.query("year") || "0");
  const month = parseInt(c.req.query("month") || "0");

  if (!year || month < 1 || month > 12) {
    return error(c, 40001, "参数错误：year 和 month 为必填项");
  }

  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate =
    month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, "0")}-01`;

  const rows = db
    .query(
      "SELECT date, status FROM checkins WHERE user_id = ? AND date >= ? AND date < ?"
    )
    .all(userId, startDate, endDate) as { date: string; status: string }[];

  const dayMap: Record<string, { taken: number; total: number }> = {};
  for (const row of rows) {
    if (!dayMap[row.date]) dayMap[row.date] = { taken: 0, total: 0 };
    dayMap[row.date].total++;
    if (row.status === "taken") dayMap[row.date].taken++;
  }

  const days: Record<string, string | null> = {};
  for (const [date, counts] of Object.entries(dayMap)) {
    if (counts.taken === counts.total) days[date] = "taken";
    else if (counts.taken > 0) days[date] = "partial";
    else days[date] = "missed";
  }

  return success(c, { year, month, days });
});

export default checkins;
