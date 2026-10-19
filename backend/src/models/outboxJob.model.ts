import mongoose, { Document, Schema } from "mongoose";
import {
  OutboxJobStatusEnum,
  OutboxJobStatusType,
} from "../enums/work-item.enum";

export interface OutboxJobDocument extends Document {
  type: string;
  payload: any;
  status: OutboxJobStatusType;
  attempts: number;
  runAt: Date;
  lockedUntil: Date | null;
  lastError: string | null;
  dedupeKey: string;
  createdAt: Date;
  updatedAt: Date;
}

const outboxJobSchema = new Schema<OutboxJobDocument>(
  {
    type: {
      type: String,
      required: true,
    },
    payload: {
      type: Schema.Types.Mixed,
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(OutboxJobStatusEnum),
      default: OutboxJobStatusEnum.PENDING,
      required: true,
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    runAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    lockedUntil: {
      type: Date,
      default: null,
    },
    lastError: {
      type: String,
      default: null,
    },
    dedupeKey: {
      type: String,
      required: true,
      unique: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for polling worker to claim available jobs in FIFO order
outboxJobSchema.index({ status: 1, runAt: 1 });
outboxJobSchema.index({ status: 1, "payload.workspaceId": 1 });

const OutboxJobModel = mongoose.model<OutboxJobDocument>(
  "OutboxJob",
  outboxJobSchema
);
export default OutboxJobModel;
