import "dotenv/config";
import mongoose from "mongoose";
import connectDatabase from "../config/database.config";
import UserModel from "../models/user.model";
import AccountModel from "../models/account.model";
import WorkspaceModel from "../models/workspace.model";
import RoleModel from "../models/roles-permission.model";
import MemberModel from "../models/member.model";
import TeamModel from "../models/team.model";
import TeamMemberModel from "../models/teamMember.model";
import WorkItemModel from "../models/workItem.model";
import ItemEventModel from "../models/itemEvent.model";
import OutboxJobModel from "../models/outboxJob.model";
import IdempotencyRecordModel from "../models/idempotencyRecord.model";
import NotificationModel from "../models/notification.model";
import ItemViewModel from "../models/itemView.model";
import { Roles } from "../enums/role.enum";
import { RolePermissions } from "../utils/role-permission";
import { ProviderEnum } from "../enums/account-provider.enum";
import { hashValue } from "../utils/bcrypt";
import {
  ItemEventTypeEnum,
  TeamMemberRoleEnum,
  WorkItemPriorityEnum,
  WorkItemRequestTypeEnum,
  WorkItemStateEnum,
} from "../enums/work-item.enum";

export const seedDatabase = async (options?: { bulkCount?: number }) => {
  const isBulk =
    process.argv.includes("--bulk") ||
    process.env.BULK === "true" ||
    (options && options.bulkCount && options.bulkCount > 0);

  const bulkCount = options?.bulkCount || (isBulk ? 5000 : 0);

  console.log("=========================================");
  console.log("Newtonite Operations Seed Script Starting");
  console.log(`Bulk items requested: ${bulkCount}`);
  console.log("=========================================");

  await connectDatabase();

  // Sync schema indexes across all collections
  console.log("Synchronizing model indexes...");
  await Promise.all([
    RoleModel.syncIndexes(),
    UserModel.syncIndexes(),
    AccountModel.syncIndexes(),
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
  ]);
  console.log("Indexes synchronized successfully.");

  // Clear existing collections for a clean, deterministic seed
  console.log("Cleaning existing records...");
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

  // 1. Seed Roles
  console.log("Seeding workspace roles...");
  const roleDocs: Record<string, any> = {};
  for (const roleName in RolePermissions) {
    const roleKey = roleName as keyof typeof RolePermissions;
    const role = await RoleModel.create({
      name: roleKey,
      permissions: RolePermissions[roleKey],
    });
    roleDocs[roleKey] = role;
  }

  // 2. Seed Users
  console.log("Seeding users...");
  const defaultPassword = "Password123!";

  const usersData = [
    { email: "owner@example.com", name: "Alice Owner" },
    { email: "admin@example.com", name: "Bob Admin" },
    { email: "lead1@example.com", name: "Charlie Lead-Ops" },
    { email: "member1@example.com", name: "David Member-Ops" },
    { email: "lead2@example.com", name: "Elena Lead-Eng" },
    { email: "member2@example.com", name: "Frank Member-Eng" },
    { email: "outsider@example.com", name: "Oscar Outsider" },
  ];

  const userMap = new Map<string, any>();
  for (const u of usersData) {
    const user = await UserModel.create({
      email: u.email,
      name: u.name,
      password: defaultPassword,
      isActive: true,
    });
    await AccountModel.create({
      userId: user._id,
      provider: ProviderEnum.EMAIL,
      providerId: u.email,
    });
    userMap.set(u.email, user);
  }

  // 3. Seed Workspaces
  console.log("Seeding workspaces...");
  const primaryWorkspace = await WorkspaceModel.create({
    name: "Acme Operations",
    description: "Operational response workspace for coordinating teams under pressure",
    owner: userMap.get("owner@example.com")._id,
  });

  const foreignWorkspace = await WorkspaceModel.create({
    name: "External Partner Workspace",
    description: "Tenancy isolation boundary workspace",
    owner: userMap.get("outsider@example.com")._id,
  });

  // Assign currentWorkspace on users
  for (const [email, user] of userMap.entries()) {
    user.currentWorkspace =
      email === "outsider@example.com"
        ? foreignWorkspace._id
        : primaryWorkspace._id;
    await user.save();
  }

  // 4. Seed Workspace Memberships
  console.log("Seeding workspace members...");
  // Acme Operations
  await MemberModel.create([
    {
      userId: userMap.get("owner@example.com")._id,
      workspaceId: primaryWorkspace._id,
      role: roleDocs[Roles.OWNER]._id,
    },
    {
      userId: userMap.get("admin@example.com")._id,
      workspaceId: primaryWorkspace._id,
      role: roleDocs[Roles.ADMIN]._id,
    },
    {
      userId: userMap.get("lead1@example.com")._id,
      workspaceId: primaryWorkspace._id,
      role: roleDocs[Roles.MEMBER]._id,
    },
    {
      userId: userMap.get("member1@example.com")._id,
      workspaceId: primaryWorkspace._id,
      role: roleDocs[Roles.MEMBER]._id,
    },
    {
      userId: userMap.get("lead2@example.com")._id,
      workspaceId: primaryWorkspace._id,
      role: roleDocs[Roles.MEMBER]._id,
    },
    {
      userId: userMap.get("member2@example.com")._id,
      workspaceId: primaryWorkspace._id,
      role: roleDocs[Roles.MEMBER]._id,
    },
  ]);

  // Foreign Workspace Member
  await MemberModel.create({
    userId: userMap.get("outsider@example.com")._id,
    workspaceId: foreignWorkspace._id,
    role: roleDocs[Roles.OWNER]._id,
  });

  // 5. Seed Teams in Acme Operations
  console.log("Seeding teams...");
  const opsTeam = await TeamModel.create({
    workspaceId: primaryWorkspace._id,
    name: "Customer Operations",
  });

  const engTeam = await TeamModel.create({
    workspaceId: primaryWorkspace._id,
    name: "Platform Engineering",
  });

  // Foreign Team for outsider
  const foreignTeam = await TeamModel.create({
    workspaceId: foreignWorkspace._id,
    name: "External Vendor Team",
  });

  // 6. Seed Team Memberships
  console.log("Seeding team memberships...");
  await TeamMemberModel.create([
    // Ops Team
    {
      teamId: opsTeam._id,
      userId: userMap.get("lead1@example.com")._id,
      role: TeamMemberRoleEnum.LEAD,
    },
    {
      teamId: opsTeam._id,
      userId: userMap.get("member1@example.com")._id,
      role: TeamMemberRoleEnum.MEMBER,
    },
    {
      teamId: opsTeam._id,
      userId: userMap.get("admin@example.com")._id,
      role: TeamMemberRoleEnum.MEMBER,
    },
    // Eng Team
    {
      teamId: engTeam._id,
      userId: userMap.get("lead2@example.com")._id,
      role: TeamMemberRoleEnum.LEAD,
    },
    {
      teamId: engTeam._id,
      userId: userMap.get("member2@example.com")._id,
      role: TeamMemberRoleEnum.MEMBER,
    },
    {
      teamId: engTeam._id,
      userId: userMap.get("admin@example.com")._id,
      role: TeamMemberRoleEnum.MEMBER,
    },
    // Foreign Team
    {
      teamId: foreignTeam._id,
      userId: userMap.get("outsider@example.com")._id,
      role: TeamMemberRoleEnum.LEAD,
    },
  ]);

  // 7. Seed Initial Core Work Items
  console.log("Seeding initial core operational work items...");
  const now = new Date();
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
  const twoDaysFromNow = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

  const initialItems = [
    {
      workspaceId: primaryWorkspace._id,
      teamId: opsTeam._id,
      title: "Critical Payment Gateway Timeout",
      description: "Payment gateway webhook failures observed for EU checkout tier",
      requestType: WorkItemRequestTypeEnum.INCIDENT,
      priority: WorkItemPriorityEnum.URGENT,
      state: WorkItemStateEnum.OPEN,
      ownerId: null,
      requesterId: userMap.get("member1@example.com")._id,
      approverId: null,
      requiresApproval: false,
      dueDate: twoDaysFromNow,
      lastActivityAt: now,
      version: 1,
    },
    {
      workspaceId: primaryWorkspace._id,
      teamId: opsTeam._id,
      title: "Account verification stuck in manual review",
      description: "Enterprise account KYC documentation requires verification",
      requestType: WorkItemRequestTypeEnum.CUSTOMER_ISSUE,
      priority: WorkItemPriorityEnum.HIGH,
      state: WorkItemStateEnum.IN_PROGRESS,
      ownerId: userMap.get("member1@example.com")._id,
      requesterId: userMap.get("lead1@example.com")._id,
      approverId: null,
      requiresApproval: false,
      dueDate: twoDaysFromNow,
      lastActivityAt: now,
      version: 2,
    },
    {
      workspaceId: primaryWorkspace._id,
      teamId: opsTeam._id,
      title: "High-value customer credit adjustment",
      description: "Requesting $5,000 SLA breach credit for Acme Corp Enterprise account",
      requestType: WorkItemRequestTypeEnum.PAYMENT,
      priority: WorkItemPriorityEnum.URGENT,
      state: WorkItemStateEnum.PENDING_APPROVAL,
      ownerId: userMap.get("member1@example.com")._id,
      requesterId: userMap.get("member1@example.com")._id,
      approverId: userMap.get("lead1@example.com")._id,
      requiresApproval: true,
      dueDate: twoDaysFromNow,
      lastActivityAt: now,
      version: 2,
    },
    {
      workspaceId: primaryWorkspace._id,
      teamId: engTeam._id,
      title: "Renew SOC2 compliance certificates",
      description: "Production TLS certs expiration scheduled in staging and vault",
      requestType: WorkItemRequestTypeEnum.COMPLIANCE,
      priority: WorkItemPriorityEnum.MEDIUM,
      state: WorkItemStateEnum.RESOLVED,
      ownerId: userMap.get("member2@example.com")._id,
      requesterId: userMap.get("lead2@example.com")._id,
      approverId: null,
      requiresApproval: false,
      resolutionNote: "Uploaded renewed certificates to secure vault and deployed",
      dueDate: twoDaysAgo,
      lastActivityAt: now,
      version: 3,
    },
    {
      workspaceId: primaryWorkspace._id,
      teamId: engTeam._id,
      title: "Deploy database migration v2.4",
      description: "Index additions for high-throughput outbox table",
      requestType: WorkItemRequestTypeEnum.TASK,
      priority: WorkItemPriorityEnum.LOW,
      state: WorkItemStateEnum.CLOSED,
      ownerId: userMap.get("lead2@example.com")._id,
      requesterId: userMap.get("lead2@example.com")._id,
      approverId: null,
      requiresApproval: false,
      resolutionNote: "Migration verified successfully across all replicas",
      dueDate: twoDaysAgo,
      lastActivityAt: twoDaysAgo,
      version: 4,
    },
    {
      workspaceId: primaryWorkspace._id,
      teamId: opsTeam._id,
      title: "Overdue VIP ticket resolution",
      description: "SLA expiration occurred 2 days ago without resolution",
      requestType: WorkItemRequestTypeEnum.CUSTOMER_ISSUE,
      priority: WorkItemPriorityEnum.URGENT,
      state: WorkItemStateEnum.IN_PROGRESS,
      ownerId: userMap.get("member1@example.com")._id,
      requesterId: userMap.get("lead1@example.com")._id,
      approverId: null,
      requiresApproval: false,
      dueDate: twoDaysAgo, // Overdue
      lastActivityAt: now,
      version: 2,
    },
    {
      workspaceId: primaryWorkspace._id,
      teamId: engTeam._id,
      title: "Stale infrastructure monitoring alert",
      description: "Dead-letter queue spike alert has been unattended for 5 days",
      requestType: WorkItemRequestTypeEnum.INCIDENT,
      priority: WorkItemPriorityEnum.MEDIUM,
      state: WorkItemStateEnum.IN_PROGRESS,
      ownerId: userMap.get("member2@example.com")._id,
      requesterId: userMap.get("lead2@example.com")._id,
      approverId: null,
      requiresApproval: false,
      dueDate: twoDaysFromNow,
      lastActivityAt: fiveDaysAgo, // Stale
      version: 2,
    },
  ];

  for (const itemData of initialItems) {
    const item = await WorkItemModel.create(itemData);
    await ItemEventModel.create({
      itemId: item._id,
      workspaceId: item.workspaceId,
      actorId: item.requesterId,
      type: ItemEventTypeEnum.CREATED,
      payload: { title: item.title, priority: item.priority },
      createdAt: item.createdAt,
    });
    if (item.ownerId) {
      await ItemEventModel.create({
        itemId: item._id,
        workspaceId: item.workspaceId,
        actorId: item.ownerId,
        type: ItemEventTypeEnum.CLAIMED,
        payload: { ownerId: item.ownerId },
        createdAt: item.createdAt,
      });
    }
  }

  // 8. Bulk Seed if requested
  if (bulkCount > 0) {
    console.log(`Generating ${bulkCount} bulk items across teams...`);
    const bulkItems: any[] = [];
    const bulkEvents: any[] = [];
    const priorities = [
      WorkItemPriorityEnum.LOW,
      WorkItemPriorityEnum.MEDIUM,
      WorkItemPriorityEnum.HIGH,
      WorkItemPriorityEnum.URGENT,
    ];
    const states = [
      WorkItemStateEnum.OPEN,
      WorkItemStateEnum.IN_PROGRESS,
      WorkItemStateEnum.PENDING_APPROVAL,
      WorkItemStateEnum.RESOLVED,
      WorkItemStateEnum.CLOSED,
    ];
    const types = [
      WorkItemRequestTypeEnum.CUSTOMER_ISSUE,
      WorkItemRequestTypeEnum.INCIDENT,
      WorkItemRequestTypeEnum.PAYMENT,
      WorkItemRequestTypeEnum.COMPLIANCE,
      WorkItemRequestTypeEnum.TASK,
    ];

    const teamList = [
      {
        team: opsTeam,
        members: [
          userMap.get("lead1@example.com")._id,
          userMap.get("member1@example.com")._id,
        ],
        lead: userMap.get("lead1@example.com")._id,
      },
      {
        team: engTeam,
        members: [
          userMap.get("lead2@example.com")._id,
          userMap.get("member2@example.com")._id,
        ],
        lead: userMap.get("lead2@example.com")._id,
      },
    ];

    for (let i = 1; i <= bulkCount; i++) {
      const teamConfig = teamList[i % 2];
      const state = states[i % states.length];
      const priority = priorities[i % priorities.length];
      const reqType = types[i % types.length];
      const owner =
        state === WorkItemStateEnum.OPEN
          ? null
          : teamConfig.members[i % teamConfig.members.length];
      const requiresApproval = state === WorkItemStateEnum.PENDING_APPROVAL;
      const approver = requiresApproval ? teamConfig.lead : null;

      const randomHours = Math.floor(Math.random() * 240); // 0-10 days
      const createdAt = new Date(now.getTime() - randomHours * 60 * 60 * 1000);
      const isOverdue = i % 5 === 0;
      const dueDate = isOverdue
        ? new Date(now.getTime() - 24 * 60 * 60 * 1000)
        : new Date(now.getTime() + (randomHours + 48) * 60 * 60 * 1000);

      const itemId = new mongoose.Types.ObjectId();
      bulkItems.push({
        _id: itemId,
        workspaceId: primaryWorkspace._id,
        teamId: teamConfig.team._id,
        title: `Operational Task #${i}: ${reqType.replace("_", " ")} investigation`,
        description: `Automated test operational record for testing cursor pagination at scale. Sequence number #${i}`,
        requestType: reqType,
        priority: priority,
        state: state,
        ownerId: owner,
        requesterId: teamConfig.members[0],
        approverId: approver,
        requiresApproval: requiresApproval,
        dueDate: dueDate,
        lastActivityAt: createdAt,
        version: 1,
        createdAt: createdAt,
        updatedAt: createdAt,
      });

      bulkEvents.push({
        itemId: itemId,
        workspaceId: primaryWorkspace._id,
        actorId: teamConfig.members[0],
        type: ItemEventTypeEnum.CREATED,
        payload: { sequence: i },
        createdAt: createdAt,
      });
    }

    // Insert in batches of 1,000
    const chunkSize = 1000;
    for (let i = 0; i < bulkItems.length; i += chunkSize) {
      const itemChunk = bulkItems.slice(i, i + chunkSize);
      const eventChunk = bulkEvents.slice(i, i + chunkSize);
      await WorkItemModel.insertMany(itemChunk);
      await ItemEventModel.insertMany(eventChunk);
      console.log(`Inserted bulk batch: ${i + itemChunk.length} / ${bulkCount}`);
    }
  }

  const finalItemCount = await WorkItemModel.countDocuments();
  console.log("=========================================");
  console.log("Seed Completed Successfully!");
  console.log(`Total Work Items in Database: ${finalItemCount}`);
  console.log("-----------------------------------------");
  console.log("Demo Credentials (Password for all: Password123!)");
  console.log("Owner:    owner@example.com   (Workspace Owner)");
  console.log("Admin:    admin@example.com   (Workspace Admin)");
  console.log("Ops Lead: lead1@example.com   (Lead: Customer Operations)");
  console.log("Ops Mem:  member1@example.com (Member: Customer Operations)");
  console.log("Eng Lead: lead2@example.com   (Lead: Platform Engineering)");
  console.log("Eng Mem:  member2@example.com (Member: Platform Engineering)");
  console.log("Outsider: outsider@example.com(External Partner Workspace only)");
  console.log("=========================================");
};

if (require.main === module) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seeding failed:", err);
      process.exit(1);
    });
}
