import API from "./axios-client";
import {
  AllMembersInWorkspaceResponseType,
  AnalyticsResponseType,
  ChangeWorkspaceMemberRoleType,
  CreateWorkspaceResponseType,
} from "../types/api.type";
import {
  AllWorkspaceResponseType,
  CreateWorkspaceType,
  CurrentUserResponseType,
  LoginResponseType,
  loginType,
  registerType,
  WorkspaceByIdResponseType,
  EditWorkspaceType,
  AttentionResponseType,
  ListItemsResponseType,
  WorkItemType,
  ListEventsResponseType,
  ItemEventType,
  TeamType,
  NotificationType,
} from "@/types/api.type";

export const loginMutationFn = async (
  data: loginType
): Promise<LoginResponseType> => {
  const response = await API.post("/auth/login", data);
  return response.data;
};

export const registerMutationFn = async (data: registerType) =>
  await API.post("/auth/register", data);

export const logoutMutationFn = async () => await API.post("/auth/logout");

export const getCurrentUserQueryFn =
  async (): Promise<CurrentUserResponseType> => {
    const response = await API.get(`/user/current`);
    return response.data;
  };

//********* WORKSPACE ****************
//************* */

export const createWorkspaceMutationFn = async (
  data: CreateWorkspaceType
): Promise<CreateWorkspaceResponseType> => {
  const response = await API.post(`/workspace/create/new`, data);
  return response.data;
};

export const editWorkspaceMutationFn = async ({
  workspaceId,
  data,
}: EditWorkspaceType) => {
  const response = await API.put(`/workspace/update/${workspaceId}`, data);
  return response.data;
};

export const getAllWorkspacesUserIsMemberQueryFn =
  async (): Promise<AllWorkspaceResponseType> => {
    const response = await API.get(`/workspace/all`);
    return response.data;
  };

export const getWorkspaceByIdQueryFn = async (
  workspaceId: string
): Promise<WorkspaceByIdResponseType> => {
  const response = await API.get(`/workspace/${workspaceId}`);
  return response.data;
};

export const getMembersInWorkspaceQueryFn = async (
  workspaceId: string
): Promise<AllMembersInWorkspaceResponseType> => {
  const response = await API.get(`/workspace/members/${workspaceId}`);
  return response.data;
};

export const getWorkspaceAnalyticsQueryFn = async (
  workspaceId: string
): Promise<AnalyticsResponseType> => {
  const response = await API.get(`/workspace/analytics/${workspaceId}`);
  return response.data;
};

export const changeWorkspaceMemberRoleMutationFn = async ({
  workspaceId,
  data,
}: ChangeWorkspaceMemberRoleType) => {
  const response = await API.put(
    `/workspace/change/member/role/${workspaceId}`,
    data
  );
  return response.data;
};

export const deleteWorkspaceMutationFn = async (
  workspaceId: string
): Promise<{
  message: string;
  currentWorkspace: string;
}> => {
  const response = await API.delete(`/workspace/delete/${workspaceId}`);
  return response.data;
};

//*******MEMBER ****************

export const invitedUserJoinWorkspaceMutationFn = async (
  iniviteCode: string
): Promise<{
  message: string;
  workspaceId: string;
}> => {
  const response = await API.post(`/member/workspace/${iniviteCode}/join`);
  return response.data;
};

// ==========================================
// NEWTONITE OPERATIONS API FUNCTIONS
// ==========================================

export const getAttentionQueryFn = async (
  workspaceId: string,
  staleDays?: number
): Promise<AttentionResponseType> => {
  const url = staleDays ? `/items/attention?staleDays=${staleDays}` : `/items/attention`;
  const response = await API.get(url, {
    headers: { "x-workspace-id": workspaceId },
  });
  return response.data;
};

export const getItemsInfiniteQueryFn = async ({
  workspaceId,
  cursor,
  limit = 25,
  state,
  priority,
  teamId,
  ownerId,
  requestType,
  search,
}: {
  workspaceId: string;
  cursor?: string | null;
  limit?: number;
  state?: string | string[];
  priority?: string | string[];
  teamId?: string;
  ownerId?: string;
  requestType?: string | string[];
  search?: string;
}): Promise<ListItemsResponseType> => {
  const params = new URLSearchParams();
  if (cursor) params.append("cursor", cursor);
  if (limit) params.append("limit", limit.toString());
  if (teamId) params.append("teamId", teamId);
  if (ownerId) params.append("ownerId", ownerId);
  if (search) params.append("search", search);

  if (state) {
    if (Array.isArray(state)) state.forEach((s) => params.append("state", s));
    else params.append("state", state);
  }
  if (priority) {
    if (Array.isArray(priority)) priority.forEach((p) => params.append("priority", p));
    else params.append("priority", priority);
  }
  if (requestType) {
    if (Array.isArray(requestType)) requestType.forEach((r) => params.append("requestType", r));
    else params.append("requestType", requestType);
  }

  const response = await API.get(`/items?${params.toString()}`, {
    headers: { "x-workspace-id": workspaceId },
  });
  return response.data;
};

export const getItemByIdQueryFn = async ({
  workspaceId,
  itemId,
}: {
  workspaceId: string;
  itemId: string;
}): Promise<{ item: WorkItemType }> => {
  const response = await API.get(`/items/${itemId}`, {
    headers: { "x-workspace-id": workspaceId },
  });
  return response.data;
};

export const getItemEventsQueryFn = async ({
  workspaceId,
  itemId,
  cursor,
  limit = 20,
}: {
  workspaceId: string;
  itemId: string;
  cursor?: string | null;
  limit?: number;
}): Promise<ListEventsResponseType> => {
  const params = new URLSearchParams();
  if (cursor) params.append("cursor", cursor);
  if (limit) params.append("limit", limit.toString());

  const response = await API.get(`/items/${itemId}/events?${params.toString()}`, {
    headers: { "x-workspace-id": workspaceId },
  });
  return response.data;
};

export const recordItemViewMutationFn = async ({
  workspaceId,
  itemId,
}: {
  workspaceId: string;
  itemId: string;
}) => {
  const response = await API.post(
    `/items/${itemId}/view`,
    {},
    { headers: { "x-workspace-id": workspaceId } }
  );
  return response.data;
};

export const createItemMutationFn = async ({
  workspaceId,
  data,
  idempotencyKey,
}: {
  workspaceId: string;
  data: any;
  idempotencyKey?: string;
}): Promise<{ message: string; item: WorkItemType }> => {
  const headers: Record<string, string> = { "x-workspace-id": workspaceId };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const response = await API.post("/items", data, { headers });
  return response.data;
};

export const updateItemFieldsMutationFn = async ({
  workspaceId,
  itemId,
  data,
  idempotencyKey,
}: {
  workspaceId: string;
  itemId: string;
  data: {
    expectedVersion: number;
    title?: string;
    description?: string;
    priority?: string;
    dueDate?: string | null;
  };
  idempotencyKey?: string;
}): Promise<{ message: string; item: WorkItemType }> => {
  const headers: Record<string, string> = { "x-workspace-id": workspaceId };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const response = await API.patch(`/items/${itemId}`, data, { headers });
  return response.data;
};

export const claimItemMutationFn = async ({
  workspaceId,
  itemId,
  expectedVersion,
  idempotencyKey,
}: {
  workspaceId: string;
  itemId: string;
  expectedVersion?: number;
  idempotencyKey?: string;
}): Promise<{ message: string; item: WorkItemType }> => {
  const headers: Record<string, string> = { "x-workspace-id": workspaceId };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const response = await API.post(
    `/items/${itemId}/claim`,
    { expectedVersion },
    { headers }
  );
  return response.data;
};

export const releaseItemMutationFn = async ({
  workspaceId,
  itemId,
  expectedVersion,
  idempotencyKey,
}: {
  workspaceId: string;
  itemId: string;
  expectedVersion?: number;
  idempotencyKey?: string;
}): Promise<{ message: string; item: WorkItemType }> => {
  const headers: Record<string, string> = { "x-workspace-id": workspaceId };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const response = await API.post(
    `/items/${itemId}/release`,
    { expectedVersion },
    { headers }
  );
  return response.data;
};

export const transitionItemMutationFn = async ({
  workspaceId,
  itemId,
  action,
  data,
  idempotencyKey,
}: {
  workspaceId: string;
  itemId: string;
  action: string;
  data: {
    expectedVersion: number;
    resolutionNote?: string;
    reason?: string;
    comment?: string;
    approverId?: string | null;
    requiresApproval?: boolean;
  };
  idempotencyKey?: string;
}): Promise<{ message: string; item: WorkItemType }> => {
  const headers: Record<string, string> = { "x-workspace-id": workspaceId };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const response = await API.post(
    `/items/${itemId}/transition`,
    { action, ...data },
    { headers }
  );
  return response.data;
};

export const addCommentMutationFn = async ({
  workspaceId,
  itemId,
  text,
  idempotencyKey,
}: {
  workspaceId: string;
  itemId: string;
  text: string;
  idempotencyKey?: string;
}): Promise<{ message: string; event: ItemEventType }> => {
  const headers: Record<string, string> = { "x-workspace-id": workspaceId };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const response = await API.post(`/items/${itemId}/comments`, { text }, { headers });
  return response.data;
};

export const getTeamsQueryFn = async (
  workspaceId: string
): Promise<{ teams: TeamType[] }> => {
  const response = await API.get("/teams", {
    headers: { "x-workspace-id": workspaceId },
  });
  return response.data;
};

export const getNotificationsQueryFn = async (
  workspaceId: string
): Promise<{ notifications: NotificationType[] }> => {
  const response = await API.get("/notifications", {
    headers: { "x-workspace-id": workspaceId },
  });
  return response.data;
};

