export const isAuthRoute = (pathname: string): boolean => {
  return Object.values(AUTH_ROUTES).includes(pathname);
};

export const AUTH_ROUTES = {
  SIGN_IN: "/",
  SIGN_UP: "/sign-up",
};

export const PROTECTED_ROUTES = {
  WORKSPACE: "/workspace/:workspaceId",
  ATTENTION: "/workspace/:workspaceId/attention",
  ITEMS: "/workspace/:workspaceId/items",
  ITEM_DETAILS: "/workspace/:workspaceId/items/:itemId",
  MEMBERS: "/workspace/:workspaceId/members",
  SETTINGS: "/workspace/:workspaceId/settings",
};

export const BASE_ROUTE = {
  INVITE_URL: "/invite/workspace/:inviteCode/join",
};
