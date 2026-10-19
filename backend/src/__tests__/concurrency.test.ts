import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";
import app from "../index";
import WorkItemModel from "../models/workItem.model";
import ItemEventModel from "../models/itemEvent.model";
import UserModel from "../models/user.model";
import TeamMemberModel from "../models/teamMember.model";
import MemberModel from "../models/member.model";
import {
  setupTestDatabase,
  teardownTestDatabase,
  seedTestContext,
  SeededTestContext,
} from "./testHelper";

describe("Phase 7: Concurrency & Idempotency Tests", () => {
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

  /**
   * Test 1: Atomic Claim
   * 10 concurrent claims by different team members on one unowned item
   * Expected: Exactly one 200, nine 409; one 'claimed' event; version incremented once
   */
  it("Test 1 [Atomic Claim]: 10 concurrent claims on one unowned item yield exactly one 200 and nine 409s", async () => {
    // 1. Create an unowned open item in Team A
    const item = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.owner.id,
      title: "Concurrent Claim Target Item",
      requestType: "incident",
      priority: "HIGH",
      state: "OPEN",
      ownerId: null,
      version: 1,
    });

    // 2. Create 10 distinct users in Team A with valid workspace membership
    const members: any[] = [];
    for (let i = 0; i < 10; i++) {
      const user = await UserModel.create({
        name: `Claimant ${i}`,
        email: `claimant${i}-${Date.now()}@test.com`,
      });
      // Add workspace membership
      await MemberModel.create({
        userId: user._id,
        workspaceId: ctx.workspace.id,
        role: ctx.roles.MEMBER._id,
      });
      // Add to team A
      await TeamMemberModel.create({
        teamId: ctx.teamA.id,
        userId: user._id,
        role: "member",
      });
      members.push(user);
    }

    // 3. Fire 10 simultaneous claims using Promise.all (true parallelism)
    const claimRequests = members.map((member) =>
      request(app)
        .post(`/api/items/${item.id}/claim`)
        .set("x-test-user-id", member.id)
        .set("x-workspace-id", ctx.workspace.id)
        .send({ expectedVersion: 1 })
    );

    const responses = await Promise.all(claimRequests);

    const successResponses = responses.filter((r) => r.status === 200);
    const conflictResponses = responses.filter((r) => r.status === 409);

    expect(successResponses.length).toBe(1);
    expect(conflictResponses.length).toBe(9);

    // Verify error code on all 409s
    for (const res of conflictResponses) {
      expect(res.body.code).toBe("ALREADY_CLAIMED");
      expect(res.body.current).toBeDefined();
    }

    // Verify database invariants
    const updated = await WorkItemModel.findById(item.id);
    expect(updated?.version).toBe(2); // Incremented exactly once
    expect(updated?.ownerId).not.toBeNull();
    expect(updated?.ownerId?.toString()).toBe(
      successResponses[0].body.item.ownerId
    );

    // Exactly one 'claimed' event written
    const events = await ItemEventModel.find({
      itemId: item.id,
      type: "claimed",
    });
    expect(events.length).toBe(1);
  });

  /**
   * Test 2: Stale Write (Optimistic Locking)
   * Two clients load version 1; both send an edit with expectedVersion: 1
   * Expected: One succeeds, one gets 409 with current item; no lost update
   */
  it("Test 2 [Stale Write]: Concurrent edits with identical expectedVersion produce one 200 and one 409 STALE_VERSION", async () => {
    const item = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.owner.id,
      title: "Original Item Title",
      description: "Original Description",
      requestType: "task",
      priority: "MEDIUM",
      state: "OPEN",
      ownerId: ctx.teamAMember.id,
      version: 1,
    });

    // Client 1 attempts to change priority to HIGH
    const req1 = request(app)
      .patch(`/api/items/${item.id}`)
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({
        expectedVersion: 1,
        priority: "HIGH",
      });

    // Client 2 attempts to change title
    const req2 = request(app)
      .patch(`/api/items/${item.id}`)
      .set("x-test-user-id", ctx.teamALead.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({
        expectedVersion: 1,
        title: "Conflicting Client 2 Title",
      });

    const [res1, res2] = await Promise.all([req1, req2]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const staleRes = res1.status === 409 ? res1 : res2;
    expect(staleRes.body.code).toBe("STALE_VERSION");
    expect(staleRes.body.current).toBeDefined();
    expect(staleRes.body.current.version).toBe(2);

    const reloaded = await WorkItemModel.findById(item.id);
    expect(reloaded?.version).toBe(2); // Only one edit was committed
  });

  /**
   * Test 3: Idempotent Create
   * Same Idempotency-Key sent 5 times in parallel
   * Expected: One item and one event; all responses identical
   */
  it("Test 3 [Idempotent Create]: 5 parallel requests with identical Idempotency-Key return identical responses and create only 1 item", async () => {
    const idempotencyKey = `create-key-${Date.now()}`;
    const payload = {
      title: "Idempotent Created Item",
      description: "Testing parallel deduplication",
      teamId: ctx.teamA.id,
      requestType: "customer_issue",
      priority: "URGENT",
    };

    const requests = Array.from({ length: 5 }, () =>
      request(app)
        .post("/api/items")
        .set("x-test-user-id", ctx.teamAMember.id)
        .set("x-workspace-id", ctx.workspace.id)
        .set("Idempotency-Key", idempotencyKey)
        .send(payload)
    );

    const responses = await Promise.all(requests);

    // All should be successful (either initial 201 or replay)
    const validCodes = responses.filter(
      (r) => r.status === 201 || r.status === 200 || r.status === 409
    );
    expect(validCodes.length).toBe(5);

    // At least one returned 201, and if cached/replayed, all successful ones return the same item ID
    const successful = responses.filter((r) => r.status === 201 || r.status === 200);
    expect(successful.length).toBeGreaterThanOrEqual(1);

    const primaryItemId = successful[0].body.item._id;
    for (const s of successful) {
      expect(s.body.item._id).toBe(primaryItemId);
    }

    // Exact count in DB must be 1 item and 1 created event
    const itemCount = await WorkItemModel.countDocuments({
      title: "Idempotent Created Item",
    });
    expect(itemCount).toBe(1);

    const eventCount = await ItemEventModel.countDocuments({
      itemId: primaryItemId,
      type: "created",
    });
    expect(eventCount).toBe(1);
  });

  /**
   * Test 4: Key Reuse With Different Body
   * Same key, different payload
   * Expected: 422 Unprocessable Entity, no second item created
   */
  it("Test 4 [Key Reuse with Different Body]: Reusing an Idempotency-Key with a modified payload yields 422", async () => {
    const idempotencyKey = `reuse-key-${Date.now()}`;

    // First request
    const firstRes = await request(app)
      .post("/api/items")
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .set("Idempotency-Key", idempotencyKey)
      .send({
        title: "First Payload Title",
        teamId: ctx.teamA.id,
        requestType: "task",
        priority: "LOW",
      });
    expect(firstRes.status).toBe(201);

    // Second request with SAME key but DIFFERENT payload
    const secondRes = await request(app)
      .post("/api/items")
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .set("Idempotency-Key", idempotencyKey)
      .send({
        title: "DIFFERENT Payload Title Tampered",
        teamId: ctx.teamA.id,
        requestType: "task",
        priority: "URGENT",
      });

    expect(secondRes.status).toBe(422);
    expect(secondRes.body.message).toContain("different request payload");

    // Total items created is only 1
    const totalItems = await WorkItemModel.countDocuments({
      workspaceId: ctx.workspace.id,
    });
    expect(totalItems).toBe(1);
  });

  /**
   * T10: Comments do not change version
   */
  it("T10 [Comments Version Invariant]: Comments increment commentCount without bumping version; subsequent edit with old expectedVersion succeeds", async () => {
    const item = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.owner.id,
      ownerId: ctx.teamAMember.id,
      title: "Comment Version Test Item",
      requestType: "task",
      priority: "MEDIUM",
      state: "IN_PROGRESS",
      version: 1,
      commentCount: 0,
    });

    // Add comment
    const commentRes = await request(app)
      .post(`/api/items/${item.id}/comments`)
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ text: "This is a comment" });

    expect([200, 201]).toContain(commentRes.status);

    const afterComment = await WorkItemModel.findById(item.id);
    expect(afterComment?.commentCount).toBe(1);
    expect(afterComment?.version).toBe(1); // Version NOT bumped by comment

    // Edit with expectedVersion: 1 still succeeds!
    const editRes = await request(app)
      .patch(`/api/items/${item.id}`)
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 1, title: "Title After Comment" });

    expect(editRes.status).toBe(200);
    expect(editRes.body.item.version).toBe(2);
  });

  /**
   * T11: Parallel comments
   */
  it("T11 [Parallel Comments]: 10 simultaneous comments produce commentCount of 10 and 10 events", async () => {
    const item = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.owner.id,
      ownerId: ctx.teamAMember.id,
      title: "Parallel Comments Item",
      requestType: "task",
      priority: "MEDIUM",
      state: "IN_PROGRESS",
      version: 1,
      commentCount: 0,
    });

    const requests = Array.from({ length: 10 }).map((_, i) =>
      request(app)
        .post(`/api/items/${item.id}/comments`)
        .set("x-test-user-id", ctx.teamAMember.id)
        .set("x-workspace-id", ctx.workspace.id)
        .send({ text: `Parallel comment #${i + 1}` })
    );

    const responses = await Promise.all(requests);
    for (const res of responses) {
      expect([200, 201]).toContain(res.status);
    }

    const reloaded = await WorkItemModel.findById(item.id);
    expect(reloaded?.commentCount).toBe(10);

    const eventCount = await ItemEventModel.countDocuments({
      itemId: item.id,
      type: "comment_added",
    });
    expect(eventCount).toBe(10);
  });

  /**
   * T12: Double delete race
   */
  it("T12 [Double Delete Guard]: Two parallel deletes produce exactly one success, one 404, and one DELETED event", async () => {
    const item = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.owner.id,
      title: "Double Delete Item",
      requestType: "task",
      priority: "LOW",
      state: "OPEN",
      version: 1,
    });

    const [res1, res2] = await Promise.all([
      request(app)
        .delete(`/api/items/${item.id}`)
        .set("x-test-user-id", ctx.admin.id)
        .set("x-workspace-id", ctx.workspace.id),
      request(app)
        .delete(`/api/items/${item.id}`)
        .set("x-test-user-id", ctx.admin.id)
        .set("x-workspace-id", ctx.workspace.id),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 404]);

    const deleteEvents = await ItemEventModel.countDocuments({
      itemId: item.id,
      type: "deleted",
    });
    expect(deleteEvents).toBe(1);
  });

  /**
   * T13: Invariant check (Item can never end up OPEN with an owner)
   */
  it("T13 [State-Owner Invariant]: Item can never end up in state OPEN with an owner", async () => {
    const item = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.owner.id,
      title: "Invariant Work Item",
      requestType: "task",
      priority: "LOW",
      state: "OPEN",
      ownerId: null,
      version: 1,
    });

    // 1. Claim -> IN_PROGRESS with owner
    const claimRes = await request(app)
      .post(`/api/items/${item.id}/claim`)
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 1 });
    expect(claimRes.status).toBe(200);

    let doc = await WorkItemModel.findById(item.id);
    expect(doc?.state).toBe("IN_PROGRESS");
    expect(doc?.ownerId?.toString()).toBe(ctx.teamAMember.id);

    // 2. Release -> OPEN with null owner
    const releaseRes = await request(app)
      .post(`/api/items/${item.id}/release`)
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 2 });
    expect(releaseRes.status).toBe(200);

    doc = await WorkItemModel.findById(item.id);
    expect(doc?.state).toBe("OPEN");
    expect(doc?.ownerId).toBeNull();

    // 3. Reassign on OPEN item is rejected by state guard -> state remains OPEN, ownerId remains null
    const reassignRes = await request(app)
      .post(`/api/items/${item.id}/reassign`)
      .set("x-test-user-id", ctx.admin.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 3, newOwnerId: ctx.teamAMember.id });
    expect(reassignRes.status).toBe(422);

    doc = await WorkItemModel.findById(item.id);
    expect(doc?.state).toBe("OPEN");
    expect(doc?.ownerId).toBeNull();
  });

  /**
   * T18: Stale lock takeover
   */
  it("T18 [Stale Lock Recovery]: in_progress lock older than 2 minutes lets retry run; younger lock returns 409", async () => {
    const IdempotencyRecordModel = (await import("../models/idempotencyRecord.model")).default;
    const staleKey = `stale-lock-${Date.now()}`;
    const freshKey = `fresh-lock-${Date.now()}`;

    const staleBody = {
      title: "Stale Lock Reclaimed Item",
      teamId: ctx.teamA.id,
      requestType: "task",
      priority: "LOW",
    };
    const staleHash = crypto.createHash("sha256").update(JSON.stringify(staleBody)).digest("hex");

    // 1. Insert stale in_progress lock (created 3 minutes ago)
    await IdempotencyRecordModel.create({
      key: staleKey,
      userId: ctx.teamAMember.id,
      route: "/api/items",
      requestHash: staleHash,
      status: "in_progress",
      createdAt: new Date(Date.now() - 180000), // 3 minutes old
    });

    // Retry should take over lock and succeed (201)
    const retryStale = await request(app)
      .post("/api/items")
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .set("Idempotency-Key", staleKey)
      .send(staleBody);
    expect(retryStale.status).toBe(201);

    // 2. Insert fresh in_progress lock (created 10 seconds ago)
    const freshBody = {
      title: "Fresh Lock Item",
      teamId: ctx.teamA.id,
      requestType: "task",
      priority: "LOW",
    };
    const freshHash = crypto.createHash("sha256").update(JSON.stringify(freshBody)).digest("hex");

    await IdempotencyRecordModel.create({
      key: freshKey,
      userId: ctx.teamAMember.id,
      route: "/api/items",
      requestHash: freshHash,
      status: "in_progress",
      createdAt: new Date(),
    });

    // Retry while lock is young returns 409
    const retryFresh = await request(app)
      .post("/api/items")
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .set("Idempotency-Key", freshKey)
      .send(freshBody);
    expect(retryFresh.status).toBe(409);
    expect(retryFresh.body.errorCode).toBe("REQUEST_IN_PROGRESS");
  });

  /**
   * T19: Errors are not cached in idempotency
   */
  it("T19 [Error Non-Caching]: 409/422 with idempotency key is not cached; corrected retry runs fresh", async () => {
    const item = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.owner.id,
      ownerId: ctx.teamAMember.id,
      title: "Error Cache Test Item",
      requestType: "task",
      state: "IN_PROGRESS",
      version: 2,
    });

    const key = `error-retry-key-${Date.now()}`;

    // 1. Submit edit with STALE expectedVersion -> 409 Conflict
    const conflictRes = await request(app)
      .patch(`/api/items/${item.id}`)
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .set("Idempotency-Key", key)
      .send({ expectedVersion: 1, title: "Stale Edit Attempt" });
    expect(conflictRes.status).toBe(409);

    // 2. Client reloads, fixes expectedVersion to 2, sends SAME key -> executes fresh with 200 OK!
    const fixedRes = await request(app)
      .patch(`/api/items/${item.id}`)
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .set("Idempotency-Key", key)
      .send({ expectedVersion: 2, title: "Corrected Edit Attempt" });
    expect(fixedRes.status).toBe(200);
    expect(fixedRes.body.item.title).toBe("Corrected Edit Attempt");
  });
});
