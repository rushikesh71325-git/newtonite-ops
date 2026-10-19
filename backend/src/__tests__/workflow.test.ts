import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import app from "../index";
import WorkItemModel from "../models/workItem.model";
import {
  setupTestDatabase,
  teardownTestDatabase,
  seedTestContext,
  SeededTestContext,
} from "./testHelper";

describe("Phase 7: Workflow Rules & Approval Separation", () => {
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
   * Test 5: Workflow Rules
   * Every illegal transition (for example OPEN directly to RESOLVED) returns 409/422 with allowedActions; legal ones succeed
   */
  it("Test 5 [Workflow Rules]: Blocks illegal transitions with 409 and allowedActions, permits valid state lifecycle", async () => {
    // 1. Create item in OPEN state
    const item = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.owner.id,
      title: "Workflow Lifecycle Target Item",
      requestType: "incident",
      priority: "HIGH",
      state: "OPEN",
      ownerId: null,
      version: 1,
    });

    // 2. Illegal transition: Direct resolve from OPEN (illegal transition)
    const illegalResolveRes = await request(app)
      .post(`/api/items/${item.id}/resolve`)
      .set("x-test-user-id", ctx.teamALead.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({
        expectedVersion: 1,
        resolutionNote: "Attempting illegal resolve",
      });

    expect([409, 422]).toContain(illegalResolveRes.status);
    expect(illegalResolveRes.body.errorCode).toBe("ILLEGAL_TRANSITION");
    expect(illegalResolveRes.body.allowedActions).toBeDefined();
    expect(illegalResolveRes.body.allowedActions).toContain("claim");
    expect(illegalResolveRes.body.allowedActions).not.toContain("resolve");

    // 3. Legal transition: Claim item -> IN_PROGRESS
    const claimRes = await request(app)
      .post(`/api/items/${item.id}/claim`)
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 1 });
    expect(claimRes.status).toBe(200);
    expect(claimRes.body.item.state).toBe("IN_PROGRESS");
    expect(claimRes.body.item.version).toBe(2);

    // 4. Legal transition: Resolve item -> RESOLVED
    const resolveRes = await request(app)
      .post(`/api/items/${item.id}/resolve`)
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({
        expectedVersion: 2,
        resolutionNote: "Fixed root cause successfully",
      });
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.item.state).toBe("RESOLVED");
    expect(resolveRes.body.item.version).toBe(3);

    // 5. Legal transition: Close item -> CLOSED (by team lead)
    const closeRes = await request(app)
      .post(`/api/items/${item.id}/close`)
      .set("x-test-user-id", ctx.teamALead.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 3 });
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.item.state).toBe("CLOSED");
    expect(closeRes.body.item.version).toBe(4);

    // 6. Illegal transition: Cannot resolve a CLOSED item
    const resolveClosedRes = await request(app)
      .post(`/api/items/${item.id}/resolve`)
      .set("x-test-user-id", ctx.teamALead.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 4, resolutionNote: "Illegal resolve on closed" });
    expect([409, 422]).toContain(resolveClosedRes.status);
    expect(resolveClosedRes.body.errorCode).toBe("ILLEGAL_TRANSITION");

    // 7. Conflict: Another team member attempts to claim an already-claimed item
    const claimOtherRes = await request(app)
      .post(`/api/items/${item.id}/claim`)
      .set("x-test-user-id", ctx.teamALead.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 4 });
    expect(claimOtherRes.status).toBe(409);
    expect(claimOtherRes.body.code).toBe("ALREADY_CLAIMED");
  });

  /**
   * Test 6: Approval Separation (Separation of Duties)
   * Owner approves own item; non-approver approves -> 403 in both cases
   * Designated third-party approver approves -> 200
   */
  it("Test 6 [Approval Separation]: Blocks owner self-approval and non-approvers with 403; allows designated approver", async () => {
    // 1. Create item in IN_PROGRESS requiring approval
    const item = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.owner.id,
      ownerId: ctx.teamAMember.id,
      title: "Sensitive Security Patch",
      requestType: "incident",
      priority: "URGENT",
      state: "IN_PROGRESS",
      requiresApproval: true,
      approverId: null,
      version: 1,
    });

    // 2. Setup self-approval scenario: Item with approverId pointing to the owner
    await WorkItemModel.updateOne(
      { _id: item.id },
      {
        $set: {
          state: "PENDING_APPROVAL",
          approverId: ctx.teamAMember.id,
          version: 2,
        },
      }
    );

    // 3. Violation 1: Item owner attempts to self-approve own work -> 403 Forbidden
    const selfApproveRes = await request(app)
      .post(`/api/items/${item.id}/approve`)
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 2 });

    expect(selfApproveRes.status).toBe(403);
    expect(selfApproveRes.body.reason).toContain("cannot approve their own");

    // 4. Violation 2: Non-approver (admin not designated) attempts to approve -> 403 Forbidden
    const unauthApproveRes = await request(app)
      .post(`/api/items/${item.id}/approve`)
      .set("x-test-user-id", ctx.admin.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 2 });

    expect(unauthApproveRes.status).toBe(403);
    expect(unauthApproveRes.body.reason).toContain("designated approver");

    // Violation 3: Unrelated user from another team attempts to approve -> 404 Not Found (B3 team existence-hiding)
    const otherTeamApproveRes = await request(app)
      .post(`/api/items/${item.id}/approve`)
      .set("x-test-user-id", ctx.teamBMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 2 });

    expect(otherTeamApproveRes.status).toBe(404);

    // 5. Valid: Reassign approver to designated Lead (Team A Lead) and approve -> 200 OK
    await WorkItemModel.updateOne(
      { _id: item.id },
      { $set: { approverId: ctx.teamALead.id } }
    );

    const validApproveRes = await request(app)
      .post(`/api/items/${item.id}/approve`)
      .set("x-test-user-id", ctx.teamALead.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 2 });

    expect(validApproveRes.status).toBe(200);
    expect(validApproveRes.body.item.state).toBe("RESOLVED");
    expect(validApproveRes.body.item.version).toBe(3);
  });

  /**
   * T6: Reassign state guard
   */
  it("T6 [Reassign State Guard]: Reassigning OPEN, RESOLVED, CLOSED or deleted is rejected; IN_PROGRESS succeeds with REASSIGNED event", async () => {
    const ItemEventModel = (await import("../models/itemEvent.model")).default;

    // 1. OPEN item -> rejected with 422
    const openItem = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.owner.id,
      title: "Open Item",
      requestType: "task",
      state: "OPEN",
      version: 1,
    });
    const openReassign = await request(app)
      .post(`/api/items/${openItem.id}/reassign`)
      .set("x-test-user-id", ctx.admin.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 1, newOwnerId: ctx.teamAMember.id });
    expect(openReassign.status).toBe(422);

    // 2. RESOLVED item -> rejected with 422
    const resolvedItem = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.owner.id,
      ownerId: ctx.teamAMember.id,
      title: "Resolved Item",
      requestType: "task",
      state: "RESOLVED",
      resolutionNote: "Fixed",
      version: 2,
    });
    const resolvedReassign = await request(app)
      .post(`/api/items/${resolvedItem.id}/reassign`)
      .set("x-test-user-id", ctx.admin.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 2, newOwnerId: ctx.teamALead.id });
    expect(resolvedReassign.status).toBe(422);

    // 3. CLOSED item -> rejected with 422
    const closedItem = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.owner.id,
      title: "Closed Item",
      requestType: "task",
      state: "CLOSED",
      version: 3,
    });
    const closedReassign = await request(app)
      .post(`/api/items/${closedItem.id}/reassign`)
      .set("x-test-user-id", ctx.admin.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 3, newOwnerId: ctx.teamAMember.id });
    expect(closedReassign.status).toBe(422);

    // 4. Deleted item -> rejected with 404
    const deletedItem = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.owner.id,
      title: "Deleted Item",
      requestType: "task",
      state: "IN_PROGRESS",
      deletedAt: new Date(),
      version: 1,
    });
    const deletedReassign = await request(app)
      .post(`/api/items/${deletedItem.id}/reassign`)
      .set("x-test-user-id", ctx.admin.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 1, newOwnerId: ctx.teamAMember.id });
    expect(deletedReassign.status).toBe(404);

    // 5. IN_PROGRESS item -> succeeds and writes REASSIGNED event
    const activeItem = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.owner.id,
      ownerId: ctx.teamAMember.id,
      title: "Active In Progress Item",
      requestType: "task",
      state: "IN_PROGRESS",
      version: 1,
    });
    const validReassign = await request(app)
      .post(`/api/items/${activeItem.id}/reassign`)
      .set("x-test-user-id", ctx.admin.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 1, newOwnerId: ctx.teamALead.id });

    expect(validReassign.status).toBe(200);
    expect(validReassign.body.item.ownerId).toBe(ctx.teamALead.id);

    const event = await ItemEventModel.findOne({
      itemId: activeItem.id,
      type: "reassigned",
    });
    expect(event).not.toBeNull();
    expect(event?.payload.previousOwnerId.toString()).toBe(ctx.teamAMember.id);
    expect(event?.payload.newOwnerId.toString()).toBe(ctx.teamALead.id);
  });

  /**
   * T7: Admin override in PENDING_APPROVAL
   */
  it("T7 [Admin Override]: Admin can cancel item stuck in PENDING_APPROVAL with reason; plain member cannot", async () => {
    const item = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.owner.id,
      ownerId: ctx.teamAMember.id,
      approverId: ctx.teamALead.id,
      title: "Stuck Approval Item",
      requestType: "incident",
      state: "PENDING_APPROVAL",
      requiresApproval: true,
      version: 2,
    });

    // Plain member attempts to cancel -> 403 Forbidden
    const memberCancel = await request(app)
      .post(`/api/items/${item.id}/cancel`)
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 2, reason: "Cancel please" });
    expect(memberCancel.status).toBe(403);

    // Admin attempts to cancel without reason -> 422 Unprocessable
    const noReasonCancel = await request(app)
      .post(`/api/items/${item.id}/cancel`)
      .set("x-test-user-id", ctx.admin.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 2 });
    expect(noReasonCancel.status).toBe(422);

    // Admin cancels with reason -> 200 OK
    const adminCancel = await request(app)
      .post(`/api/items/${item.id}/cancel`)
      .set("x-test-user-id", ctx.admin.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ expectedVersion: 2, reason: "Approver is on leave" });
    expect(adminCancel.status).toBe(200);
    expect(adminCancel.body.item.state).toBe("CLOSED");
  });

  /**
   * T8: requiresApproval cannot be turned off through request-approval payload
   */
  it("T8 [requiresApproval Immutability]: Cannot turn off requiresApproval via request-approval payload", async () => {
    const item = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.owner.id,
      ownerId: ctx.teamAMember.id,
      approverId: ctx.teamALead.id,
      title: "Requires Approval Immutability",
      requestType: "incident",
      state: "IN_PROGRESS",
      requiresApproval: true,
      version: 1,
    });

    const res = await request(app)
      .post(`/api/items/${item.id}/transition`)
      .set("x-test-user-id", ctx.teamAMember.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({
        action: "request_approval",
        expectedVersion: 1,
        approverId: ctx.teamALead.id,
        requiresApproval: false, // Malicious attempt to disable approval requirement
      });

    expect(res.status).toBe(200);
    expect(res.body.item.requiresApproval).toBe(true);

    const reloaded = await WorkItemModel.findById(item.id);
    expect(reloaded?.requiresApproval).toBe(true);
  });

  /**
   * T9: Change team validation, 409 conflict, and TEAM_CHANGED event
   */
  it("T9 [Change Team]: Foreign workspace team returns 404, stale version returns 409, valid emits TEAM_CHANGED", async () => {
    const ItemEventModel = (await import("../models/itemEvent.model")).default;
    const TeamModel = (await import("../models/team.model")).default;

    // Foreign team in another workspace
    const foreignTeam = await TeamModel.create({
      name: "Foreign Team",
      workspaceId: ctx.foreignWorkspace.id,
    });

    const item = await WorkItemModel.create({
      workspaceId: ctx.workspace.id,
      teamId: ctx.teamA.id,
      requesterId: ctx.owner.id,
      ownerId: ctx.teamAMember.id,
      title: "Team Shift Item",
      requestType: "task",
      state: "IN_PROGRESS",
      version: 1,
    });

    // 1. Team from another workspace -> 404
    const foreignTeamRes = await request(app)
      .post(`/api/items/${item.id}/team`)
      .set("x-test-user-id", ctx.admin.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ newTeamId: foreignTeam.id, expectedVersion: 1 });
    expect(foreignTeamRes.status).toBe(404);

    // 2. Stale expectedVersion -> 409
    const staleRes = await request(app)
      .post(`/api/items/${item.id}/team`)
      .set("x-test-user-id", ctx.admin.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ newTeamId: ctx.teamB.id, expectedVersion: 999 });
    expect(staleRes.status).toBe(409);

    // 3. Valid change team -> 200, logs TEAM_CHANGED with before and after
    const validRes = await request(app)
      .post(`/api/items/${item.id}/team`)
      .set("x-test-user-id", ctx.admin.id)
      .set("x-workspace-id", ctx.workspace.id)
      .send({ newTeamId: ctx.teamB.id, expectedVersion: 1 });

    expect(validRes.status).toBe(200);
    expect(validRes.body.item.teamId).toBe(ctx.teamB.id);

    const event = await ItemEventModel.findOne({
      itemId: item.id,
      type: "team_changed",
    });
    expect(event).not.toBeNull();
    expect(event?.payload.previousTeamId).toBe(ctx.teamA.id);
    expect(event?.payload.newTeamId).toBe(ctx.teamB.id);
  });
});
