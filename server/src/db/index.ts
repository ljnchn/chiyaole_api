import { Database } from "bun:sqlite";
import { join } from "path";
import { mkdirSync, existsSync } from "fs";

const DB_PATH = process.env.DATABASE_PATH || "./data/chiyaole.db";

if (DB_PATH !== ":memory:") {
  const dir = join(DB_PATH, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

const db = new Database(DB_PATH, { create: true });

export function migrate() {
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    openid        TEXT UNIQUE NOT NULL,
    session_key   TEXT DEFAULT '',
    nick_name     TEXT DEFAULT '用药小助手',
    avatar_url    TEXT DEFAULT '',
    health_score  INTEGER DEFAULT 0,
    join_date     TEXT NOT NULL,
    settings      TEXT DEFAULT '{}',
    emergency_contact TEXT DEFAULT '{}',
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS medications (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    dosage        TEXT NOT NULL,
    specification TEXT DEFAULT '',
    icon          TEXT DEFAULT 'pill',
    color         TEXT DEFAULT '#0058bc',
    remark        TEXT DEFAULT '',
    remaining     INTEGER DEFAULT 0,
    total         INTEGER DEFAULT 0,
    unit          TEXT DEFAULT '片',
    times         TEXT DEFAULT '[]',
    with_food     TEXT DEFAULT '',
    status        TEXT DEFAULT 'active',
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
  )`);
  db.run("CREATE INDEX IF NOT EXISTS idx_med_user_status ON medications(user_id, status)");

  db.run(`CREATE TABLE IF NOT EXISTS checkins (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    medication_id   TEXT NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
    date            TEXT NOT NULL,
    scheduled_time  TEXT DEFAULT '',
    actual_time     TEXT DEFAULT '',
    status          TEXT DEFAULT 'taken',
    dosage          TEXT DEFAULT '',
    note            TEXT DEFAULT '',
    created_at      TEXT DEFAULT (datetime('now'))
  )`);
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_checkin_unique ON checkins(user_id, medication_id, date, scheduled_time)");
  db.run("CREATE INDEX IF NOT EXISTS idx_checkin_user_date ON checkins(user_id, date)");

  db.run(`CREATE TABLE IF NOT EXISTS subscriptions (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_id TEXT NOT NULL,
    status      TEXT DEFAULT 'accept',
    created_at  TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, template_id)
  )`);
}

migrate();

export default db;
