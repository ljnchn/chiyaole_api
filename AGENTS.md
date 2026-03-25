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
- **JWT secret** defaults to `dev-secret-key` when `JWT_SECRET` env var is not set.
- **Tests use in-memory SQLite** (`:memory:`) so they don't touch the dev database.
- **Hono's `onError` handler** is used for centralized error handling (not middleware try/catch), since Hono's middleware chain doesn't propagate thrown errors to middleware-level try/catch as expected.
- The API base path is `/v1` — all endpoints are prefixed accordingly.
