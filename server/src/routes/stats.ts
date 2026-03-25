import { Hono } from "hono";
import db from "../db";
import { success } from "../middleware/error";
import { optionalNumber } from "../utils/validate";

type Variables = { userId: string };
const stats = new Hono<{ Variables: Variables }>();

function calculateStreak(userId: string): number {
  const rows = db
    .query(
      `SELECT DISTINCT date FROM checkins
       WHERE user_id = ? AND status = 'taken'
       ORDER BY date DESC`
    )
    .all(userId) as { date: string }[];

  if (rows.length === 0) return 0;

  let streak = 0;
  const today = new Date();

  for (let i = 0; i < rows.length; i++) {
    const expected = new Date(today);
    expected.setDate(expected.getDate() - i);
    const expectedStr = expected.toISOString().split("T")[0];

    if (rows[i].date === expectedStr) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

function getComplianceRate(userId: string, days: number): number {
  const row = db
    .query(
      `SELECT
        COUNT(CASE WHEN status = 'taken' THEN 1 END) AS taken,
        COUNT(*) AS total
       FROM checkins
       WHERE user_id = ? AND date BETWEEN date('now', '-' || ? || ' days') AND date('now')`
    )
    .get(userId, days - 1) as { taken: number; total: number };

  if (row.total === 0) return 0;
  return Math.round((row.taken / row.total) * 100);
}

stats.get("/overview", async (c) => {
  const userId = c.get("userId");

  const streakDays = calculateStreak(userId);
  const compliance7d = getComplianceRate(userId, 7);
  const compliance30d = getComplianceRate(userId, 30);

  const userRow = db
    .query("SELECT health_score FROM users WHERE id = ?")
    .get(userId) as { health_score: number } | null;

  const totalRow = db
    .query(
      "SELECT COUNT(*) as cnt FROM checkins WHERE user_id = ? AND status = 'taken'"
    )
    .get(userId) as { cnt: number };

  return success(c, {
    streakDays,
    healthScore: userRow?.health_score ?? 0,
    compliance7d,
    compliance30d,
    totalCheckins: totalRow.cnt,
  });
});

stats.get("/compliance", async (c) => {
  const userId = c.get("userId");
  const days = optionalNumber(c.req.query("days"), "days", 1, 365) ?? 30;

  const rows = db
    .query(
      `SELECT date,
        COUNT(CASE WHEN status = 'taken' THEN 1 END) AS taken,
        COUNT(*) AS total
       FROM checkins
       WHERE user_id = ? AND date BETWEEN date('now', '-' || ? || ' days') AND date('now')
       GROUP BY date
       ORDER BY date ASC`
    )
    .all(userId, days - 1) as { date: string; taken: number; total: number }[];

  const points = rows.map((r) => ({
    date: r.date,
    rate: r.total > 0 ? Math.round((r.taken / r.total) * 100) : 0,
  }));

  const average =
    points.length > 0
      ? Math.round(points.reduce((sum, p) => sum + p.rate, 0) / points.length)
      : 0;

  return success(c, { days, points, average });
});

export default stats;
