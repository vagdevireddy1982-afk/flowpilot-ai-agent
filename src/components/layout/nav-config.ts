import {
  Activity,
  BarChart3,
  BookOpen,
  Bot,
  LayoutDashboard,
  LifeBuoy,
  Package,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Permission } from "@/lib/auth/rbac";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: Permission;
  /** Shown in the command palette as a hint. */
  keywords?: string[];
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Operate",
    items: [
      {
        href: "/dashboard",
        label: "Dashboard",
        icon: LayoutDashboard,
        permission: "analytics:read",
        keywords: ["home", "overview"],
      },
      {
        href: "/agent",
        label: "AI Agent",
        icon: Bot,
        permission: "agent:use",
        keywords: ["chat", "assistant", "ask"],
      },
      {
        href: "/approvals",
        label: "Approvals",
        icon: ShieldCheck,
        permission: "approval:read",
        keywords: ["human in the loop", "confirm"],
      },
    ],
  },
  {
    label: "Records",
    items: [
      {
        href: "/customers",
        label: "Customers",
        icon: Users,
        permission: "customer:read",
        keywords: ["accounts", "people"],
      },
      {
        href: "/orders",
        label: "Orders",
        icon: Package,
        permission: "order:read",
        keywords: ["purchases", "refunds"],
      },
      {
        href: "/tickets",
        label: "Support tickets",
        icon: LifeBuoy,
        permission: "ticket:read",
        keywords: ["issues", "cases"],
      },
      {
        href: "/knowledge",
        label: "Knowledge base",
        icon: BookOpen,
        permission: "knowledge:read",
        keywords: ["rag", "documents", "policies"],
      },
    ],
  },
  {
    label: "Oversight",
    items: [
      {
        href: "/activity",
        label: "Activity log",
        icon: Activity,
        permission: "audit:read",
        keywords: ["audit", "history", "email"],
      },
      {
        href: "/analytics",
        label: "Analytics",
        icon: BarChart3,
        permission: "analytics:read",
        keywords: ["metrics", "cost", "latency"],
      },
      {
        href: "/settings",
        label: "Settings",
        icon: Settings,
        permission: "settings:read",
        keywords: ["profile", "provider", "roles"],
      },
    ],
  },
];
