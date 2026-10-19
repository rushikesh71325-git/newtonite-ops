import mongoose, { Document, Schema } from "mongoose";

export interface ItemViewDocument extends Document {
  userId: mongoose.Types.ObjectId;
  itemId: mongoose.Types.ObjectId;
  workspaceId: mongoose.Types.ObjectId;
  lastSeenAt: Date;
}

const itemViewSchema = new Schema<ItemViewDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
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
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
  }
);

itemViewSchema.index({ userId: 1, itemId: 1 }, { unique: true });

const ItemViewModel = mongoose.model<ItemViewDocument>(
  "ItemView",
  itemViewSchema
);
export default ItemViewModel;
