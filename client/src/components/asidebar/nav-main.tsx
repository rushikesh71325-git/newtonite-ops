import {
  LucideIcon,
  Settings,
  Users,
  ShieldAlert,
  Layers,
} from "lucide-react";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Link, useLocation } from "react-router-dom";
import useWorkspaceId from "@/hooks/use-workspace-id";
import { useAuthContext } from "@/context/auth-provider";
import { Permissions } from "@/constant";

type ItemType = {
  title: string;
  url: string;
  icon: LucideIcon;
  badge?: string;
};

export function NavMain() {
  const { hasPermission } = useAuthContext();

  const canManageSettings = hasPermission(
    Permissions.MANAGE_WORKSPACE_SETTINGS
  );

  const workspaceId = useWorkspaceId();
  const location = useLocation();

  const pathname = location.pathname;

  const items: ItemType[] = [
    {
      title: "Needs Attention",
      url: `/workspace/${workspaceId}/attention`,
      icon: ShieldAlert,
    },
    {
      title: "Work Items",
      url: `/workspace/${workspaceId}/items`,
      icon: Layers,
    },
    {
      title: "Members",
      url: `/workspace/${workspaceId}/members`,
      icon: Users,
    },

    ...(canManageSettings
      ? [
          {
            title: "Settings",
            url: `/workspace/${workspaceId}/settings`,
            icon: Settings,
          },
        ]
      : []),
  ];
  return (
    <SidebarGroup>
      <SidebarMenu>
        {items.map((item) => {
          const isActive =
            item.url === pathname ||
            (item.title === "Needs Attention" &&
              pathname === `/workspace/${workspaceId}`);
          return (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton isActive={isActive} asChild>
                <Link to={item.url} className="!text-[15px]">
                  <item.icon />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
