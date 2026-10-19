import mongoose, { Document, Schema } from "mongoose";

export interface IdempotencyRecordDocument extends Document {
  key: string;
  userId: mongoose.Types.ObjectId;
  route: string;
  requestHash: string;
  status: "in_progress" | "completed";
  responseStatus: number | null;
  responseBody: any;
  createdAt: Date;
}

const idempotencyRecordSchema = new Schema<IdempotencyRecordDocument>(
  {
    key: {
      type: String,
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    route: {
      type: String,
      required: true,
    },
    requestHash: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["in_progress", "completed"],
      default: "in_progress",
      required: true,
    },
    responseStatus: {
      type: Number,
      default: null,
    },
    responseBody: {
      type: Schema.Types.Mixed,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 86400, // 24 hours TTL index
    },
  },
  {
    timestamps: false,
  }
);

// Unique index on (userId, route, key) preventing concurrent or duplicate duplicate requests
idempotencyRecordSchema.index(
  { userId: 1, route: 1, key: 1 },
  { unique: true }
);

const IdempotencyRecordModel = mongoose.model<IdempotencyRecordDocument>(
  "IdempotencyRecord",
  idempotencyRecordSchema
);
export default IdempotencyRecordModel;
