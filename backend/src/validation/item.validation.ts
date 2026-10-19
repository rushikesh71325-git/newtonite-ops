import { z } from "zod";
import {
  WorkItemPriorityEnum,
  WorkItemRequestTypeEnum,
  WorkItemStateEnum,
} from "../enums/work-item.enum";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const createItemSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(255, "Title must be 255 characters or fewer"),
  description: z.string().trim().max(10000).optional().default(""),
  requestType: z.nativeEnum(WorkItemRequestTypeEnum),
  priority: z
    .nativeEnum(WorkItemPriorityEnum)
    .optional()
    .default(WorkItemPriorityEnum.MEDIUM),
  teamId: z.string().regex(objectIdRegex, "Invalid teamId"),
  approverId: z.string().regex(objectIdRegex, "Invalid approverId").optional().nullable(),
  requiresApproval: z.boolean().optional().default(false),
  dueDate: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}/))
    .or(z.date())
    .optional()
    .nullable(),
});

export const transitionItemSchema = z.object({
  action: z.enum([
    "claim",
    "release",
    "request_approval",
    "resolve",
    "approve",
    "reject",
    "close",
    "reopen",
    "cancel",
  ]),
  expectedVersion: z.number().int().min(1, "expectedVersion is required"),
  resolutionNote: z.string().trim().optional(),
  reason: z.string().trim().optional(),
  comment: z.string().trim().optional(),
  approverId: z.string().regex(objectIdRegex, "Invalid approverId").optional().nullable(),
  requiresApproval: z.boolean().optional(),
});

export const updateItemFieldsSchema = z.object({
  expectedVersion: z.number().int().min(1, "expectedVersion is required"),
  title: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(10000).optional(),
  priority: z.nativeEnum(WorkItemPriorityEnum).optional(),
  dueDate: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}/))
    .or(z.date())
    .optional()
    .nullable(),
});

export const reassignItemSchema = z.object({
  expectedVersion: z.number().int().min(1, "expectedVersion is required"),
  newOwnerId: z.string().regex(objectIdRegex, "Invalid newOwnerId"),
});

export const addCommentSchema = z.object({
  text: z.string().trim().min(1, "Comment text is required").max(5000),
});

export const listItemsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  state: z
    .nativeEnum(WorkItemStateEnum)
    .or(z.array(z.nativeEnum(WorkItemStateEnum)))
    .optional(),
  priority: z
    .nativeEnum(WorkItemPriorityEnum)
    .or(z.array(z.nativeEnum(WorkItemPriorityEnum)))
    .optional(),
  teamId: z.string().regex(objectIdRegex, "Invalid teamId").optional(),
  ownerId: z
    .string()
    .regex(objectIdRegex, "Invalid ownerId")
    .or(z.literal("me"))
    .or(z.literal("unassigned"))
    .optional(),
  requesterId: z
    .string()
    .regex(objectIdRegex, "Invalid requesterId")
    .or(z.literal("me"))
    .optional(),
  requestType: z
    .nativeEnum(WorkItemRequestTypeEnum)
    .or(z.array(z.nativeEnum(WorkItemRequestTypeEnum)))
    .optional(),
  dueBefore: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .optional(),
  dueAfter: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .optional(),
  search: z.string().trim().optional(),
});
