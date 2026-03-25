# AGENTS.md

## Cursor Cloud specific instructions

### Project Overview
This is a WeChat mini-program backend API ("吃药了" / ChiYaoLe - medication reminder). Tech stack: **Bun + Hono + SQLite**. All source code lives in `server/`.

### Runtime
- **Bun** is the runtime (not Node.js). Install via `curl -fsSL https://bun.sh/install | bash` if missing.
- Bun must be on PATH: `export BUN_INSTALL="$HOME/.bun" && export PATH="$BUN_INSTALL/bin:$PATH"`

### Key Commands (all from `server/` directory)
| Task | Command |
|------|---------|
| Install deps | `bun install` |
| Dev server | `bun run dev` (runs on port 3000 with `--watch`) |
| Type check | `bun run lint` |
| Tests | `bun test` |
| Seed data | `bun run seed` |
| Build binary | `bun run build` |

### Development Notes
- **SQLite is embedded** via `bun:sqlite` — no external database service needed. DB file auto-creates at `./data/chiyaole.db`.
- **WeChat API is mocked** in non-production: any login code starting with `test_` returns a mock openid. No real `WX_APPID`/`WX_SECRET` needed for dev/test.
- **JWT secret** defaults to `dev-secret-key` when `JWT_SECRET` env var is not set. The server will **refuse to start** in production (`NODE_ENV=production`) without an explicit `JWT_SECRET`.
- **Tests use in-memory SQLite** (`:memory:`) so they don't touch the dev database.
- **Hono's `onError` handler** is used for centralized error handling (not middleware try/catch), since Hono's middleware chain doesn't propagate thrown errors to middleware-level try/catch as expected.
- The API base path is `/v1` — all endpoints are prefixed accordingly.

### Authentication Architecture
- JWT signed with HMAC-SHA256 via Web Crypto API (`crypto.subtle`). No external JWT library needed.
- Token (7d) vs refreshToken (30d) are distinguished by `type` claim in JWT payload.
- Auth error codes: `40100` (invalid/missing), `40101` (expired — client should refresh), `40102` (refreshToken used as access token).
- WeChat-specific error codes mapped: `40029`/`40163` → invalid/used code, `45011` → rate limit, `40226` → blocked user.
- Login endpoint has IP-based rate limiting (10 req/min per IP).
- `session_key` and `openid` are never exposed in API responses (allowlist pattern in `formatUser`).
