import { Request, Response } from "express";
import { asyncHandler } from "../middlewares/asyncHandler.middleware";
import { HTTPSTATUS } from "../config/http.config";
import {
  createItemSchema,
  transitionItemSchema,
  updateItemFieldsSchema,
  reassignItemSchema,
  addCommentSchema,
  listItemsQuerySchema,
} from "../validation/item.validation";
import {
  createItemService,
  getItemService,
  transitionItemService,
  claimItemService,
  updateItemFieldsService,
  reassignItemService,
  addCommentService,
  getItemTimelineService,
  deleteItemService,
  changeItemTeamService,
  listItemsService,
  getAttentionService,
  recordItemViewService,
} from "../services/item.service";
import { BadRequestException, UnauthorizedException } from "../utils/appError";
import { WorkflowAction } from "../workflow/workflow";

export const createItemController = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.policyCtx) {
      throw new UnauthorizedException("Workspace context missing");
    }

    const validatedBody = createItemSchema.parse(req.body);
    const item = await createItemService(
      req.policyCtx,
      validatedBody,
      req.id
    );

    return res.status(HTTPSTATUS.CREATED).json({
      message: "Work item created successfully",
      item,
    });
  }
);

export const getItemByIdController = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.policyCtx) {
      throw new UnauthorizedException("Workspace context missing");
    }

    const item = await getItemService(req.policyCtx, req.params.id);

    return res.status(HTTPSTATUS.OK).json({
      item,
    });
  }
);

export const transitionItemController = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.policyCtx) {
      throw new UnauthorizedException("Workspace context missing");
    }

    const validatedBody = transitionItemSchema.parse(req.body);
    const item = await transitionItemService(
      req.policyCtx,
      req.params.id,
      validatedBody,
      req.id
    );

    return res.status(HTTPSTATUS.OK).json({
      message: `Action '${validatedBody.action}' applied successfully`,
      item,
    });
  }
);

export const claimItemController = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.policyCtx) {
      throw new UnauthorizedException("Workspace context missing");
    }

    const expectedVersion = req.body.expectedVersion
      ? Number(req.body.expectedVersion)
      : undefined;

    const item = await claimItemService(
      req.policyCtx,
      req.params.id,
      expectedVersion,
      req.id
    );

    return res.status(HTTPSTATUS.OK).json({
      message: "Item claimed successfully",
      item,
    });
  }
);

export const updateItemFieldsController = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.policyCtx) {
      throw new UnauthorizedException("Workspace context missing");
    }

    const validated = updateItemFieldsSchema.parse(req.body);
    const item = await updateItemFieldsService(
      req.policyCtx,
      req.params.id,
      validated,
      req.id
    );

    return res.status(HTTPSTATUS.OK).json({
      message: "Item updated successfully",
      item,
    });
  }
);

export const reassignItemController = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.policyCtx) {
      throw new UnauthorizedException("Workspace context missing");
    }

    const validated = reassignItemSchema.parse(req.body);
    const item = await reassignItemService(
      req.policyCtx,
      req.params.id,
      validated,
      req.id
    );

    return res.status(HTTPSTATUS.OK).json({
      message: "Item reassigned successfully",
      item,
    });
  }
);

export const addCommentController = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.policyCtx) {
      throw new UnauthorizedException("Workspace context missing");
    }

    const validated = addCommentSchema.parse(req.body);
    const commentEvent = await addCommentService(
      req.policyCtx,
      req.params.id,
      validated.text,
      req.id
    );

    return res.status(HTTPSTATUS.CREATED).json({
      message: "Comment added successfully",
      event: commentEvent,
    });
  }
);

export const getItemTimelineController = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.policyCtx) {
      throw new UnauthorizedException("Workspace context missing");
    }

    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;

    const result = await getItemTimelineService(req.policyCtx, req.params.id, {
      cursor,
      limit,
    });

    return res.status(HTTPSTATUS.OK).json(result);
  }
);

// Dedicated action helpers delegating to transitionItemService
const createActionController = (action: WorkflowAction) =>
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.policyCtx) {
      throw new UnauthorizedException("Workspace context missing");
    }

    const payload = {
      action,
      expectedVersion: req.body.expectedVersion,
      resolutionNote: req.body.resolutionNote,
      reason: req.body.reason,
      comment: req.body.comment,
      approverId: req.body.approverId,
      requiresApproval: req.body.requiresApproval,
    };

    const validatedBody = transitionItemSchema.parse(payload);
    const item = await transitionItemService(
      req.policyCtx,
      req.params.id,
      validatedBody,
      req.id
    );

    return res.status(HTTPSTATUS.OK).json({
      message: `Action '${action}' applied successfully`,
      item,
    });
  });

export const releaseItemController = createActionController("release");
export const requestApprovalController = createActionController("request_approval");
export const resolveItemController = createActionController("resolve");
export const approveItemController = createActionController("approve");
export const rejectItemController = createActionController("reject");
export const closeItemController = createActionController("close");
export const reopenItemController = createActionController("reopen");
export const cancelItemController = createActionController("cancel");

export const deleteItemController = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.policyCtx) {
      throw new UnauthorizedException("Workspace context missing");
    }

    const result = await deleteItemService(req.policyCtx, req.params.id, req.id);
    return res.status(HTTPSTATUS.OK).json(result);
  }
);

export const changeItemTeamController = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.policyCtx) {
      throw new UnauthorizedException("Workspace context missing");
    }

    const newTeamId = req.body.newTeamId;
    if (!newTeamId || typeof newTeamId !== "string") {
      throw new BadRequestException("newTeamId is required");
    }

    const expectedVersion =
      req.body.expectedVersion !== undefined
        ? Number(req.body.expectedVersion)
        : undefined;

    const item = await changeItemTeamService(
      req.policyCtx,
      req.params.id,
      newTeamId,
      expectedVersion,
      req.id
    );

    return res.status(HTTPSTATUS.OK).json({
      message: "Item team reassigned successfully",
      item,
    });
  }
);

export const listItemsController = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.policyCtx) {
      throw new UnauthorizedException("Workspace context missing");
    }

    const validatedQuery = listItemsQuerySchema.parse(req.query);
    const result = await listItemsService(req.policyCtx, validatedQuery);

    return res.status(HTTPSTATUS.OK).json(result);
  }
);

export const getAttentionController = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.policyCtx) {
      throw new UnauthorizedException("Workspace context missing");
    }

    const staleDays = req.query.staleDays
      ? Number(req.query.staleDays)
      : undefined;

    const result = await getAttentionService(req.policyCtx, staleDays);

    return res.status(HTTPSTATUS.OK).json(result);
  }
);

export const recordItemViewController = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.policyCtx) {
      throw new UnauthorizedException("Workspace context missing");
    }

    const result = await recordItemViewService(req.policyCtx, req.params.id);

    return res.status(HTTPSTATUS.OK).json(result);
  }
);
