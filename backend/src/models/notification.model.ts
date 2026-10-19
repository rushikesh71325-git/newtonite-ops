import mongoose, { Document, Schema } from "mongoose";

export interface NotificationDocument extends Document {
  userId: mongoose.Types.ObjectId;
  workspaceId: mongoose.Types.ObjectId;
  itemId?: mongoose.Types.ObjectId | null;
  title: string;
  message: string;
  dedupeKey: string;
  read: boolean;
  createdAt: Date;
}

const notificationSchema = new Schema<NotificationDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    itemId: {
      type: Schema.Types.ObjectId,
      ref: "WorkItem",
      default: null,
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    dedupeKey: {
      type: String,
      required: true,
      unique: true,
    },
    read: {
      type: Boolean,
      default: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
  }
);

notificationSchema.index({ userId: 1, createdAt: -1 });

const NotificationModel = mongoose.model<NotificationDocument>(
  "Notification",
  notificationSchema
);
export default NotificationModel;
