import {
  PermissionType,
  TaskPriorityEnumType,
  TaskStatusEnumType,
} from "@/constant";

export type loginType = { email: string; password: string };
export type LoginResponseType = {
  message: string;
  user: {
    _id: string;
    currentWorkspace: string;
  };
};

export type registerType = {
  name: string;
  email: string;
  password: string;
};

// USER TYPE
export type UserType = {
  _id: string;
  name: string;
  email: string;
  profilePicture: string | null;
  isActive: true;
  lastLogin: null;
  createdAt: Date;
  updatedAt: Date;
  currentWorkspace: {
    _id: string;
    name: string;
    owner: string;
    inviteCode: string;
  };
};

export type CurrentUserResponseType = {
  message: string;
  user: UserType;
};

//******** */ WORLSPACE TYPES ****************
// ******************************************
export type WorkspaceType = {
  _id: string;
  name: string;
  description?: string;
  owner: string;
  inviteCode: string;
};

export type CreateWorkspaceType = {
  name: string;
  description: string;
};

export type EditWorkspaceType = {
  workspaceId: string;
  data: {
    name: string;
    description: string;
  };
};

export type CreateWorkspaceResponseType = {
  message: string;
  workspace: WorkspaceType;
};

export type AllWorkspaceResponseType = {
  message: string;
  workspaces: WorkspaceType[];
};

export type WorkspaceWithMembersType = WorkspaceType & {
  members: {
    _id: string;
    userId: string;
    workspaceId: string;
    role: {
      _id: string;
      name: string;
      permissions: PermissionType[];
    };
    joinedAt: string;
    createdAt: string;
  }[];
};

export type WorkspaceByIdResponseType = {
  message: string;
  workspace: WorkspaceWithMembersType;
};

export type ChangeWorkspaceMemberRoleType = {
  workspaceId: string;
  data: {
    roleId: string;
    memberId: string;
  };
};

export type AllMembersInWorkspaceResponseType = {
  message: string;
  members: {
    _id: string;
    userId: {
      _id: string;
      name: string;
      email: string;
      profilePicture: string | null;
    };
    workspaceId: string;
    role: {
      _id: string;
      name: string;
    };
    joinedAt: string;
    createdAt: string;
  }[];
  roles: RoleType[];
};

export type AnalyticsResponseType = {
  message: string;
  analytics: {
    totalTasks: number;
    overdueTasks: number;
    completedTasks: number;
  };
};

export type PaginationType = {
  totalCount: number;
  pageSize: number;
  pageNumber: number;
  totalPages: number;
  skip: number;
  limit: number;
};

export type RoleType = {
  _id: string;
  name: string;
};
// *********** MEMBER ****************

//******** */ PROJECT TYPES ****************
//****************************************** */
export type ProjectType = {
  _id: string;
  name: string;
  emoji: string;
  description: string;
  workspace: string;
  createdBy: {
    _id: string;
    name: string;
    profilePicture: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type CreateProjectPayloadType = {
  workspaceId: string;
  data: {
    emoji: string;
    name: string;
    description: string;
  };
};

export type ProjectResponseType = {
  message: "Project created successfully";
  project: ProjectType;
};

export type EditProjectPayloadType = {
  workspaceId: string;
  projectId: string;
  data: {
    emoji: string;
    name: string;
    description: string;
  };
};

//ALL PROJECTS IN WORKSPACE TYPE
export type AllProjectPayloadType = {
  workspaceId: string;
  pageNumber?: number;
  pageSize?: number;
  keyword?: string;
  skip?: boolean;
};

export type AllProjectResponseType = {
  message: string;
  projects: ProjectType[];
  pagination: PaginationType;
};

// SINGLE PROJECT IN WORKSPACE TYPE
export type ProjectByIdPayloadType = {
  workspaceId: string;
  projectId: string;
};

//********** */ TASK TYPES ************************
//************************************************* */

export type CreateTaskPayloadType = {
  workspaceId: string;
  projectId: string;
  data: {
    title: string;
    description: string;
    priority: TaskPriorityEnumType;
    status: TaskStatusEnumType;
    assignedTo: string;
    dueDate: string;
  };
};


//added new for edtiting of task
export type EditTaskPayloadType = {
  taskId: string;
  workspaceId: string;
  projectId: string;
  data: Partial<{
    title: string;
    description: string;
    priority: TaskPriorityEnumType;
    status: TaskStatusEnumType;
    assignedTo: string;
    dueDate: string;
  }>;
};


export type TaskType = {
  _id: string;
  title: string;
  description?: string;
  project?: {
    _id: string;
    emoji: string;
    name: string;
  };
  priority: TaskPriorityEnumType;
  status: TaskStatusEnumType;
  assignedTo: {
    _id: string;
    name: string;
    profilePicture: string | null;
  } | null;
  createdBy?: string;
  dueDate: string;
  taskCode: string;
  createdAt?: string;
  updatedAt?: string;
};

export type AllTaskPayloadType = {
  workspaceId: string;
  projectId?: string | null;
  keyword?: string | null;
  priority?: TaskPriorityEnumType | null;
  status?: TaskStatusEnumType | null;
  assignedTo?: string | null;
  dueDate?: string | null;
  pageNumber?: number | null;
  pageSize?: number | null;
};

export type AllTaskResponseType = {
  message: string;
  tasks: TaskType[];
  pagination: PaginationType;
};

// ==========================================
// NEWTONITE OPERATIONS MANAGEMENT TYPES
// ==========================================

export type WorkItemState =
  | "OPEN"
  | "IN_PROGRESS"
  | "PENDING_APPROVAL"
  | "RESOLVED"
  | "CLOSED";

export type WorkItemPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export type WorkItemRequestType =
  | "customer_issue"
  | "incident"
  | "payment"
  | "compliance"
  | "task";

export type WorkItemType = {
  _id: string;
  workspaceId: string;
  teamId: { _id: string; name: string } | string;
  requesterId: { _id: string; name: string; email: string } | string;
  ownerId?: { _id: string; name: string; email: string } | null;
  approverId?: { _id: string; name: string; email: string } | null;
  title: string;
  description: string;
  requestType: WorkItemRequestType;
  priority: WorkItemPriority;
  state: WorkItemState;
  requiresApproval: boolean;
  dueDate?: string | null;
  lastActivityAt: string;
  version: number;
  commentCount: number;
  resolutionNote?: string | null;
  attentionReason?: string;
  allowedActions: string[];
  createdAt: string;
  updatedAt: string;
};

export type AttentionResponseType = {
  waitingApproval: WorkItemType[];
  mineOverdue: WorkItemType[];
  unassignedUrgent: WorkItemType[];
  stale: WorkItemType[];
  changedSinceLastSeen: WorkItemType[];
};

export type ListItemsResponseType = {
  items: WorkItemType[];
  hasMore: boolean;
  nextCursor: string | null;
};

export type ItemEventUser = {
  _id: string;
  name: string;
  email: string;
};

export type ItemEventType = {
  _id: string;
  itemId: string;
  workspaceId: string;
  actorId: ItemEventUser | string;
  type: string;
  from?: string | null;
  to?: string | null;
  payload?: any;
  requestId?: string | null;
  createdAt: string;
};

export type ListEventsResponseType = {
  events: ItemEventType[];
  hasMore: boolean;
  nextCursor: string | null;
};

export type TeamType = {
  _id: string;
  name: string;
  workspaceId: string;
  leadId?: { _id: string; name: string; email: string } | null;
  createdAt?: string;
};

export type NotificationType = {
  _id: string;
  userId: string;
  workspaceId: string;
  itemId?: string | null;
  title: string;
  message: string;
  dedupeKey: string;
  read: boolean;
  createdAt: string;
};
