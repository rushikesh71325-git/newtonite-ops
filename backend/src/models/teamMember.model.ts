import mongoose, { Document, Schema } from "mongoose";
import { TeamMemberRoleEnum, TeamMemberRoleType } from "../enums/work-item.enum";

export interface TeamMemberDocument extends Document {
  teamId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  role: TeamMemberRoleType;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const teamMemberSchema = new Schema<TeamMemberDocument>(
  {
    teamId: {
      type: Schema.Types.ObjectId,
      ref: "Team",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: Object.values(TeamMemberRoleEnum),
      default: TeamMemberRoleEnum.MEMBER,
      required: true,
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Mandatory unique index on (teamId, userId)
teamMemberSchema.index({ teamId: 1, userId: 1 }, { unique: true });

const TeamMemberModel = mongoose.model<TeamMemberDocument>(
  "TeamMember",
  teamMemberSchema
);
export default TeamMemberModel;
