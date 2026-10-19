import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import app from "../index";
import WorkItemModel from "../models/workItem.model";
import ItemEventModel from "../models/itemEvent.model";
import OutboxJobModel from "../models/outboxJob.model";
import {
  setupTestDatabase,
  teardownTestDatabase,
  seedTestContext,
  SeededTestContext,
} from "./testHelper";

describe("Phase 7: Transactional Invariants & Rollback (Plan Section 11)", () => {
  let ctx: SeededTestContext;

  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    ctx = await seedTestContext();
    vi.restoreAllMocks();
  });

  /**
   * Test 8: Transactional History & Outbox Rollback
   * Force the event insert to throw inside tx()
   * Expected: Item unchanged and no event or job (complete rollback)
   */
  it("Test 8 [Transactional History]: Forces ItemEvent insert failure, verifying complete multi-document rollback", async () => {
    // 1. Create target item in OPEN state
    const item = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.owner.id,
      title: "Transactional Rollback Target Item",
      requestType: "incident",
      priority: "HIGH",
      state: "OPEN",
      ownerId: null,
      version: 1,
    });

    // 2. Mock ItemEventModel.create to throw a transient or fatal error during the transaction
    const createSpy = vi
      .spyOn(ItemEventModel, "create")
      .mockImplementationOnce(async () => {
        throw new Error("Simulated database failure during ItemEvent creation");
      });

    // 3. Attempt to claim the item
    const res = await request(app)
      .post(`/api/items/${item.id}/claim`)
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 1 });

    // Expect server to return internal server error due to aborted transaction
    expect(res.status).toBe(500);

    // 4. Verify complete multi-document rollback:
    // 4a. WorkItem must remain completely untouched (version 1, state OPEN, ownerId null)
    const reloadedItem = await WorkItemModel.findById(item.id);
    expect(reloadedItem?.version).toBe(1);
    expect(reloadedItem?.state).toBe("OPEN");
    expect(reloadedItem?.ownerId).toBeNull();

    // 4b. No phantom ItemEvent exists
    const events = await ItemEventModel.find({ itemId: item.id });
    expect(events.length).toBe(0);

    // 4c. No phantom OutboxJob exists
    const jobs = await OutboxJobModel.find({
      "payload.itemId": item.id.toString(),
    });
    expect(jobs.length).toBe(0);

    createSpy.mockRestore();
  });
});
