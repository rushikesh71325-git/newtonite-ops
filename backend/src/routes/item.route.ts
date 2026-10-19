import { Router } from "express";
import isAuthenticated from "../middlewares/isAuthenticated.middleware";
import { requireAuthContext } from "../middlewares/authContext.middleware";
import { idempotencyMiddleware } from "../middlewares/idempotency.middleware";
import {
  createItemController,
  getItemByIdController,
  transitionItemController,
  claimItemController,
  releaseItemController,
  requestApprovalController,
  resolveItemController,
  approveItemController,
  rejectItemController,
  closeItemController,
  reopenItemController,
  cancelItemController,
  updateItemFieldsController,
  reassignItemController,
  addCommentController,
  getItemTimelineController,
  deleteItemController,
  changeItemTeamController,
  listItemsController,
  getAttentionController,
  recordItemViewController,
} from "../controllers/item.controller";

const itemRoutes = Router();

itemRoutes.use(isAuthenticated);
itemRoutes.use(requireAuthContext);

// Listing & Attention views
itemRoutes.get("/", listItemsController);
itemRoutes.get("/attention", getAttentionController);

// Item views & history
itemRoutes.post("/:id/view", recordItemViewController);
itemRoutes.get("/:id/events", getItemTimelineController);
itemRoutes.get("/:id", getItemByIdController);

// Mutating endpoints guarded by idempotency when header provided
itemRoutes.post("/", idempotencyMiddleware, createItemController);
itemRoutes.patch("/:id", idempotencyMiddleware, updateItemFieldsController);
itemRoutes.delete("/:id", deleteItemController);
itemRoutes.post("/:id/transition", idempotencyMiddleware, transitionItemController);
itemRoutes.post("/:id/reassign", idempotencyMiddleware, reassignItemController);
itemRoutes.post("/:id/team", idempotencyMiddleware, changeItemTeamController);
itemRoutes.post("/:id/comments", idempotencyMiddleware, addCommentController);

// Action shortcuts with idempotency support
itemRoutes.post("/:id/claim", idempotencyMiddleware, claimItemController);
itemRoutes.post("/:id/release", idempotencyMiddleware, releaseItemController);
itemRoutes.post("/:id/request-approval", idempotencyMiddleware, requestApprovalController);
itemRoutes.post("/:id/resolve", idempotencyMiddleware, resolveItemController);
itemRoutes.post("/:id/approve", idempotencyMiddleware, approveItemController);
itemRoutes.post("/:id/reject", idempotencyMiddleware, rejectItemController);
itemRoutes.post("/:id/close", idempotencyMiddleware, closeItemController);
itemRoutes.post("/:id/reopen", idempotencyMiddleware, reopenItemController);
itemRoutes.post("/:id/cancel", idempotencyMiddleware, cancelItemController);

export default itemRoutes;
