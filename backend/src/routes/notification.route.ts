import { Router } from "express";
import isAuthenticated from "../middlewares/isAuthenticated.middleware";
import { requireAuthContext } from "../middlewares/authContext.middleware";
import {
  getMyNotificationsController,
  markNotificationReadController,
  getDeadJobsController,
} from "../controllers/notification.controller";

const notificationRoutes = Router();

notificationRoutes.use(isAuthenticated);
notificationRoutes.use(requireAuthContext);

notificationRoutes.get("/", getMyNotificationsController);
notificationRoutes.get("/dead-jobs", getDeadJobsController);
notificationRoutes.patch("/:id/read", markNotificationReadController);

export default notificationRoutes;
