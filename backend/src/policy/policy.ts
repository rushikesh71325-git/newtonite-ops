import { RoleType } from "../enums/role.enum";
import { TeamMemberRoleType } from "../enums/work-item.enum";

export interface PolicyContext {
  userId: string;
  workspaceId: string;
  workspaceRole: RoleType | string;
  teamRoles: Map<string, TeamMemberRoleType>; // teamId string -> role ('member' | 'lead')
  teamIds: string[];
}

export interface PolicyDecision {
  allow: boolean;
  reason?: string;
}

export type PolicyAction =
  | "view"
  | "create"
  | "claim"
  | "release"
  | "request_approval"
  | "resolve"
  | "edit"
  | "comment"
  | "reassign"
  | "transition"
  | "approve"
  | "reject"
  | "close"
  | "reopen"
  | "cancel"
  | "change_team"
  | "delete";

export function can(
  ctx: PolicyContext,
  action: PolicyAction,
  item?: {
    _id?: any;
    workspaceId?: any;
    teamId?: any;
    ownerId?: any;
    requesterId?: any;
    approverId?: any;
    state?: string;
    requiresApproval?: boolean;
  }
): PolicyDecision {
  const isAdmin =
    ctx.workspaceRole === "ADMIN" || ctx.workspaceRole === "OWNER";

  // Check workspace scoping
  if (item && item.workspaceId) {
    if (item.workspaceId.toString() !== ctx.workspaceId) {
      return {
        allow: false,
        reason: "Access denied: resource belongs to a different workspace",
      };
    }
  }

  const teamIdStr = item?.teamId ? item.teamId.toString() : "";
  const isMemberOfTeam = teamIdStr ? ctx.teamRoles.has(teamIdStr) : false;
  const teamRole = teamIdStr ? ctx.teamRoles.get(teamIdStr) : undefined;
  const isTeamLead = teamRole === "lead";

  const ownerIdStr = item?.ownerId ? item.ownerId.toString() : null;
  const isOwner = !!(ownerIdStr && ownerIdStr === ctx.userId);

  const requesterIdStr = item?.requesterId ? item.requesterId.toString() : null;
  const isRequester = !!(requesterIdStr && requesterIdStr === ctx.userId);

  const approverIdStr = item?.approverId ? item.approverId.toString() : null;
  const isApprover = !!(approverIdStr && approverIdStr === ctx.userId);

  switch (action) {
    case "view": {
      if (isAdmin || isMemberOfTeam || isApprover) {
        return { allow: true };
      }
      return {
        allow: false,
        reason: "You do not have permission to view work items from this team",
      };
    }

    case "create": {
      if (isAdmin || isMemberOfTeam) {
        return { allow: true };
      }
      return {
        allow: false,
        reason: "You can only create items for teams you belong to",
      };
    }

    case "claim": {
      if (!isAdmin && !isMemberOfTeam) {
        return {
          allow: false,
          reason: "You can only claim items from your own team",
        };
      }
      return { allow: true };
    }

    case "release": {
      if (isAdmin || isOwner || isTeamLead) {
        return { allow: true };
      }
      return {
        allow: false,
        reason: "Only the item owner, team lead, or workspace admin may release ownership",
      };
    }

    case "request_approval": {
      if (isAdmin || isOwner || isTeamLead) {
        return { allow: true };
      }
      return {
        allow: false,
        reason: "Only the item owner, team lead, or workspace admin may request approval",
      };
    }

    case "resolve": {
      if (isAdmin || isOwner || isTeamLead) {
        return { allow: true };
      }
      return {
        allow: false,
        reason: "Only the item owner, team lead, or workspace admin may resolve this item",
      };
    }

    case "edit": {
      if (isAdmin || isOwner || isTeamLead) {
        return { allow: true };
      }
      return {
        allow: false,
        reason: "Only the item owner, team lead, or workspace admin may edit this item",
      };
    }

    case "comment": {
      if (isAdmin || isOwner || isTeamLead || isMemberOfTeam || isApprover) {
        return { allow: true };
      }
      return {
        allow: false,
        reason: "Must belong to the item's team, be an approver, or be an admin to comment",
      };
    }

    case "reassign": {
      if (isAdmin || isTeamLead) {
        return { allow: true };
      }
      return {
        allow: false,
        reason: "Only team leads or workspace admins may reassign items",
      };
    }

    case "transition": {
      if (isAdmin || isOwner || isTeamLead) {
        return { allow: true };
      }
      return {
        allow: false,
        reason: "Only the item owner, team lead, or workspace admin may transition this item",
      };
    }

    case "approve": {
      if (!isApprover) {
        return {
          allow: false,
          reason: "Only the designated approver may approve this item",
        };
      }
      // Separation of duties: Approver is neither owner nor requester
      if (isOwner) {
        return {
          allow: false,
          reason: "Self-approval is forbidden: the owner cannot approve their own item",
        };
      }
      if (isRequester) {
        return {
          allow: false,
          reason: "Self-approval is forbidden: the requester cannot approve their own item",
        };
      }
      return { allow: true };
    }

    case "reject": {
      if (!isApprover) {
        return {
          allow: false,
          reason: "Only the designated approver may reject this item",
        };
      }
      return { allow: true };
    }

    case "close": {
      if (isAdmin || isOwner || isTeamLead) {
        return { allow: true };
      }
      return {
        allow: false,
        reason: "Only the owner, team lead, or workspace admin may close this item",
      };
    }

    case "reopen": {
      if (isAdmin || isTeamLead || isRequester) {
        return { allow: true };
      }
      return {
        allow: false,
        reason: "Only a team lead, original requester, or workspace admin may reopen this item",
      };
    }

    case "cancel": {
      if (isAdmin || isTeamLead) {
        return { allow: true };
      }
      return {
        allow: false,
        reason: "Only a team lead or workspace admin may cancel this item",
      };
    }

    case "change_team": {
      if (isAdmin) {
        return { allow: true };
      }
      return {
        allow: false,
        reason: "Only workspace admins may change an item's team",
      };
    }

    case "delete": {
      if (isAdmin) {
        return { allow: true };
      }
      return {
        allow: false,
        reason: "Only workspace admins or owners may delete items",
      };
    }

    default:
      return { allow: false, reason: "Unrecognized policy action" };
  }
}
