import mongoose, { Document, Schema } from "mongoose";
import { ItemEventTypeEnum, ItemEventType } from "../enums/work-item.enum";

export interface ItemEventDocument extends Document {
  itemId: mongoose.Types.ObjectId;
  workspaceId: mongoose.Types.ObjectId;
  actorId: mongoose.Types.ObjectId;
  type: ItemEventType;
  from?: string | null;
  to?: string | null;
  payload?: any;
  requestId?: string | null;
  createdAt: Date;
}

const itemEventSchema = new Schema<ItemEventDocument>(
  {
    itemId: {
      type: Schema.Types.ObjectId,
      ref: "WorkItem",
      required: true,
      index: true,
    },
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    actorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(ItemEventTypeEnum),
      required: true,
    },
    from: {
      type: String,
      default: null,
    },
    to: {
      type: String,
      default: null,
    },
    payload: {
      type: Schema.Types.Mixed,
      default: {},
    },
    requestId: {
      type: String,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false, // Explicit append-only with createdAt
  }
);

// Index for cursor-paginated timeline queries
itemEventSchema.index({ itemId: 1, createdAt: -1, _id: -1 });

const ItemEventModel = mongoose.model<ItemEventDocument>(
  "ItemEvent",
  itemEventSchema
);
export default ItemEventModel;
