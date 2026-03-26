import db from "./index";
import { generateId } from "../utils/id";

const userId = generateId("u");
const medId1 = generateId("m");
const medId2 = generateId("m");

db.run("DELETE FROM subscriptions");
db.run("DELETE FROM checkins");
db.run("DELETE FROM medications");
db.run("DELETE FROM users");

db.run(
  `INSERT INTO users (id, openid, nick_name, avatar_url, health_score, join_date, settings, emergency_contact)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  [
    userId,
    "test_openid_12345",
    "测试用户",
    "",
    85,
    "2026-03-20",
    JSON.stringify({
      reminderEnabled: true,
      reminderSound: "default",
      vibrationEnabled: true,
      snoozeMinutes: 10,
    }),
    JSON.stringify({ name: "张三", phone: "13800138000" }),
  ]
);

db.run(
  `INSERT INTO medications (id, user_id, name, dosage, frequency, start_date, specification, icon, color, remaining, total, unit, times, with_food, status, low_stock_enabled, low_stock_threshold)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [
    medId1,
    userId,
    "阿莫西林胶囊",
    "1粒",
    "1日2次",
    "2026-03-01",
    "0.25g x 24粒",
    "capsule",
    "#0058bc",
    20,
    24,
    "粒",
    JSON.stringify(["08:00", "20:00"]),
    "after",
    "active",
    1,
    5,
  ]
);

db.run(
  `INSERT INTO medications (id, user_id, name, dosage, frequency, start_date, specification, icon, color, remaining, total, unit, times, with_food, status, low_stock_enabled, low_stock_threshold)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [
    medId2,
    userId,
    "布洛芬缓释胶囊",
    "1粒",
    "1日1次",
    "2026-03-10",
    "0.3g x 20粒",
    "pill",
    "#e74c3c",
    5,
    20,
    "粒",
    JSON.stringify(["12:00"]),
    "after",
    "active",
    1,
    null,
  ]
);

const today = new Date().toISOString().split("T")[0];
const checkinId = generateId("c");
db.run(
  `INSERT INTO checkins (id, user_id, medication_id, date, scheduled_time, actual_time, status, dosage, note)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [checkinId, userId, medId1, today, "08:00", "08:15", "taken", "1粒", ""]
);

console.log("Seed data inserted successfully!");
console.log(`  User ID: ${userId}`);
console.log(`  Medication 1 ID: ${medId1}`);
console.log(`  Medication 2 ID: ${medId2}`);
console.log(`  Checkin ID: ${checkinId}`);
