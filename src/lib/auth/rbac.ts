import type { Role } from "@/generated/prisma/enums";
import { forbidden } from "@/lib/errors";

/**
 * Permission catalogue. Roles map to a fixed permission set; call sites ask
 * for a permission, never for a role, so adding a role later is a one-line
 * change here instead of a codebase-wide grep.
 */
export const PERMISSIONS = [
  "customer:read",
  "customer:write",
  "order:read",
  "order:write",
  "order:cancel",
  "order:refund",
  "ticket:read",
  "ticket:write",
  "knowledge:read",
  "knowledge:write",
  "email:read",
  "email:send",
  "agent:use",
  "approval:read",
  "approval:decide",
  "audit:read",
  "analytics:read",
  "settings:read",
  "settings:write",
  "user:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const VIEWER: Permission[] = [
  "customer:read",
  "order:read",
  "ticket:read",
  "knowledge:read",
  "email:read",
  "approval:read",
  "audit:read",
  "analytics:read",
  "settings:read",
];

const AGENT: Permission[] = [
  ...VIEWER,
  "customer:write",
  "order:write",
  "ticket:write",
  "knowledge:write",
  "email:send",
  "agent:use",
];

const ADMIN: Permission[] = [
  ...AGENT,
  "order:cancel",
  "order:refund",
  "approval:decide",
  "settings:write",
  "user:manage",
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  VIEWER,
  AGENT,
  ADMIN,
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  ADMIN:
    "Full access. Can approve high-risk agent actions, cancel and refund orders, and manage settings.",
  AGENT:
    "Day-to-day operator. Can use the AI agent, manage customers, orders, tickets and knowledge, and send email.",
  VIEWER: "Read-only access to dashboards, records, approvals and audit history.",
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function assertPermission(role: Role, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw forbidden(PERMISSION_LABELS[permission]);
  }
}

const PERMISSION_LABELS: Record<Permission, string> = {
  "customer:read": "view customers",
  "customer:write": "modify customers",
  "order:read": "view orders",
  "order:write": "modify orders",
  "order:cancel": "cancel orders",
  "order:refund": "issue refunds",
  "ticket:read": "view tickets",
  "ticket:write": "modify tickets",
  "knowledge:read": "read the knowledge base",
  "knowledge:write": "manage knowledge documents",
  "email:read": "view sent email",
  "email:send": "send customer email",
  "agent:use": "use the AI agent",
  "approval:read": "view approvals",
  "approval:decide": "approve or reject agent actions",
  "audit:read": "view audit logs",
  "analytics:read": "view analytics",
  "settings:read": "view settings",
  "settings:write": "change settings",
  "user:manage": "manage users",
};
