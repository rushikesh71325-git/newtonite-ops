import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import app from "../index";
import WorkItemModel from "../models/workItem.model";
import TeamModel from "../models/team.model";
import TeamMemberModel from "../models/teamMember.model";
import ItemEventModel from "../models/itemEvent.model";
import {
  setupTestDatabase,
  teardownTestDatabase,
  seedTestContext,
  SeededTestContext,
} from "./testHelper";

describe("Phase 7: Authorization, Resource Scoping & Mass Assignment", () => {
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
   * Test 7: Resource-Level Access & Scoping
   * - User in Team B reads, edits, claims, comments on Team A item -> 403
   * - User in another workspace does the same -> 404 on every endpoint (existence hiding)
   * - List query filters strictly to user's assigned teams
   */
  it("Test 7 [Resource-Level Access]: Enforces team scoping (403), cross-tenant existence hiding (404), and team query isolation", async () => {
    // 1. Create an item in Team A
    const itemA = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.owner.id,
      title: "Team A Confidential Work Item",
      requestType: "incident",
      priority: "HIGH",
      state: "OPEN",
      ownerId: null,
      version: 1,
    });

    // 2. Create an item in Team B
    const itemB = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamB.id,
      requesterId: ctx.owner.id,
      title: "Team B Operational Work Item",
      requestType: "task",
      priority: "LOW",
      state: "OPEN",
      ownerId: null,
      version: 1,
    });

    // 3. User in Team B attempts to access Team A's item -> Strictly 404 (existence hiding across teams):
    // 3a. Read Team A item
    const readRes = await request(app)
      .get(`/api/items/${itemA.id}`)
      .set("x-test-user-id", ctx.teamBMember.id)
      .set("x-workspace-id", ctx.workspace.id);
    expect(readRes.status).toBe(404);

    // 3b. Claim Team A item
    const claimRes = await request(app)
      .post(`/api/items/${itemA.id}/claim`)
      .set("x-test-user-id", ctx.teamBMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 1 });
    expect(claimRes.status).toBe(404);

    // 3c. Edit Team A item
    const editRes = await request(app)
      .patch(`/api/items/${itemA.id}`)
      .set("x-test-user-id", ctx.teamBMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 1, title: "Hacked Title" });
    expect(editRes.status).toBe(404);

    // 3d. Comment on Team A item
    const commentRes = await request(app)
      .post(`/api/items/${itemA.id}/comments`)
      .set("x-test-user-id", ctx.teamBMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ text: "Unauthorized comment" });
    expect(commentRes.status).toBe(404);

    // 4. User in Foreign Workspace attempts to access Acme items -> Strictly 404 (existence hiding)
    const foreignRead = await request(app)
      .get(`/api/items/${itemA.id}`)
      .set("x-test-user-id", ctx.foreignUser.id)
      .set("x-workspace-id", ctx.foreignWorkspace.id);
    expect(foreignRead.status).toBe(404);

    const foreignClaim = await request(app)
      .post(`/api/items/${itemA.id}/claim`)
      .set("x-test-user-id", ctx.foreignUser.id)
      .set("x-workspace-id", ctx.foreignWorkspace.id)
      .send({ expectedVersion: 1 });
    expect(foreignClaim.status).toBe(404);

    // 5. Team Scoping in Item Listing:
    // Non-admin Team A member lists items -> should ONLY see itemA, NEVER itemB
    const listRes = await request(app)
      .get("/api/items")
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id);

    expect(listRes.status).toBe(200);
    const returnedIds = listRes.body.items.map((i: any) => i._id);
    expect(returnedIds).toContain(itemA.id);
    expect(returnedIds).not.toContain(itemB.id);
  });

  /**
   * Test 13: Mass Assignment Protection
   * PATCH with ownerId, workspaceId, version, state in body
   * Expected: Unlisted fields rejected or ignored, preventing privilege escalation
   */
  it("Test 13 [Mass Assignment]: Rejects or ignores unauthorized fields (ownerId, workspaceId, version, state) during PATCH", async () => {
    const item = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.owner.id,
      title: "Mass Assignment Test Item",
      description: "Original Description",
      requestType: "task",
      priority: "MEDIUM",
      state: "OPEN",
      ownerId: ctx.teamAMember.id,
      version: 1,
    });

    const maliciousOwnerId = ctx.owner.id;
    const maliciousWorkspaceId = ctx.foreignWorkspace.id;

    // Send forbidden fields inside PATCH body
    const patchRes = await request(app)
      .patch(`/api/items/${item.id}`)
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({
        expectedVersion: 1,
        title: "Legitimate Title Update",
        ownerId: maliciousOwnerId,
        workspaceId: maliciousWorkspaceId,
        version: 999,
        state: "CLOSED",
      });

    // Our updateItemFieldsSchema only whitelists { expectedVersion, title, description, priority, dueDate }
    // Non-whitelisted fields must NOT alter the protected database state
    expect(patchRes.status).toBe(200);

    const reloaded = await WorkItemModel.findById(item.id);
    expect(reloaded?.title).toBe("Legitimate Title Update");
    expect(reloaded?.ownerId?.toString()).toBe(ctx.teamAMember.id); // ownerId was NOT modified to maliciousOwnerId
    expect(reloaded?.workspaceId.toString()).toBe(ctx.workspace.id); // workspaceId was NOT modified
    expect(reloaded?.state).toBe("OPEN"); // state was NOT modified
    expect(reloaded?.version).toBe(2); // version incremented legitimately by 1, NOT 999
  });

  /**
   * T1: Dead jobs scoped to workspace
   */
  it("T1 [Dead Jobs Scoping]: Admin sees only workspace dead jobs, non-admin gets 403", async () => {
    const OutboxJobModel = (await import("../models/outboxJob.model")).default;

    await OutboxJobModel.create({
      type: "notify",
      payload: { workspaceId: ctx.workspace.id, recipientId: ctx.owner.id },
      status: "dead",
      dedupeKey: `dead-job-A-${Date.now()}`,
    });

    await OutboxJobModel.create({
      type: "notify",
      payload: { workspaceId: ctx.foreignWorkspace.id, recipientId: ctx.foreignUser.id },
      status: "dead",
      dedupeKey: `dead-job-B-${Date.now()}`,
    });

    // Plain member gets 403
    const memberRes = await request(app)
      .get("/api/notifications/dead-jobs")
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id);
    expect(memberRes.status).toBe(403);

    // Admin sees only workspace A dead jobs
    const adminRes = await request(app)
      .get("/api/notifications/dead-jobs")
      .set("x-test-user-id", ctx.admin.id)
      .set("x-workspace-id", ctx.workspace.id);
    expect(adminRes.status).toBe(200);
    expect(adminRes.body.deadJobs.length).toBeGreaterThanOrEqual(1);
    for (const job of adminRes.body.deadJobs) {
      expect(job.payload.workspaceId).toBe(ctx.workspace.id);
    }
  });

  /**
   * T2: View recording visibility check
   */
  it("T2 [View Recording Scoping]: User not in item's team gets 404 from POST /items/:id/view and no ItemView is created", async () => {
    const ItemViewModel = (await import("../models/itemView.model")).default;

    const itemA = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.owner.id,
      title: "Team A Private Item",
      requestType: "task",
      priority: "LOW",
      state: "OPEN",
      version: 1,
    });

    const res = await request(app)
      .post(`/api/items/${itemA.id}/view`)
      .set("x-test-user-id", ctx.teamBMember.id)
      .set("x-workspace-id", ctx.workspace.id);
    expect(res.status).toBe(404);

    const view = await ItemViewModel.findOne({
      userId: ctx.teamBMember.id,
      itemId: itemA.id,
    });
    expect(view).toBeNull();
  });

  /**
   * T3: Attention scoping for changed since last seen
   */
  it("T3 [Attention Scoping]: Changed since last seen group never contains other team's items", async () => {
    const ItemViewModel = (await import("../models/itemView.model")).default;

    const itemB = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamB.id,
      requesterId: ctx.owner.id,
      title: "Team B Item",
      requestType: "task",
      priority: "LOW",
      state: "OPEN",
      version: 1,
    });

    // Create an ItemView record for teamAMember on itemB
    await ItemViewModel.create({
      userId: ctx.teamAMember.id,
      itemId: itemB.id,
      workspaceId: ctx.workspace.id,
      lastSeenAt: new Date(Date.now() - 60000),
    });

    // Update itemB activity after lastSeenAt
    await WorkItemModel.updateOne(
      { _id: itemB.id },
      { $set: { lastActivityAt: new Date() } }
    );

    const res = await request(app)
      .get("/api/items/attention")
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id);

    expect(res.status).toBe(200);
    const changedIds = res.body.changedSinceLastSeen.map((i: any) => i._id);
    expect(changedIds).not.toContain(itemB.id);
  });

  /**
   * T4: Reassign validation
   */
  it("T4 [Reassign Validation]: Non-workspace member returns 400, different-team member returns 400", async () => {
    const item = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.owner.id,
      ownerId: ctx.teamAMember.id,
      title: "Item to reassign",
      requestType: "task",
      priority: "MEDIUM",
      state: "IN_PROGRESS",
      version: 1,
    });

    // 1. Non-workspace member -> 400
    const nonMemberRes = await request(app)
      .post(`/api/items/${item.id}/reassign`)
      .set("x-test-user-id", ctx.admin.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 1, newOwnerId: ctx.foreignUser.id });
    expect(nonMemberRes.status).toBe(400);

    // 2. Different-team member -> 400
    const diffTeamRes = await request(app)
      .post(`/api/items/${item.id}/reassign`)
      .set("x-test-user-id", ctx.admin.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 1, newOwnerId: ctx.teamBMember.id });
    expect(diffTeamRes.status).toBe(400);
  });

  /**
   * T5: Approver validation
   */
  it("T5 [Approver Validation]: Non-member approver returns 400; owner or requester as approver returns 400", async () => {
    // 1. Non-member approver on create -> 400
    const nonMemberCreate = await request(app)
      .post("/api/items")
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({
        title: "Approver test 1",
        requestType: "incident",
        teamId: ctx.teamA.id,
        approverId: ctx.foreignUser.id,
        requiresApproval: true,
      });
    expect(nonMemberCreate.status).toBe(400);

    // 2. Requester equal to approver on create -> 400
    const selfApproverCreate = await request(app)
      .post("/api/items")
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({
        title: "Approver test 2",
        requestType: "incident",
        teamId: ctx.teamA.id,
        approverId: ctx.teamAMember.id,
        requiresApproval: true,
      });
    expect(selfApproverCreate.status).toBe(400);

    // 3. Create valid item in IN_PROGRESS
    const validItem = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.teamAMember.id,
      ownerId: ctx.teamAMember.id,
      title: "Approver test 3",
      requestType: "incident",
      priority: "HIGH",
      state: "IN_PROGRESS",
      requiresApproval: true,
      version: 1,
    });

    // Owner as approver in request_approval -> 400
    const ownerApproveReq = await request(app)
      .post(`/api/items/${validItem.id}/transition`)
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({
        action: "request_approval",
        expectedVersion: 1,
        approverId: ctx.teamAMember.id,
      });
    expect(ownerApproveReq.status).toBe(400);
  });

  /**
   * T22: Approver Outside Team Access
   * An approver who belongs to the workspace but NOT to the item's team
   * can view the item (not 404) and approve it when PENDING_APPROVAL.
   */
  it("T22 [Cross-Team Approver Access]: Approver outside the item's team can view and approve the item without 404 or 403", async () => {
    // 1. Create item in Team A with approver in Team B
    const item = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.teamAMember.id,
      ownerId: ctx.teamAMember.id,
      approverId: ctx.teamBMember.id,
      title: "Cross-team approval item",
      requestType: "incident",
      priority: "HIGH",
      state: "PENDING_APPROVAL",
      requiresApproval: true,
      version: 1,
    });

    // 2. Approver in Team B views item -> 200 OK (not 404 existence hiding)
    const viewRes = await request(app)
      .get(`/api/items/${item.id}`)
      .set("x-test-user-id", ctx.teamBMember.id)
      .set("x-workspace-id", ctx.workspace.id);

    expect(viewRes.status).toBe(200);
    expect(viewRes.body.item).toBeDefined();
    expect(viewRes.body.item.allowedActions).toContain("approve");

    // 3. Approver in Team B approves item -> 200 OK
    const approveRes = await request(app)
      .post(`/api/items/${item.id}/approve`)
      .set("x-test-user-id", ctx.teamBMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 1 });

    expect(approveRes.status).toBe(200);
    expect(approveRes.body.item.state).toBe("RESOLVED");
  });

  /**
   * T23: Foreign Team Scoping on Create
   * Admin creating an item with a foreign workspace team ID returns 404.
   */
  it("T23 [Create Team Workspace Scoping]: Admin creating an item with a foreign teamId returns 404", async () => {
    // 1. Create a team belonging to the foreign workspace
    const foreignTeam = await TeamModel.create({
      name: "External Foreign Team",
      workspaceId: ctx.foreignWorkspace.id,
      leadId: ctx.foreignUser.id,
    });

    // 2. Admin in primary workspace attempts to create item with foreign teamId
    const res = await request(app)
      .post("/api/items")
      .set("x-test-user-id", ctx.admin.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({
        title: "Item with foreign team",
        requestType: "task",
        teamId: foreignTeam.id,
      });

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/Target team not found in this workspace/i);
  });

  /**
   * T24: Team Removal Item Release & Audit
   * Removing a member from a team releases their OPEN, IN_PROGRESS, and PENDING_APPROVAL
   * items to OPEN/null and writes RELEASED events in a transaction.
   */
  it("T24 [Team Removal Item Release]: Removing a member from a team releases items and writes RELEASED events", async () => {
    // 1. Create an IN_PROGRESS item and a PENDING_APPROVAL item owned by teamAMember
    const inProgressItem = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.teamAMember.id,
      ownerId: ctx.teamAMember.id,
      title: "Active In-Progress Work",
      requestType: "incident",
      state: "IN_PROGRESS",
      version: 1,
    });

    const pendingItem = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.teamAMember.id,
      ownerId: ctx.teamAMember.id,
      approverId: ctx.teamALead.id,
      title: "Active Pending Approval Work",
      requestType: "incident",
      state: "PENDING_APPROVAL",
      requiresApproval: true,
      version: 1,
    });

    // 2. Admin removes teamAMember from Team A
    const removeRes = await request(app)
      .delete(`/api/teams/${ctx.teamA.id}/members/${ctx.teamAMember.id}`)
      .set("x-test-user-id", ctx.admin.id)
      .set("x-workspace-id", ctx.workspace.id);

    expect(removeRes.status).toBe(200);

    // 3. Both items are now unassigned and state reset to OPEN
    const updatedInProgress = await WorkItemModel.findById(inProgressItem.id);
    expect(updatedInProgress?.ownerId).toBeNull();
    expect(updatedInProgress?.state).toBe("OPEN");
    expect(updatedInProgress?.version).toBe(2);

    const updatedPending = await WorkItemModel.findById(pendingItem.id);
    expect(updatedPending?.ownerId).toBeNull();
    expect(updatedPending?.state).toBe("OPEN");
    expect(updatedPending?.version).toBe(2);

    // 4. Immutable ItemEvents were written for both items
    const events = await ItemEventModel.find({
      itemId: { $in: [inProgressItem.id, pendingItem.id] },
      type: "released",
    });
    expect(events.length).toBe(2);
    expect(events.every((e) => e.payload?.action === "team_member_removed")).toBe(true);
  });
});
