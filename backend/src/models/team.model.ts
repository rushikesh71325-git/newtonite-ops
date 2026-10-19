import mongoose, { Document, Schema } from "mongoose";

export interface TeamDocument extends Document {
  workspaceId: mongoose.Types.ObjectId;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

const teamSchema = new Schema<TeamDocument>(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

teamSchema.index({ workspaceId: 1, name: 1 }, { unique: true });

const TeamModel = mongoose.model<TeamDocument>("Team", teamSchema);
export default TeamModel;
