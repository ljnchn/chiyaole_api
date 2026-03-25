import { describe, it, expect, beforeAll } from "bun:test";
import app from "../index";

const BASE = "http://localhost";
let token = "";
let refreshToken = "";
let medicationId = "";
let checkinId = "";

async function req(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>
) {
  const res = await app.fetch(
    new Request(`${BASE}/v1${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  );
  return res.json() as Promise<{ code: number; message: string; data: any }>;
}

describe("Auth", () => {
  it("POST /auth/login - should login with test code", async () => {
    const data = await req("POST", "/auth/login", { code: "test_user001" });
    expect(data.code).toBe(0);
    expect(data.data.token).toBeTruthy();
    expect(data.data.refreshToken).toBeTruthy();
    expect(data.data.isNewUser).toBe(true);
    token = data.data.token;
    refreshToken = data.data.refreshToken;
  });

  it("POST /auth/login - should return existing user on second login", async () => {
    const data = await req("POST", "/auth/login", { code: "test_user001" });
    expect(data.code).toBe(0);
    expect(data.data.isNewUser).toBe(false);
    token = data.data.token;
  });

  it("POST /auth/refresh - should refresh token", async () => {
    const data = await req("POST", "/auth/refresh", { refreshToken });
    expect(data.code).toBe(0);
    expect(data.data.token).toBeTruthy();
    token = data.data.token;
    refreshToken = data.data.refreshToken;
  });

  it("POST /auth/login - should reject missing code", async () => {
    const res = await app.fetch(
      new Request(`${BASE}/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json() as { code: number };
    expect(data.code).toBe(40001);
  });
});

describe("Users", () => {
  it("GET /users/me - should get current user", async () => {
    const data = await req("GET", "/users/me");
    expect(data.code).toBe(0);
    expect(data.data.nickName).toBe("用药小助手");
    expect(data.data.joinDays).toBeGreaterThanOrEqual(1);
  });

  it("PATCH /users/me - should update user info", async () => {
    const data = await req("PATCH", "/users/me", { nickName: "测试用户" });
    expect(data.code).toBe(0);
    expect(data.data.nickName).toBe("测试用户");
  });

  it("PATCH /users/me/settings - should update settings", async () => {
    const data = await req("PATCH", "/users/me/settings", {
      reminderEnabled: false,
    });
    expect(data.code).toBe(0);
    expect(data.data.reminderEnabled).toBe(false);
  });

  it("PATCH /users/me/emergency-contact - should update contact", async () => {
    const data = await req("PATCH", "/users/me/emergency-contact", {
      name: "李四",
      phone: "13900139000",
    });
    expect(data.code).toBe(0);
    expect(data.data.name).toBe("李四");
  });
});

describe("Medications", () => {
  it("POST /medications - should create medication", async () => {
    const data = await req("POST", "/medications", {
      name: "阿莫西林胶囊",
      dosage: "1粒",
      specification: "0.25g x 24粒",
      icon: "capsule",
      remaining: 24,
      total: 24,
      unit: "粒",
      times: ["08:00", "20:00"],
      withFood: "after",
    });
    expect(data.code).toBe(0);
    expect(data.data.name).toBe("阿莫西林胶囊");
    expect(data.data.id).toBeTruthy();
    medicationId = data.data.id;
  });

  it("GET /medications - should list medications", async () => {
    const data = await req("GET", "/medications");
    expect(data.code).toBe(0);
    expect(data.data.list.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /medications/stats - should return stats", async () => {
    const data = await req("GET", "/medications/stats");
    expect(data.code).toBe(0);
    expect(data.data.total).toBeGreaterThanOrEqual(1);
    expect(data.data.active).toBeGreaterThanOrEqual(1);
  });

  it("GET /medications/:id - should get medication detail", async () => {
    const data = await req("GET", `/medications/${medicationId}`);
    expect(data.code).toBe(0);
    expect(data.data.medication.name).toBe("阿莫西林胶囊");
  });

  it("PATCH /medications/:id - should update medication", async () => {
    const data = await req("PATCH", `/medications/${medicationId}`, {
      status: "paused",
    });
    expect(data.code).toBe(0);
    expect(data.data.status).toBe("paused");
  });

  it("PATCH /medications/:id - should restore to active", async () => {
    const data = await req("PATCH", `/medications/${medicationId}`, {
      status: "active",
    });
    expect(data.code).toBe(0);
    expect(data.data.status).toBe("active");
  });

  it("PATCH /medications/:id/stock - should update stock", async () => {
    const data = await req("PATCH", `/medications/${medicationId}/stock`, {
      delta: -2,
    });
    expect(data.code).toBe(0);
    expect(data.data.remaining).toBe(22);
  });
});

describe("Checkins", () => {
  it("POST /checkins - should create checkin", async () => {
    const today = new Date().toISOString().split("T")[0];
    const data = await req("POST", "/checkins", {
      medicationId,
      date: today,
      scheduledTime: "08:00",
      actualTime: "08:15",
      status: "taken",
      dosage: "1粒",
    });
    expect(data.code).toBe(0);
    expect(data.data.id).toBeTruthy();
    checkinId = data.data.id;
  });

  it("POST /checkins - should reject duplicate", async () => {
    const today = new Date().toISOString().split("T")[0];
    const data = await req("POST", "/checkins", {
      medicationId,
      date: today,
      scheduledTime: "08:00",
      actualTime: "08:15",
      status: "taken",
    });
    expect(data.code).toBe(40900);
  });

  it("GET /checkins - should list checkins", async () => {
    const today = new Date().toISOString().split("T")[0];
    const data = await req("GET", `/checkins?date=${today}`);
    expect(data.code).toBe(0);
    expect(data.data.list.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /checkins/today - should return today agenda", async () => {
    const data = await req("GET", "/checkins/today");
    expect(data.code).toBe(0);
    expect(data.data.items).toBeDefined();
    expect(data.data.progress).toBeDefined();
  });

  it("GET /checkins/calendar - should return calendar data", async () => {
    const now = new Date();
    const data = await req(
      "GET",
      `/checkins/calendar?year=${now.getFullYear()}&month=${now.getMonth() + 1}`
    );
    expect(data.code).toBe(0);
    expect(data.data.year).toBe(now.getFullYear());
  });

  it("PATCH /checkins/:id - should update checkin", async () => {
    const data = await req("PATCH", `/checkins/${checkinId}`, {
      note: "补录",
    });
    expect(data.code).toBe(0);
    expect(data.data.note).toBe("补录");
  });
});

describe("Stats", () => {
  it("GET /stats/overview - should return stats overview", async () => {
    const data = await req("GET", "/stats/overview");
    expect(data.code).toBe(0);
    expect(data.data.totalCheckins).toBeGreaterThanOrEqual(1);
  });

  it("GET /stats/compliance - should return compliance data", async () => {
    const data = await req("GET", "/stats/compliance?days=7");
    expect(data.code).toBe(0);
    expect(data.data.days).toBe(7);
  });
});

describe("Subscriptions", () => {
  it("POST /subscriptions - should create subscription", async () => {
    const data = await req("POST", "/subscriptions", {
      templateId: "tmpl_test_001",
      status: "accept",
    });
    expect(data.code).toBe(0);
    expect(data.data.templateId).toBe("tmpl_test_001");
  });

  it("GET /subscriptions - should list subscriptions", async () => {
    const data = await req("GET", "/subscriptions");
    expect(data.code).toBe(0);
    expect(data.data.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Auth protection", () => {
  it("should reject unauthenticated requests", async () => {
    const savedToken = token;
    token = "";
    const data = await req("GET", "/users/me");
    expect(data.code).toBe(40100);
    token = savedToken;
  });
});

describe("Cleanup", () => {
  it("DELETE /checkins/:id - should delete checkin", async () => {
    const data = await req("DELETE", `/checkins/${checkinId}`);
    expect(data.code).toBe(0);
  });

  it("DELETE /medications/:id - should delete medication", async () => {
    const data = await req("DELETE", `/medications/${medicationId}`);
    expect(data.code).toBe(0);
  });

  it("DELETE /users/me/data - should clear user data", async () => {
    const data = await req("DELETE", "/users/me/data", undefined, {
      "X-Confirm": "DELETE",
    });
    expect(data.code).toBe(0);
  });
});
