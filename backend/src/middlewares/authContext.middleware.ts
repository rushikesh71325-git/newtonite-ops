import { Request, Response, NextFunction } from "express";
import TeamModel from "../models/team.model";
import MemberModel from "../models/member.model";
import TeamMemberModel from "../models/teamMember.model";
import { NotFoundException, UnauthorizedException } from "../utils/appError";
import { PolicyContext } from "../policy/policy";
import { TeamMemberRoleType } from "../enums/work-item.enum";

export const requireAuthContext = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      throw new UnauthorizedException("Authentication required");
    }

    // Determine target workspace from header, query, param, or current user workspace
    const workspaceId =
      req.params.workspaceId ||
      (req.headers["x-workspace-id"] as string) ||
      (req.query.workspaceId as string) ||
      req.user?.currentWorkspace?.toString();

    if (!workspaceId) {
      throw new NotFoundException("Workspace not found");
    }

    // 1. Verify workspace membership (single indexed query)
    const member = await MemberModel.findOne({
      userId,
      workspaceId,
    }).populate("role");

    if (!member || !member.role) {
      // 404 rather than 403 to avoid leaking existence across tenants
      throw new NotFoundException("Workspace not found or access denied");
    }

    // 2. Load user's team memberships strictly within current workspace
    const workspaceTeams = await TeamModel.find({ workspaceId }).select("_id").lean();
    const workspaceTeamIds = workspaceTeams.map((t) => t._id);

    const teamMemberships = await TeamMemberModel.find({
      userId,
      teamId: { $in: workspaceTeamIds },
    });
    const teamRoles = new Map<string, TeamMemberRoleType>();
    const teamIds: string[] = [];

    for (const tm of teamMemberships) {
      const tId = tm.teamId.toString();
      teamRoles.set(tId, tm.role);
      teamIds.push(tId);
    }

    const policyCtx: PolicyContext = {
      userId: userId.toString(),
      workspaceId: workspaceId.toString(),
      workspaceRole: (member.role as any).name,
      teamRoles,
      teamIds,
    };

    req.policyCtx = policyCtx;
    next();
  } catch (error) {
    next(error);
  }
};
