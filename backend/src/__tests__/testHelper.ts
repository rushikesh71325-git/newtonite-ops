import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import RoleModel from "../models/roles-permission.model";
import UserModel from "../models/user.model";
import WorkspaceModel from "../models/workspace.model";
import MemberModel from "../models/member.model";
import TeamModel from "../models/team.model";
import TeamMemberModel from "../models/teamMember.model";
import WorkItemModel from "../models/workItem.model";
import ItemEventModel from "../models/itemEvent.model";
import OutboxJobModel from "../models/outboxJob.model";
import IdempotencyRecordModel from "../models/idempotencyRecord.model";
import NotificationModel from "../models/notification.model";
import ItemViewModel from "../models/itemView.model";
import AccountModel from "../models/account.model";
import { ProviderEnum } from "../enums/account-provider.enum";
import { RolePermissions } from "../utils/role-permission";
import { hashValue } from "../utils/bcrypt";

let replSet: MongoMemoryReplSet | null = null;

export async function setupTestDatabase() {
  if (replSet) return;
  replSet = await MongoMemoryReplSet.create({
    instanceOpts: [{ launchTimeout: 60000 }],
    replSet: { count: 1 },
  });
  const uri = replSet.getUri();
  await mongoose.connect(uri);

  await Promise.all([
    RoleModel.syncIndexes(),
    UserModel.syncIndexes(),
    WorkspaceModel.syncIndexes(),
    MemberModel.syncIndexes(),
    TeamModel.syncIndexes(),
    TeamMemberModel.syncIndexes(),
    WorkItemModel.syncIndexes(),
    ItemEventModel.syncIndexes(),
    OutboxJobModel.syncIndexes(),
    IdempotencyRecordModel.syncIndexes(),
    NotificationModel.syncIndexes(),
    ItemViewModel.syncIndexes(),
    AccountModel.syncIndexes(),
  ]);
}

export async function teardownTestDatabase() {
  await clearTestCollections();
}

export async function stopTestDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (replSet) {
    await replSet.stop();
    replSet = null;
  }
}

// Clean up replset on process termination
process.once("beforeExit", async () => {
  if (replSet) {
    await replSet.stop();
  }
});

export async function clearTestCollections() {
  await Promise.all([
    RoleModel.deleteMany({}),
    UserModel.deleteMany({}),
    AccountModel.deleteMany({}),
    WorkspaceModel.deleteMany({}),
    MemberModel.deleteMany({}),
    TeamModel.deleteMany({}),
    TeamMemberModel.deleteMany({}),
    WorkItemModel.deleteMany({}),
    ItemEventModel.deleteMany({}),
    OutboxJobModel.deleteMany({}),
    IdempotencyRecordModel.deleteMany({}),
    NotificationModel.deleteMany({}),
    ItemViewModel.deleteMany({}),
  ]);
}

export interface SeededTestContext {
  workspace: any;
  foreignWorkspace: any;
  teamA: any;
  teamB: any;
  owner: any;
  admin: any;
  teamALead: any;
  teamAMember: any;
  teamBMember: any;
  foreignUser: any;
  roles: Record<string, any>;
}

export async function seedTestContext(): Promise<SeededTestContext> {
  await clearTestCollections();

  // 1. Roles
  const roles: Record<string, any> = {};
  for (const roleName in RolePermissions) {
    const roleKey = roleName as keyof typeof RolePermissions;
    roles[roleKey] = await RoleModel.create({
      name: roleKey,
      permissions: RolePermissions[roleKey],
    });
  }

  const plainPassword = "Password123!";

  // 2. Users
  const owner = await UserModel.create({
    name: "Alice Owner",
    email: `owner-${Date.now()}@test.com`,
    password: plainPassword,
  });
  const admin = await UserModel.create({
    name: "Bob Admin",
    email: `admin-${Date.now()}@test.com`,
    password: plainPassword,
  });
  const teamALead = await UserModel.create({
    name: "Charlie TeamA Lead",
    email: `leadA-${Date.now()}@test.com`,
    password: plainPassword,
  });
  const teamAMember = await UserModel.create({
    name: "David TeamA Member",
    email: `memberA-${Date.now()}@test.com`,
    password: plainPassword,
  });
  const teamBMember = await UserModel.create({
    name: "Eve TeamB Member",
    email: `memberB-${Date.now()}@test.com`,
    password: plainPassword,
  });
  const foreignUser = await UserModel.create({
    name: "Frank Foreigner",
    email: `foreign-${Date.now()}@test.com`,
    password: plainPassword,
  });

  // Seed Accounts for users so authentication works
  const allUsers = [owner, admin, teamALead, teamAMember, teamBMember, foreignUser];
  for (const u of allUsers) {
    await AccountModel.create({
      userId: u._id,
      provider: ProviderEnum.EMAIL,
      providerId: u.email,
    });
  }

  // 3. Workspaces
  const workspace = await WorkspaceModel.create({
    name: "Acme Primary Operations",
    description: "Primary testing workspace",
    owner: owner._id,
  });

  const foreignWorkspace = await WorkspaceModel.create({
    name: "External Partner Workspace",
    description: "Foreign testing workspace",
    owner: foreignUser._id,
  });

  // 4. Teams in Acme
  const teamA = await TeamModel.create({
    name: "Team Alpha (Customer Support)",
    workspaceId: workspace._id,
    leadId: teamALead._id,
  });

  const teamB = await TeamModel.create({
    name: "Team Beta (Infrastructure)",
    workspaceId: workspace._id,
    leadId: admin._id,
  });

  // 5. Workspace Memberships
  await MemberModel.create({
    userId: owner._id,
    workspaceId: workspace._id,
    role: roles.OWNER._id,
  });
  await MemberModel.create({
    userId: admin._id,
    workspaceId: workspace._id,
    role: roles.ADMIN._id,
  });
  await MemberModel.create({
    userId: teamALead._id,
    workspaceId: workspace._id,
    role: roles.MEMBER._id,
  });
  await MemberModel.create({
    userId: teamAMember._id,
    workspaceId: workspace._id,
    role: roles.MEMBER._id,
  });
  await MemberModel.create({
    userId: teamBMember._id,
    workspaceId: workspace._id,
    role: roles.MEMBER._id,
  });

  // Foreign workspace membership
  await MemberModel.create({
    userId: foreignUser._id,
    workspaceId: foreignWorkspace._id,
    role: roles.OWNER._id,
  });

  // 6. Team Memberships
  await TeamMemberModel.create({
    teamId: teamA._id,
    userId: teamALead._id,
    role: "lead",
  });
  await TeamMemberModel.create({
    teamId: teamA._id,
    userId: teamAMember._id,
    role: "member",
  });
  await TeamMemberModel.create({
    teamId: teamB._id,
    userId: teamBMember._id,
    role: "member",
  });

  return {
    workspace,
    foreignWorkspace,
    teamA,
    teamB,
    owner,
    admin,
    teamALead,
    teamAMember,
    teamBMember,
    foreignUser,
    roles,
  };
}
