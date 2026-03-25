# API 设计文档

**版本:** 2.0
**日期:** 2026-03-25
**Base URL:** `https://api.chiyaole.com/v1`
**技术栈:** Bun + SQLite + Hono

---

## 1. 总体设计

### 技术选型

| 层 | 技术 | 说明 |
|----|------|------|
| 运行时 | [Bun](https://bun.sh) | 高性能 JS/TS 运行时，内置 SQLite 驱动 |
| HTTP 框架 | [Hono](https://hono.dev) | 轻量级 Web 框架，原生适配 Bun |
| 数据库 | SQLite (via `bun:sqlite`) | 嵌入式数据库，零运维，单文件部署 |
| 认证 | JWT (`@hono/jwt`) | 微信 code → openid → 签发 JWT |
| 部署 | 单二进制 / Docker | `bun build --compile` 或容器化 |

### 架构原则

- RESTful 风格，JSON 请求/响应
- 所有接口需认证（除 `/auth/login` 外）
- 本地优先：客户端优先读写 Storage，写操作异步同步至服务端
- 幂等设计：打卡等操作支持重复提交不产生副作用
- SQLite WAL 模式，支持并发读

### 认证方式

```
小程序端                                 服务端 (Bun)
  |                                        |
  |-- wx.login() 获取 code --------------->|
  |                                        |-- fetch wechat code2Session
  |                                        |-- 获取 openid + session_key
  |                                        |-- INSERT/SELECT users
  |                                        |-- 签发 JWT (bun:crypto)
  |<---- { token, refreshToken } ----------|
  |                                        |
  |-- 后续请求 Header:                     |
  |   Authorization: Bearer <token>        |
```

Token 有效期 7 天，`refreshToken` 有效期 30 天。

### 通用响应格式

```json
{
  "code": 0,
  "message": "ok",
  "data": { ... }
}
```

错误响应：

```json
{
  "code": 40001,
  "message": "参数错误：name 不能为空",
  "data": null
}
```

### 错误码规范

| 范围 | 含义 |
|------|------|
| 0 | 成功 |
| 40001-40099 | 参数校验错误 |
| 40100-40199 | 认证/授权错误 |
| 40400-40499 | 资源不存在 |
| 40900-40999 | 业务冲突（重复打卡等） |
| 50000-50099 | 服务端内部错误 |

### 分页（列表接口通用）

请求参数：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| page | number | 1 | 页码 |
| pageSize | number | 20 | 每页条数，最大 100 |

响应包裹：

```json
{
  "code": 0,
  "data": {
    "list": [],
    "total": 128,
    "page": 1,
    "pageSize": 20
  }
}
```

---

## 2. 数据库设计 (SQLite)

```sql
-- 启用 WAL 模式提升并发性能
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 用户表
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  openid        TEXT UNIQUE NOT NULL,
  session_key   TEXT DEFAULT '',
  nick_name     TEXT DEFAULT '用药小助手',
  avatar_url    TEXT DEFAULT '',
  health_score  INTEGER DEFAULT 0,
  join_date     TEXT NOT NULL,  -- YYYY-MM-DD
  settings      TEXT DEFAULT '{}',  -- JSON
  emergency_contact TEXT DEFAULT '{}',  -- JSON
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

-- 药品表
CREATE TABLE medications (
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
  times         TEXT DEFAULT '[]',  -- JSON array ["08:00","20:00"]
  with_food     TEXT DEFAULT '',    -- before/after/empty/''
  status        TEXT DEFAULT 'active',  -- active/paused/completed
  low_stock_enabled  INTEGER DEFAULT 1,     -- 是否启用库存预警
  low_stock_threshold INTEGER DEFAULT NULL, -- 预警数量：remaining <= threshold 时告急；为 NULL 则按 remaining/total < 0.2 回退
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_med_user_status ON medications(user_id, status);

-- 打卡记录表
CREATE TABLE checkins (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  medication_id   TEXT NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  date            TEXT NOT NULL,  -- YYYY-MM-DD
  scheduled_time  TEXT DEFAULT '',  -- HH:mm
  actual_time     TEXT DEFAULT '',  -- HH:mm
  status          TEXT DEFAULT 'taken',  -- taken/missed
  dosage          TEXT DEFAULT '',
  note            TEXT DEFAULT '',
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_checkin_unique ON checkins(user_id, medication_id, date, scheduled_time);
CREATE INDEX idx_checkin_user_date ON checkins(user_id, date);

-- 提醒订阅记录
CREATE TABLE subscriptions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL,
  status      TEXT DEFAULT 'accept',  -- accept/reject/ban
  created_at  TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, template_id)
);
```

> SQLite 使用 `TEXT` 存储 JSON 字段，Bun 内置 `JSON.parse/stringify` 处理序列化。
> 日期时间统一使用 ISO 8601 文本格式（`YYYY-MM-DD` / `datetime('now')`），利用 SQLite 字符串比较支持范围查询。

---

## 3. 认证模块

### POST /auth/login

微信登录，获取 token。

**请求：**

```json
{
  "code": "0a3Xxxxxx"
}
```

**服务端逻辑（Bun）：**

```typescript
// 1. 调用微信 code2Session
const wxRes = await fetch(`https://api.weixin.qq.com/sns/jscode2session?appid=${APPID}&secret=${SECRET}&js_code=${code}&grant_type=authorization_code`)
const { openid, session_key } = await wxRes.json()

// 2. 查找或创建用户
const user = db.query("SELECT * FROM users WHERE openid = ?").get(openid)
  ?? createUser(openid, session_key)

// 3. 签发 JWT
const token = await sign({ uid: user.id, openid }, JWT_SECRET, { expiresIn: '7d' })
const refreshToken = await sign({ uid: user.id, type: 'refresh' }, JWT_SECRET, { expiresIn: '30d' })
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "token": "eyJhbGciOi...",
    "refreshToken": "eyJhbGciOi...",
    "expiresIn": 604800,
    "isNewUser": true
  }
}
```

### POST /auth/refresh

续期 token。

**请求：**

```json
{
  "refreshToken": "eyJhbGciOi..."
}
```

**响应：** 同 login。

---

## 4. 用户模块

### GET /users/me

获取当前用户信息。

**响应：**

```json
{
  "code": 0,
  "data": {
    "id": "u_abc123",
    "nickName": "小明",
    "avatarUrl": "",
    "healthScore": 94,
    "joinDate": "2026-03-25",
    "joinDays": 1,
    "settings": {
      "reminderEnabled": true,
      "reminderSound": "default",
      "vibrationEnabled": true,
      "snoozeMinutes": 10
    },
    "emergencyContact": {
      "name": "",
      "phone": ""
    }
  }
}
```

> `joinDays` 为计算字段：`CAST(julianday('now') - julianday(join_date) AS INTEGER) + 1`

### PATCH /users/me

更新用户信息（部分更新）。

**请求（任选字段）：**

```json
{
  "nickName": "静雅",
  "avatarUrl": "https://..."
}
```

**校验：** `nickName` 长度 1-50；`avatarUrl` 需为合法 URL 或空字符串。
**响应：** 返回完整用户对象。

### PATCH /users/me/settings

更新用户设置。

**请求：**

```json
{
  "reminderEnabled": false,
  "snoozeMinutes": 15
}
```

**可选字段：** `reminderEnabled`(bool), `reminderSound`(string), `vibrationEnabled`(bool), `snoozeMinutes`(5/10/15/20/30)
**响应：** 返回完整 settings 对象。

### PATCH /users/me/emergency-contact

更新紧急联系人。

**请求：**

```json
{
  "name": "张三",
  "phone": "13800138000"
}
```

### DELETE /users/me/data

清除用户所有数据（退出/注销）。需二次确认 header `X-Confirm: DELETE`。

**服务端逻辑：** CASCADE 删除用户关联的 medications、checkins、subscriptions。

---

## 5. 药品模块

### GET /medications

获取用户的所有药品。

**Query 参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| status | string | 可选，`active` / `paused` / `completed` |

**SQL：**

```sql
SELECT * FROM medications WHERE user_id = ? AND (? IS NULL OR status = ?) ORDER BY created_at DESC
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "list": [
      {
        "id": "m_abc123",
        "name": "阿莫西林胶囊",
        "dosage": "1粒",
        "specification": "0.25g x 24粒",
        "icon": "capsule",
        "color": "#0058bc",
        "remark": "",
        "remaining": 2,
        "total": 24,
        "unit": "粒",
        "times": ["08:00", "20:00"],
        "withFood": "after",
        "status": "active",
        "createdAt": "2026-03-25T08:00:00Z",
        "updatedAt": "2026-03-25T08:00:00Z"
      }
    ],
    "total": 4
  }
}
```

### GET /medications/stats

药品统计摘要。

**SQL：**

```sql
SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
  SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) AS paused,
  SUM(
    CASE
      WHEN status = 'active' AND low_stock_enabled = 1 AND (
        (low_stock_threshold IS NOT NULL AND remaining <= low_stock_threshold)
        OR (low_stock_threshold IS NULL AND total > 0 AND CAST(remaining AS REAL) / total < 0.2)
      ) THEN 1 ELSE 0
    END
  ) AS lowStock
FROM medications WHERE user_id = ?
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "total": 4,
    "active": 3,
    "paused": 1,
    "lowStock": 2
  }
}
```

### GET /medications/:id

获取单个药品详情 + 最近 10 条打卡记录。

**SQL：**

```sql
SELECT * FROM medications WHERE id = ? AND user_id = ?;
SELECT * FROM checkins WHERE medication_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 10;
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "medication": { ... },
    "recentCheckins": [ ... ]
  }
}
```

### POST /medications

添加药品。

**请求：**

```json
{
  "name": "阿莫西林胶囊",
  "dosage": "1粒",
  "specification": "0.25g x 24粒",
  "icon": "capsule",
  "color": "#0058bc",
  "remark": "",
  "remaining": 24,
  "total": 24,
  "unit": "粒",
  "times": ["08:00", "20:00"],
  "withFood": "after",
  "lowStockEnabled": true,
  "lowStockThreshold": 5
}
```

**校验规则：**

| 字段 | 规则 |
|------|------|
| name | 必填，1-50 字符 |
| dosage | 必填，1-20 字符 |
| icon | 可选，枚举：`pill` / `capsule` / `tablet` / `spray`，默认 `pill` |
| color | 可选，hex 格式，默认 `#0058bc` |
| times | 可选，数组，元素格式 HH:mm |
| withFood | 可选，枚举：`before` / `after` / `empty` / `''` |
| lowStockEnabled | 可选，布尔值，默认 true |
| lowStockThreshold | 可选，>= 0，默认 null；当为 null 时回退到 remaining/total < 0.2 |
| remaining | 可选，≥ 0，默认 0 |
| total | 可选，≥ 0，默认 0 |

**响应：** 返回完整药品对象（含服务端生成的 `id`, `createdAt`, `updatedAt`）。
> 返回的药品对象包含库存预警配置：`lowStockEnabled` / `lowStockThreshold`（当 `lowStockThreshold` 为 `NULL` 时，告急判断会回退到 `remaining/total < 0.2`）。

### PATCH /medications/:id

更新药品（部分更新，仅传需要修改的字段）。
> 可更新库存预警配置字段：`lowStockEnabled` / `lowStockThreshold`。

**请求示例：**

```json
{
  "status": "paused"
}
```

**限制：** 不可修改 `id`, `userId`, `createdAt`。
**响应：** 返回更新后的完整药品对象。

### DELETE /medications/:id

删除药品。关联的打卡记录通过 CASCADE 自动删除。

### PATCH /medications/:id/stock

更新库存（专用接口，支持增减）。

**请求：**

```json
{
  "delta": -1
}
```

**SQL：**

```sql
UPDATE medications SET remaining = MAX(0, remaining + ?), updated_at = datetime('now') WHERE id = ? AND user_id = ?
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "id": "m_abc123",
    "remaining": 1,
    "total": 24,
    "lowStock": true
  }
}
```

---

## 6. 打卡模块

### POST /checkins

创建打卡记录（一键打卡）。

**请求：**

```json
{
  "medicationId": "m_abc123",
  "date": "2026-03-25",
  "scheduledTime": "08:00",
  "actualTime": "08:15",
  "status": "taken",
  "dosage": "1粒",
  "note": ""
}
```

**幂等逻辑：**

```sql
-- 使用 INSERT OR IGNORE + UNIQUE INDEX 实现幂等
INSERT OR IGNORE INTO checkins (id, user_id, medication_id, date, scheduled_time, actual_time, status, dosage, note)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
```

同一 `(user_id, medication_id, date, scheduled_time)` 组合若已存在，返回 `40900` 冲突。

**副作用：** 打卡 `taken` 时服务端自动执行库存 -1：

```sql
UPDATE medications SET remaining = MAX(0, remaining - 1), updated_at = datetime('now')
WHERE id = ? AND user_id = ?
```

**响应：** 返回完整打卡记录。

### PATCH /checkins/:id

更新打卡记录（补录、修改备注等）。

**请求：**

```json
{
  "status": "taken",
  "actualTime": "20:30",
  "note": "补录"
}
```

### DELETE /checkins/:id

删除打卡记录。

### GET /checkins

查询打卡记录。

**Query 参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| date | string | 按日查询 YYYY-MM-DD |
| startDate | string | 范围起始 |
| endDate | string | 范围结束 |
| medicationId | string | 按药品筛选 |
| status | string | `taken` / `missed` |
| page | number | 分页 |
| pageSize | number | 分页 |

**SQL 示例（按日查询）：**

```sql
SELECT c.*, m.name AS medication_name, m.icon, m.color
FROM checkins c
JOIN medications m ON c.medication_id = m.id
WHERE c.user_id = ? AND c.date = ?
ORDER BY c.scheduled_time ASC
```

### GET /checkins/today

今日待办 + 打卡状态（首页聚合接口）。

**服务端逻辑：**

```sql
-- 获取活跃药品的每个时间点
SELECT m.id, m.name, m.dosage, m.icon, m.color, m.times
FROM medications m WHERE m.user_id = ? AND m.status = 'active';

-- 获取今日已有打卡
SELECT * FROM checkins WHERE user_id = ? AND date = date('now');
```

在应用层展开 `medication.times` → 逐条匹配 checkins → 组装响应。

**响应：**

```json
{
  "code": 0,
  "data": {
    "date": "2026-03-25",
    "items": [
      {
        "medicationId": "m_abc123",
        "medicationName": "阿莫西林胶囊",
        "dosage": "1粒",
        "icon": "capsule",
        "color": "#0058bc",
        "scheduledTime": "08:00",
        "checkin": {
          "id": "c_xyz789",
          "status": "taken",
          "actualTime": "08:15"
        }
      },
      {
        "medicationId": "m_abc123",
        "medicationName": "阿莫西林胶囊",
        "dosage": "1粒",
        "icon": "capsule",
        "color": "#0058bc",
        "scheduledTime": "20:00",
        "checkin": null
      }
    ],
    "progress": {
      "total": 5,
      "completed": 3,
      "percentage": 60
    }
  }
}
```

### GET /checkins/calendar

月度日历打卡状态。

**Query 参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| year | number | 必填 |
| month | number | 必填，1-12 |

**SQL：**

```sql
SELECT date, status FROM checkins
WHERE user_id = ? AND date BETWEEN ? AND ?
```

在应用层按日聚合：该日全部 taken → `taken`，部分 taken → `partial`，全部 missed → `missed`。

**响应：**

```json
{
  "code": 0,
  "data": {
    "year": 2026,
    "month": 3,
    "days": {
      "2026-03-01": "taken",
      "2026-03-02": "taken",
      "2026-03-03": "partial",
      "2026-03-04": "missed",
      "2026-03-25": null
    }
  }
}
```

---

## 7. 统计模块

### GET /stats/overview

用户统计总览。

**SQL：**

```sql
-- 连续打卡天数（从今天往前推）
WITH dates AS (
  SELECT DISTINCT date FROM checkins
  WHERE user_id = ? AND status = 'taken'
  ORDER BY date DESC
)
-- 应用层计算连续天数

-- 依从率
SELECT
  COUNT(CASE WHEN status = 'taken' THEN 1 END) AS taken,
  COUNT(*) AS total
FROM checkins
WHERE user_id = ? AND date BETWEEN date('now', '-6 days') AND date('now')
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "streakDays": 7,
    "healthScore": 94,
    "compliance7d": 92,
    "compliance30d": 88,
    "totalCheckins": 86
  }
}
```

### GET /stats/compliance

依从率趋势数据。

**Query 参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| days | number | 天数范围，默认 30 |

**响应：**

```json
{
  "code": 0,
  "data": {
    "days": 30,
    "points": [
      { "date": "2026-03-01", "rate": 100 },
      { "date": "2026-03-02", "rate": 100 },
      { "date": "2026-03-03", "rate": 75 }
    ],
    "average": 88
  }
}
```

---

## 8. 提醒与订阅模块

### POST /subscriptions

记录用户订阅消息授权状态。

客户端调用 `wx.requestSubscribeMessage` 后将结果同步到服务端。

**请求：**

```json
{
  "templateId": "tmpl_xxxxxx",
  "status": "accept"
}
```

**SQL：**

```sql
INSERT INTO subscriptions (id, user_id, template_id, status)
VALUES (?, ?, ?, ?)
ON CONFLICT(user_id, template_id) DO UPDATE SET status = excluded.status
```

### GET /subscriptions

获取当前用户的订阅状态列表。

**响应：**

```json
{
  "code": 0,
  "data": [
    {
      "templateId": "tmpl_xxxxxx",
      "status": "accept"
    }
  ]
}
```

### POST /reminders/send

（内部/定时任务调用）触发服药提醒推送。

**服务端逻辑：**

```typescript
// 查询当前时间应推送的提醒
const pending = db.query(`
  SELECT u.openid, m.name, m.dosage, m.times, s.template_id
  FROM medications m
  JOIN users u ON m.user_id = u.id
  JOIN subscriptions s ON s.user_id = u.id AND s.status = 'accept'
  WHERE m.status = 'active'
  AND json_extract(u.settings, '$.reminderEnabled') = 1
`).all()

// 调用微信订阅消息 API 推送
for (const item of pending) {
  await fetch('https://api.weixin.qq.com/cgi-bin/message/subscribe/send', {
    method: 'POST',
    body: JSON.stringify({
      touser: item.openid,
      template_id: item.template_id,
      data: {
        thing1: { value: item.name },
        time2: { value: scheduledTime },
        thing3: { value: item.dosage }
      }
    })
  })
}
```

> 此接口不对外暴露，由 Bun 定时任务（`setInterval` 或 cron）内部调用。

---

## 9. 接口总览

| # | 方法 | 路径 | 说明 | 优先级 |
|---|------|------|------|--------|
| 1 | POST | /auth/login | 微信登录 | P0 |
| 2 | POST | /auth/refresh | Token 续期 | P0 |
| 3 | GET | /users/me | 获取用户信息 | P0 |
| 4 | PATCH | /users/me | 更新用户信息 | P1 |
| 5 | PATCH | /users/me/settings | 更新设置 | P1 |
| 6 | PATCH | /users/me/emergency-contact | 更新紧急联系人 | P2 |
| 7 | DELETE | /users/me/data | 清除用户数据 | P2 |
| 8 | GET | /medications | 药品列表 | P0 |
| 9 | GET | /medications/stats | 药品统计 | P0 |
| 10 | GET | /medications/:id | 药品详情 + 近期打卡 | P0 |
| 11 | POST | /medications | 添加药品 | P0 |
| 12 | PATCH | /medications/:id | 更新药品 | P0 |
| 13 | DELETE | /medications/:id | 删除药品（CASCADE） | P1 |
| 14 | PATCH | /medications/:id/stock | 更新库存 | P0 |
| 15 | POST | /checkins | 打卡（幂等 + 自动扣库存） | P0 |
| 16 | PATCH | /checkins/:id | 更新打卡（补录） | P1 |
| 17 | DELETE | /checkins/:id | 删除打卡 | P2 |
| 18 | GET | /checkins | 查询打卡记录 | P0 |
| 19 | GET | /checkins/today | 今日待办聚合 | P0 |
| 20 | GET | /checkins/calendar | 月度日历状态 | P0 |
| 21 | GET | /stats/overview | 统计总览 | P1 |
| 22 | GET | /stats/compliance | 依从率趋势 | P2 |
| 23 | POST | /subscriptions | 记录订阅授权 | P1 |
| 24 | GET | /subscriptions | 获取订阅状态 | P1 |

**P0 = 12 个接口（MVP）** / P1 = 8 个 / P2 = 4 个，共 24 个接口。

---

## 10. 项目结构参考（Bun + Hono）

```
server/
├── src/
│   ├── index.ts              # 入口，Hono app + Bun.serve
│   ├── db/
│   │   ├── schema.sql        # 建表语句
│   │   ├── index.ts          # Database.open + migrate
│   │   └── seed.ts           # 开发环境种子数据
│   ├── middleware/
│   │   ├── auth.ts           # JWT 验证中间件
│   │   └── error.ts          # 统一错误处理
│   ├── routes/
│   │   ├── auth.ts           # /auth/*
│   │   ├── users.ts          # /users/*
│   │   ├── medications.ts    # /medications/*
│   │   ├── checkins.ts       # /checkins/*
│   │   ├── stats.ts          # /stats/*
│   │   └── subscriptions.ts  # /subscriptions/*
│   ├── services/
│   │   ├── wechat.ts         # 微信 API 调用封装
│   │   └── reminder.ts       # 定时提醒推送
│   └── utils/
│       ├── id.ts             # ID 生成（nanoid）
│       └── validate.ts       # 参数校验
├── data/
│   └── chiyaole.db           # SQLite 数据库文件
├── package.json
├── bunfig.toml
└── tsconfig.json
```

### 启动命令

```bash
# 开发
bun run --watch src/index.ts

# 构建单二进制
bun build --compile src/index.ts --outfile chiyaole-server

# 运行
./chiyaole-server
```

### 环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `PORT` | 服务端口 | `3000` |
| `DATABASE_PATH` | SQLite 文件路径 | `./data/chiyaole.db` |
| `JWT_SECRET` | JWT 签名密钥 | `your-secret-key` |
| `WX_APPID` | 微信小程序 AppID | `wx84a0172595b38012` |
| `WX_SECRET` | 微信小程序 AppSecret | `your-app-secret` |

---

## 11. 前端接入策略

### 新增 utils/request.js

统一处理 token 注入、错误拦截、自动续期：

```javascript
const authService = require('./authService')

const BASE_URL = 'https://api.chiyaole.com/v1'

function request(method, path, data) {
  return new Promise((resolve, reject) => {
    const auth = authService.getAuth()
    wx.request({
      url: BASE_URL + path,
      method,
      data,
      header: {
        'Content-Type': 'application/json',
        'Authorization': auth?.token ? `Bearer ${auth.token}` : ''
      },
      success(res) {
        if (res.data.code === 40100) {
          // Token 过期，自动续期
          authService.login().then(() => request(method, path, data).then(resolve).catch(reject))
          return
        }
        if (res.data.code !== 0) {
          reject(res.data)
          return
        }
        resolve(res.data.data)
      },
      fail: reject
    })
  })
}

module.exports = {
  get: (path, params) => request('GET', path + toQuery(params), null),
  post: (path, data) => request('POST', path, data),
  patch: (path, data) => request('PATCH', path, data),
  delete: (path) => request('DELETE', path, null)
}
```

### 渐进式迁移

```
阶段 A：登录 + 写操作同步
  - /auth/login 获取 token
  - 打卡/添加药品：先写 Storage，再异步 POST 到服务端
  - 读取仍走 Storage

阶段 B：读写双通道
  - onShow 时从 API 拉最新数据覆盖 Storage
  - 弱网降级到本地

阶段 C：服务端优先
  - 所有读写走 API
  - Storage 仅作缓存层
  - 多端数据同步
```
