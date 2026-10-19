import { Router } from "express";
import isAuthenticated from "../middlewares/isAuthenticated.middleware";
import { requireAuthContext } from "../middlewares/authContext.middleware";
import {
  getTeamsController,
  createTeamController,
  getTeamMembersController,
  addMemberToTeamController,
  removeMemberFromTeamController,
} from "../controllers/team.controller";

const teamRoutes = Router();

teamRoutes.use(isAuthenticated);
teamRoutes.use(requireAuthContext);

teamRoutes.get("/", getTeamsController);
teamRoutes.post("/", createTeamController);
teamRoutes.get("/:teamId/members", getTeamMembersController);
teamRoutes.post("/:teamId/members", addMemberToTeamController);
teamRoutes.delete("/:teamId/members/:userId", removeMemberFromTeamController);

export default teamRoutes;
