import { WorkItemStateEnum, WorkItemStateType } from "../enums/work-item.enum";

export type WorkflowAction =
  | "claim"
  | "release"
  | "request_approval"
  | "resolve"
  | "approve"
  | "reject"
  | "close"
  | "reopen"
  | "cancel";

export interface WorkflowActorContext {
  userId: string;
  workspaceRole: "OWNER" | "ADMIN" | "MEMBER";
  teamRole?: "member" | "lead" | null;
  isTeamMember: boolean;
}

export interface WorkItemStateInfo {
  _id: string;
  state: WorkItemStateType;
  ownerId?: string | null;
  requesterId?: string;
  approverId?: string | null;
  requiresApproval?: boolean;
  teamId?: string;
}

export interface TransitionRule {
  action: WorkflowAction;
  fromStates: WorkItemStateType[];
  toState: WorkItemStateType;
  description: string;
  checkRole: (actor: WorkflowActorContext, item: WorkItemStateInfo) => { allowed: boolean; reason?: string };
  checkPreconditions: (item: WorkItemStateInfo, payload?: any) => { ok: boolean; reason?: string };
}

export const WORKFLOW_TRANSITIONS: Record<WorkflowAction, TransitionRule> = {
  claim: {
    action: "claim",
    fromStates: [WorkItemStateEnum.OPEN],
    toState: WorkItemStateEnum.IN_PROGRESS,
    description: "Claim an unowned work item",
    checkRole: (actor) => {
      const allowed = actor.isTeamMember || actor.workspaceRole === "ADMIN" || actor.workspaceRole === "OWNER";
      return allowed
        ? { allowed: true }
        : { allowed: false, reason: "Must be a member of the item's team to claim work" };
    },
    checkPreconditions: (item) => {
      if (item.ownerId) {
        return { ok: false, reason: "Item is already owned by a user" };
      }
      return { ok: true };
    },
  },

  release: {
    action: "release",
    fromStates: [WorkItemStateEnum.IN_PROGRESS],
    toState: WorkItemStateEnum.OPEN,
    description: "Release ownership back to unassigned queue",
    checkRole: (actor, item) => {
      const isOwner = !!(item.ownerId && item.ownerId.toString() === actor.userId);
      const isLead = actor.teamRole === "lead";
      const isAdmin = actor.workspaceRole === "ADMIN" || actor.workspaceRole === "OWNER";
      const allowed = isOwner || isLead || isAdmin;
      return allowed
        ? { allowed: true }
        : { allowed: false, reason: "Only the item owner, team lead, or workspace admin may release ownership" };
    },
    checkPreconditions: () => ({ ok: true }),
  },

  request_approval: {
    action: "request_approval",
    fromStates: [WorkItemStateEnum.IN_PROGRESS],
    toState: WorkItemStateEnum.PENDING_APPROVAL,
    description: "Submit in-progress item for sign-off",
    checkRole: (actor, item) => {
      const isOwner = !!(item.ownerId && item.ownerId.toString() === actor.userId);
      const isLead = actor.teamRole === "lead";
      const isAdmin = actor.workspaceRole === "ADMIN" || actor.workspaceRole === "OWNER";
      const allowed = isOwner || isLead || isAdmin;
      return allowed
        ? { allowed: true }
        : { allowed: false, reason: "Only the owner, team lead, or admin may request approval" };
    },
    checkPreconditions: (item, payload) => {
      const hasApprover = !!(item.approverId || (payload && payload.approverId));
      if (!hasApprover) {
        return { ok: false, reason: "An approver must be designated before requesting approval" };
      }
      if (!item.requiresApproval && !(payload && payload.requiresApproval)) {
        return { ok: false, reason: "Item is not configured to require approval" };
      }
      return { ok: true };
    },
  },

  resolve: {
    action: "resolve",
    fromStates: [WorkItemStateEnum.IN_PROGRESS],
    toState: WorkItemStateEnum.RESOLVED,
    description: "Resolve an item directly without approval gate",
    checkRole: (actor, item) => {
      const isOwner = !!(item.ownerId && item.ownerId.toString() === actor.userId);
      const isLead = actor.teamRole === "lead";
      const isAdmin = actor.workspaceRole === "ADMIN" || actor.workspaceRole === "OWNER";
      const allowed = isOwner || isLead || isAdmin;
      return allowed
        ? { allowed: true }
        : { allowed: false, reason: "Only the item owner, team lead, or admin may resolve an item" };
    },
    checkPreconditions: (item, payload) => {
      if (item.requiresApproval) {
        return {
          ok: false,
          reason: "Items requiring approval cannot be resolved directly; they must pass through approval",
        };
      }
      const note = payload?.resolutionNote || payload?.note;
      if (!note || typeof note !== "string" || note.trim().length === 0) {
        return { ok: false, reason: "A resolution note is required to resolve an item" };
      }
      return { ok: true };
    },
  },

  approve: {
    action: "approve",
    fromStates: [WorkItemStateEnum.PENDING_APPROVAL],
    toState: WorkItemStateEnum.RESOLVED,
    description: "Approve a pending approval request",
    checkRole: (actor, item) => {
      // Must be the designated approver
      if (!item.approverId || item.approverId.toString() !== actor.userId) {
        return { allowed: false, reason: "Only the designated approver may approve this item" };
      }
      // Separation of duties: Approver is neither owner nor requester
      if (item.ownerId && item.ownerId.toString() === actor.userId) {
        return { allowed: false, reason: "Self-approval is forbidden: the owner cannot approve their own item" };
      }
      if (item.requesterId && item.requesterId.toString() === actor.userId) {
        return { allowed: false, reason: "Self-approval is forbidden: the requester cannot approve their own item" };
      }
      return { allowed: true };
    },
    checkPreconditions: () => ({ ok: true }),
  },

  reject: {
    action: "reject",
    fromStates: [WorkItemStateEnum.PENDING_APPROVAL],
    toState: WorkItemStateEnum.IN_PROGRESS,
    description: "Reject an approval request and send back for revision",
    checkRole: (actor, item) => {
      if (!item.approverId || item.approverId.toString() !== actor.userId) {
        return { allowed: false, reason: "Only the designated approver may reject this item" };
      }
      return { allowed: true };
    },
    checkPreconditions: (_item, payload) => {
      const comment = payload?.comment || payload?.reason;
      if (!comment || typeof comment !== "string" || comment.trim().length === 0) {
        return { ok: false, reason: "A reason or comment is required when rejecting an item" };
      }
      return { ok: true };
    },
  },

  close: {
    action: "close",
    fromStates: [WorkItemStateEnum.RESOLVED],
    toState: WorkItemStateEnum.CLOSED,
    description: "Close a resolved item",
    checkRole: (actor, item) => {
      const isOwner = !!(item.ownerId && item.ownerId.toString() === actor.userId);
      const isLead = actor.teamRole === "lead";
      const isAdmin = actor.workspaceRole === "ADMIN" || actor.workspaceRole === "OWNER";
      const allowed = isOwner || isLead || isAdmin;
      return allowed
        ? { allowed: true }
        : { allowed: false, reason: "Only the owner, team lead, or admin may close a resolved item" };
    },
    checkPreconditions: () => ({ ok: true }),
  },

  reopen: {
    action: "reopen",
    fromStates: [WorkItemStateEnum.RESOLVED],
    toState: WorkItemStateEnum.IN_PROGRESS,
    description: "Reopen a resolved item for further action",
    checkRole: (actor, item) => {
      const isLead = actor.teamRole === "lead";
      const isRequester = !!(item.requesterId && item.requesterId.toString() === actor.userId);
      const isAdmin = actor.workspaceRole === "ADMIN" || actor.workspaceRole === "OWNER";
      const allowed = isLead || isRequester || isAdmin;
      return allowed
        ? { allowed: true }
        : { allowed: false, reason: "Only a team lead, the original requester, or an admin may reopen an item" };
    },
    checkPreconditions: (_item, payload) => {
      const reason = payload?.reason || payload?.comment;
      if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
        return { ok: false, reason: "A reason is required to reopen an item" };
      }
      return { ok: true };
    },
  },

  cancel: {
    action: "cancel",
    fromStates: [
      WorkItemStateEnum.OPEN,
      WorkItemStateEnum.IN_PROGRESS,
      WorkItemStateEnum.PENDING_APPROVAL,
    ],
    toState: WorkItemStateEnum.CLOSED,
    description: "Cancel an open or in-progress item",
    checkRole: (actor) => {
      const isLead = actor.teamRole === "lead";
      const isAdmin = actor.workspaceRole === "ADMIN" || actor.workspaceRole === "OWNER";
      const allowed = isLead || isAdmin;
      return allowed
        ? { allowed: true }
        : { allowed: false, reason: "Only a team lead or workspace admin may cancel an item" };
    },
    checkPreconditions: (_item, payload) => {
      const reason = payload?.reason || payload?.comment;
      if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
        return { ok: false, reason: "A reason is required to cancel an item" };
      }
      return { ok: true };
    },
  },
};

/**
 * Pure function: computes the list of actions currently allowed on an item for a given actor.
 */
export function computeAllowedActions(
  actor: WorkflowActorContext,
  item: WorkItemStateInfo
): WorkflowAction[] {
  const allowed: WorkflowAction[] = [];

  for (const actionKey of Object.keys(WORKFLOW_TRANSITIONS) as WorkflowAction[]) {
    const rule = WORKFLOW_TRANSITIONS[actionKey];

    // 1. Must be in a valid 'from' state
    if (!rule.fromStates.includes(item.state)) {
      continue;
    }

    // 2. Actor must satisfy role requirements
    const roleCheck = rule.checkRole(actor, item);
    if (!roleCheck.allowed) {
      continue;
    }

    // 3. Check preconditions (without runtime payload where possible)
    if (actionKey === "claim" && item.ownerId) {
      continue;
    }
    if (actionKey === "request_approval" && (!item.requiresApproval || !item.approverId)) {
      continue;
    }
    if (actionKey === "resolve" && item.requiresApproval) {
      continue;
    }

    allowed.push(actionKey);
  }

  return allowed;
}
