import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import app from "../index";
import {
  setupTestDatabase,
  teardownTestDatabase,
  seedTestContext,
  SeededTestContext,
} from "./testHelper";

describe("Authentication & Session Verification", () => {
  let ctx: SeededTestContext;

  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    ctx = await seedTestContext();
  });

  it("Logs in successfully with seeded user credentials (Password123!)", async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({
        email: ctx.owner.email,
        password: "Password123!",
      });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.message).toBe("Logged in successfully");
    expect(loginRes.body.user).toBeDefined();
    expect(loginRes.body.user.email).toBe(ctx.owner.email);

    // Verify session cookie is set
    const rawCookies = loginRes.headers["set-cookie"];
    expect(rawCookies).toBeDefined();
    const cookies = Array.isArray(rawCookies) ? rawCookies : [rawCookies as string];
    expect(cookies.some((c: string) => c.includes("session"))).toBe(true);
  });

  it("Rejects login attempts with an incorrect password (401 Unauthorized)", async () => {
    const failedRes = await request(app)
      .post("/api/auth/login")
      .send({
        email: ctx.owner.email,
        password: "WrongPassword!",
      });

    expect(failedRes.status).toBe(401);
    expect(failedRes.body.message).toMatch(/Invalid email or password/i);
  });

  it("Rejects login attempts with an unregistered email (401 Unauthorized)", async () => {
    const nonExistentRes = await request(app)
      .post("/api/auth/login")
      .send({
        email: "nonexistent-user@example.com",
        password: "Password123!",
      });

    expect(nonExistentRes.status).toBe(401);
  });
});
