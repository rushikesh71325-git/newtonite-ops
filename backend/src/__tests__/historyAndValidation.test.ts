import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import app from "../index";
import WorkItemModel from "../models/workItem.model";
import ItemEventModel from "../models/itemEvent.model";
import {
  setupTestDatabase,
  teardownTestDatabase,
  seedTestContext,
  SeededTestContext,
} from "./testHelper";

describe("Soft Delete, History Detail & Validation Tests (T14-T17, T21)", () => {
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
   * T14: Soft delete keeps history:
   * After delete, timeline still has all events plus DELETED.
   * The item is hidden from lists, search, and all 5 attention queues.
   * Non-admin gets 404. Admin can read timeline.
   */
  it("T14 [Soft Delete & Timeline Preservation]: Admin can read timeline with DELETED event; hidden from lists/attention; non-admin gets 404", async () => {
    // 1. Create item
    const item = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.teamAMember.id,
      title: "Item to be soft deleted",
      description: "Full history should persist",
      requestType: "incident",
      priority: "HIGH",
      state: "OPEN",
      ownerId: null,
      version: 1,
    });

    // 2. Claim item
    await request(app)
      .post(`/api/items/${item.id}/claim`)
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 1 });

    // 3. Add comment
    await request(app)
      .post(`/api/items/${item.id}/comments`)
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ text: "Progress comment before soft deletion" });

    // 4. Admin deletes item
    const deleteRes = await request(app)
      .delete(`/api/items/${item.id}`)
      .set("x-test-user-id", ctx.admin.id)
      .set("x-workspace-id", ctx.workspace.id);
    expect(deleteRes.status).toBe(200);

    // 5. Timeline access check:
    // Admin CAN read the timeline of the deleted item
    const adminTimelineRes = await request(app)
      .get(`/api/items/${item.id}/events`)
      .set("x-test-user-id", ctx.admin.id)
      .set("x-workspace-id", ctx.workspace.id);
    expect(adminTimelineRes.status).toBe(200);
    const eventTypes = adminTimelineRes.body.events.map((e: any) => e.type);
    expect(eventTypes).toContain("deleted");
    expect(eventTypes).toContain("claimed");
    expect(eventTypes).toContain("comment_added");

    // Non-admin gets 404 on timeline
    const memberTimelineRes = await request(app)
      .get(`/api/items/${item.id}/events`)
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id);
    expect(memberTimelineRes.status).toBe(404);

    // Non-admin gets 404 on item fetch
    const memberGetRes = await request(app)
      .get(`/api/items/${item.id}`)
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id);
    expect(memberGetRes.status).toBe(404);

    // 6. Hidden from lists
    const listRes = await request(app)
      .get("/api/items")
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id);
    expect(listRes.status).toBe(200);
    const listedIds = listRes.body.items.map((i: any) => i._id.toString());
    expect(listedIds).not.toContain(item.id);

    // 7. Hidden from search
    const searchRes = await request(app)
      .get("/api/items?search=soft+deleted")
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id);
    expect(searchRes.status).toBe(200);
    const searchIds = searchRes.body.items.map((i: any) => i._id.toString());
    expect(searchIds).not.toContain(item.id);

    // 8. Hidden from all 5 attention queues
    const attentionRes = await request(app)
      .get("/api/items/attention")
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id);
    expect(attentionRes.status).toBe(200);
    const {
      waitingApproval,
      mineOverdue,
      unassignedUrgent,
      stale,
      changedSinceLastSeen,
    } = attentionRes.body;
    const allAttentionIds = [
      ...(waitingApproval || []),
      ...(mineOverdue || []),
      ...(unassignedUrgent || []),
      ...(stale || []),
      ...(changedSinceLastSeen || []),
    ].map((i: any) => i._id.toString());
    expect(allAttentionIds).not.toContain(item.id);
  });

  /**
   * T15: Every mutation on a deleted item returns 404
   */
  it("T15 [Deleted Item Mutations]: Claim, transition, edit, reassign, comment all return 404 on deleted item", async () => {
    // 1. Create and delete item
    const item = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.teamAMember.id,
      title: "Item for Mutation Guard",
      requestType: "incident",
      priority: "HIGH",
      state: "IN_PROGRESS",
      ownerId: ctx.teamAMember.id,
      version: 1,
      deletedAt: new Date(),
    });

    // Claim -> 404
    const claimRes = await request(app)
      .post(`/api/items/${item.id}/claim`)
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 1 });
    expect(claimRes.status).toBe(404);

    // Transition -> 404
    const transitionRes = await request(app)
      .post(`/api/items/${item.id}/transition`)
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ action: "resolve", expectedVersion: 1, resolutionNote: "Testing" });
    expect(transitionRes.status).toBe(404);

    // Edit fields -> 404
    const editRes = await request(app)
      .patch(`/api/items/${item.id}`)
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 1, title: "New title on deleted" });
    expect(editRes.status).toBe(404);

    // Reassign -> 404
    const reassignRes = await request(app)
      .post(`/api/items/${item.id}/reassign`)
      .set("x-test-user-id", ctx.admin.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 1, newOwnerId: ctx.teamALead.id });
    expect(reassignRes.status).toBe(404);

    // Comment -> 404
    const commentRes = await request(app)
      .post(`/api/items/${item.id}/comments`)
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ text: "Comment on deleted" });
    expect(commentRes.status).toBe(404);
  });

  /**
   * T16: Closed or resolved items reject field edits with 400
   */
  it("T16 [Field Edit State Guard]: Closed and resolved items reject field edits with 400", async () => {
    // 1. Resolved item
    const resolvedItem = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.teamAMember.id,
      ownerId: ctx.teamAMember.id,
      title: "Resolved Item",
      requestType: "incident",
      state: "RESOLVED",
      resolutionNote: "Fixed in production",
      version: 1,
    });

    const editResolved = await request(app)
      .patch(`/api/items/${resolvedItem.id}`)
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 1, title: "Attempt edit on resolved" });
    expect(editResolved.status).toBe(400);

    // 2. Closed item
    const closedItem = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.teamAMember.id,
      ownerId: ctx.teamAMember.id,
      title: "Closed Item",
      requestType: "incident",
      state: "CLOSED",
      version: 1,
    });

    const editClosed = await request(app)
      .patch(`/api/items/${closedItem.id}`)
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 1, title: "Attempt edit on closed" });
    expect(editClosed.status).toBe(400);
  });

  /**
   * T17: FIELDS_CHANGED event stores before and after for both fields; no-op edit creates no event
   */
  it("T17 [Audit Trail Diff]: FIELDS_CHANGED stores before/after diffs; no-op edit creates no event", async () => {
    const item = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.teamAMember.id,
      ownerId: ctx.teamAMember.id,
      title: "Original Title",
      description: "Original Description",
      requestType: "task",
      priority: "MEDIUM",
      state: "IN_PROGRESS",
      version: 1,
    });

    // 1. Edit both title and description
    const editRes = await request(app)
      .patch(`/api/items/${item.id}`)
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({
        expectedVersion: 1,
        title: "Updated Title",
        description: "Updated Description",
      });
    expect(editRes.status).toBe(200);

    // Verify event in database
    const fieldEvent = await ItemEventModel.findOne({
      itemId: item.id,
      type: "fields_changed",
    });
    expect(fieldEvent).not.toBeNull();
    expect(fieldEvent?.payload.changes.title).toEqual({
      before: "Original Title",
      after: "Updated Title",
    });
    expect(fieldEvent?.payload.changes.description).toEqual({
      before: "Original Description",
      after: "Updated Description",
    });

    const eventsCountBefore = await ItemEventModel.countDocuments({
      itemId: item.id,
    });

    // 2. No-op edit: sending exact same title and description
    const noopRes = await request(app)
      .patch(`/api/items/${item.id}`)
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({
        expectedVersion: 2,
        title: "Updated Title",
        description: "Updated Description",
      });
    expect(noopRes.status).toBe(200);

    // Verify no new event was created
    const eventsCountAfter = await ItemEventModel.countDocuments({
      itemId: item.id,
    });
    expect(eventsCountAfter).toBe(eventsCountBefore);
    expect(noopRes.body.item.version).toBe(2);
  });

  /**
   * T21: Bad query values return 400, not 500
   */
  it("T21 [Query Validation]: Invalid teamId, date, or state returns 400 with VALIDATION_ERROR, not 500", async () => {
    // 1. Bad teamId (not a valid ObjectId)
    const badTeamRes = await request(app)
      .get("/api/items?teamId=invalid-non-hex-id")
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id);
    expect(badTeamRes.status).toBe(400);
    expect(badTeamRes.body.errorCode).toBe("VALIDATION_ERROR");

    // 2. Malformed date
    const badDateRes = await request(app)
      .get("/api/items?dueBefore=not-a-valid-iso-date")
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id);
    expect(badDateRes.status).toBe(400);
    expect(badDateRes.body.errorCode).toBe("VALIDATION_ERROR");

    // 3. Unknown state
    const badStateRes = await request(app)
      .get("/api/items?state=NON_EXISTENT_STATE")
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id);
    expect(badStateRes.status).toBe(400);
    expect(badStateRes.body.errorCode).toBe("VALIDATION_ERROR");

    // 4. Unknown priority
    const badPriorityRes = await request(app)
      .get("/api/items?priority=INVALID_PRIORITY")
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id);
    expect(badPriorityRes.status).toBe(400);
    expect(badPriorityRes.body.errorCode).toBe("VALIDATION_ERROR");
  });
});
