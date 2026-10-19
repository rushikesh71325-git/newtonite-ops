import mongoose from "mongoose";
import WorkItemModel, { WorkItemDocument } from "../models/workItem.model";
import ItemEventModel, { ItemEventDocument } from "../models/itemEvent.model";
import OutboxJobModel from "../models/outboxJob.model";
import ItemViewModel from "../models/itemView.model";
import MemberModel from "../models/member.model";
import TeamMemberModel from "../models/teamMember.model";
import TeamModel from "../models/team.model";
import { PolicyContext, can, PolicyAction } from "../policy/policy";
import {
  BadRequestException,
  ConflictError,
  ForbiddenError,
  IllegalTransitionError,
  NotFoundException,
} from "../utils/appError";
import { ErrorCodeEnum } from "../enums/error-code.enum";
import { tx } from "../utils/transaction";
import {
  WorkflowAction,
  WORKFLOW_TRANSITIONS,
  computeAllowedActions,
} from "../workflow/workflow";
import {
  ItemEventTypeEnum,
  ItemEventType,
  WorkItemStateEnum,
} from "../enums/work-item.enum";

function getEventTypeForAction(action: WorkflowAction): ItemEventType {
  switch (action) {
    case "claim":
      return ItemEventTypeEnum.CLAIMED;
    case "release":
      return ItemEventTypeEnum.RELEASED;
    case "request_approval":
      return ItemEventTypeEnum.APPROVAL_REQUESTED;
    case "approve":
      return ItemEventTypeEnum.APPROVED;
    case "reject":
      return ItemEventTypeEnum.REJECTED;
    case "resolve":
    case "close":
    case "reopen":
    case "cancel":
      return ItemEventTypeEnum.STATE_CHANGED;
    default:
      return ItemEventTypeEnum.STATE_CHANGED;
  }
}

function getNotificationRecipients(
  action: WorkflowAction,
  item: WorkItemDocument,
  actorId: string
): string[] {
  const recipients = new Set<string>();

  if (action === "request_approval" && item.approverId) {
    recipients.add(item.approverId.toString());
  } else if (action === "approve" || action === "reject") {
    if (item.ownerId) recipients.add(item.ownerId.toString());
    if (item.requesterId) recipients.add(item.requesterId.toString());
  } else if (
    action === "claim" ||
    action === "release" ||
    action === "resolve" ||
    action === "close"
  ) {
    if (item.requesterId) recipients.add(item.requesterId.toString());
  }

  // Do not notify the actor themselves
  recipients.delete(actorId);
  return Array.from(recipients);
}

function encodeCursor(date: Date, id: any): string {
  return Buffer.from(`${date.toISOString()}|${id.toString()}`).toString("base64");
}

function decodeCursor(cursor: string): { date: Date; id: string } {
  try {
    const raw = Buffer.from(cursor, "base64").toString("utf-8");
    const parts = raw.split("|");
    if (parts.length !== 2) {
      throw new BadRequestException("Invalid pagination cursor format");
    }
    const [dateStr, idStr] = parts;
    const date = new Date(dateStr);
    if (isNaN(date.getTime()) || !mongoose.Types.ObjectId.isValid(idStr)) {
      throw new BadRequestException("Invalid pagination cursor format");
    }
    return { date, id: idStr };
  } catch (err) {
    if (err instanceof BadRequestException) throw err;
    throw new BadRequestException("Invalid pagination cursor format");
  }
}

/**
 * Create a new operational work item transactionally with initial ItemEvent and optional OutboxJob.
 */
export async function createItemService(
  ctx: PolicyContext,
  input: {
    title: string;
    description?: string;
    requestType: any;
    priority?: any;
    teamId: string;
    approverId?: string | null;
    requiresApproval?: boolean;
    dueDate?: any;
  },
  requestId?: string
) {
  // Authorization policy check
  const authDecision = can(ctx, "create", {
    workspaceId: ctx.workspaceId,
    teamId: input.teamId,
  });

  if (!authDecision.allow) {
    throw new ForbiddenError({ reason: authDecision.reason });
  }

  // Validate team exists in this workspace (even for admins)
  if (!mongoose.Types.ObjectId.isValid(input.teamId)) {
    throw new BadRequestException("Invalid teamId");
  }

  const targetTeam = await TeamModel.findOne({
    _id: new mongoose.Types.ObjectId(input.teamId),
    workspaceId: new mongoose.Types.ObjectId(ctx.workspaceId),
  });
  if (!targetTeam) {
    throw new NotFoundException("Target team not found in this workspace");
  }

  // Validate approver if provided (Item 6)
  if (input.approverId) {
    if (!mongoose.Types.ObjectId.isValid(input.approverId)) {
      throw new BadRequestException("Invalid approverId");
    }
    const approverMember = await MemberModel.findOne({
      userId: new mongoose.Types.ObjectId(input.approverId),
      workspaceId: new mongoose.Types.ObjectId(ctx.workspaceId),
    });
    if (!approverMember) {
      throw new BadRequestException("Approver must be a member of this workspace");
    }
    if (input.approverId.toString() === ctx.userId.toString()) {
      throw new BadRequestException("Approver cannot be the requester (self-approval is forbidden)");
    }
  }

  return await tx(async (session) => {
    const itemData: any = {
      workspaceId: new mongoose.Types.ObjectId(ctx.workspaceId),
      teamId: new mongoose.Types.ObjectId(input.teamId),
      title: input.title,
      description: input.description || "",
      requestType: input.requestType,
      priority: input.priority || "MEDIUM",
      state: WorkItemStateEnum.OPEN,
      ownerId: null,
      requesterId: new mongoose.Types.ObjectId(ctx.userId),
      approverId: input.approverId
        ? new mongoose.Types.ObjectId(input.approverId)
        : null,
      requiresApproval: !!input.requiresApproval,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      lastActivityAt: new Date(),
      version: 1,
    };

    const items = (await WorkItemModel.create([itemData], {
      session,
    })) as WorkItemDocument[];
    const item = items[0];

    // Transactional audit event
    const events = (await ItemEventModel.create(
      [
        {
          itemId: item._id,
          workspaceId: item.workspaceId,
          actorId: new mongoose.Types.ObjectId(ctx.userId),
          type: ItemEventTypeEnum.CREATED,
          payload: {
            title: item.title,
            priority: item.priority,
            requestType: item.requestType,
          },
          requestId: requestId || null,
        },
      ],
      { session }
    )) as ItemEventDocument[];

    // If approver designated at creation and requiresApproval is set, queue notification
    if (
      item.requiresApproval &&
      item.approverId &&
      item.approverId.toString() !== ctx.userId
    ) {
      const eventIdStr = (events[0]._id as any).toString();
      const approverIdStr = item.approverId.toString();

      await OutboxJobModel.create(
        [
          {
            type: "notify",
            payload: {
              workspaceId: ctx.workspaceId,
              itemId: (item._id as any).toString(),
              eventId: eventIdStr,
              recipientId: approverIdStr,
              actorId: ctx.userId,
              action: "created",
              title: `New work item requires approval: ${item.title}`,
              message: `Work item '${item.title}' was created and designates you as approver.`,
            },
            status: "pending",
            runAt: new Date(),
            dedupeKey: `${eventIdStr}:${approverIdStr}`,
          },
        ],
        { session }
      );
    }

    return item;
  });
}

/**
 * Find an active work item scoped by workspace, team (unless admin), and soft-deletion.
 * Enforces 404 existence-hiding across teams and deleted items.
 */
async function findActiveItem(
  ctx: PolicyContext,
  itemId: string,
  allowDeletedForAdmin = false
): Promise<WorkItemDocument> {
  if (!mongoose.Types.ObjectId.isValid(itemId)) {
    throw new NotFoundException("Work item not found");
  }

  const isAdmin =
    ctx.workspaceRole === "ADMIN" || ctx.workspaceRole === "OWNER";

  const item = await WorkItemModel.findOne({
    _id: itemId,
    workspaceId: ctx.workspaceId,
  });

  if (!item) {
    throw new NotFoundException("Work item not found");
  }

  const isApprover = !!(item.approverId && item.approverId.toString() === ctx.userId);

  // Cross-team existence hiding: return 404 if not admin, not in this team, and not the designated approver
  if (!isAdmin && !ctx.teamRoles.has(item.teamId.toString()) && !isApprover) {
    throw new NotFoundException("Work item not found");
  }

  // Soft-delete existence hiding
  if (item.deletedAt && (!allowDeletedForAdmin || !isAdmin)) {
    throw new NotFoundException("Work item not found");
  }

  return item;
}

/**
 * Load an item with workspace scoping, policy enforcement, and computed allowedActions.
 */
export async function getItemService(ctx: PolicyContext, itemId: string) {
  const item = await findActiveItem(ctx, itemId, true);

  // Authorization check
  const authDecision = can(ctx, "view", item);
  if (!authDecision.allow) {
    throw new ForbiddenError({ reason: authDecision.reason });
  }

  const actorContext = {
    userId: ctx.userId,
    workspaceRole: ctx.workspaceRole as any,
    teamRole: ctx.teamRoles.get(item.teamId.toString()) || null,
    isTeamMember: ctx.teamRoles.has(item.teamId.toString()),
  };

  const itemStateInfo = {
    _id: (item._id as any).toString(),
    state: item.state,
    ownerId: item.ownerId ? item.ownerId.toString() : null,
    requesterId: item.requesterId.toString(),
    approverId: item.approverId ? item.approverId.toString() : null,
    requiresApproval: item.requiresApproval,
    teamId: item.teamId.toString(),
  };

  const allowedActions = item.deletedAt
    ? []
    : computeAllowedActions(actorContext, itemStateInfo);

  return {
    ...item.toObject(),
    allowedActions,
  };
}

/**
 * Dedicated atomic claim method with conditional update filter:
 * { _id: itemId, workspaceId: ctx.workspaceId, ownerId: null, state: 'OPEN', deletedAt: null }
 */
export async function claimItemService(
  ctx: PolicyContext,
  itemId: string,
  expectedVersion?: number,
  requestId?: string
) {
  const current = await findActiveItem(ctx, itemId);

  // Check version first so stale clients receive 409 conflict (B7)
  if (expectedVersion !== undefined && current.version !== expectedVersion) {
    throw new ConflictError({
      code: ErrorCodeEnum.STALE_VERSION,
      message: "Item was modified by another operation (stale version)",
      current,
    });
  }

  // Check if caller already owns it -> idempotent 200 with allowedActions (B5)
  if (current.ownerId) {
    if (current.ownerId.toString() === ctx.userId) {
      return getItemService(ctx, itemId);
    }
    throw new ConflictError({
      code: ErrorCodeEnum.ALREADY_CLAIMED,
      message: "Item was already claimed by another user",
      current,
    });
  }

  // Authorization policy check
  const authDecision = can(ctx, "claim", current);
  if (!authDecision.allow) {
    throw new ForbiddenError({ reason: authDecision.reason });
  }

  if (current.state !== WorkItemStateEnum.OPEN) {
    const actorContext = {
      userId: ctx.userId,
      workspaceRole: ctx.workspaceRole as any,
      teamRole: ctx.teamRoles.get(current.teamId.toString()) || null,
      isTeamMember: ctx.teamRoles.has(current.teamId.toString()),
    };
    const currentItemInfo = {
      _id: (current._id as any).toString(),
      state: current.state,
      ownerId: null,
      requesterId: current.requesterId.toString(),
      approverId: current.approverId ? current.approverId.toString() : null,
      requiresApproval: current.requiresApproval,
      teamId: current.teamId.toString(),
    };
    throw new IllegalTransitionError({
      message: `Cannot claim item in state '${current.state}'`,
      allowedActions: computeAllowedActions(actorContext, currentItemInfo),
    });
  }

  return await tx(async (session) => {
    const filter: any = {
      _id: itemId,
      workspaceId: ctx.workspaceId,
      ownerId: null,
      state: WorkItemStateEnum.OPEN,
      deletedAt: null,
    };

    if (expectedVersion !== undefined) {
      filter.version = expectedVersion;
    }

    const updated = (await WorkItemModel.findOneAndUpdate(
      filter,
      {
        $set: {
          ownerId: new mongoose.Types.ObjectId(ctx.userId),
          state: WorkItemStateEnum.IN_PROGRESS,
          lastActivityAt: new Date(),
        },
        $inc: { version: 1 },
      },
      { new: true, session }
    )) as WorkItemDocument | null;

    if (!updated) {
      // Race lost or version mismatched: load current state to provide in conflict response
      const fresh = await WorkItemModel.findOne({
        _id: itemId,
        workspaceId: ctx.workspaceId,
      }).session(session);

      if (!fresh || fresh.deletedAt) {
        throw new NotFoundException("Work item not found");
      }

      if (fresh.ownerId) {
        if (fresh.ownerId.toString() === ctx.userId) {
          // Idempotent double click: return consistent shape with allowedActions (B5)
          const actorContext = {
            userId: ctx.userId,
            workspaceRole: ctx.workspaceRole as any,
            teamRole: ctx.teamRoles.get(fresh.teamId.toString()) || null,
            isTeamMember: ctx.teamRoles.has(fresh.teamId.toString()),
          };
          const freshItemInfo = {
            _id: (fresh._id as any).toString(),
            state: fresh.state,
            ownerId: fresh.ownerId.toString(),
            requesterId: fresh.requesterId.toString(),
            approverId: fresh.approverId ? fresh.approverId.toString() : null,
            requiresApproval: fresh.requiresApproval,
            teamId: fresh.teamId.toString(),
          };
          return {
            ...fresh.toObject(),
            allowedActions: computeAllowedActions(actorContext, freshItemInfo),
          };
        }
        throw new ConflictError({
          code: ErrorCodeEnum.ALREADY_CLAIMED,
          message: "Item was already claimed by another user",
          current: fresh,
        });
      }

      throw new ConflictError({
        code: ErrorCodeEnum.STALE_VERSION,
        message: "Item was modified by another operation (stale version)",
        current: fresh,
      });
    }

    // Append claimed event in the same transaction
    const events = (await ItemEventModel.create(
      [
        {
          itemId: updated._id,
          workspaceId: updated.workspaceId,
          actorId: new mongoose.Types.ObjectId(ctx.userId),
          type: ItemEventTypeEnum.CLAIMED,
          from: WorkItemStateEnum.OPEN,
          to: WorkItemStateEnum.IN_PROGRESS,
          payload: { ownerId: ctx.userId },
          requestId: requestId || null,
        },
      ],
      { session }
    )) as ItemEventDocument[];

    // Outbox notification for requester if not the claimant
    if (updated.requesterId && updated.requesterId.toString() !== ctx.userId) {
      const eventIdStr = (events[0]._id as any).toString();
      await OutboxJobModel.create(
        [
          {
            type: "notify",
            payload: {
              workspaceId: updated.workspaceId.toString(),
              itemId: (updated._id as any).toString(),
              eventId: eventIdStr,
              recipientId: updated.requesterId.toString(),
              actorId: ctx.userId,
              action: "claimed",
              title: `Work item claimed: ${updated.title}`,
              message: `Work item '${updated.title}' has been claimed.`,
            },
            status: "pending",
            runAt: new Date(),
            dedupeKey: `${eventIdStr}:${updated.requesterId.toString()}`,
          },
        ],
        { session }
      );
    }

    const actorContext = {
      userId: ctx.userId,
      workspaceRole: ctx.workspaceRole as any,
      teamRole: ctx.teamRoles.get(updated.teamId.toString()) || null,
      isTeamMember: ctx.teamRoles.has(updated.teamId.toString()),
    };
    const updatedStateInfo = {
      _id: (updated._id as any).toString(),
      state: updated.state,
      ownerId: updated.ownerId ? updated.ownerId.toString() : null,
      requesterId: updated.requesterId.toString(),
      approverId: updated.approverId ? updated.approverId.toString() : null,
      requiresApproval: updated.requiresApproval,
      teamId: updated.teamId.toString(),
    };

    return {
      ...updated.toObject(),
      allowedActions: computeAllowedActions(actorContext, updatedStateInfo),
    };
  });
}

/**
 * Execute a workflow transition with atomic guarded update, versioning, event, and outbox job.
 */
export async function transitionItemService(
  ctx: PolicyContext,
  itemId: string,
  input: {
    action: WorkflowAction;
    expectedVersion: number;
    resolutionNote?: string;
    reason?: string;
    comment?: string;
    approverId?: string | null;
    requiresApproval?: boolean;
  },
  requestId?: string
) {
  const rule = WORKFLOW_TRANSITIONS[input.action];
  if (!rule) {
    throw new IllegalTransitionError({
      message: `Unknown workflow action '${input.action}'`,
      allowedActions: [],
    });
  }

  // 1. Initial read with workspace & team scoping (B3, A1)
  const current = await findActiveItem(ctx, itemId);

  // 2. Check version first so stale clients get 409 conflict instead of 403/422 (B7)
  if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
    throw new ConflictError({
      code: ErrorCodeEnum.STALE_VERSION,
      message: "Item was modified by another operation (stale version)",
      current,
    });
  }

  const actorContext = {
    userId: ctx.userId,
    workspaceRole: ctx.workspaceRole as any,
    teamRole: ctx.teamRoles.get(current.teamId.toString()) || null,
    isTeamMember: ctx.teamRoles.has(current.teamId.toString()),
  };

  const currentItemInfo = {
    _id: (current._id as any).toString(),
    state: current.state,
    ownerId: current.ownerId ? current.ownerId.toString() : null,
    requesterId: current.requesterId.toString(),
    approverId: current.approverId ? current.approverId.toString() : null,
    requiresApproval: current.requiresApproval,
    teamId: current.teamId.toString(),
  };

  const allowedActions = computeAllowedActions(actorContext, currentItemInfo);

  // 3. Resource-level authorization
  const authDecision = can(ctx, input.action as PolicyAction, current);
  if (!authDecision.allow) {
    throw new ForbiddenError({ reason: authDecision.reason });
  }

  // 4. Workflow table check: valid from-state
  if (!rule.fromStates.includes(current.state)) {
    throw new IllegalTransitionError({
      message: `Cannot perform action '${input.action}' on item in state '${current.state}'`,
      allowedActions,
    });
  }

  // 5. Precondition check
  const preCheck = rule.checkPreconditions(currentItemInfo, input);
  if (!preCheck.ok) {
    throw new IllegalTransitionError({
      message: preCheck.reason || "Preconditions not met for transition",
      allowedActions,
    });
  }

  // Validate approver when requesting approval (Item 6)
  if (input.action === "request_approval") {
    const targetApproverId =
      input.approverId || (current.approverId ? current.approverId.toString() : null);
    if (!targetApproverId) {
      throw new BadRequestException("An approver must be designated before requesting approval");
    }
    if (!mongoose.Types.ObjectId.isValid(targetApproverId)) {
      throw new BadRequestException("Invalid approverId");
    }
    const approverMember = await MemberModel.findOne({
      userId: new mongoose.Types.ObjectId(targetApproverId),
      workspaceId: new mongoose.Types.ObjectId(ctx.workspaceId),
    });
    if (!approverMember) {
      throw new BadRequestException("Approver must be a member of this workspace");
    }
    if (
      targetApproverId === current.requesterId.toString() ||
      (current.ownerId && targetApproverId === current.ownerId.toString()) ||
      targetApproverId === ctx.userId
    ) {
      throw new BadRequestException("Approver cannot be the item owner or requester (self-approval is forbidden)");
    }
  }

  // 6. Execute guarded atomic update inside transaction
  return await tx(async (session) => {
    const updateSet: any = {
      state: rule.toState,
      lastActivityAt: new Date(),
    };

    if (input.action === "claim") {
      updateSet.ownerId = new mongoose.Types.ObjectId(ctx.userId);
    } else if (input.action === "release") {
      updateSet.ownerId = null;
    } else if (input.action === "request_approval") {
      if (input.approverId) {
        updateSet.approverId = new mongoose.Types.ObjectId(input.approverId);
      }
      if (current.requiresApproval) {
        // Cannot turn off requiresApproval once already required (Item 10)
        updateSet.requiresApproval = true;
      } else if (input.requiresApproval !== undefined) {
        updateSet.requiresApproval = input.requiresApproval;
      }
    } else if (input.action === "resolve") {
      updateSet.resolutionNote = input.resolutionNote || null;
    }

    // Atomic conditional filter with version, valid fromStates, and soft-delete filter
    const filter: any = {
      _id: itemId,
      workspaceId: ctx.workspaceId,
      version: input.expectedVersion,
      state: { $in: rule.fromStates },
      deletedAt: null,
    };

    if (input.action === "claim") {
      filter.ownerId = null;
    }

    const updated = (await WorkItemModel.findOneAndUpdate(
      filter,
      { $set: updateSet, $inc: { version: 1 } },
      { new: true, session }
    )) as WorkItemDocument | null;

    if (!updated) {
      // Guard failed: determine conflict cause
      const fresh = await WorkItemModel.findOne({
        _id: itemId,
        workspaceId: ctx.workspaceId,
      }).session(session);

      if (!fresh || fresh.deletedAt) {
        throw new NotFoundException("Work item not found");
      }

      if (input.action === "claim" && fresh.ownerId) {
        if (fresh.ownerId.toString() === ctx.userId) {
          // Idempotent double-click: return consistent shape with allowedActions (B5)
          const freshItemInfo = {
            _id: (fresh._id as any).toString(),
            state: fresh.state,
            ownerId: fresh.ownerId.toString(),
            requesterId: fresh.requesterId.toString(),
            approverId: fresh.approverId ? fresh.approverId.toString() : null,
            requiresApproval: fresh.requiresApproval,
            teamId: fresh.teamId.toString(),
          };
          return {
            ...fresh.toObject(),
            allowedActions: computeAllowedActions(actorContext, freshItemInfo),
          };
        }
        throw new ConflictError({
          code: ErrorCodeEnum.ALREADY_CLAIMED,
          message: "Item was already claimed by another user",
          current: fresh,
        });
      }

      throw new ConflictError({
        code: ErrorCodeEnum.STALE_VERSION,
        message: "Item was modified by another operation (stale version)",
        current: fresh,
      });
    }

    // Append ItemEvent in the same transaction
    const events = (await ItemEventModel.create(
      [
        {
          itemId: updated._id,
          workspaceId: updated.workspaceId,
          actorId: new mongoose.Types.ObjectId(ctx.userId),
          type: getEventTypeForAction(input.action),
          from: current.state,
          to: updated.state,
          payload: {
            action: input.action,
            resolutionNote: input.resolutionNote,
            reason: input.reason,
            comment: input.comment,
          },
          requestId: requestId || null,
        },
      ],
      { session }
    )) as ItemEventDocument[];

    // Queue outbox job for secondary notification
    const recipients = getNotificationRecipients(
      input.action,
      updated,
      ctx.userId
    );
    for (const recipientId of recipients) {
      const eventIdStr = (events[0]._id as any).toString();
      await OutboxJobModel.create(
        [
          {
            type: "notify",
            payload: {
              workspaceId: updated.workspaceId.toString(),
              itemId: (updated._id as any).toString(),
              eventId: eventIdStr,
              recipientId,
              actorId: ctx.userId,
              action: input.action,
              title: `Item '${updated.title}' updated: ${input.action}`,
              message: `Action '${input.action}' moved item to ${updated.state}`,
            },
            status: "pending",
            runAt: new Date(),
            dedupeKey: `${eventIdStr}:${recipientId}`,
          },
        ],
        { session }
      );
    }

    const updatedStateInfo = {
      _id: (updated._id as any).toString(),
      state: updated.state,
      ownerId: updated.ownerId ? updated.ownerId.toString() : null,
      requesterId: updated.requesterId.toString(),
      approverId: updated.approverId ? updated.approverId.toString() : null,
      requiresApproval: updated.requiresApproval,
      teamId: updated.teamId.toString(),
    };

    return {
      ...updated.toObject(),
      allowedActions: computeAllowedActions(actorContext, updatedStateInfo),
    };
  });
}

/**
 * Optimistic locking field update with strict whitelist and expectedVersion check.
 */
export async function updateItemFieldsService(
  ctx: PolicyContext,
  itemId: string,
  input: {
    expectedVersion: number;
    title?: string;
    description?: string;
    priority?: any;
    dueDate?: any;
  },
  requestId?: string
) {
  const current = await findActiveItem(ctx, itemId);

  // Check version first so stale clients get 409 conflict instead of 403/422 (B7)
  if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
    throw new ConflictError({
      code: ErrorCodeEnum.STALE_VERSION,
      message: "Item was modified by another operation (stale version)",
      current,
    });
  }

  // Reject field edits on CLOSED or RESOLVED items (B2)
  if (
    current.state === WorkItemStateEnum.CLOSED ||
    current.state === WorkItemStateEnum.RESOLVED
  ) {
    throw new BadRequestException(
      `Cannot edit fields of a work item that is ${current.state.toLowerCase()}`
    );
  }

  const authDecision = can(ctx, "edit", current);
  if (!authDecision.allow) {
    throw new ForbiddenError({ reason: authDecision.reason });
  }

  // Strict whitelist of mutable fields & compute field-level before/after diff (B1)
  const setFields: any = {
    lastActivityAt: new Date(),
  };

  const changes: Record<string, { before: any; after: any }> = {};

  if (input.title !== undefined && input.title !== current.title) {
    setFields.title = input.title;
    changes.title = { before: current.title, after: input.title };
  }
  if (input.description !== undefined && input.description !== current.description) {
    setFields.description = input.description;
    changes.description = { before: current.description, after: input.description };
  }
  if (input.priority !== undefined && input.priority !== current.priority) {
    setFields.priority = input.priority;
    changes.priority = { before: current.priority, after: input.priority };
  }
  if (input.dueDate !== undefined) {
    const newDueDate = input.dueDate ? new Date(input.dueDate) : null;
    const oldDueTime = current.dueDate ? new Date(current.dueDate).getTime() : null;
    const newDueTime = newDueDate ? newDueDate.getTime() : null;
    if (oldDueTime !== newDueTime) {
      setFields.dueDate = newDueDate;
      changes.dueDate = { before: current.dueDate, after: newDueDate };
    }
  }

  if (Object.keys(changes).length === 0) {
    const actorContext = {
      userId: ctx.userId,
      workspaceRole: ctx.workspaceRole as any,
      teamRole: ctx.teamRoles.get(current.teamId.toString()) || null,
      isTeamMember: ctx.teamRoles.has(current.teamId.toString()),
    };
    const currentItemInfo = {
      _id: (current._id as any).toString(),
      state: current.state,
      ownerId: current.ownerId ? current.ownerId.toString() : null,
      requesterId: current.requesterId.toString(),
      approverId: current.approverId ? current.approverId.toString() : null,
      requiresApproval: current.requiresApproval,
      teamId: current.teamId.toString(),
    };
    return {
      ...current.toObject(),
      allowedActions: computeAllowedActions(actorContext, currentItemInfo),
    };
  }

  return await tx(async (session) => {
    const updated = (await WorkItemModel.findOneAndUpdate(
      {
        _id: itemId,
        workspaceId: ctx.workspaceId,
        version: input.expectedVersion,
        deletedAt: null,
      },
      {
        $set: setFields,
        $inc: { version: 1 },
      },
      { new: true, session }
    )) as WorkItemDocument | null;

    if (!updated) {
      const fresh = await WorkItemModel.findOne({
        _id: itemId,
        workspaceId: ctx.workspaceId,
      }).session(session);

      if (!fresh || fresh.deletedAt) {
        throw new NotFoundException("Work item not found");
      }

      throw new ConflictError({
        code: ErrorCodeEnum.STALE_VERSION,
        message: "Item was modified by another operation (stale version)",
        current: fresh,
      });
    }

    // Detail audit trail: store before & after per field, and use FIELDS_CHANGED (B1)
    if (Object.keys(changes).length > 0) {
      const isOnlyPriority =
        Object.keys(changes).length === 1 && changes.priority !== undefined;
      const eventType = isOnlyPriority
        ? ItemEventTypeEnum.PRIORITY_CHANGED
        : ItemEventTypeEnum.FIELDS_CHANGED;

      await ItemEventModel.create(
        [
          {
            itemId: updated._id,
            workspaceId: updated.workspaceId,
            actorId: new mongoose.Types.ObjectId(ctx.userId),
            type: eventType,
            payload: {
              changes,
              previousPriority: current.priority,
              newPriority: updated.priority,
            },
            requestId: requestId || null,
          },
        ],
        { session }
      );
    }

    const actorContext = {
      userId: ctx.userId,
      workspaceRole: ctx.workspaceRole as any,
      teamRole: ctx.teamRoles.get(updated.teamId.toString()) || null,
      isTeamMember: ctx.teamRoles.has(updated.teamId.toString()),
    };
    const updatedStateInfo = {
      _id: (updated._id as any).toString(),
      state: updated.state,
      ownerId: updated.ownerId ? updated.ownerId.toString() : null,
      requesterId: updated.requesterId.toString(),
      approverId: updated.approverId ? updated.approverId.toString() : null,
      requiresApproval: updated.requiresApproval,
      teamId: updated.teamId.toString(),
    };

    return {
      ...updated.toObject(),
      allowedActions: computeAllowedActions(actorContext, updatedStateInfo),
    };
  });
}

/**
 * Reassign work item to a new owner with version locking and audit event.
 */
export async function reassignItemService(
  ctx: PolicyContext,
  itemId: string,
  input: {
    expectedVersion: number;
    newOwnerId: string;
  },
  requestId?: string
) {
  if (!mongoose.Types.ObjectId.isValid(input.newOwnerId)) {
    throw new BadRequestException("Invalid newOwnerId");
  }

  const current = await findActiveItem(ctx, itemId);

  // Check version first so stale clients get 409 conflict (B7)
  if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
    throw new ConflictError({
      code: ErrorCodeEnum.STALE_VERSION,
      message: "Item was modified by another operation (stale version)",
      current,
    });
  }

  const actorContext = {
    userId: ctx.userId,
    workspaceRole: ctx.workspaceRole as any,
    teamRole: ctx.teamRoles.get(current.teamId.toString()) || null,
    isTeamMember: ctx.teamRoles.has(current.teamId.toString()),
  };

  const currentItemInfo = {
    _id: (current._id as any).toString(),
    state: current.state,
    ownerId: current.ownerId ? current.ownerId.toString() : null,
    requesterId: current.requesterId.toString(),
    approverId: current.approverId ? current.approverId.toString() : null,
    requiresApproval: current.requiresApproval,
    teamId: current.teamId.toString(),
  };

  // State guard: Only allow reassign in IN_PROGRESS (Item 5)
  if (current.state !== WorkItemStateEnum.IN_PROGRESS) {
    throw new IllegalTransitionError({
      message: `Cannot reassign work item in state '${current.state}'. Reassignment is only permitted in IN_PROGRESS state.`,
      allowedActions: computeAllowedActions(actorContext, currentItemInfo),
    });
  }

  // Validate new owner: must be a workspace member (Item 4)
  const newOwnerMember = await MemberModel.findOne({
    userId: new mongoose.Types.ObjectId(input.newOwnerId),
    workspaceId: new mongoose.Types.ObjectId(ctx.workspaceId),
  }).populate("role");

  if (!newOwnerMember) {
    throw new BadRequestException("New owner must be a member of this workspace");
  }

  // Validate new owner: must belong to the item's team (unless an admin/owner) (Item 4)
  const roleName = (newOwnerMember.role as any)?.name;
  const isTargetAdmin = roleName === "ADMIN" || roleName === "OWNER";
  if (!isTargetAdmin) {
    const isTeamMember = await TeamMemberModel.findOne({
      userId: new mongoose.Types.ObjectId(input.newOwnerId),
      teamId: current.teamId,
    });
    if (!isTeamMember) {
      throw new BadRequestException("New owner must belong to the item's team");
    }
  }

  const authDecision = can(ctx, "reassign", current);
  if (!authDecision.allow) {
    throw new ForbiddenError({ reason: authDecision.reason });
  }

  return await tx(async (session) => {
    const updated = (await WorkItemModel.findOneAndUpdate(
      {
        _id: itemId,
        workspaceId: ctx.workspaceId,
        version: input.expectedVersion,
        state: WorkItemStateEnum.IN_PROGRESS,
        deletedAt: null,
      },
      {
        $set: {
          ownerId: new mongoose.Types.ObjectId(input.newOwnerId),
          lastActivityAt: new Date(),
        },
        $inc: { version: 1 },
      },
      { new: true, session }
    )) as WorkItemDocument | null;

    if (!updated) {
      const fresh = await WorkItemModel.findOne({
        _id: itemId,
        workspaceId: ctx.workspaceId,
      }).session(session);

      if (!fresh || fresh.deletedAt) {
        throw new NotFoundException("Work item not found");
      }

      throw new ConflictError({
        code: ErrorCodeEnum.STALE_VERSION,
        message: "Item was modified by another operation (stale version)",
        current: fresh,
      });
    }

    const events = (await ItemEventModel.create(
      [
        {
          itemId: updated._id,
          workspaceId: updated.workspaceId,
          actorId: new mongoose.Types.ObjectId(ctx.userId),
          type: ItemEventTypeEnum.REASSIGNED,
          payload: {
            previousOwnerId: current.ownerId,
            newOwnerId: input.newOwnerId,
          },
          requestId: requestId || null,
        },
      ],
      { session }
    )) as ItemEventDocument[];

    // Notify new owner via outbox
    if (input.newOwnerId !== ctx.userId) {
      const eventIdStr = (events[0]._id as any).toString();
      await OutboxJobModel.create(
        [
          {
            type: "notify",
            payload: {
              workspaceId: updated.workspaceId.toString(),
              itemId: (updated._id as any).toString(),
              eventId: eventIdStr,
              recipientId: input.newOwnerId,
              actorId: ctx.userId,
              action: "reassigned",
              title: `Item reassigned to you: ${updated.title}`,
              message: `You have been assigned to work item '${updated.title}'.`,
            },
            status: "pending",
            runAt: new Date(),
            dedupeKey: `${eventIdStr}:${input.newOwnerId}`,
          },
        ],
        { session }
      );
    }

    const actorContext = {
      userId: ctx.userId,
      workspaceRole: ctx.workspaceRole as any,
      teamRole: ctx.teamRoles.get(updated.teamId.toString()) || null,
      isTeamMember: ctx.teamRoles.has(updated.teamId.toString()),
    };
    const updatedStateInfo = {
      _id: (updated._id as any).toString(),
      state: updated.state,
      ownerId: updated.ownerId ? updated.ownerId.toString() : null,
      requesterId: updated.requesterId.toString(),
      approverId: updated.approverId ? updated.approverId.toString() : null,
      requiresApproval: updated.requiresApproval,
      teamId: updated.teamId.toString(),
    };

    return {
      ...updated.toObject(),
      allowedActions: computeAllowedActions(actorContext, updatedStateInfo),
    };
  });
}

/**
 * Add a comment to an item as an append-only event, increment commentCount, bump lastActivityAt,
 * and queue outbox notification within one transaction.
 */
export async function addCommentService(
  ctx: PolicyContext,
  itemId: string,
  text: string,
  requestId?: string
) {
  const current = await findActiveItem(ctx, itemId);

  const authDecision = can(ctx, "comment", current);
  if (!authDecision.allow) {
    throw new ForbiddenError({ reason: authDecision.reason });
  }

  return await tx(async (session) => {
    // 1. Bump item activity and commentCount (comments do not bump version - Item 8)
    const updated = (await WorkItemModel.findOneAndUpdate(
      { _id: itemId, workspaceId: ctx.workspaceId, deletedAt: null },
      {
        $set: { lastActivityAt: new Date() },
        $inc: { commentCount: 1 },
      },
      { new: true, session }
    )) as WorkItemDocument;

    if (!updated) {
      throw new NotFoundException("Work item not found");
    }

    // 2. Append comment event
    const events = (await ItemEventModel.create(
      [
        {
          itemId: updated._id,
          workspaceId: updated.workspaceId,
          actorId: new mongoose.Types.ObjectId(ctx.userId),
          type: ItemEventTypeEnum.COMMENT_ADDED,
          payload: { text },
          requestId: requestId || null,
        },
      ],
      { session }
    )) as ItemEventDocument[];

    // 3. Queue outbox notification to owner and approver
    const recipients = new Set<string>();
    if (updated.ownerId) recipients.add(updated.ownerId.toString());
    if (updated.approverId) recipients.add(updated.approverId.toString());
    recipients.delete(ctx.userId);

    for (const recipientId of recipients) {
      const eventIdStr = (events[0]._id as any).toString();
      await OutboxJobModel.create(
        [
          {
            type: "notify",
            payload: {
              workspaceId: updated.workspaceId.toString(),
              itemId: (updated._id as any).toString(),
              eventId: eventIdStr,
              recipientId,
              actorId: ctx.userId,
              action: "comment_added",
              title: `New comment on: ${updated.title}`,
              message: text.length > 80 ? `${text.slice(0, 77)}...` : text,
            },
            status: "pending",
            runAt: new Date(),
            dedupeKey: `${eventIdStr}:${recipientId}`,
          },
        ],
        { session }
      );
    }

    return events[0];
  });
}

/**
 * Cursor-paginated timeline query for an item (newest first).
 */
export async function getItemTimelineService(
  ctx: PolicyContext,
  itemId: string,
  query: { cursor?: string; limit?: number }
) {
  // Scoped view verification (admin can view timeline of soft-deleted items)
  await getItemService(ctx, itemId);

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 50);
  const filter: any = {
    itemId: new mongoose.Types.ObjectId(itemId),
    workspaceId: new mongoose.Types.ObjectId(ctx.workspaceId),
  };

  if (query.cursor) {
    const decoded = decodeCursor(query.cursor);
    filter.$or = [
      { createdAt: { $lt: decoded.date } },
      {
        createdAt: decoded.date,
        _id: { $lt: new mongoose.Types.ObjectId(decoded.id) },
      },
    ];
  }

  // Fetch limit + 1 to detect hasMore
  const events = await ItemEventModel.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .populate("actorId", "name email");

  const hasMore = events.length > limit;
  const returnedEvents = hasMore ? events.slice(0, limit) : events;

  let nextCursor: string | null = null;
  if (hasMore && returnedEvents.length > 0) {
    const lastRow = returnedEvents[returnedEvents.length - 1];
    nextCursor = encodeCursor(lastRow.createdAt, (lastRow._id as any).toString());
  }

  return {
    events: returnedEvents,
    hasMore,
    nextCursor,
  };
}

/**
 * Delete a work item (strictly workspace Admin / Owner only).
 * Performs soft delete and appends DELETED event while preserving all history (A1).
 */
export async function deleteItemService(
  ctx: PolicyContext,
  itemId: string,
  requestId?: string
) {
  const current = await findActiveItem(ctx, itemId);

  const authDecision = can(ctx, "delete", current);
  if (!authDecision.allow) {
    throw new ForbiddenError({ reason: authDecision.reason });
  }

  return await tx(async (session) => {
    // Guard against concurrent delete: atomic conditional update filter (Item 11, T12)
    const updated = await WorkItemModel.findOneAndUpdate(
      {
        _id: itemId,
        workspaceId: ctx.workspaceId,
        deletedAt: null,
      },
      {
        $set: {
          deletedAt: new Date(),
          deletedBy: new mongoose.Types.ObjectId(ctx.userId),
          lastActivityAt: new Date(),
        },
        $inc: { version: 1 },
      },
      { new: true, session }
    );

    if (!updated) {
      throw new NotFoundException("Work item not found");
    }

    // Append DELETED event - do NOT delete historical events (A1)
    await ItemEventModel.create(
      [
        {
          itemId: current._id,
          workspaceId: current.workspaceId,
          actorId: new mongoose.Types.ObjectId(ctx.userId),
          type: ItemEventTypeEnum.DELETED,
          from: current.state,
          to: current.state,
          payload: { action: "delete" },
          requestId: requestId || null,
        },
      ],
      { session }
    );

    return { success: true, message: "Item deleted successfully" };
  });
}

/**
 * Change the team assignment of an item (strictly workspace Admin / Owner only).
 */
export async function changeItemTeamService(
  ctx: PolicyContext,
  itemId: string,
  newTeamId: string,
  expectedVersion?: number,
  requestId?: string
) {
  if (!mongoose.Types.ObjectId.isValid(newTeamId)) {
    throw new BadRequestException("Invalid newTeamId");
  }

  // 1. Require target team to belong to this workspace (Item 9, T9)
  const targetTeam = await TeamModel.findOne({
    _id: new mongoose.Types.ObjectId(newTeamId),
    workspaceId: new mongoose.Types.ObjectId(ctx.workspaceId),
  });
  if (!targetTeam) {
    throw new NotFoundException("Target team not found in this workspace");
  }

  const current = await findActiveItem(ctx, itemId);

  // 2. Check version first for 409 conflict (Item 9, T9)
  if (expectedVersion !== undefined && current.version !== expectedVersion) {
    throw new ConflictError({
      code: ErrorCodeEnum.STALE_VERSION,
      message: "Item was modified by another operation (stale version)",
      current,
    });
  }

  const authDecision = can(ctx, "change_team", current);
  if (!authDecision.allow) {
    throw new ForbiddenError({ reason: authDecision.reason });
  }

  // 3. Check or clear owner if they are not in the new team (Item 9)
  let clearOwner = false;
  if (current.ownerId) {
    const ownerMember = await MemberModel.findOne({
      userId: current.ownerId,
      workspaceId: ctx.workspaceId,
    }).populate("role");

    const roleName = (ownerMember?.role as any)?.name;
    const isOwnerAdmin = roleName === "ADMIN" || roleName === "OWNER";

    if (!isOwnerAdmin) {
      const isMemberOfNewTeam = await TeamMemberModel.findOne({
        userId: current.ownerId,
        teamId: new mongoose.Types.ObjectId(newTeamId),
      });

      if (!isMemberOfNewTeam) {
        clearOwner = true;
      }
    }
  }

  return await tx(async (session) => {
    const filter: any = {
      _id: itemId,
      workspaceId: ctx.workspaceId,
      deletedAt: null,
    };
    if (expectedVersion !== undefined) {
      filter.version = expectedVersion;
    }

    const updateSet: any = {
      teamId: new mongoose.Types.ObjectId(newTeamId),
      lastActivityAt: new Date(),
    };

    if (clearOwner) {
      updateSet.ownerId = null;
      if (current.state === WorkItemStateEnum.IN_PROGRESS) {
        updateSet.state = WorkItemStateEnum.OPEN;
      }
    }

    const updated = (await WorkItemModel.findOneAndUpdate(
      filter,
      {
        $set: updateSet,
        $inc: { version: 1 },
      },
      { new: true, session }
    )) as WorkItemDocument | null;

    if (!updated) {
      const fresh = await WorkItemModel.findOne({
        _id: itemId,
        workspaceId: ctx.workspaceId,
      }).session(session);

      if (!fresh || fresh.deletedAt) {
        throw new NotFoundException("Work item not found");
      }

      throw new ConflictError({
        code: ErrorCodeEnum.STALE_VERSION,
        message: "Item was modified by another operation (stale version)",
        current: fresh,
      });
    }

    // Use new TEAM_CHANGED event with before and after (Item 9, T9)
    await ItemEventModel.create(
      [
        {
          itemId: updated._id,
          workspaceId: updated.workspaceId,
          actorId: new mongoose.Types.ObjectId(ctx.userId),
          type: ItemEventTypeEnum.TEAM_CHANGED,
          payload: {
            previousTeamId: current.teamId.toString(),
            newTeamId: newTeamId.toString(),
            ownerCleared: clearOwner,
          },
          requestId: requestId || null,
        },
      ],
      { session }
    );

    const actorContext = {
      userId: ctx.userId,
      workspaceRole: ctx.workspaceRole as any,
      teamRole: ctx.teamRoles.get(updated.teamId.toString()) || null,
      isTeamMember: ctx.teamRoles.has(updated.teamId.toString()),
    };
    const updatedStateInfo = {
      _id: (updated._id as any).toString(),
      state: updated.state,
      ownerId: updated.ownerId ? updated.ownerId.toString() : null,
      requesterId: updated.requesterId.toString(),
      approverId: updated.approverId ? updated.approverId.toString() : null,
      requiresApproval: updated.requiresApproval,
      teamId: updated.teamId.toString(),
    };

    return {
      ...updated.toObject(),
      allowedActions: computeAllowedActions(actorContext, updatedStateInfo),
    };
  });
}

/**
 * Filtered cursor-paginated work items query matching compound indexes.
 */
export async function listItemsService(
  ctx: PolicyContext,
  query: {
    cursor?: string;
    limit?: number;
    state?: string | string[];
    priority?: string | string[];
    teamId?: string;
    ownerId?: string;
    requesterId?: string;
    requestType?: string | string[];
    dueBefore?: string;
    dueAfter?: string;
    search?: string;
  }
) {
  const isAdmin = ctx.workspaceRole === "ADMIN" || ctx.workspaceRole === "OWNER";
  const filter: any = {
    workspaceId: new mongoose.Types.ObjectId(ctx.workspaceId),
    deletedAt: null,
  };

  // Team scope enforcement
  if (query.teamId) {
    if (!isAdmin && !ctx.teamRoles.has(query.teamId)) {
      return { items: [], hasMore: false, nextCursor: null };
    }
    filter.teamId = new mongoose.Types.ObjectId(query.teamId);
  } else if (!isAdmin) {
    filter.teamId = {
      $in: ctx.teamIds.map((id) => new mongoose.Types.ObjectId(id)),
    };
  }

  // State filter
  if (query.state) {
    const states = Array.isArray(query.state)
      ? query.state
      : query.state.split(",").map((s) => s.trim());
    filter.state = { $in: states };
  }

  // Priority filter
  if (query.priority) {
    const priorities = Array.isArray(query.priority)
      ? query.priority
      : query.priority.split(",").map((p) => p.trim());
    filter.priority = { $in: priorities };
  }

  // Request type filter
  if (query.requestType) {
    const types = Array.isArray(query.requestType)
      ? query.requestType
      : query.requestType.split(",").map((t) => t.trim());
    filter.requestType = { $in: types };
  }

  // Owner filter
  if (query.ownerId) {
    if (query.ownerId === "unassigned") {
      filter.ownerId = null;
    } else if (query.ownerId === "me") {
      filter.ownerId = new mongoose.Types.ObjectId(ctx.userId);
    } else if (mongoose.Types.ObjectId.isValid(query.ownerId)) {
      filter.ownerId = new mongoose.Types.ObjectId(query.ownerId);
    }
  }

  // Requester filter
  if (query.requesterId) {
    if (query.requesterId === "me") {
      filter.requesterId = new mongoose.Types.ObjectId(ctx.userId);
    } else if (mongoose.Types.ObjectId.isValid(query.requesterId)) {
      filter.requesterId = new mongoose.Types.ObjectId(query.requesterId);
    }
  }

  // Due date filters
  if (query.dueBefore || query.dueAfter) {
    filter.dueDate = {};
    if (query.dueBefore) filter.dueDate.$lte = new Date(query.dueBefore);
    if (query.dueAfter) filter.dueDate.$gte = new Date(query.dueAfter);
  }

  // Keyword text search
  if (query.search && query.search.trim().length > 0) {
    filter.$text = { $search: query.search.trim() };
  }

  // Cursor pagination condition
  if (query.cursor) {
    const decoded = decodeCursor(query.cursor);
    filter.$or = [
      { updatedAt: { $lt: decoded.date } },
      {
        updatedAt: decoded.date,
        _id: { $lt: new mongoose.Types.ObjectId(decoded.id) },
      },
    ];
  }

  const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 100);

  const items = await WorkItemModel.find(filter)
    .sort({ updatedAt: -1, _id: -1 })
    .limit(limit + 1)
    .populate("ownerId", "name email")
    .populate("requesterId", "name email")
    .populate("approverId", "name email")
    .populate("teamId", "name");

  const hasMore = items.length > limit;
  const returnedItems = hasMore ? items.slice(0, limit) : items;

  let nextCursor: string | null = null;
  if (hasMore && returnedItems.length > 0) {
    const lastRow = returnedItems[returnedItems.length - 1];
    nextCursor = encodeCursor(lastRow.updatedAt, (lastRow._id as any).toString());
  }

  const itemsWithActions = returnedItems.map((item) => {
    const teamIdStr = item.teamId ? (item.teamId as any)._id?.toString() || item.teamId.toString() : "";
    const actorContext = {
      userId: ctx.userId,
      workspaceRole: ctx.workspaceRole as any,
      teamRole: ctx.teamRoles.get(teamIdStr) || null,
      isTeamMember: ctx.teamRoles.has(teamIdStr),
    };
    const itemStateInfo = {
      _id: (item._id as any).toString(),
      state: item.state,
      ownerId: item.ownerId ? (item.ownerId as any)._id?.toString() || item.ownerId.toString() : null,
      requesterId: item.requesterId ? (item.requesterId as any)._id?.toString() || item.requesterId.toString() : "",
      approverId: item.approverId ? (item.approverId as any)._id?.toString() || item.approverId.toString() : null,
      requiresApproval: item.requiresApproval,
      teamId: teamIdStr,
    };
    return {
      ...item.toObject(),
      allowedActions: computeAllowedActions(actorContext, itemStateInfo),
    };
  });

  return {
    items: itemsWithActions,
    hasMore,
    nextCursor,
  };
}

/**
 * Needs-attention endpoint: runs 5 parallel indexed queries.
 */
export async function getAttentionService(ctx: PolicyContext, staleDays = 3) {
  const isAdmin = ctx.workspaceRole === "ADMIN" || ctx.workspaceRole === "OWNER";
  const now = new Date();
  const staleDate = new Date(now.getTime() - staleDays * 24 * 60 * 60 * 1000);
  const workspaceId = new mongoose.Types.ObjectId(ctx.workspaceId);
  const userObjectId = new mongoose.Types.ObjectId(ctx.userId);

  const teamFilter = isAdmin
    ? {}
    : { teamId: { $in: ctx.teamIds.map((id) => new mongoose.Types.ObjectId(id)) } };

  // 1. Waiting on my approval
  const waitingApprovalPromise = WorkItemModel.find({
    workspaceId,
    approverId: userObjectId,
    state: WorkItemStateEnum.PENDING_APPROVAL,
    deletedAt: null,
  })
    .sort({ updatedAt: -1 })
    .limit(10)
    .populate("ownerId", "name email")
    .populate("requesterId", "name email")
    .populate("teamId", "name");

  // 2. Mine and overdue
  const mineOverduePromise = WorkItemModel.find({
    workspaceId,
    ownerId: userObjectId,
    state: { $nin: [WorkItemStateEnum.RESOLVED, WorkItemStateEnum.CLOSED] },
    dueDate: { $lt: now, $ne: null },
    deletedAt: null,
  })
    .sort({ dueDate: 1 })
    .limit(10)
    .populate("ownerId", "name email")
    .populate("requesterId", "name email")
    .populate("teamId", "name");

  // 3. Unassigned in my teams (URGENT and HIGH first)
  const unassignedUrgentPromise = WorkItemModel.find({
    workspaceId,
    ...teamFilter,
    ownerId: null,
    state: WorkItemStateEnum.OPEN,
    priority: { $in: ["URGENT", "HIGH"] },
    deletedAt: null,
  })
    .sort({ priority: -1, createdAt: 1 })
    .limit(10)
    .populate("requesterId", "name email")
    .populate("teamId", "name");

  // 4. Stale active items
  const stalePromise = WorkItemModel.find({
    workspaceId,
    ...teamFilter,
    state: { $nin: [WorkItemStateEnum.RESOLVED, WorkItemStateEnum.CLOSED] },
    lastActivityAt: { $lt: staleDate },
    deletedAt: null,
  })
    .sort({ lastActivityAt: 1 })
    .limit(10)
    .populate("ownerId", "name email")
    .populate("requesterId", "name email")
    .populate("teamId", "name");

  // 5. Changed since I last looked (via ItemView)
  const itemViewsPromise = ItemViewModel.find({
    userId: userObjectId,
    workspaceId,
  })
    .sort({ lastSeenAt: -1 })
    .limit(50);

  const [
    waitingApprovalDocs,
    mineOverdueDocs,
    unassignedUrgentDocs,
    staleDocs,
    itemViews,
  ] = await Promise.all([
    waitingApprovalPromise,
    mineOverduePromise,
    unassignedUrgentPromise,
    stalePromise,
    itemViewsPromise,
  ]);

  // For changed since last looked:
  let changedSinceLastSeenDocs: any[] = [];
  if (itemViews.length > 0) {
    const viewMap = new Map<string, Date>();
    for (const v of itemViews) {
      viewMap.set(v.itemId.toString(), v.lastSeenAt);
    }
    const viewedItemIds = Array.from(viewMap.keys()).map(
      (id) => new mongoose.Types.ObjectId(id)
    );

    const candidateItems = await WorkItemModel.find({
      _id: { $in: viewedItemIds },
      workspaceId,
      ...teamFilter,
      state: { $nin: [WorkItemStateEnum.CLOSED] },
      deletedAt: null,
    })
      .populate("ownerId", "name email")
      .populate("teamId", "name");

    changedSinceLastSeenDocs = candidateItems
      .filter((item) => {
        const lastSeen = viewMap.get((item._id as any).toString());
        return lastSeen && item.lastActivityAt > lastSeen;
      })
      .slice(0, 10);
  }

  const mapWithActions = (docs: any[], reasonFn: (d: any) => string) =>
    docs.map((item) => {
      const teamIdStr = item.teamId ? (item.teamId as any)._id?.toString() || item.teamId.toString() : "";
      const actorContext = {
        userId: ctx.userId,
        workspaceRole: ctx.workspaceRole as any,
        teamRole: ctx.teamRoles.get(teamIdStr) || null,
        isTeamMember: ctx.teamRoles.has(teamIdStr),
      };
      const itemStateInfo = {
        _id: (item._id as any).toString(),
        state: item.state,
        ownerId: item.ownerId ? (item.ownerId as any)._id?.toString() || item.ownerId.toString() : null,
        requesterId: item.requesterId ? (item.requesterId as any)._id?.toString() || item.requesterId.toString() : "",
        approverId: item.approverId ? (item.approverId as any)._id?.toString() || item.approverId.toString() : null,
        requiresApproval: item.requiresApproval,
        teamId: teamIdStr,
      };
      return {
        ...item.toObject(),
        attentionReason: reasonFn(item),
        allowedActions: computeAllowedActions(actorContext, itemStateInfo),
      };
    });

  return {
    waitingApproval: mapWithActions(
      waitingApprovalDocs,
      () => "Awaiting your approval"
    ),
    mineOverdue: mapWithActions(mineOverdueDocs, (d) => {
      const diffDays = Math.ceil(
        (now.getTime() - new Date(d.dueDate).getTime()) / (1000 * 3600 * 24)
      );
      return `Overdue by ${diffDays} day${diffDays === 1 ? "" : "s"}`;
    }),
    unassignedUrgent: mapWithActions(
      unassignedUrgentDocs,
      (d) => `Unassigned ${d.priority} priority item`
    ),
    stale: mapWithActions(staleDocs, (d) => {
      const diffDays = Math.floor(
        (now.getTime() - new Date(d.lastActivityAt).getTime()) /
          (1000 * 3600 * 24)
      );
      return `Inactive for ${diffDays} day${diffDays === 1 ? "" : "s"}`;
    }),
    changedSinceLastSeen: mapWithActions(
      changedSinceLastSeenDocs,
      () => "Updated since you last reviewed this item"
    ),
  };
}

/**
 * Record user view timestamp on an item.
 */
export async function recordItemViewService(
  ctx: PolicyContext,
  itemId: string
) {
  // Check visibility and access first (throws 404 if hidden, deleted, or other-team)
  await findActiveItem(ctx, itemId);

  await ItemViewModel.findOneAndUpdate(
    {
      userId: new mongoose.Types.ObjectId(ctx.userId),
      itemId: new mongoose.Types.ObjectId(itemId),
      workspaceId: new mongoose.Types.ObjectId(ctx.workspaceId),
    },
    {
      $set: { lastSeenAt: new Date() },
    },
    { upsert: true, new: true }
  );

  return { success: true };
}
