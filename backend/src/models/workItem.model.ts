import mongoose, { Document, Schema } from "mongoose";
import {
  WorkItemPriorityEnum,
  WorkItemPriorityType,
  WorkItemRequestTypeEnum,
  WorkItemRequestType,
  WorkItemStateEnum,
  WorkItemStateType,
} from "../enums/work-item.enum";

export interface WorkItemDocument extends Document {
  workspaceId: mongoose.Types.ObjectId;
  teamId: mongoose.Types.ObjectId;
  title: string;
  description: string;
  requestType: WorkItemRequestType;
  priority: WorkItemPriorityType;
  state: WorkItemStateType;
  ownerId: mongoose.Types.ObjectId | null;
  requesterId: mongoose.Types.ObjectId;
  approverId: mongoose.Types.ObjectId | null;
  requiresApproval: boolean;
  dueDate: Date | null;
  lastActivityAt: Date;
  version: number;
  commentCount: number;
  resolutionNote?: string | null;
  deletedAt?: Date | null;
  deletedBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const workItemSchema = new Schema<WorkItemDocument>(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    teamId: {
      type: Schema.Types.ObjectId,
      ref: "Team",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    requestType: {
      type: String,
      enum: Object.values(WorkItemRequestTypeEnum),
      required: true,
    },
    priority: {
      type: String,
      enum: Object.values(WorkItemPriorityEnum),
      default: WorkItemPriorityEnum.MEDIUM,
      required: true,
    },
    state: {
      type: String,
      enum: Object.values(WorkItemStateEnum),
      default: WorkItemStateEnum.OPEN,
      required: true,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    requesterId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    approverId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    requiresApproval: {
      type: Boolean,
      default: false,
    },
    dueDate: {
      type: Date,
      default: null,
    },
    lastActivityAt: {
      type: Date,
      default: Date.now,
    },
    version: {
      type: Number,
      default: 1,
      required: true,
    },
    commentCount: {
      type: Number,
      default: 0,
    },
    resolutionNote: {
      type: String,
      default: null,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    strict: "throw", // Rejects unknown fields in writes
  }
);

// Compound indexes for high-throughput query patterns
// 1. Team lists filtered by state and cursor pagination
workItemSchema.index({
  workspaceId: 1,
  teamId: 1,
  state: 1,
  updatedAt: -1,
  _id: -1,
});

// 2. "My items" attention / listing
workItemSchema.index({
  workspaceId: 1,
  ownerId: 1,
  state: 1,
  updatedAt: -1,
});

// 3. "Waiting on my approval" attention
workItemSchema.index({
  workspaceId: 1,
  approverId: 1,
  state: 1,
});

// 4. Overdue and due-soon
workItemSchema.index({
  workspaceId: 1,
  state: 1,
  dueDate: 1,
});

// 5. Unassigned queue with partial filter
workItemSchema.index(
  { workspaceId: 1, teamId: 1, ownerId: 1 },
  { partialFilterExpression: { ownerId: null } }
);

// 6. Text index for keyword search
workItemSchema.index(
  { title: "text", description: "text" },
  { weights: { title: 10, description: 1 } }
);

const WorkItemModel = mongoose.model<WorkItemDocument>(
  "WorkItem",
  workItemSchema
);
export default WorkItemModel;
