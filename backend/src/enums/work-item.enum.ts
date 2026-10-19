export const WorkItemStateEnum = {
  OPEN: "OPEN",
  IN_PROGRESS: "IN_PROGRESS",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  RESOLVED: "RESOLVED",
  CLOSED: "CLOSED",
} as const;

export type WorkItemStateType =
  (typeof WorkItemStateEnum)[keyof typeof WorkItemStateEnum];

export const WorkItemPriorityEnum = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  URGENT: "URGENT",
} as const;

export type WorkItemPriorityType =
  (typeof WorkItemPriorityEnum)[keyof typeof WorkItemPriorityEnum];

export const WorkItemRequestTypeEnum = {
  CUSTOMER_ISSUE: "customer_issue",
  INCIDENT: "incident",
  PAYMENT: "payment",
  COMPLIANCE: "compliance",
  TASK: "task",
} as const;

export type WorkItemRequestType =
  (typeof WorkItemRequestTypeEnum)[keyof typeof WorkItemRequestTypeEnum];

export const ItemEventTypeEnum = {
  CREATED: "created",
  STATE_CHANGED: "state_changed",
  FIELDS_CHANGED: "fields_changed",
  DELETED: "deleted",
  CLAIMED: "claimed",
  RELEASED: "released",
  REASSIGNED: "reassigned",
  PRIORITY_CHANGED: "priority_changed",
  COMMENT_ADDED: "comment_added",
  APPROVAL_REQUESTED: "approval_requested",
  APPROVED: "approved",
  REJECTED: "rejected",
  TEAM_CHANGED: "team_changed",
} as const;

export type ItemEventType =
  (typeof ItemEventTypeEnum)[keyof typeof ItemEventTypeEnum];

export const TeamMemberRoleEnum = {
  MEMBER: "member",
  LEAD: "lead",
} as const;

export type TeamMemberRoleType =
  (typeof TeamMemberRoleEnum)[keyof typeof TeamMemberRoleEnum];

export const OutboxJobStatusEnum = {
  PENDING: "pending",
  PROCESSING: "processing",
  DONE: "done",
  DEAD: "dead",
} as const;

export type OutboxJobStatusType =
  (typeof OutboxJobStatusEnum)[keyof typeof OutboxJobStatusEnum];
