# CLAUDE.md

## 项目概要

微信小程序「吃药了」后台 API。技术栈 Bun + Hono + SQLite，源码在 `server/` 目录。

## 常用命令

所有命令在 `server/` 目录下执行：

```bash
bun install       # 安装依赖
bun run dev       # 开发服务器（端口 3000，--watch 热重载）
bun run start     # 生产启动
bun run test      # 运行测试（52 个）
bun run lint      # TypeScript 类型检查（tsc --noEmit）
bun run seed      # 插入种子数据
bun run build     # 编译为单二进制
```

## 架构

- 入口 `src/index.ts`，Hono 挂载 6 个路由模块，basePath `/v1`
- 数据库 `src/db/index.ts` 启动时自动建表（`CREATE TABLE IF NOT EXISTS`）
- 认证 `src/middleware/auth.ts` 实现 JWT 签发/验证（HMAC-SHA256，Web Crypto API）
- 错误处理 `src/middleware/error.ts` 使用 Hono 的 `app.onError()` 而非中间件 try/catch
- 微信 API `src/services/wechat.ts` 封装 code2Session，非 production 且 code 以 `test_` 开头时走 mock

## 开发注意事项

- **运行时是 Bun**，不是 Node.js，SQLite 通过 `bun:sqlite` 内置，无需额外服务
- **开发环境无需任何环境变量**。`JWT_SECRET` 默认 `dev-secret-key`，微信 API 自动 mock
- **生产环境必须设置** `JWT_SECRET`、`WX_APPID`、`WX_SECRET`，否则 JWT_SECRET 未设时拒绝启动
- 测试使用内存 SQLite（`:memory:`），通过 `bunfig.toml` preload `src/test-setup.ts` 设置
- 数据库文件在 `server/data/chiyaole.db`，已 gitignore

## 认证体系

- Token 有效期 7 天，refreshToken 30 天，通过 JWT payload 中的 `type` 字段区分
- 错误码 `40100`（无效）、`40101`（过期，应调用 `/auth/refresh`）、`40102`（误用 refreshToken）
- 微信错误码映射：`40029`/`40163` → code 无效，`45011` → 频率限制，`40226` → 用户封禁
- `/auth/login` 有 IP 限流（10 次/分钟）
- `session_key`、`openid` 不出现在任何 API 响应中（`formatUser` 使用字段白名单）

## 错误码规范

| 范围 | 含义 |
|------|------|
| 0 | 成功 |
| 40001-40099 | 参数校验错误 |
| 40100-40199 | 认证/授权错误 |
| 40400-40499 | 资源不存在 |
| 40900-40999 | 业务冲突（如重复打卡） |
| 50000-50099 | 服务端内部错误 |

## 代码风格

- TypeScript strict 模式，提交前确保 `bun run lint` 无错误
- 数据库查询结果统一用 `as Record<string, unknown>` 断言后在 format 函数中做字段映射
- 响应使用 `success(c, data)` / `error(c, code, message, httpStatus)` 工具函数
- ID 格式：`u_`（用户）、`m_`（药品）、`c_`（打卡）、`s_`（订阅）+ nanoid(16)
- 数据库字段 snake_case，API 响应 camelCase，在 route 层的 format 函数中转换

## 测试

- `src/__tests__/api.test.ts`：29 个测试覆盖全部 24 个接口
- `src/__tests__/auth.test.ts`：23 个测试覆盖认证边界情况
- 测试直接调用 `app.fetch()`，无需启动 HTTP 服务器
- 添加新接口后需在对应测试文件补充测试

## API 设计文档

完整接口规格（请求/响应格式、字段校验、SQL 示例）见 `API_DESIGN.md`。
