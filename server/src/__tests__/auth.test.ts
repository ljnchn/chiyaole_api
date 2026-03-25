import { describe, it, expect } from "bun:test";
import app from "../index";
import { signJwt } from "../middleware/auth";

const BASE = "http://localhost";

async function rawReq(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>
) {
  return app.fetch(
    new Request(`${BASE}/v1${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  );
}

async function jsonReq(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>
) {
  const res = await rawReq(method, path, body, headers);
  return {
    status: res.status,
    body: (await res.json()) as { code: number; message: string; data: any },
  };
}

describe("Auth - Token Validation", () => {
  it("should reject requests without Authorization header", async () => {
    const { status, body } = await jsonReq("GET", "/users/me");
    expect(status).toBe(401);
    expect(body.code).toBe(40100);
  });

  it("should reject requests with malformed Authorization header", async () => {
    const { status, body } = await jsonReq("GET", "/users/me", undefined, {
      Authorization: "Token abc123",
    });
    expect(status).toBe(401);
    expect(body.code).toBe(40100);
  });

  it("should reject a completely invalid JWT", async () => {
    const { status, body } = await jsonReq("GET", "/users/me", undefined, {
      Authorization: "Bearer not.a.valid.jwt",
    });
    expect(status).toBe(401);
    expect(body.code).toBe(40100);
  });

  it("should reject a tampered JWT (modified payload)", async () => {
    const token = await signJwt({ uid: "u_test", openid: "oid" }, 3600);
    const parts = token.split(".");
    const payload = JSON.parse(atob(parts[1]));
    payload.uid = "u_hacked";
    const tamperedPayload = btoa(JSON.stringify(payload))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    const { status, body } = await jsonReq("GET", "/users/me", undefined, {
      Authorization: `Bearer ${tampered}`,
    });
    expect(status).toBe(401);
    expect(body.code).toBe(40100);
  });

  it("should return 40101 for an expired token", async () => {
    const token = await signJwt({ uid: "u_test", openid: "oid" }, -1);

    const { status, body } = await jsonReq("GET", "/users/me", undefined, {
      Authorization: `Bearer ${token}`,
    });
    expect(status).toBe(401);
    expect(body.code).toBe(40101);
    expect(body.message).toContain("过期");
  });

  it("should return 40102 when using refreshToken to access a protected route", async () => {
    const refreshToken = await signJwt({ uid: "u_test", type: "refresh" }, 3600);

    const { status, body } = await jsonReq("GET", "/users/me", undefined, {
      Authorization: `Bearer ${refreshToken}`,
    });
    expect(status).toBe(401);
    expect(body.code).toBe(40102);
  });
});

describe("Auth - Login Flow", () => {
  it("should create a new user on first login", async () => {
    const { status, body } = await jsonReq("POST", "/auth/login", {
      code: "test_auth_new_user",
    });
    expect(status).toBe(200);
    expect(body.code).toBe(0);
    expect(body.data.token).toBeTruthy();
    expect(body.data.refreshToken).toBeTruthy();
    expect(body.data.isNewUser).toBe(true);
    expect(body.data.expiresIn).toBe(604800);
  });

  it("should return existing user on repeated login", async () => {
    const { body } = await jsonReq("POST", "/auth/login", {
      code: "test_auth_new_user",
    });
    expect(body.code).toBe(0);
    expect(body.data.isNewUser).toBe(false);
  });

  it("should reject login with empty code", async () => {
    const { status } = await rawReq("POST", "/auth/login", {});
    expect(status).toBe(400);
  });

  it("should reject login with empty string code", async () => {
    const { status } = await rawReq("POST", "/auth/login", { code: "" });
    expect(status).toBe(400);
  });
});

describe("Auth - Token Refresh", () => {
  let validRefreshToken = "";
  let accessToken = "";

  it("should get tokens first via login", async () => {
    const { body } = await jsonReq("POST", "/auth/login", {
      code: "test_auth_refresh_user",
    });
    expect(body.code).toBe(0);
    validRefreshToken = body.data.refreshToken;
    accessToken = body.data.token;
  });

  it("should refresh with valid refreshToken", async () => {
    const { status, body } = await jsonReq("POST", "/auth/refresh", {
      refreshToken: validRefreshToken,
    });
    expect(status).toBe(200);
    expect(body.code).toBe(0);
    expect(body.data.token).toBeTruthy();
    expect(body.data.refreshToken).toBeTruthy();
    expect(body.data.expiresIn).toBe(604800);
  });

  it("should reject refresh with an access token (not refresh type)", async () => {
    const { status, body } = await jsonReq("POST", "/auth/refresh", {
      refreshToken: accessToken,
    });
    expect(status).toBe(401);
    expect(body.code).toBe(40100);
  });

  it("should reject refresh with garbage token", async () => {
    const { status, body } = await jsonReq("POST", "/auth/refresh", {
      refreshToken: "garbage.invalid.token",
    });
    expect(status).toBe(401);
    expect(body.code).toBe(40100);
  });

  it("should return 40101 for an expired refreshToken", async () => {
    const expired = await signJwt({ uid: "u_test", type: "refresh" }, -1);
    const { status, body } = await jsonReq("POST", "/auth/refresh", {
      refreshToken: expired,
    });
    expect(status).toBe(401);
    expect(body.code).toBe(40101);
  });
});

describe("Auth - Deleted User", () => {
  let token = "";
  let refreshToken = "";

  it("should login and get tokens", async () => {
    const { body } = await jsonReq("POST", "/auth/login", {
      code: "test_auth_delete_user",
    });
    expect(body.code).toBe(0);
    token = body.data.token;
    refreshToken = body.data.refreshToken;
  });

  it("should delete user data", async () => {
    const { body } = await jsonReq("DELETE", "/users/me/data", undefined, {
      Authorization: `Bearer ${token}`,
      "X-Confirm": "DELETE",
    });
    expect(body.code).toBe(0);
  });

  it("should reject refresh for a deleted user", async () => {
    const { status, body } = await jsonReq("POST", "/auth/refresh", {
      refreshToken,
    });
    expect(status).toBe(401);
    expect(body.code).toBe(40100);
    expect(body.message).toContain("注销");
  });

  it("should return 404 when accessing profile with old token of deleted user", async () => {
    const { body } = await jsonReq("GET", "/users/me", undefined, {
      Authorization: `Bearer ${token}`,
    });
    expect(body.code).toBe(40400);
  });
});

describe("Auth - session_key not exposed", () => {
  let token = "";

  it("should login", async () => {
    const { body } = await jsonReq("POST", "/auth/login", {
      code: "test_auth_session_key_check",
    });
    token = body.data.token;
  });

  it("GET /users/me should NOT contain session_key or openid", async () => {
    const { body } = await jsonReq("GET", "/users/me", undefined, {
      Authorization: `Bearer ${token}`,
    });
    expect(body.code).toBe(0);
    const data = body.data;
    expect(data.session_key).toBeUndefined();
    expect(data.sessionKey).toBeUndefined();
    expect(data.openid).toBeUndefined();
    expect(data.id).toBeTruthy();
    expect(data.nickName).toBeTruthy();
  });
});

describe("Auth - Rate Limiting", () => {
  it("should allow normal login requests from a fresh IP", async () => {
    const { body } = await jsonReq("POST", "/auth/login", {
      code: "test_rate_limit_check",
    }, {
      "X-Forwarded-For": "10.99.99.99",
    });
    expect(body.code).toBe(0);
  });

  it("should block after exceeding limit from same IP", async () => {
    const testIp = "10.88.88.88";
    for (let i = 0; i < 10; i++) {
      await rawReq("POST", "/auth/login", {
        code: `test_rl_${i}`,
      }, {
        "X-Forwarded-For": testIp,
      });
    }
    const { status, body } = await jsonReq("POST", "/auth/login", {
      code: "test_rl_overflow",
    }, {
      "X-Forwarded-For": testIp,
    });
    expect(status).toBe(429);
    expect(body.code).toBe(40106);
  });
});
