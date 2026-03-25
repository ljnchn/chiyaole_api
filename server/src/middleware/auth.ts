import type { Context, Next } from "hono";
import { error } from "./error";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-key";

if (process.env.NODE_ENV === "production" && JWT_SECRET === "dev-secret-key") {
  console.error("FATAL: JWT_SECRET must be set in production");
  process.exit(1);
}
if (JWT_SECRET === "dev-secret-key") {
  console.warn("⚠️  Using default JWT_SECRET — do NOT use in production");
}

interface JwtPayload {
  uid: string;
  openid?: string;
  type?: string;
  exp: number;
  iat: number;
}

type VerifyResult =
  | { ok: true; payload: JwtPayload }
  | { ok: false; reason: "invalid" | "expired" };

function base64UrlDecode(str: string): string {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return atob(str);
}

async function verifyJwt(token: string): Promise<VerifyResult> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return { ok: false, reason: "invalid" };

    const header = JSON.parse(base64UrlDecode(parts[0]));
    if (header.alg !== "HS256") return { ok: false, reason: "invalid" };

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(JWT_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );

    const signatureInput = encoder.encode(`${parts[0]}.${parts[1]}`);
    const signatureBytes = Uint8Array.from(
      atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0)
    );

    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      signatureInput
    );
    if (!valid) return { ok: false, reason: "invalid" };

    const payload: JwtPayload = JSON.parse(base64UrlDecode(parts[1]));

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return { ok: false, reason: "expired" };
    }

    return { ok: true, payload };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

export async function signJwt(
  payload: Record<string, unknown>,
  expiresInSeconds: number
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + expiresInSeconds };

  const encoder = new TextEncoder();

  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const body = btoa(JSON.stringify(fullPayload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${header}.${body}`)
  );

  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `${header}.${body}.${sig}`;
}

export function authMiddleware() {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return error(c, 40100, "未提供认证 token", 401);
    }

    const token = authHeader.slice(7);
    const result = await verifyJwt(token);

    if (!result.ok) {
      if (result.reason === "expired") {
        return error(c, 40101, "token 已过期，请使用 refreshToken 续期", 401);
      }
      return error(c, 40100, "token 无效", 401);
    }

    if (result.payload.type === "refresh") {
      return error(c, 40102, "不可使用 refreshToken 访问接口", 401);
    }

    c.set("userId", result.payload.uid);
    c.set("openid", result.payload.openid);

    await next();
  };
}

export async function verifyRefreshToken(
  token: string
): Promise<VerifyResult> {
  const result = await verifyJwt(token);
  if (!result.ok) return result;
  if (result.payload.type !== "refresh") return { ok: false, reason: "invalid" };
  return result;
}

export { JWT_SECRET };
