# 吃药了 (ChiYaoLe) — 服药提醒后台 API

微信小程序「吃药了」的后台服务，提供用户管理、药品管理、打卡记录、统计分析、订阅提醒等 RESTful API。

## 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 运行时 | [Bun](https://bun.sh) | 高性能 JS/TS 运行时，内置 SQLite 驱动 |
| HTTP 框架 | [Hono](https://hono.dev) | 轻量级 Web 框架，原生适配 Bun |
| 数据库 | SQLite (`bun:sqlite`) | 嵌入式数据库，零运维，单文件部署 |
| 认证 | JWT (HMAC-SHA256) | 微信 code → openid → 签发 JWT，纯 Web Crypto API 实现 |

## 快速开始

### 环境要求

- [Bun](https://bun.sh) >= 1.0

```bash
# 安装 Bun（如尚未安装）
curl -fsSL https://bun.sh/install | bash
```

### 安装与启动

```bash
cd server

# 安装依赖
bun install

# 启动开发服务器（带热重载）
bun run dev
```

服务启动后访问 `http://localhost:3000/v1/health` 验证。

### 可用脚本

```bash
bun run dev       # 开发模式（--watch 热重载），端口 3000
bun run start     # 生产模式启动
bun run build     # 编译为单二进制文件 ./chiyaole-server
bun run test      # 运行全部测试（52 个）
bun run lint      # TypeScript 类型检查（tsc --noEmit）
bun run seed      # 插入开发用种子数据
```

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `PORT` | 否 | `3000` | 服务端口 |
| `DATABASE_PATH` | 否 | `./data/chiyaole.db` | SQLite 文件路径，自动创建 |
| `JWT_SECRET` | 生产必填 | `dev-secret-key` | JWT 签名密钥。生产环境未设置时拒绝启动 |
| `WX_APPID` | 生产必填 | `wx_test_appid` | 微信小程序 AppID |
| `WX_SECRET` | 生产必填 | `wx_test_secret` | 微信小程序 AppSecret |
| `NODE_ENV` | 否 | — | 设为 `production` 启用生产模式 |

> 开发环境无需配置任何环境变量即可运行。微信登录使用 mock 模式：`code` 以 `test_` 开头时自动返回模拟的 openid。

## 项目结构

```
server/
├── src/
│   ├── index.ts              # 入口：Hono app + Bun.serve
│   ├── db/
│   │   ├── schema.sql        # DDL（参考用）
│   │   ├── index.ts          # 数据库初始化 + 自动迁移
│   │   └── seed.ts           # 开发环境种子数据
│   ├── middleware/
│   │   ├── auth.ts           # JWT 签发/验证 + 认证中间件
│   │   └── error.ts          # 统一错误处理（含微信错误码映射）
│   ├── routes/
│   │   ├── auth.ts           # /auth/* — 登录、续期
│   │   ├── users.ts          # /users/* — 用户信息
│   │   ├── medications.ts    # /medications/* — 药品管理
│   │   ├── checkins.ts       # /checkins/* — 打卡记录
│   │   ├── stats.ts          # /stats/* — 统计数据
│   │   └── subscriptions.ts  # /subscriptions/* — 订阅提醒
│   ├── services/
│   │   ├── wechat.ts         # 微信 API 封装（code2Session + 订阅消息）
│   │   └── reminder.ts       # 定时提醒查询
│   └── utils/
│       ├── id.ts             # nanoid 生成带前缀 ID（u_xxx, m_xxx, c_xxx）
│       └── validate.ts       # 参数校验工具
├── data/                     # SQLite 数据库文件（自动创建，已 gitignore）
├── package.json
├── bunfig.toml               # Bun 配置（测试 preload）
└── tsconfig.json             # TypeScript 严格模式
```

## 认证机制

```
小程序端                                 服务端
  |                                        |
  |-- wx.login() 获取 code --------------->|
  |                                        |-- 调用微信 code2Session
  |                                        |-- 获取 openid + session_key
  |                                        |-- 查找/创建用户
  |                                        |-- 签发 JWT
  |<---- { token, refreshToken } ----------|
  |                                        |
  |-- 后续请求 Header:                     |
  |   Authorization: Bearer <token>        |
```

- **token** 有效期 7 天，**refreshToken** 有效期 30 天
- 所有接口需认证（除 `/auth/login`、`/auth/refresh`、`/health` 外）
- `session_key` 和 `openid` 不会出现在任何 API 响应中

### 认证错误码

| 错误码 | 含义 | 客户端处理 |
|--------|------|------------|
| 40100 | token 无效或未提供 | 重新调用 `wx.login()` |
| 40101 | token 已过期 | 调用 `/auth/refresh` 续期 |
| 40102 | 误用 refreshToken 访问接口 | 使用正确的 token |
| 40103 | 微信 code 无效/已使用 | 重新调用 `wx.login()` |
| 40104 | 微信接口频率限制 | 稍后重试 |
| 40105 | 用户已被微信封禁 | 提示用户 |
| 40106 | 登录请求过于频繁 | 稍后重试（IP 限流 10 次/分钟）|

## API 接口

**Base URL:** `http://localhost:3000/v1`

### 通用响应格式

```json
// 成功
{ "code": 0, "message": "ok", "data": { ... } }

// 失败
{ "code": 40001, "message": "参数错误：name 不能为空", "data": null }
```

### 接口总览（24 个）

| # | 方法 | 路径 | 说明 | 认证 |
|---|------|------|------|------|
| 1 | POST | `/auth/login` | 微信登录 | 否 |
| 2 | POST | `/auth/refresh` | Token 续期 | 否 |
| 3 | GET | `/users/me` | 获取用户信息 | 是 |
| 4 | PATCH | `/users/me` | 更新用户信息 | 是 |
| 5 | PATCH | `/users/me/settings` | 更新设置 | 是 |
| 6 | PATCH | `/users/me/emergency-contact` | 更新紧急联系人 | 是 |
| 7 | DELETE | `/users/me/data` | 清除用户数据（需 `X-Confirm: DELETE`）| 是 |
| 8 | GET | `/medications` | 药品列表 | 是 |
| 9 | GET | `/medications/stats` | 药品统计摘要 | 是 |
| 10 | GET | `/medications/:id` | 药品详情 + 近期打卡 | 是 |
| 11 | POST | `/medications` | 添加药品 | 是 |
| 12 | PATCH | `/medications/:id` | 更新药品 | 是 |
| 13 | DELETE | `/medications/:id` | 删除药品（CASCADE） | 是 |
| 14 | PATCH | `/medications/:id/stock` | 更新库存（增减） | 是 |
| 15 | POST | `/checkins` | 打卡（幂等 + 自动扣库存） | 是 |
| 16 | PATCH | `/checkins/:id` | 更新打卡（补录） | 是 |
| 17 | DELETE | `/checkins/:id` | 删除打卡 | 是 |
| 18 | GET | `/checkins` | 查询打卡记录（分页 + 筛选） | 是 |
| 19 | GET | `/checkins/today` | 今日待办聚合 | 是 |
| 20 | GET | `/checkins/calendar` | 月度日历状态 | 是 |
| 21 | GET | `/stats/overview` | 统计总览 | 是 |
| 22 | GET | `/stats/compliance` | 依从率趋势 | 是 |
| 23 | POST | `/subscriptions` | 记录订阅授权 | 是 |
| 24 | GET | `/subscriptions` | 获取订阅状态 | 是 |

> 完整的请求/响应格式、字段校验规则、SQL 实现细节见 [API_DESIGN.md](./API_DESIGN.md)。

### 快速体验

```bash
# 1. 登录（开发环境 mock）
curl -X POST http://localhost:3000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"code":"test_demo"}'

# 从响应中取 token，后续请求带上
TOKEN="<从上面响应中复制>"

# 2. 查看用户信息
curl http://localhost:3000/v1/users/me \
  -H "Authorization: Bearer $TOKEN"

# 3. 添加药品
curl -X POST http://localhost:3000/v1/medications \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"阿莫西林胶囊","dosage":"1粒","times":["08:00","20:00"],"remaining":24,"total":24,"unit":"粒"}'

# 4. 打卡
curl -X POST http://localhost:3000/v1/checkins \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"medicationId":"<药品ID>","date":"2026-03-25","scheduledTime":"08:00","actualTime":"08:15","status":"taken","dosage":"1粒"}'

# 5. 查看今日待办
curl http://localhost:3000/v1/checkins/today \
  -H "Authorization: Bearer $TOKEN"
```

## 测试

```bash
bun test
```

测试覆盖：
- **API 测试**（29 个）：完整覆盖全部 24 个接口的正常/异常路径
- **认证测试**（23 个）：无 token、无效 token、篡改 token、过期 token、refreshToken 误用、已注销用户续期、`session_key` 不泄露、IP 限流

测试使用内存数据库（`:memory:`），不影响开发数据。

## 部署

```bash
# 方式一：直接运行
NODE_ENV=production JWT_SECRET=your-secret WX_APPID=wxXXX WX_SECRET=xxx bun run start

# 方式二：编译为单二进制
bun run build
JWT_SECRET=your-secret ./chiyaole-server
```

## License

MIT
