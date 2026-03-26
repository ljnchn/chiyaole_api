-- 启用 WAL 模式提升并发性能
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 用户表
CREATE TABLE IF NOT EXISTS users (
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
);

-- 药品表
CREATE TABLE IF NOT EXISTS medications (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  dosage        TEXT NOT NULL,
  frequency     TEXT DEFAULT '1日3次' CHECK (frequency IN ('1日1次', '1日2次', '1日3次', '1日4次', '隔日1次', '每周1次', '必要时')),
  start_date    TEXT NOT NULL DEFAULT (date('now')),
  specification TEXT DEFAULT '',
  icon          TEXT DEFAULT 'pill',
  color         TEXT DEFAULT '#0058bc',
  remark        TEXT DEFAULT '',
  remaining     INTEGER DEFAULT 0,
  total         INTEGER DEFAULT 0,
  unit          TEXT DEFAULT '片',
  times         TEXT DEFAULT '[]',
  with_food     TEXT DEFAULT '' CHECK (with_food IN ('', 'before', 'with', 'after', 'sleep')),
  status        TEXT DEFAULT 'active',
  low_stock_enabled  INTEGER DEFAULT 1,     -- 是否启用库存预警
  low_stock_threshold INTEGER DEFAULT NULL, -- 预警数量：remaining <= threshold 时告急；为 NULL 则按 remaining/total < 0.2 回退
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_med_user_status ON medications(user_id, status);

-- 打卡记录表
CREATE TABLE IF NOT EXISTS checkins (
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
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_checkin_unique ON checkins(user_id, medication_id, date, scheduled_time);
CREATE INDEX IF NOT EXISTS idx_checkin_user_date ON checkins(user_id, date);

-- 提醒订阅记录
CREATE TABLE IF NOT EXISTS subscriptions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL,
  status      TEXT DEFAULT 'accept',
  created_at  TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, template_id)
);
