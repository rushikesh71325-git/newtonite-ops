import { Request, Response } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../middlewares/asyncHandler.middleware";
import { HTTPSTATUS } from "../config/http.config";
import NotificationModel from "../models/notification.model";
import OutboxJobModel from "../models/outboxJob.model";
import { UnauthorizedException, NotFoundException, ForbiddenError } from "../utils/appError";

export const getMyNotificationsController = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.policyCtx) {
      throw new UnauthorizedException("Workspace context missing");
    }

    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const notifications = await NotificationModel.find({
      userId: new mongoose.Types.ObjectId(req.policyCtx.userId),
      workspaceId: new mongoose.Types.ObjectId(req.policyCtx.workspaceId),
    })
      .sort({ createdAt: -1 })
      .limit(limit);

    return res.status(HTTPSTATUS.OK).json({
      notifications,
    });
  }
);

export const markNotificationReadController = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.policyCtx) {
      throw new UnauthorizedException("Workspace context missing");
    }

    const notification = await NotificationModel.findOneAndUpdate(
      {
        _id: req.params.id,
        userId: new mongoose.Types.ObjectId(req.policyCtx.userId),
        workspaceId: new mongoose.Types.ObjectId(req.policyCtx.workspaceId),
      },
      {
        $set: { read: true },
      },
      { new: true }
    );

    if (!notification) {
      throw new NotFoundException("Notification not found");
    }

    return res.status(HTTPSTATUS.OK).json({
      message: "Notification marked as read",
      notification,
    });
  }
);

/**
 * Admin view to inspect dead jobs in the outbox queue.
 */
export const getDeadJobsController = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.policyCtx) {
      throw new UnauthorizedException("Workspace context missing");
    }

    if (
      req.policyCtx.workspaceRole !== "ADMIN" &&
      req.policyCtx.workspaceRole !== "OWNER"
    ) {
      throw new ForbiddenError(
        "Only workspace administrators can inspect dead outbox jobs"
      );
    }

    const deadJobs = await OutboxJobModel.find({
      status: "dead",
      "payload.workspaceId": req.policyCtx.workspaceId,
    })
      .sort({ updatedAt: -1 })
      .limit(50);

    return res.status(HTTPSTATUS.OK).json({
      deadJobs,
    });
  }
);
