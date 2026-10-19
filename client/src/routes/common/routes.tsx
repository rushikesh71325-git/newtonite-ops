import SignIn from "@/page/auth/Sign-in";
import SignUp from "@/page/auth/Sign-up";
import NeedsAttention from "@/page/workspace/NeedsAttention";
import WorkItems from "@/page/workspace/WorkItems";
import WorkItemDetail from "@/page/workspace/WorkItemDetail";
import Members from "@/page/workspace/Members";
import Settings from "@/page/workspace/Settings";
import { AUTH_ROUTES, BASE_ROUTE, PROTECTED_ROUTES } from "./routePaths";
import InviteUser from "@/page/invite/InviteUser";

export const authenticationRoutePaths = [
  { path: AUTH_ROUTES.SIGN_IN, element: <SignIn /> },
  { path: AUTH_ROUTES.SIGN_UP, element: <SignUp /> },
];

export const protectedRoutePaths = [
  { path: PROTECTED_ROUTES.WORKSPACE, element: <NeedsAttention /> },
  { path: PROTECTED_ROUTES.ATTENTION, element: <NeedsAttention /> },
  { path: PROTECTED_ROUTES.ITEMS, element: <WorkItems /> },
  { path: PROTECTED_ROUTES.ITEM_DETAILS, element: <WorkItemDetail /> },
  { path: PROTECTED_ROUTES.MEMBERS, element: <Members /> },
  { path: PROTECTED_ROUTES.SETTINGS, element: <Settings /> },
];

export const baseRoutePaths = [
  { path: BASE_ROUTE.INVITE_URL, element: <InviteUser /> },
];
