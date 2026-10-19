import mongoose from "mongoose";
import TeamModel from "../models/team.model";
import TeamMemberModel from "../models/teamMember.model";
import MemberModel from "../models/member.model";
import UserModel from "../models/user.model";
import { PolicyContext } from "../policy/policy";
import {
  ForbiddenError,
  NotFoundException,
  BadRequestException,
} from "../utils/appError";
import {
  TeamMemberRoleEnum,
  TeamMemberRoleType,
  WorkItemStateEnum,
  ItemEventTypeEnum,
} from "../enums/work-item.enum";
import WorkItemModel from "../models/workItem.model";
import ItemEventModel from "../models/itemEvent.model";
import OutboxJobModel from "../models/outboxJob.model";
import { tx } from "../utils/transaction";

/**
 * List all teams in the active workspace.
 */
export async function getTeamsInWorkspaceService(ctx: PolicyContext) {
  const teams = await TeamModel.find({
    workspaceId: new mongoose.Types.ObjectId(ctx.workspaceId),
  }).sort({ name: 1 });

  return teams;
}

/**
 * Create a new team in workspace (Admin/Owner only).
 */
export async function createTeamService(ctx: PolicyContext, name: string) {
  if (ctx.workspaceRole !== "ADMIN" && ctx.workspaceRole !== "OWNER") {
    throw new ForbiddenError("Only workspace admins or owners may create teams");
  }

  const existing = await TeamModel.findOne({
    workspaceId: ctx.workspaceId,
    name: name.trim(),
  });

  if (existing) {
    throw new BadRequestException("A team with this name already exists in this workspace");
  }

  const team = await TeamModel.create({
    workspaceId: ctx.workspaceId,
    name: name.trim(),
  });

  return team;
}

/**
 * Get members of a specific team with their user profiles and roles.
 */
export async function getTeamMembersService(ctx: PolicyContext, teamId: string) {
  if (!mongoose.Types.ObjectId.isValid(teamId)) {
    throw new NotFoundException("Team not found");
  }

  const team = await TeamModel.findOne({
    _id: teamId,
    workspaceId: ctx.workspaceId,
  });

  if (!team) {
    throw new NotFoundException("Team not found");
  }

  const members = await TeamMemberModel.find({ teamId })
    .populate("userId", "name email profilePicture")
    .sort({ joinedAt: 1 });

  return members;
}

/**
 * Add a user to a team (Admin/Owner or existing Team Lead).
 */
export async function addMemberToTeamService(
  ctx: PolicyContext,
  teamId: string,
  userId: string,
  role: TeamMemberRoleType = TeamMemberRoleEnum.MEMBER
) {
  if (!mongoose.Types.ObjectId.isValid(teamId) || !mongoose.Types.ObjectId.isValid(userId)) {
    throw new NotFoundException("Team or user not found");
  }

  const team = await TeamModel.findOne({
    _id: teamId,
    workspaceId: ctx.workspaceId,
  });

  if (!team) {
    throw new NotFoundException("Team not found");
  }

  const isAdmin = ctx.workspaceRole === "ADMIN" || ctx.workspaceRole === "OWNER";
  const isLead = ctx.teamRoles.get(teamId) === "lead";

  if (!isAdmin && !isLead) {
    throw new ForbiddenError("Only team leads or workspace admins may add members to this team");
  }

  // Verify the target user is a member of the workspace
  const workspaceMember = await MemberModel.findOne({
    userId,
    workspaceId: ctx.workspaceId,
  });

  if (!workspaceMember) {
    throw new BadRequestException("User must be a member of the workspace before being added to a team");
  }

  const allowedRoles = ["member", "lead"];
  if (role && !allowedRoles.includes(role)) {
    throw new BadRequestException("Invalid team role. Allowed roles: member, lead");
  }

  // Create or update team membership
  const teamMember = await TeamMemberModel.findOneAndUpdate(
    { teamId, userId },
    { $set: { role, joinedAt: new Date() } },
    { upsert: true, new: true }
  ).populate("userId", "name email");

  return teamMember;
}

/**
 * Remove a user from a team (Admin/Owner or existing Team Lead).
 */
export async function removeMemberFromTeamService(
  ctx: PolicyContext,
  teamId: string,
  userId: string
) {
  if (!mongoose.Types.ObjectId.isValid(teamId) || !mongoose.Types.ObjectId.isValid(userId)) {
    throw new NotFoundException("Team or user not found");
  }

  const team = await TeamModel.findOne({
    _id: teamId,
    workspaceId: ctx.workspaceId,
  });

  if (!team) {
    throw new NotFoundException("Team not found");
  }

  const isAdmin = ctx.workspaceRole === "ADMIN" || ctx.workspaceRole === "OWNER";
  const isLead = ctx.teamRoles.get(teamId) === "lead";

  if (!isAdmin && !isLead) {
    throw new ForbiddenError("Only team leads or workspace admins may remove members from this team");
  }

  return await tx(async (session) => {
    await TeamMemberModel.deleteOne({ teamId, userId }).session(session);

    // Release any active items in this team owned by the departing member (including OPEN, IN_PROGRESS, PENDING_APPROVAL)
    const activeItems = await WorkItemModel.find({
      workspaceId: ctx.workspaceId,
      teamId: new mongoose.Types.ObjectId(teamId),
      ownerId: new mongoose.Types.ObjectId(userId),
      state: {
        $in: [
          WorkItemStateEnum.OPEN,
          WorkItemStateEnum.IN_PROGRESS,
          WorkItemStateEnum.PENDING_APPROVAL,
        ],
      },
      deletedAt: null,
    }).session(session);

    if (activeItems.length > 0) {
      const now = new Date();
      const itemIds = activeItems.map((item) => item._id);

      // Revert ownership to null and state to OPEN
      await WorkItemModel.updateMany(
        { _id: { $in: itemIds } },
        {
          $set: {
            ownerId: null,
            state: WorkItemStateEnum.OPEN,
            lastActivityAt: now,
          },
          $inc: { version: 1 },
        },
        { session }
      );

      // Record an immutable ItemEvent and outbox notification for each released item
      for (const item of activeItems) {
        const [eventDoc] = await ItemEventModel.create(
          [
            {
              itemId: item._id,
              workspaceId: item.workspaceId,
              actorId: new mongoose.Types.ObjectId(ctx.userId),
              type: ItemEventTypeEnum.RELEASED,
              from: item.state,
              to: WorkItemStateEnum.OPEN,
              payload: {
                action: "team_member_removed",
                previousOwnerId: userId,
                reason: "Member removed from team",
              },
            },
          ],
          { session }
        );

        if (item.requesterId && item.requesterId.toString() !== ctx.userId) {
          const eventIdStr = (eventDoc._id as any).toString();
          const recipientId = item.requesterId.toString();
          await OutboxJobModel.create(
            [
              {
                type: "notify",
                payload: {
                  workspaceId: item.workspaceId.toString(),
                  itemId: (item._id as any).toString(),
                  eventId: eventIdStr,
                  recipientId,
                  actorId: ctx.userId,
                  action: "release",
                  title: `Item '${item.title}' unassigned`,
                  message: `Item owner was removed from team; item reverted to open.`,
                },
                status: "pending",
                runAt: now,
                dedupeKey: `${eventIdStr}:${recipientId}`,
              },
            ],
            { session }
          );
        }
      }
    }

    return { success: true, message: "Member removed from team" };
  });
}
