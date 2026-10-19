import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler.middleware";
import { HTTPSTATUS } from "../config/http.config";
import {
  getTeamsInWorkspaceService,
  createTeamService,
  getTeamMembersService,
  addMemberToTeamService,
  removeMemberFromTeamService,
} from "../services/team.service";
import { UnauthorizedException, BadRequestException } from "../utils/appError";

export const getTeamsController = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.policyCtx) {
      throw new UnauthorizedException("Workspace context missing");
    }
    const teams = await getTeamsInWorkspaceService(req.policyCtx);
    return res.status(HTTPSTATUS.OK).json({ teams });
  }
);

export const createTeamController = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.policyCtx) {
      throw new UnauthorizedException("Workspace context missing");
    }
    const name = req.body.name;
    if (!name || typeof name !== "string") {
      throw new BadRequestException("Team name is required");
    }
    const team = await createTeamService(req.policyCtx, name);
    return res.status(HTTPSTATUS.CREATED).json({
      message: "Team created successfully",
      team,
    });
  }
);

export const getTeamMembersController = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.policyCtx) {
      throw new UnauthorizedException("Workspace context missing");
    }
    const members = await getTeamMembersService(
      req.policyCtx,
      req.params.teamId
    );
    return res.status(HTTPSTATUS.OK).json({ members });
  }
);

export const addMemberToTeamController = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.policyCtx) {
      throw new UnauthorizedException("Workspace context missing");
    }
    const { userId, role } = req.body;
    if (!userId || typeof userId !== "string") {
      throw new BadRequestException("userId is required");
    }
    const teamMember = await addMemberToTeamService(
      req.policyCtx,
      req.params.teamId,
      userId,
      role
    );
    return res.status(HTTPSTATUS.OK).json({
      message: "Member added to team",
      teamMember,
    });
  }
);

export const removeMemberFromTeamController = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.policyCtx) {
      throw new UnauthorizedException("Workspace context missing");
    }
    const result = await removeMemberFromTeamService(
      req.policyCtx,
      req.params.teamId,
      req.params.userId
    );
    return res.status(HTTPSTATUS.OK).json(result);
  }
);
